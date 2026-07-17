import { expect, test } from "bun:test";
import {
  getComparablePriceCurrency,
  getItemSearchMetadata,
  getExchangeRateCacheKey,
  PriceChecker,
} from "../src/services/PriceEstimator";
import { Poe2Item } from "../src/services/types";
import { formatPriceAmount } from "../src/services/types";

test("reports when no comparable listings are available", () => {
  expect(() => PriceChecker.priceEstimate([])).toThrow(
    "No comparable listings found",
  );
});

test("handles items without extended explicit modifier metadata", async () => {
  const item = {
    item: { extended: { mods: {} } },
  } as Poe2Item;

  await expect(PriceChecker.getHighTierMods(item, 3)).resolves.toEqual([]);
});

test("skips modifiers that are not in the local stat table", () => {
  const item = {
    item: {
      explicitMods: ["82% increased effect of Socketed [Augment] Items"],
    },
  } as Poe2Item;

  expect(PriceChecker.parseItemMods(item).explicits).toEqual([]);
});

test("keeps structured unknown modifiers for trade matching", () => {
  const item = {
    item: {
      explicitMods: [
        {
          description: "82% increased effect of Socketed [Augment] Items",
          hash: "stat.explicit.stat_2081918629",
          mods: [],
        },
      ],
    },
  } as Poe2Item;

  expect(PriceChecker.parseItemMods(item).explicits).toMatchObject([
    { hash: "explicit.stat_2081918629", value1: 82 },
  ]);
});

test("searches unique items by name and unique rarity", () => {
  const item = {
    item: {
      frameType: 3,
      name: "Darkness Enthroned",
      baseType: "Fine Belt",
    },
  } as Poe2Item;

  expect(getItemSearchMetadata(item)).toEqual({
    baseType: "Fine Belt",
    name: "Darkness Enthroned",
    rarity: "unique",
  });
});

test("keeps fractional prices visible", () => {
  expect(formatPriceAmount(0.109)).toBe("0.109");
});

test("separates cached exchange rates by league", () => {
  expect(getExchangeRateCacheKey("exalted", "chaos", "Standard")).not.toBe(
    getExchangeRateCacheKey("exalted", "chaos", "HC Runes of Aldur"),
  );
});

test("keeps one-currency comparisons in their listed currency", () => {
  expect(getComparablePriceCurrency("exalted", ["divine"])).toBe("divine");
  expect(getComparablePriceCurrency("exalted", ["chaos", "divine"])).toBe(
    "exalted",
  );
});
