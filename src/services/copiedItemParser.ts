import { Poe2Item } from "./types";
import { Items } from "../data/items";

const SECTION_SEPARATOR = /^-{8,}$/;
const FRAME_TYPE_BY_RARITY: Record<string, number> = {
  Normal: 0,
  Magic: 1,
  Rare: 2,
  Unique: 3,
  Gem: 4,
  Currency: 5,
};
const COPIED_ITEM_PROPERTY_NAMES = new Set([
  "Armour",
  "Block Chance",
  "Chaos Damage",
  "Cold Damage",
  "Critical Hit Chance",
  "Elemental Damage",
  "Energy Shield",
  "Evasion Rating",
  "Fire Damage",
  "Lightning Damage",
  "Physical Damage",
  "Spirit",
  "Attacks per Second",
]);
const KNOWN_BASE_TYPES = [
  ...new Set(
    Items.flatMap((group) => group.entries.map((entry) => entry.type)),
  ),
].sort((left, right) => right.length - left.length);

function createStableId(text: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `clipboard-${(hash >>> 0).toString(16)}`;
}

function splitSections(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .reduce<string[][]>(
      (sections, rawLine) => {
        const line = rawLine.trim();
        if (SECTION_SEPARATOR.test(line)) {
          if (sections.at(-1)?.length) {
            sections.push([]);
          }
        } else if (line) {
          sections.at(-1)?.push(line);
        }
        return sections;
      },
      [[]],
    )
    .filter((section) => section.length > 0);
}

function parseRequiredLevel(line: string) {
  const level = line.match(/\bLevel\s+(\d+)/i)?.[1];
  return level
    ? [
        {
          name: "Level",
          values: [[level, 0] as [string, number]],
          displayMode: 0,
          type: 0,
        },
      ]
    : [];
}

function normalizeModifier(line: string) {
  return line
    .replace(/(?<=\d)\([^)]*\)/g, "")
    .replace(/\s+[\u2014-]\s+Unscalable Value$/i, "")
    .replace(
      /\s+\((?:implicit|rune|crafted|desecrated|fractured|mutated)\)$/i,
      "",
    )
    .trim();
}

function resolveKnownBaseType(displayName: string) {
  const normalizedName = displayName.toLowerCase();
  return KNOWN_BASE_TYPES.find((baseType) =>
    normalizedName.includes(baseType.toLowerCase()),
  );
}

function resolveEquipmentBaseType(
  displayName: string,
  allowUnknownBaseType: boolean,
) {
  const withoutTierPrefix = displayName.replace(/^Exceptional\s+/i, "");
  return (
    resolveKnownBaseType(withoutTierPrefix) ||
    (allowUnknownBaseType ? withoutTierPrefix : undefined)
  );
}

function isListingNote(line: string) {
  return /^Notes?:\s*/i.test(line);
}

function parseRuneSockets(lines: string[]) {
  const socketsLine = lines.find((line) => /^Sockets:\s*/i.test(line));
  if (!socketsLine) {
    return undefined;
  }

  const count = socketsLine.match(/\bS\b/gi)?.length || 0;
  return Array.from({ length: count }, () => ({}));
}

function isItemMetadata(line: string) {
  return isListingNote(line) || /^Sockets:\s*/i.test(line);
}

function parseCopiedItemProperty(line: string) {
  const match = line.match(/^([^:]+):\s*(.+)$/);
  const name = match?.[1]?.trim();
  if (!name || !COPIED_ITEM_PROPERTY_NAMES.has(name)) {
    return undefined;
  }

  const value = match![2].replace(/\s+\([^)]*\)\s*$/, "").trim();
  return {
    name,
    values: [[value, 0] as [string, number]],
    displayMode: 0,
  };
}

export function parseCopiedItemText(rawText: string): Poe2Item {
  const sections = splitSections(rawText);
  const header = sections[0] || [];
  const hasItemClass = /^Item Class:/i.test(header[0] || "");
  const rarityIndex = hasItemClass ? 1 : 0;
  const itemClass = hasItemClass
    ? header[0]?.match(/^Item Class:\s*(.+)$/i)?.[1]
    : "Skill Gems";
  const rarity = header[rarityIndex]?.match(/^Rarity:\s*(.+)$/i)?.[1];
  const displayName = header[rarityIndex + 1];
  const hasSeparateBaseType = rarity === "Rare" || rarity === "Unique";
  const name = hasSeparateBaseType
    ? displayName
    : rarity === "Gem"
      ? displayName
      : "";
  const typeLine = hasSeparateBaseType ? header[rarityIndex + 2] : displayName;
  const equipmentBaseTypeSource = hasSeparateBaseType ? typeLine : displayName;
  const baseType =
    rarity === "Gem" || rarity === "Currency"
      ? displayName
      : equipmentBaseTypeSource
        ? resolveEquipmentBaseType(
            equipmentBaseTypeSource,
            rarity !== "Magic",
          )
        : undefined;

  const frameType = rarity ? FRAME_TYPE_BY_RARITY[rarity] : undefined;
  if (
    !itemClass ||
    !rarity ||
    frameType === undefined ||
    !displayName ||
    !baseType
  ) {
    throw new Error("Paste a complete English Path of Exile item description.");
  }

  let itemLevel = 0;
  let corrupted = false;
  let requirements: Poe2Item["item"]["requirements"] = [];
  const implicitMods: string[] = [];
  const explicitMods: string[] = [];
  const enchantMods: string[] = [];
  let reachedItemLevel = false;
  let parsedSimpleExplicitSection = false;
  const advancedCopy = sections.some((section) =>
    section.some((line) => /^\{.+Modifier.+\}$/.test(line)),
  );
  const propertyLines = sections.flat();
  const copiedItemProperties = propertyLines
    .map(parseCopiedItemProperty)
    .filter((property): property is NonNullable<typeof property> =>
      Boolean(property),
    );
  const gemLevel = propertyLines
    .find((line) => /^Level:\s*\d+/i.test(line))
    ?.match(/\d+/)?.[0];
  const quality = propertyLines
    .find((line) => /^Quality:\s*[+-]?\d+%/i.test(line))
    ?.match(/[+-]?\d+/)?.[0];
  const qualityValue = quality ? Number(quality) : undefined;
  const sockets = parseRuneSockets(propertyLines);

  for (const section of sections.slice(1)) {
    const requiredLine = section.find((line) => line.startsWith("Requires:"));
    const itemLevelLine = section.find((line) =>
      line.startsWith("Item Level:"),
    );

    if (requiredLine) {
      requirements = parseRequiredLevel(requiredLine);
      continue;
    }
    if (itemLevelLine) {
      itemLevel = Number(itemLevelLine.match(/\d+/)?.[0] || 0);
      reachedItemLevel = true;
      continue;
    }
    if (section.includes("Corrupted")) {
      corrupted = true;
      continue;
    }
    if (!reachedItemLevel) {
      continue;
    }

    const modifierLines = section.filter((line) => !isItemMetadata(line));
    if (!modifierLines.length) {
      continue;
    }

    if (advancedCopy) {
      let modifierType: "implicit" | "explicit" | "enchant" = "explicit";
      for (const line of modifierLines) {
        if (/^\{.+Modifier.+\}$/.test(line)) {
          modifierType = /Implicit Modifier/i.test(line)
            ? "implicit"
            : /(?:Enchant|Rune) Modifier/i.test(line)
              ? "enchant"
              : "explicit";
          continue;
        }
        if (!modifierLines.some((entry) => /^\{.+Modifier.+\}$/.test(entry))) {
          continue;
        }
        const modifier = normalizeModifier(line);
        if (modifierType === "implicit") {
          implicitMods.push(modifier);
        } else if (modifierType === "explicit") {
          explicitMods.push(modifier);
        } else {
          enchantMods.push(modifier);
        }
      }
      continue;
    }

    if (modifierLines.some((line) => line.endsWith("(implicit)"))) {
      implicitMods.push(...modifierLines.map(normalizeModifier));
    } else if (
      modifierLines.some((line) => /\s+\((?:rune|enchant)\)$/i.test(line))
    ) {
      enchantMods.push(...modifierLines.map(normalizeModifier));
    } else if (!parsedSimpleExplicitSection) {
      explicitMods.push(...modifierLines.map(normalizeModifier));
      parsedSimpleExplicitSection = true;
    }
  }

  const normalizedText = rawText.replace(/\r\n?/g, "\n").trim();
  const id = createStableId(normalizedText);

  return {
    id,
    origin: "clipboard",
    listing: {
      method: "clipboard",
      indexed: "",
      stash: { name: "Clipboard", x: 0, y: 0 },
      account: { name: "", online: null, current: false },
      price: { type: "", amount: 0, currency: "exalted" },
    },
    item: {
      realm: "pc",
      corrupted,
      verified: true,
      w: 1,
      h: 1,
      icon: "",
      league: "",
      id,
      ...(gemLevel ? { gemLevel: Number(gemLevel) } : {}),
      ...(qualityValue !== undefined ? { quality: qualityValue } : {}),
      ...(sockets ? { sockets } : {}),
      name,
      typeLine: typeLine || baseType,
      baseType,
      rarity,
      ilvl: itemLevel,
      identified: true,
      properties: [
        { name: itemClass, values: [], displayMode: 0 },
        ...copiedItemProperties,
        ...(gemLevel
          ? [
              {
                name: "Level",
                values: [[gemLevel, 0] as [string, number]],
                displayMode: 0,
              },
            ]
          : []),
        ...(qualityValue !== undefined
          ? [
              {
                name: "Quality",
                values: [
                  [`${qualityValue >= 0 ? "+" : ""}${qualityValue}%`, 0] as [
                    string,
                    number,
                  ],
                ],
                displayMode: 0,
              },
            ]
          : []),
      ],
      requirements,
      implicitMods,
      explicitMods,
      enchantMods,
      frameType,
      extended: {
        mods: { explicit: [] },
        hashes: { explicit: [] },
      },
    },
  };
}
