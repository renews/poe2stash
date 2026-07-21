import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparableItemTooltipContent } from "../src/components/ComparableItemHoverCard";
import { Poe2Item } from "../src/services/types";

test("renders the full comparable item details and marks unused modifiers", () => {
  const item = {
    id: "comparable",
    listing: {
      price: { amount: 59.38, currency: "exalted" },
    },
    item: {
      icon: "https://example.com/spear.png",
      name: "Daevata's Wind",
      typeLine: "War Spear",
      baseType: "War Spear",
      rarity: "Unique",
      ilvl: 76,
      corrupted: true,
      properties: [
        { name: "Physical Damage", values: [["24-44", 0]] },
      ],
      implicitMods: ["34% increased Projectile Speed with this Weapon"],
      explicitMods: ["Adds 12 to 26 Physical Damage", "+100 to Evasion Rating"],
      sockets: [{ group: 0 }],
      extended: {
        mods: { explicit: [{ tier: "P1" }, { tier: "S1" }] },
        hashes: {
          explicit: [
            ["explicit.stat_used", []],
            ["explicit.stat_unused", []],
          ],
        },
      },
    },
  } as Poe2Item;

  const markup = renderToStaticMarkup(
    createElement(ComparableItemTooltipContent, {
      item,
      usedExplicitHashes: new Set(["explicit.stat_used"]),
    }),
  );

  expect(markup).toContain("Daevata&#x27;s Wind");
  expect(markup).toContain("Unique War Spear");
  expect(markup).toContain("Item level 76");
  expect(markup).toContain("59.38 exalted");
  expect(markup).toContain("Corrupted");
  expect(markup).toContain("Physical Damage: 24-44");
  expect(markup).toContain("Implicit");
  expect(markup).toContain("Adds 12 to 26 Physical Damage");
  expect(markup).toContain('title="suffix · not used in search"');
  expect(markup).toContain("line-through opacity-60");
  expect(markup).toContain("Sockets: 1");
});
