import { expect, test } from "bun:test";
import { parseCopiedItemText } from "../src/services/copiedItemParser";

const RARE_RING = [
  "Item Class: Rings",
  "Rarity: Rare",
  "Miracle Grip",
  "Amethyst Ring",
  "--------",
  "Requires: Level 59",
  "--------",
  "Item Level: 74",
  "--------",
  "+8% to Chaos Resistance (implicit)",
  "--------",
  "+108 to Evasion Rating",
  "+90 to maximum Life",
  "16% increased Rarity of Items found",
  "+26 to Dexterity",
  "+31 to Intelligence",
  "+13% to all Elemental Resistances",
  "--------",
  "Corrupted",
].join("\r\n");

test("parses a copied rare item for the existing price estimator", () => {
  const item = parseCopiedItemText(RARE_RING);

  expect(item.id).toBe(item.item.id);
  expect(item.origin).toBe("clipboard");
  expect(item.item).toMatchObject({
    name: "Miracle Grip",
    typeLine: "Amethyst Ring",
    baseType: "Amethyst Ring",
    rarity: "Rare",
    frameType: 2,
    ilvl: 74,
    corrupted: true,
    requirements: [
      {
        name: "Level",
        values: [["59", 0]],
      },
    ],
    implicitMods: ["+8% to Chaos Resistance"],
    explicitMods: [
      "+108 to Evasion Rating",
      "+90 to maximum Life",
      "16% increased Rarity of Items found",
      "+26 to Dexterity",
      "+31 to Intelligence",
      "+13% to all Elemental Resistances",
    ],
  });
  expect(item.item.properties).toContainEqual({
    name: "Rings",
    values: [],
    displayMode: 0,
  });
});

test("normalizes advanced unique modifiers without treating flavor text as stats", () => {
  const item = parseCopiedItemText(`Item Class: Foci
Rarity: Unique
The Eternal Spark
Crystal Focus
--------
Energy Shield: 44 (augmented)
--------
Requires: Level 26, 43 Int
--------
Item Level: 81
--------
{ Unique Modifier - Defences }
56(50-70)% increased Energy Shield
{ Unique Modifier - Mana }
40% increased Mana Regeneration Rate while stationary
{ Unique Modifier - Elemental, Lightning, Resistance }
+26(20-30)% to Lightning Resistance
--------
A flash of blue, a stormcloud's kiss,
her motionless dance the pulse of bliss`);

  expect(item.item).toMatchObject({
    name: "The Eternal Spark",
    typeLine: "Crystal Focus",
    baseType: "Crystal Focus",
    rarity: "Unique",
    frameType: 3,
    ilvl: 81,
    explicitMods: [
      "56% increased Energy Shield",
      "40% increased Mana Regeneration Rate while stationary",
      "+26% to Lightning Resistance",
    ],
  });
});

test("parses a copied gem with its exact level and quality", () => {
  const item = parseCopiedItemText(`Rarity: Gem
Spark
--------
Projectile, Lightning, Duration
Level: 15
Quality: +20%
Mana Cost: 12
--------
Requires: Level 58, 103 Int
--------
Fires a projectile that deals lightning damage.`);

  expect(item.item).toMatchObject({
    name: "Spark",
    typeLine: "Spark",
    baseType: "Spark",
    rarity: "Gem",
    frameType: 4,
    gemLevel: 15,
    quality: 20,
    requirements: [
      {
        name: "Level",
        values: [["58", 0]],
      },
    ],
    explicitMods: [],
    implicitMods: [],
  });
  expect(item.item.properties).toEqual(
    expect.arrayContaining([
      { name: "Level", values: [["15", 0]], displayMode: 0 },
      { name: "Quality", values: [["+20%", 0]], displayMode: 0 },
    ]),
  );
});

test("resolves a magic item's base type from the local item catalog", () => {
  const item = parseCopiedItemText(`Item Class: Two Hand Maces
Rarity: Magic
Crackling Temple Maul of the Brute
--------
Physical Damage: 35-72
Lightning Damage: 1-50 (lightning)
Critical Hit Chance: 5.00%
Attacks per Second: 1.20
--------
Requires: Level 28, 57 Str
--------
Item Level: 32
--------
Adds 1 to 50 Lightning Damage
+8 to Strength`);

  expect(item.item).toMatchObject({
    name: "",
    typeLine: "Crackling Temple Maul of the Brute",
    baseType: "Temple Maul",
    rarity: "Magic",
    frameType: 1,
    ilvl: 32,
    explicitMods: ["Adds 1 to 50 Lightning Damage", "+8 to Strength"],
  });
  expect(item.item.properties).toEqual(
    expect.arrayContaining([
      { name: "Physical Damage", values: [["35-72", 0]], displayMode: 0 },
      { name: "Lightning Damage", values: [["1-50", 0]], displayMode: 0 },
      {
        name: "Critical Hit Chance",
        values: [["5.00%", 0]],
        displayMode: 0,
      },
      {
        name: "Attacks per Second",
        values: [["1.20", 0]],
        displayMode: 0,
      },
    ]),
  );
});

test("normalizes a tier-prefixed normal item to its catalog base type", () => {
  const item = parseCopiedItemText(`Item Class: Quarterstaves
Rarity: Normal
Exceptional Bolting Quarterstaff
--------
Physical Damage: 24-97
Lightning Damage: 1-100 (lightning)
Critical Hit Chance: 10.00%
Attacks per Second: 1.40
--------
Requires: Level 78, 127 (unmet) Dex, 50 Int
--------
Sockets: S S S
--------
Item Level: 81`);

  expect(item.item).toMatchObject({
    name: "",
    typeLine: "Exceptional Bolting Quarterstaff",
    baseType: "Bolting Quarterstaff",
    rarity: "Normal",
    frameType: 0,
    ilvl: 81,
  });
  expect(item.item.sockets).toHaveLength(3);
  expect(item.item.properties).toContainEqual({
    name: "Quarterstaves",
    values: [],
    displayMode: 0,
  });
});

test("normalizes every Exceptional normal item before catalog fallback", () => {
  const item = parseCopiedItemText(`Item Class: Quarterstaves
Rarity: Normal
Exceptional Future Quarterstaff
--------
Physical Damage: 24-97
--------
Item Level: 81`);

  expect(item.item.typeLine).toBe("Exceptional Future Quarterstaff");
  expect(item.item.baseType).toBe("Future Quarterstaff");
});

test("normalizes Exceptional equipment base types across rarities", () => {
  const cases = [
    {
      rarity: "Magic",
      header: "Exceptional Crackling Bolting Quarterstaff of the Brute",
    },
    {
      rarity: "Rare",
      header: "Doom Branch\nExceptional Bolting Quarterstaff",
    },
    {
      rarity: "Unique",
      header: "Future Relic\nExceptional Bolting Quarterstaff",
    },
  ];

  for (const { rarity, header } of cases) {
    const item = parseCopiedItemText(`Item Class: Quarterstaves
Rarity: ${rarity}
${header}
--------
Physical Damage: 24-97
--------
Item Level: 81`);

    expect(item.item.baseType).toBe("Bolting Quarterstaff");
  }
});

test("excludes in-game listing notes from item modifiers", () => {
  for (const label of ["Note", "Notes"]) {
    const item = parseCopiedItemText(`Item Class: Quarterstaves
Rarity: Normal
Bolting Quarterstaff
--------
Physical Damage: 24-97
--------
Item Level: 81
--------
${label}: xyz`);

    expect(item.item.explicitMods).toEqual([]);
    expect(item.item.implicitMods).toEqual([]);
    expect(item.item.enchantMods).toEqual([]);
  }
});

test("parses copied stackable currency by its fixed identity", () => {
  const item = parseCopiedItemText(`Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 1/10
--------
Right Click this item then left click another item to apply it.`);

  expect(item.item).toMatchObject({
    name: "",
    typeLine: "Divine Orb",
    baseType: "Divine Orb",
    rarity: "Currency",
    frameType: 5,
    explicitMods: [],
    implicitMods: [],
  });
});

test("accepts fixed-name currency before the local catalog is updated", () => {
  const item = parseCopiedItemText(`Item Class: Stackable Currency
Rarity: Currency
Future Orb
--------
Stack Size: 1/10
--------
Right Click this item then left click another item to apply it.`);

  expect(item.item.baseType).toBe("Future Orb");
});

test("stops simple modifier parsing before unique flavor and help text", () => {
  const item = parseCopiedItemText(`Item Class: Charms
Rarity: Unique
Nascent Hope
Thawing Charm
--------
Lasts 3 Seconds
Consumes 40 of 40 Charges on use
--------
Requires: Level 12
--------
Item Level: 80
--------
Used when you become Frozen (implicit)
--------
23% Chance to gain a Charge when you kill an enemy
Energy Shield Recharge starts on use
--------
"Even in the face of the Winter of the World,
life found a way."
--------
Used automatically when condition is met. Can only hold charges while in belt.`);

  expect(item.item.implicitMods).toEqual(["Used when you become Frozen"]);
  expect(item.item.explicitMods).toEqual([
    "23% Chance to gain a Charge when you kill an enemy",
    "Energy Shield Recharge starts on use",
  ]);
});

test("keeps rune enchants separate from explicit equipment modifiers", () => {
  const item = parseCopiedItemText(`Item Class: Helmets
Rarity: Rare
Corpse Horn
Trapper Hood
--------
Quality: +20% (augmented)
Evasion Rating: 692 (augmented)
--------
Requires: Level 75, 107 Dex
--------
Sockets: S
--------
Item Level: 81
--------
8% increased Reservation Efficiency of Minion Skills (rune)
--------
77% increased Evasion Rating
+160 to maximum Life
+30 to maximum Mana
+2 to Level of all Minion Skills`);

  expect(item.item.enchantMods).toEqual([
    "8% increased Reservation Efficiency of Minion Skills",
  ]);
  expect(item.item.explicitMods).toEqual([
    "77% increased Evasion Rating",
    "+160 to maximum Life",
    "+30 to maximum Mana",
    "+2 to Level of all Minion Skills",
  ]);
  expect(item.item.quality).toBe(20);
});
