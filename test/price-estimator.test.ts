import axios from "axios";
import { expect, test } from "bun:test";
import {
  getComparablePriceCurrency,
  buildModifierSearchFilters,
  DEFAULT_MODIFIER_RANGE_PERCENT,
  getItemSearchFilters,
  getItemSearchMetadata,
  getExchangeRateCacheKey,
  isEstimateFresh,
  Estimate,
  MODIFIER_COMPARISON_VERSION,
  PriceChecker,
  roundCurrencyAmount,
  selectSelectedModifiers,
} from "../src/services/PriceEstimator";
import {
  buildTradeStatFilters,
  getCurrencyRateFromOverview,
  parseMirrorRateFromPage,
  Poe2TradeClient,
} from "../src/services/Poe2TradeClient";
import { Poe2Item, Poe2ItemSearch } from "../src/services/types";
import {
  formatDate,
  formatDateTime,
  formatPriceAmount,
} from "../src/services/types";
import { AGED_LISTING_PRICE_REDUCTION_FACTOR } from "../src/services/listingPricePolicy";
import { Poe2Trade } from "../src/services/poe2trade";
import { Poe2Scout } from "../src/services/Poe2ScoutClient";

test("reports when no comparable listings are available", () => {
  expect(() => PriceChecker.priceEstimate([])).toThrow(
    "No comparable listings found",
  );
});

test("uses robust comparable analysis for the suggested price", () => {
  const estimate = PriceChecker.priceEstimate(
    [10, 11, 12, 13, 1000].map((amount) => ({
      amount,
      currency: "exalted",
    })),
  );

  expect(estimate.price.amount).toBe(11.5);
  expect(estimate.comparables).toHaveLength(4);
  expect(estimate.excludedComparableCount).toBe(1);
  expect(estimate.confidence).toBe("medium");
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

test("uses authoritative item metadata to distinguish local modifiers", () => {
  const item = {
    item: {
      explicitMods: ["90% increased Armour"],
      extended: {
        hashes: {
          explicit: [["explicit.stat_1062208444", [90]]],
        },
      },
    },
  } as Poe2Item;

  expect(PriceChecker.parseItemMods(item).explicits).toMatchObject([
    { hash: "explicit.stat_1062208444", value1: 90 },
  ]);
});

test("passes authoritative local modifier hashes to the shared trade query", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          baseType: "Expert Full Plate",
          explicitMods: ["90% increased Armour"],
          implicitMods: [],
          extended: {
            hashes: {
              explicit: [["explicit.stat_1062208444", [90]]],
            },
          },
        },
      } as Poe2Item,
      "Standard",
    );

    expect(capturedSearch.explicit).toEqual([
      { id: "explicit.stat_1062208444", min: 79, max: 101 },
    ]);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
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
    category: "accessory.belt",
    name: "Darkness Enthroned",
    rarity: "unique",
  });
});

test("includes gem level and quality in gem search metadata", () => {
  const item = {
    item: {
      name: "Healing Runes",
      typeLine: "Healing Runes",
      baseType: "Healing Runes",
      frameType: 4,
      gemLevel: 15,
      quality: 20,
    },
  } as Poe2Item;

  expect(getItemSearchMetadata(item)).toMatchObject({
    baseType: "Healing Runes",
    name: "Healing Runes",
    rarity: undefined,
    gemLevel: 15,
    quality: 20,
  });
});

test("does not send a gem name in trade searches", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          name: "Spark",
          typeLine: "Spark",
          baseType: "Spark",
          frameType: 4,
          gemLevel: 15,
          quality: 20,
        },
      } as Poe2Item,
      "Standard",
    );

    expect(capturedSearch).not.toHaveProperty("name");
    expect(capturedSearch).toMatchObject({
      baseType: "Spark",
      gem_level: 15,
      gem_level_max: 15,
      quality: 20,
      quality_max: 20,
    });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("includes item level for non-gems but not gems", () => {
  const rare = {
    item: {
      frameType: 2,
      rarity: "Rare",
      baseType: "Vaal Regalia",
      ilvl: 84,
    },
  } as Poe2Item;
  const gem = {
    item: {
      frameType: 4,
      name: "Healing Runes",
      baseType: "Healing Runes",
      gemLevel: 15,
      quality: 20,
      ilvl: 84,
    },
  } as Poe2Item;

  const rareMetadata = getItemSearchMetadata(rare);
  const gemMetadata = getItemSearchMetadata(gem);

  expect(getItemSearchFilters(rareMetadata)).not.toHaveProperty("ilvl");
  expect(getItemSearchFilters(rareMetadata, true)).toMatchObject({ ilvl: 84 });
  expect(getItemSearchFilters(rareMetadata, false)).not.toHaveProperty("ilvl");
  expect(getItemSearchFilters(gemMetadata)).not.toHaveProperty("ilvl");
  expect(getItemSearchFilters(gemMetadata)).toMatchObject({
    gem_level: 15,
    gem_level_max: 15,
    quality: 20,
    quality_max: 20,
  });
});

test("adds an optional minimum and maximum required-level filter for non-gems", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;
  const item = {
    id: "required-level-item",
    item: {
      frameType: 2,
      rarity: "Rare",
      typeLine: "Vaal Regalia",
      baseType: "Vaal Regalia",
      ilvl: 84,
      requirements: [
        {
          name: "Level",
          values: [["67", 0]],
          displayMode: 0,
          type: 62,
        },
      ],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "query-id",
      complexity: 0,
      result: ["comparable-item"],
      total: 1,
    };
  };

  try {
    expect(getItemSearchMetadata(item)).toMatchObject({ requiredLevel: 67 });

    await PriceChecker.findMatchingItem(item, "Standard", {
      explicit: [],
      implicit: [],
      requiredLevel: true,
      requiredLevelMin: 60,
      requiredLevelMax: 70,
    });

    expect(capturedSearch).toMatchObject({ lvl: 60, lvl_max: 70 });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("defaults missing non-gem level requirements to a maximum of two", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "query-id",
      complexity: 0,
      result: ["comparable-item"],
      total: 1,
    };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        id: "no-required-level-item",
        item: {
          frameType: 2,
          rarity: "Rare",
          typeLine: "Lapis Amulet",
          baseType: "Lapis Amulet",
          requirements: [],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      {
        explicit: [],
        implicit: [],
        requiredLevel: true,
      },
    );

    expect(capturedSearch).toMatchObject({ lvl: 0, lvl_max: 2 });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("does not add required-level filters for gems", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "query-id",
      complexity: 0,
      result: ["comparable-item"],
      total: 1,
    };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        id: "gem-item",
        item: {
          frameType: 4,
          name: "Spark",
          typeLine: "Spark",
          baseType: "Spark",
          gemLevel: 15,
          requirements: [
            {
              name: "Level",
              values: [["52", 0]],
              displayMode: 0,
              type: 62,
            },
          ],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      {
        explicit: [],
        implicit: [],
        requiredLevel: true,
        requiredLevelMin: 50,
        requiredLevelMax: 60,
      },
    );

    expect(capturedSearch).not.toHaveProperty("lvl");
    expect(capturedSearch).not.toHaveProperty("lvl_max");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses the default comparison range for comparable modifiers", () => {
  const filters = buildModifierSearchFilters(
    [
      { hash: "explicit.life", parsed: "100 to maximum Life", value1: 100 },
      {
        hash: "explicit.energy-shield",
        parsed: "200 to maximum Energy Shield",
        value1: 200,
      },
      {
        hash: "explicit.fire-resistance",
        parsed: "25% to Fire Resistance",
        value1: 25,
      },
      {
        hash: "explicit.skill-level",
        parsed: "+2 to Level of all Fire Skills",
        value1: 2,
      },
      {
        hash: "explicit.skill-gem-requirements",
        parsed:
          "Equipment and Skill Gems have 20% increased Attribute Requirements",
        value1: 20,
      },
      {
        hash: "explicit.attack-speed",
        parsed: "50% increased Attack Speed",
        value1: 50,
      },
    ],
    [
      {
        hash: "implicit.cold-resistance",
        parsed: "15% to Cold Resistance",
        value1: 15,
      },
    ],
  );

  expect(filters.pseudo).toEqual([
    { id: "pseudo.pseudo_total_life", min: 88, max: 112 },
    { id: "pseudo.pseudo_total_energy_shield", min: 176, max: 224 },
    { id: "pseudo.pseudo_total_resistance", min: 35, max: 45 },
  ]);
  expect(filters.explicit).toEqual([
    { id: "explicit.skill-level", min: 2 },
    { id: "explicit.skill-gem-requirements", min: 20 },
    { id: "explicit.attack-speed", min: 44, max: 56 },
  ]);
});

test("uses a configured comparison range for comparable modifiers", () => {
  const filters = buildModifierSearchFilters(
    [{ hash: "explicit.life", parsed: "100 to maximum Life", value1: 100 }],
    [],
    20,
  );

  expect(filters.pseudo).toEqual([
    { id: "pseudo.pseudo_total_life", min: 80, max: 120 },
  ]);
  expect(DEFAULT_MODIFIER_RANGE_PERCENT).toBe(12);
});

test("serializes pseudo filters into the trade stat group", () => {
  expect(
    buildTradeStatFilters({
      explicit: [{ id: "explicit.stat_123", min: 10, max: 20 }],
      pseudo: [{ id: "pseudo.pseudo_total_resistance", min: 25, max: 27 }],
    }),
  ).toEqual([
    { id: "explicit.stat_123", value: { min: 10, max: 20 } },
    {
      id: "pseudo.pseudo_total_resistance",
      value: { min: 25, max: 27 },
    },
  ]);
});

test("serializes required-level ranges and relaxed stat groups", async () => {
  const client = new Poe2TradeClient();
  const originalPost = axios.post;
  let capturedPayload: unknown;

  axios.post = (async (...args: Parameters<typeof axios.post>) => {
    capturedPayload = args[1];
    return {
      data: { id: "query-id", complexity: 0, result: [], total: 0 },
    };
  }) as unknown as typeof axios.post;

  try {
    await client.getItemByAttributes(
      {
        baseType: "Fine Ring",
        lvl: 60,
        lvl_max: 70,
        explicit: [
          { id: "explicit.stat_1", min: 10, max: 20 },
          { id: "explicit.stat_2", min: 30, max: 40 },
        ],
        statGroupType: "count",
        statGroupMin: 1,
      },
      "Standard",
    );
  } finally {
    axios.post = originalPost;
  }

  const payload = capturedPayload as {
    query: {
      stats: Array<{
        type: string;
        value?: { min: number };
        filters: unknown[];
      }>;
      filters: {
        req_filters: { filters: { lvl: { min: number; max: number } } };
      };
    };
  };
  expect(payload.query.stats[0]).toMatchObject({
    type: "count",
    value: { min: 1 },
  });
  expect(payload.query.filters.req_filters.filters.lvl).toEqual({
    min: 60,
    max: 70,
  });
});

test("retries an empty strict search by allowing one selected modifier to miss", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return searches.length === 1
      ? {
          id: "strict-query",
          complexity: 0,
          result: ["priced-item"],
          total: 1,
        }
      : {
          id: "relaxed-query",
          complexity: 0,
          result: ["comparable-item"],
          total: 1,
        };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "priced-item",
        item: {
          baseType: "Fine Ring",
          explicitMods: [
            {
              description: "100 to maximum Life",
              hash: "explicit.stat_1",
              mods: [],
            },
            {
              description: "20% increased Attack Speed",
              hash: "explicit.stat_2",
              mods: [],
            },
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
    );

    expect(searches).toHaveLength(2);
    expect(searches[0]).not.toHaveProperty("statGroupType");
    expect(searches[1]).toMatchObject({
      statGroupType: "count",
      statGroupMin: 1,
    });
    expect(result).toMatchObject({
      id: "relaxed-query",
      strategy: "one-mod-relaxed",
      selectedModifierCount: 2,
      minimumModifierCount: 1,
    });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("keeps fractional prices visible", () => {
  expect(formatPriceAmount(0.109)).toBe("0.109");
});

test("formats dates for price and currency freshness labels", () => {
  expect(formatDate(new Date(2026, 6, 17).getTime())).toBe("07.17.2026");
  expect(formatDateTime(new Date(2026, 6, 17, 9, 5).getTime())).toBe(
    "07.17.2026 09:05",
  );
});

test("separates cached exchange rates by league", () => {
  expect(getExchangeRateCacheKey("exalted", "chaos", "Standard")).not.toBe(
    getExchangeRateCacheKey("exalted", "chaos", "HC Runes of Aldur"),
  );
});

test("uses pseudo and ranged filters for the Search lookup", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          baseType: "Fine Ring",
          explicitMods: [
            "100 to maximum Life",
            "25% to Fire Resistance",
            "50% increased Attack Speed",
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
    );

    expect(capturedSearch.pseudo).toEqual([
      { id: "pseudo.pseudo_total_life", min: 88, max: 112 },
      { id: "pseudo.pseudo_total_resistance", min: 22, max: 28 },
    ]);
    expect(capturedSearch.explicit).toEqual([
      { id: "explicit.stat_681332047", min: 44, max: 56 },
    ]);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses the same selected modifiers for the Search lookup", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          baseType: "Fine Ring",
          explicitMods: [
            "100 to maximum Life",
            "25% to Fire Resistance",
            "50% increased Attack Speed",
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      { explicit: [true, false, true], implicit: [], itemLevel: false },
    );

    expect(capturedSearch.pseudo).toEqual([
      { id: "pseudo.pseudo_total_life", min: 88, max: 112 },
    ]);
    expect(capturedSearch.explicit).toEqual([
      { id: "explicit.stat_681332047", min: 44, max: 56 },
    ]);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses the Search result set for price estimates", async () => {
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const item = {
    id: "item-id",
    item: {
      id: "item-id",
      baseType: "Fine Ring",
      explicitMods: ["100 to maximum Life", "50% increased Attack Speed"],
      implicitMods: [],
    },
  } as Poe2Item;
  const modifierSelection = {
    explicit: [true, true],
    implicit: [],
    itemLevel: false,
  };
  const searchArguments: unknown[][] = [];
  const pricedIds: string[][] = [];

  PriceChecker.findMatchingItem = (async (...args) => {
    searchArguments.push(args);
    return {
      id: "search-id",
      complexity: 0,
      result: ["matching-id"],
      total: 1,
      strategy: "one-mod-relaxed",
      selectedModifierCount: 2,
      minimumModifierCount: 1,
    };
  }) as typeof PriceChecker.findMatchingItem;
  PriceChecker.getPricesForItemIds = (async (ids) => {
    pricedIds.push(ids);
    return [
      {
        amount: 10,
        currency: "exalted",
        itemId: "matching-id",
        listedAmount: 10,
        listedCurrency: "exalted",
      },
    ];
  }) as typeof PriceChecker.getPricesForItemIds;
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => false;
  PriceChecker.cachePriceEstimate = () => {};

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      item,
      "Standard",
      modifierSelection,
    );

    expect(searchArguments).toHaveLength(1);
    expect(searchArguments[0]).toEqual([
      item,
      "Standard",
      modifierSelection,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      {},
    ]);
    expect(pricedIds).toEqual([["matching-id"]]);
    expect(estimate.confidence).toBe("low");
    expect(estimate.search).toMatchObject({
      strategy: "one-mod-relaxed",
      selectedModifierCount: 2,
      minimumModifierCount: 1,
    });
  } finally {
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
  }
});

test("halves an old listing suggestion and spread before currency promotion", async () => {
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalPriceEstimate = PriceChecker.priceEstimate;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const comparable = {
    amount: 100,
    currency: "exalted",
    itemId: "matching-id",
    listedAmount: 1,
    listedCurrency: "divine",
  };
  const item = {
    id: "old-item",
    listing: {
      indexed: new Date(
        Date.now() - 13 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      price: { amount: 80, currency: "exalted" },
      stash: { name: "Shop", x: 0, y: 0 },
    },
    item: {
      id: "old-item",
      baseType: "Fine Ring",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const pricesBeforePromotion: Array<{ amount: number; currency: string }> = [];
  let matchedSuggestion: { amount: number; currency: string } | undefined;
  let matchedSpread: { amount: number; currency: string } | undefined;
  let cachedEstimate: Estimate | undefined;

  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: ["matching-id"],
    total: 1,
  });
  PriceChecker.getPricesForItemIds = async () => [comparable];
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.priceEstimate = () => ({
    price: { amount: 100, currency: "exalted" },
    stdDev: { amount: 20, currency: "exalted" },
    comparables: [comparable],
    confidence: "high",
    method: "median",
  });
  PriceChecker.upscalePrice = async (price) => {
    pricesBeforePromotion.push({
      amount: price.amount,
      currency: price.currency,
    });
    return price;
  };
  PriceChecker.matchesCurrentPrice = async (
    _item,
    suggestedPrice,
    _league,
    _options,
    spread,
  ) => {
    matchedSuggestion = suggestedPrice;
    matchedSpread = spread;
    return false;
  };
  PriceChecker.cachePriceEstimate = (_itemId, estimate) => {
    cachedEstimate = estimate;
  };

  try {
    const estimate = await PriceChecker.estimateItemPrice(item, "Standard");

    expect(pricesBeforePromotion).toEqual([
      { amount: 50, currency: "exalted" },
      { amount: 10, currency: "exalted" },
    ]);
    expect(matchedSuggestion).toEqual({
      amount: 50,
      currency: "exalted",
    });
    expect(matchedSpread).toEqual({ amount: 10, currency: "exalted" });
    expect(estimate.listingAgeAdjustmentFactor).toBe(
      AGED_LISTING_PRICE_REDUCTION_FACTOR,
    );
    expect(cachedEstimate).toBe(estimate);
    expect(estimate.comparables[0]).toMatchObject({
      amount: 100,
      listedAmount: 1,
      listedCurrency: "divine",
    });
    expect(item.listing.price).toEqual({ amount: 80, currency: "exalted" });
  } finally {
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.priceEstimate = originalPriceEstimate;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
  }
});

test("uses modifier-aware trade comparables as the suggestion and retains market value as a baseline", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const updatedAt = Date.parse("2026-07-18T10:25:16Z");
  const item = {
    id: "rolled-unique-item",
    item: {
      id: "rolled-unique-item",
      frameType: 3,
      rarity: "Unique",
      name: "Darkness Enthroned",
      typeLine: "Darkness Enthroned",
      baseType: "Fine Belt",
      explicitMods: [
        {
          description: "100 to maximum Life",
          hash: "explicit.stat_1",
          mods: [],
        },
      ],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Scout.getMarketValuation = async () => ({
    itemId: 4993,
    itemName: "Darkness Enthroned",
    price: { amount: 42, currency: "exalted" },
    quantity: 17,
    updatedAt,
    history: [{ amount: 42, quantity: 17, updatedAt }],
  });
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: ["matching-id"],
    total: 1,
    strategy: "strict",
    selectedModifierCount: 1,
    minimumModifierCount: 1,
  });
  PriceChecker.getPricesForItemIds = async () => [
    {
      amount: 100,
      currency: "exalted",
      itemId: "matching-id",
      listedAmount: 100,
      listedCurrency: "exalted",
    },
  ];
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => false;
  PriceChecker.cachePriceEstimate = () => {};

  try {
    const estimate = await PriceChecker.estimateItemPrice(item, "Standard");

    expect(estimate.source).toBe("official-trade");
    expect(estimate.method).toBe("median");
    expect(estimate.price).toEqual({ amount: 100, currency: "exalted" });
    expect(estimate.market?.price).toEqual({
      amount: 42,
      currency: "exalted",
    });
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
  }
});

test("uses Poe2Scout market history for recognized items while retaining trade comparables", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const updatedAt = Date.parse("2026-07-18T10:25:16Z");
  const item = {
    id: "unique-item-id",
    item: {
      id: "unique-item-id",
      frameType: 3,
      rarity: "Unique",
      name: "Darkness Enthroned",
      typeLine: "Darkness Enthroned",
      baseType: "Fine Belt",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Scout.getMarketValuation = async () => ({
    itemId: 4993,
    itemName: "Darkness Enthroned",
    price: { amount: 42, currency: "exalted" },
    quantity: 17,
    updatedAt,
    history: [
      { amount: 42, quantity: 17, updatedAt },
    ],
  });
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: ["matching-id"],
    total: 1,
  });
  PriceChecker.getPricesForItemIds = async () => [
    {
      amount: 10,
      currency: "exalted",
      itemId: "matching-id",
      listedAmount: 10,
      listedCurrency: "exalted",
    },
  ];
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => false;
  PriceChecker.cachePriceEstimate = () => {};

  try {
    const estimate = await PriceChecker.estimateItemPrice(item, "Standard");

    expect(estimate.source).toBe("poe2scout");
    expect(estimate.method).toBe("market-history");
    expect(estimate.price).toEqual({ amount: 42, currency: "exalted" });
    expect(estimate.market).toMatchObject({
      itemId: 4993,
      quantity: 17,
      updatedAt,
    });
    expect(estimate.comparables).toHaveLength(1);
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
  }
});

test("does not use a base type for rare item searches", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          rarity: "Rare",
          typeLine: "Lapis Amulet",
          baseType: "Lapis Amulet",
          explicitMods: ["100 to maximum Life"],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
    );

    expect(capturedSearch.rarity).toBe("rare");
    expect(capturedSearch.category).toBe("accessory.amulet");
    expect(capturedSearch).not.toHaveProperty("baseType");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("maps rare body armour to the body armour category", () => {
  expect(
    getItemSearchMetadata({
      item: {
        rarity: "Rare",
        typeLine: "Vaal Regalia",
        baseType: "Vaal Regalia",
      },
    } as Poe2Item).category,
  ).toBe("armour.chest");
});

test("uses the fetched item class to categorize every item search", () => {
  const cases = [
    {
      item: {
        rarity: "Rare",
        typeLine: "Hardwood Targe",
        baseType: "Hardwood Targe",
        properties: [{ name: "[Shield]", values: [], displayMode: 0 }],
      },
      category: "armour.shield",
    },
    {
      item: {
        rarity: "Rare",
        typeLine: "Orichalcum Spear",
        baseType: "Orichalcum Spear",
        properties: [{ name: "[Spear]", values: [], displayMode: 0 }],
      },
      category: "weapon.spear",
    },
    {
      item: {
        rarity: "Rare",
        typeLine: "Ring Mail",
        baseType: "Ring Mail",
        properties: [],
      },
      category: "armour.chest",
    },
    {
      item: {
        rarity: "Unique",
        name: "Darkness Enthroned",
        typeLine: "Fine Belt",
        baseType: "Fine Belt",
        properties: [{ name: "Belt", values: [], displayMode: 0 }],
      },
      category: "accessory.belt",
    },
    {
      item: {
        frameType: 4,
        typeLine: "Healing Runes",
        baseType: "Healing Runes",
        properties: [
          { name: "Level", values: [["15", 0]], displayMode: 0 },
        ],
      },
      category: "gem",
    },
  ] as const;

  for (const { item, category } of cases) {
    expect(getItemSearchMetadata({ item } as Poe2Item).category).toBe(category);
  }
});

test("sends the exact category and no base type for rare shield searches", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Parameters<typeof Poe2Trade.getItemByAttributes>[0];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        item: {
          rarity: "Rare",
          typeLine: "Hardwood Targe",
          baseType: "Hardwood Targe",
          properties: [{ name: "[Shield]", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
    );

    expect(capturedSearch.category).toBe("armour.shield");
    expect(capturedSearch).not.toHaveProperty("baseType");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("does not send a trade query without an item category", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let requested = false;

  Poe2Trade.getItemByAttributes = async () => {
    requested = true;
    return { id: "query-id", complexity: 0, result: [], total: 0 };
  };

  try {
    await expect(
      PriceChecker.findMatchingItem(
        {
          item: {
            rarity: "Rare",
            typeLine: "Unknown Experimental Base",
            baseType: "Unknown Experimental Base",
            properties: [],
            explicitMods: [],
            implicitMods: [],
          },
        } as Poe2Item,
        "Standard",
      ),
    ).rejects.toThrow("category");
    expect(requested).toBe(false);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("does not reuse a cached estimate from another item category", () => {
  const item = {
    item: {
      rarity: "Rare",
      typeLine: "Ring Mail",
      baseType: "Ring Mail",
      properties: [
        { name: "Body Armour", values: [], displayMode: 0 },
      ],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      category: "accessory.ring",
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(PriceChecker.matchesModifierSelection(item, estimate)).toBe(false);
});

test("omits buyout trade filters from comparable item searches", async () => {
  const client = new Poe2TradeClient();
  const originalPost = axios.post;
  let capturedPayload: unknown;

  axios.post = (async (...args: Parameters<typeof axios.post>) => {
    capturedPayload = args[1];
    return {
      data: { id: "query-id", complexity: 0, result: [], total: 0 },
    };
  }) as unknown as typeof axios.post;

  try {
    await client.getItemByAttributes(
      { baseType: "Fine Ring", price: 1, currency: "exalted" },
      "Standard",
    );
  } finally {
    axios.post = originalPost;
  }

  const query = capturedPayload as {
    query: {
      filters: Record<string, unknown>;
      stats?: unknown;
    };
  };
  expect(query.query.filters).not.toHaveProperty("trade_filters");
  expect(query.query).not.toHaveProperty("stats");
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

test("refreshes currency rates from the live overview", async () => {
  const originalGetOverview = Poe2Trade.client.getCurrencyExchangeOverview;
  const originalCacheExchangeRates = PriceChecker.cacheExchangeRates;
  const cachedRates: Record<string, number> = {};
  let overviewRequests = 0;

  Poe2Trade.client.getCurrencyExchangeOverview = async () => {
    overviewRequests++;
    return {
      core: { primary: "divine" },
      lines: [
        { id: "divine", primaryValue: 1 },
        { id: "chaos", primaryValue: 0.2 },
        { id: "exalted", primaryValue: 0.004 },
        { id: "mirror", primaryValue: 100 },
      ],
    };
  };
  PriceChecker.cacheExchangeRates = async (iWant, iHave, rate) => {
    cachedRates[`${iWant}:${iHave}`] = rate;
  };

  try {
    await PriceChecker.refreshExchangeRates("HC Runes of Aldur");

    expect(overviewRequests).toBe(1);
    expect(cachedRates["exalted:chaos"]).toBe(50);
    expect(cachedRates["chaos:divine"]).toBe(5);
    expect(cachedRates["divine:mirror"]).toBe(100);
  } finally {
    Poe2Trade.client.getCurrencyExchangeOverview = originalGetOverview;
    PriceChecker.cacheExchangeRates = originalCacheExchangeRates;
  }
});

test("parses the live Mirror rate from the currency page", () => {
  expect(
    parseMirrorRateFromPage(
      '<span>5,187.6</span> <span class="unit">Divine</span>',
    ),
  ).toBe(5187.6);
  expect(parseMirrorRateFromPage("<html>No rate</html>")).toBeUndefined();
});

test("excludes deselected modifiers while keeping all selected by default", () => {
  const modifiers = ["implicit", "explicit", "another explicit"];

  expect(selectSelectedModifiers(modifiers)).toEqual(modifiers);
  expect(selectSelectedModifiers(modifiers, [true, false, true])).toEqual([
    "implicit",
    "another explicit",
  ]);
});

test("rounds promoted currency at the half-unit boundary", () => {
  expect(roundCurrencyAmount(2.49)).toBe(2);
  expect(roundCurrencyAmount(2.5)).toBe(3);
  expect(roundCurrencyAmount(2.51)).toBe(3);
});

test("promotes suggested prices while retaining the lower denomination", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "exalted" && iHave === "chaos") return 75;
    if (iWant === "chaos" && iHave === "divine") return 6;
    if (iWant === "divine" && iHave === "mirror") return 12;
    return 1;
  };

  try {
    await expect(
      PriceChecker.upscalePrice({ amount: 144, currency: "exalted" }),
    ).resolves.toMatchObject({
      amount: 2,
      currency: "chaos",
      lowerPrice: { amount: 144, currency: "exalted" },
    });
    await expect(
      PriceChecker.upscalePrice({ amount: 190, currency: "exalted" }),
    ).resolves.toMatchObject({ amount: 3, currency: "chaos" });
    await expect(
      PriceChecker.upscalePrice({ amount: 3, currency: "chaos" }),
    ).resolves.toMatchObject({
      amount: 1,
      currency: "divine",
      lowerPrice: { amount: 3, currency: "chaos" },
    });
    await expect(
      PriceChecker.upscalePrice({ amount: 6, currency: "divine" }),
    ).resolves.toMatchObject({
      amount: 1,
      currency: "mirror",
      lowerPrice: { amount: 6, currency: "divine" },
    });
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("promotes each derived range value independently", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "exalted" && iHave === "chaos") return 75;
    if (iWant === "chaos" && iHave === "divine") return 6;
    if (iWant === "divine" && iHave === "mirror") return 100;
    return 1;
  };

  try {
    await expect(
      PriceChecker.upscalePrices(
        [
          { amount: 20, currency: "exalted" },
          { amount: 144, currency: "exalted" },
          { amount: 450, currency: "exalted" },
        ],
        "Standard",
      ),
    ).resolves.toMatchObject([
      { amount: 20, currency: "exalted" },
      { amount: 2, currency: "chaos" },
      { amount: 1, currency: "divine" },
    ]);
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("keeps a converted chaos price when the higher-tier rate is unavailable", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "exalted" && iHave === "chaos") return 57;
    throw new Error("higher-tier rate unavailable");
  };

  try {
    await expect(
      PriceChecker.upscalePrice({ amount: 142, currency: "exalted" }),
    ).resolves.toMatchObject({
      amount: 2,
      currency: "chaos",
      lowerPrice: { amount: 142, currency: "exalted" },
    });
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("only reuses a cached estimate during the configured cooldown", () => {
  const checkedAt = 1_000_000;

  expect(
    isEstimateFresh({ checkedAt } as Estimate, 5, checkedAt + 4 * 60_000),
  ).toBe(true);
  expect(
    isEstimateFresh({ checkedAt } as Estimate, 5, checkedAt + 5 * 60_000),
  ).toBe(false);
  expect(isEstimateFresh({ checkedAt } as Estimate, 0, checkedAt)).toBe(false);
  expect(isEstimateFresh({} as Estimate, 5, checkedAt)).toBe(false);
});

test("matches a rounded suggested price across currencies", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "chaos" && iHave === "exalted") return 1 / 75;
    return 1;
  };

  try {
    await expect(
      PriceChecker.matchesCurrentPrice(
        {
          listing: { price: { amount: 150, currency: "exalted" } },
        } as Poe2Item,
        { amount: 2, currency: "chaos" },
      ),
    ).resolves.toBe(true);
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("classifies a listing against the suggestion and converted spread", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "chaos" && iHave === "exalted") return 1 / 50;
    return 1;
  };

  try {
    const item = {
      listing: { price: { amount: 400, currency: "exalted" } },
    } as Poe2Item;

    await expect(
      PriceChecker.getListingPricePosition(
        item,
        { amount: 10, currency: "chaos" },
        { amount: 50, currency: "exalted" },
      ),
    ).resolves.toBe("underpriced");
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("classifies promoted suggestions using their precise lower denomination", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "chaos" && iHave === "exalted") return 1 / 57;
    return 1;
  };

  try {
    await expect(
      PriceChecker.getListingPricePosition(
        {
          listing: { price: { amount: 100, currency: "exalted" } },
        } as Poe2Item,
        {
          amount: 2,
          currency: "chaos",
          lowerPrice: { amount: 100, currency: "exalted" },
        },
        { amount: 5, currency: "exalted" },
      ),
    ).resolves.toBe("fair");
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("detects when a modifier selection no longer matches its estimate", () => {
  const item = {
    item: {
      explicitMods: [
        {
          description: "82% increased effect of Socketed [Augment] Items",
          hash: "explicit.stat_123",
          mods: [],
        },
      ],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      explicitHashes: ["explicit.stat_123"],
      implicitHashes: [],
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [true],
      implicit: [],
    }),
  ).toBe(true);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [false],
      implicit: [],
    }),
  ).toBe(false);
});

test("matches cached estimates with the selected item-level filter", () => {
  const item = {
    item: {
      ilvl: 84,
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      explicitHashes: [],
      implicitHashes: [],
      itemLevel: 84,
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      itemLevel: true,
    }),
  ).toBe(true);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      itemLevel: false,
    }),
  ).toBe(false);

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      {
        search: {
          explicitHashes: [],
          implicitHashes: [],
          modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
        },
      } as Estimate,
      { explicit: [], implicit: [] },
    ),
  ).toBe(true);
});

test("matches cached estimates with the selected required-level range", () => {
  const item = {
    item: {
      requirements: [
        {
          name: "Level",
          values: [["67", 0]],
          displayMode: 0,
          type: 62,
        },
      ],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      explicitHashes: [],
      implicitHashes: [],
      requiredLevelMin: 60,
      requiredLevelMax: 70,
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      requiredLevel: true,
      requiredLevelMin: 60,
      requiredLevelMax: 70,
    }),
  ).toBe(true);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      requiredLevel: true,
      requiredLevelMin: 61,
      requiredLevelMax: 70,
    }),
  ).toBe(false);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      requiredLevel: false,
      requiredLevelMin: 60,
      requiredLevelMax: 70,
    }),
  ).toBe(false);
});

test("normalizes comparables with mixed listed currencies", async () => {
  const originalFetchItems = Poe2Trade.fetchItems;
  const originalFetchRates = PriceChecker.fetchManyExchangeRates;
  const originalToEquivalentPrices = PriceChecker.toEquivalentPrices;
  let requestedCurrency = "";

  Poe2Trade.fetchItems = async () =>
    ({
      result: [
        {
          id: "chaos-item",
          listing: { price: { amount: 10, currency: "chaos" } },
        },
        {
          id: "divine-item",
          listing: { price: { amount: 1, currency: "divine" } },
        },
      ],
    }) as { result: Poe2Item[] };
  PriceChecker.fetchManyExchangeRates = async (iWant) => {
    requestedCurrency = iWant;
  };
  PriceChecker.toEquivalentPrices = (iWant, prices) =>
    prices.map((price) => ({ amount: price.amount, currency: iWant }));

  try {
    const prices = await PriceChecker.getPricesForItemIds(
      ["chaos-item", "divine-item"],
      "exalted",
    );

    expect(requestedCurrency).toBe("exalted");
    expect(prices.map((price) => price.currency)).toEqual([
      "exalted",
      "exalted",
    ]);
  } finally {
    Poe2Trade.fetchItems = originalFetchItems;
    PriceChecker.fetchManyExchangeRates = originalFetchRates;
    PriceChecker.toEquivalentPrices = originalToEquivalentPrices;
  }
});
