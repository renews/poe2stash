import { expect, test } from "bun:test";
import {
  getComparablePriceCurrency,
  getItemSearchMetadata,
  getExchangeRateCacheKey,
  PriceChecker,
  selectSelectedModifiers,
} from "../src/services/PriceEstimator";
import { getCurrencyRateFromOverview } from "../src/services/Poe2TradeClient";
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

test("converts currency in the requested direction", () => {
  const overview = {
    core: {
      primary: "divine",
      rates: { chaos: 5.56, exalted: 316.2 },
    },
    lines: [
      { id: "divine", primaryValue: 1 },
      { id: "chaos", primaryValue: 0.1798 },
      { id: "exalted", primaryValue: 0.003162 },
    ],
  };

  expect(getCurrencyRateFromOverview(overview, "chaos", "divine")).toBeCloseTo(
    5.56,
    2,
  );
  expect(getCurrencyRateFromOverview(overview, "divine", "chaos")).toBeCloseTo(
    0.1798,
    3,
  );
});

test("excludes deselected modifiers while keeping all selected by default", () => {
  const modifiers = ["implicit", "explicit", "another explicit"];

  expect(selectSelectedModifiers(modifiers)).toEqual(modifiers);
  expect(selectSelectedModifiers(modifiers, [true, false, true])).toEqual([
    "implicit",
    "another explicit",
  ]);
});
