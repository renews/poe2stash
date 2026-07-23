import { Items } from "../data/items";
import { Poe2Item } from "./types";

type ItemCategoryGroup = {
  id: string;
  entries: Array<{ type: string }>;
};

const ITEM_CATEGORY_BY_BASE_TYPE = new Map(
  (Items as ItemCategoryGroup[]).flatMap(({ id, entries }) =>
    entries.map(({ type }) => [
      type.toLowerCase(),
      id === "sanctum" ? "sanctum.relic" : id,
    ]),
  ),
);

const ITEM_CLASS_CATEGORIES = [
  ["two hand sword", "weapon.twosword"],
  ["one hand sword", "weapon.onesword"],
  ["two hand axe", "weapon.twoaxe"],
  ["one hand axe", "weapon.oneaxe"],
  ["two hand mace", "weapon.twomace"],
  ["one hand mace", "weapon.onemace"],
  ["quarterstaff", "weapon.warstaff"],
  ["crossbow", "weapon.crossbow"],
  ["sceptre", "weapon.sceptre"],
  ["dagger", "weapon.dagger"],
  ["spear", "weapon.spear"],
  ["flail", "weapon.flail"],
  ["claw", "weapon.claw"],
  ["wand", "weapon.wand"],
  ["staff", "weapon.staff"],
  ["bow", "weapon.bow"],
  ["fishing rod", "weapon.rod"],
  ["body armour", "armour.chest"],
  ["vaal helmet", "armour.helmet"],
  ["helmet", "armour.helmet"],
  ["gloves", "armour.gloves"],
  ["boots", "armour.boots"],
  ["buckler", "armour.buckler"],
  ["shield", "armour.shield"],
  ["quiver", "armour.quiver"],
  ["focus", "armour.focus"],
  ["amulet", "accessory.amulet"],
  ["ring", "accessory.ring"],
  ["belt", "accessory.belt"],
  ["jewel", "jewel"],
] as const;

const BASE_TYPE_CATEGORY_PATTERNS = [
  { pattern: /\bamulet\b/, category: "accessory.amulet" },
  { pattern: /\bring\b/, category: "accessory.ring" },
  { pattern: /\bbelt\b/, category: "accessory.belt" },
  { pattern: /\bquiver\b/, category: "armour.quiver" },
  { pattern: /\bbuckler\b/, category: "armour.buckler" },
  { pattern: /\bfocus\b/, category: "armour.focus" },
  { pattern: /\b(?:shield|targe)\b/, category: "armour.shield" },
  {
    pattern:
      /\b(?:regalia|body armour|cuirass|brigandine|chainmail|coat|garb|garment|jacket|mail|mantle|plate|raiment|robe|vest|vestments)\b/,
    category: "armour.chest",
  },
  {
    pattern:
      /\b(?:helmet|helm|pelt|hood|circlet|crown|burgonet|greathelm|visage)\b/,
    category: "armour.helmet",
  },
  {
    pattern: /\b(?:gloves|gauntlets|mitts|wraps|bracers)\b/,
    category: "armour.gloves",
  },
  {
    pattern:
      /\b(?:boots|greaves|shoes|slippers|sabatons|sandals|leggings|cuisses)\b/,
    category: "armour.boots",
  },
  { pattern: /\bquarterstaff\b/, category: "weapon.warstaff" },
  { pattern: /\bcrossbow\b/, category: "weapon.crossbow" },
  { pattern: /\bsceptre\b/, category: "weapon.sceptre" },
  { pattern: /\b(?:dagger|knife|dirk|shank)\b/, category: "weapon.dagger" },
  { pattern: /\bspear\b/, category: "weapon.spear" },
  { pattern: /\bflail\b/, category: "weapon.flail" },
  { pattern: /\bclaw\b/, category: "weapon.claw" },
  { pattern: /\bwand\b/, category: "weapon.wand" },
  { pattern: /\bstaff\b/, category: "weapon.staff" },
  { pattern: /\bbow\b/, category: "weapon.bow" },
  { pattern: /\bfishing rod\b/, category: "weapon.rod" },
  { pattern: /\bjewel\b/, category: "jewel" },
  { pattern: /\blife flask\b/, category: "flask.life" },
  { pattern: /\bmana flask\b/, category: "flask.mana" },
  { pattern: /\bwaystone\b/, category: "map.waystone" },
  { pattern: /\blogbook\b/, category: "map.logbook" },
  { pattern: /\bbreachstone\b/, category: "map.breachstone" },
  { pattern: /\bbarya\b/, category: "map.barya" },
  { pattern: /\btablet\b/, category: "map.tablet" },
  { pattern: /\b(?:rune|runes)\b/, category: "currency.rune" },
  { pattern: /\bsoul core\b/, category: "currency.soulcore" },
  { pattern: /\btalisman\b/, category: "currency.talisman" },
  { pattern: /\bomen\b/, category: "currency.omen" },
  { pattern: /\brelic\b/, category: "sanctum.relic" },
] as const;

const FRAME_TYPE_CATEGORIES: Record<number, string> = {
  4: "gem",
  5: "currency",
  6: "card",
  9: "sanctum.relic",
};

function normalizeItemClass(value: string) {
  return value
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .trim()
    .toLowerCase();
}

const IRREGULAR_PLURAL_ITEM_CLASSES: Record<string, string> = {
  foci: "focus",
  quarterstaves: "quarterstaff",
  staves: "staff",
};

function getCategoryFromItemClass(item: Poe2Item) {
  for (const property of item.item?.properties || []) {
    const itemClass = normalizeItemClass(property.name || "");
    const singularItemClass =
      IRREGULAR_PLURAL_ITEM_CLASSES[itemClass] || itemClass.replace(/s$/, "");
    const match = ITEM_CLASS_CATEGORIES.find(([name]) =>
      [itemClass, singularItemClass].some((candidate) =>
        candidate.endsWith(name),
      ),
    );
    if (match) {
      return match[1];
    }
  }
}

export function getItemCategory(item: Poe2Item, isGem = false) {
  if (isGem) {
    return "gem";
  }

  const itemClassCategory = getCategoryFromItemClass(item);
  if (itemClassCategory) {
    return itemClassCategory;
  }

  const baseType = item.item?.baseType || item.item?.typeLine || "";
  const text = `${baseType} ${item.item?.typeLine || ""}`.toLowerCase();
  const dataCategory = ITEM_CATEGORY_BY_BASE_TYPE.get(baseType.toLowerCase());
  const patternCategory = BASE_TYPE_CATEGORY_PATTERNS.find(
    ({ pattern, category }) =>
      (!dataCategory ||
        category === dataCategory ||
        category.startsWith(`${dataCategory}.`)) &&
      pattern.test(text),
  )?.category;
  if (patternCategory) {
    return patternCategory;
  }

  const frameTypeCategory = FRAME_TYPE_CATEGORIES[item.item?.frameType];
  if (frameTypeCategory) {
    return frameTypeCategory;
  }

  const rarity = item.item?.rarity?.toLowerCase();
  if (
    rarity === "rare" &&
    (dataCategory === "accessory" ||
      dataCategory === "armour" ||
      dataCategory === "weapon")
  ) {
    return undefined;
  }

  return dataCategory;
}
