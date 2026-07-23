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
import { Cache } from "../src/services/Cache";

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

test("honors an explicitly configured seven-seller requirement", () => {
  const comparables = [10, 11, 12, 13, 14, 15].map((amount, index) => ({
    amount,
    currency: "exalted",
    itemId: `item-${index}`,
    item: { listing: { account: { name: `seller-${index}` } } },
  }));

  expect(() =>
    PriceChecker.priceEstimate(comparables, {
      minimumIndependentSellers: 7,
    }),
  ).toThrow("at least 7 independent sellers");
});

test("handles items without extended explicit modifier metadata", async () => {
  const item = {
    item: { extended: { mods: {} } },
  } as Poe2Item;

  await expect(PriceChecker.getHighTierMods(item, 3)).resolves.toEqual([]);
});

test("reports modifiers that are not in the local stat table", () => {
  const item = {
    item: {
      explicitMods: ["82% increased effect of Socketed [Augment] Items"],
    },
  } as Poe2Item;

  expect(PriceChecker.parseItemMods(item)).toMatchObject({
    explicits: [],
    unresolved: [
      {
        section: "explicit",
        sourceIndex: 0,
        text: "82% increased effect of Socketed [Augment] Items",
      },
    ],
  });
});

test("refuses a category-only estimate when copied rare modifiers are unknown", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  Poe2Trade.getItemByAttributes = async () => ({
    id: "unsafe-category-query",
    complexity: 0,
    result: ["unrelated-rare"],
    total: 1,
  });

  try {
    await expect(
      PriceChecker.findMatchingItem(
        {
          id: "clipboard-rare",
          origin: "clipboard",
          item: {
            frameType: 2,
            rarity: "Rare",
            typeLine: "Amethyst Ring",
            baseType: "Amethyst Ring",
            properties: [{ name: "Rings", values: [], displayMode: 0 }],
            explicitMods: [
              "82% increased effect of Socketed [Augment] Items",
            ],
            implicitMods: [],
          },
        } as Poe2Item,
        "Standard",
      ),
    ).rejects.toThrow("cannot be matched to current trade data");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("keeps copied rare pricing safe after unsupported modifiers are deselected", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  Poe2Trade.getItemByAttributes = async () => ({
    id: "unsafe-category-query",
    complexity: 0,
    result: ["unrelated-rare"],
    total: 1,
  });

  try {
    await expect(
      PriceChecker.findMatchingItem(
        {
          id: "clipboard-rare",
          origin: "clipboard",
          item: {
            frameType: 2,
            rarity: "Rare",
            typeLine: "Amethyst Ring",
            baseType: "Amethyst Ring",
            properties: [{ name: "Rings", values: [], displayMode: 0 }],
            explicitMods: [
              "82% increased effect of Socketed [Augment] Items",
            ],
            implicitMods: [],
          },
        } as Poe2Item,
        "Standard",
        { explicit: [false], implicit: [] },
      ),
    ).rejects.toThrow("cannot be matched to current trade data");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("keeps modifier selections aligned when an earlier copied modifier is unknown", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;
  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "aligned-modifier-query",
      complexity: 0,
      result: ["matching-rare"],
      total: 1,
    };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        id: "clipboard-rare",
        origin: "clipboard",
        item: {
          frameType: 2,
          rarity: "Rare",
          typeLine: "Amethyst Ring",
          baseType: "Amethyst Ring",
          properties: [{ name: "Rings", values: [], displayMode: 0 }],
          explicitMods: [
            "82% increased effect of Socketed [Augment] Items",
            "50% increased Attack Speed",
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      { explicit: [false, true], implicit: [] },
    );

    expect(capturedSearch?.explicit).toEqual([
      { id: "explicit.stat_681332047", min: 44 },
    ]);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("adds selected rune enchants and exact corruption to copied item searches", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;
  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "rune-query",
      complexity: 0,
      result: ["matching-helmet"],
      total: 1,
    };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        id: "clipboard-helmet",
        origin: "clipboard",
        item: {
          frameType: 2,
          rarity: "Rare",
          typeLine: "Trapper Hood",
          baseType: "Trapper Hood",
          corrupted: true,
          properties: [{ name: "Helmets", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
          enchantMods: [
            "82% increased effect of Socketed [Augment] Items",
            "8% increased Reservation Efficiency of Minion Skills",
          ],
        },
      } as Poe2Item,
      "Standard",
      {
        explicit: [],
        implicit: [],
        enchant: [false, true],
      } as Parameters<typeof PriceChecker.findMatchingItem>[2] & {
        enchant: boolean[];
      },
    );

    expect(capturedSearch).toMatchObject({
      corrupted: "true",
      rarity: "nonunique",
      category: "armour.helmet",
      explicit: [
        { id: "rune.stat_1805633363", min: 7 },
      ],
      implicit: [],
      pseudo: [],
    });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("refuses a category-only copied item search when its enchant is unresolved", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let requested = false;
  Poe2Trade.getItemByAttributes = async () => {
    requested = true;
    return {
      id: "unsafe-enchant-query",
      complexity: 0,
      result: ["unrelated-helmet"],
      total: 1,
    };
  };

  try {
    await expect(
      PriceChecker.findMatchingItem(
        {
          id: "clipboard-helmet",
          origin: "clipboard",
          item: {
            frameType: 2,
            rarity: "Rare",
            typeLine: "Trapper Hood",
            baseType: "Trapper Hood",
            corrupted: false,
            properties: [{ name: "Helmets", values: [], displayMode: 0 }],
            explicitMods: [],
            implicitMods: [],
            enchantMods: [
              "82% increased effect of Socketed [Augment] Items",
            ],
          },
        } as Poe2Item,
        "Standard",
      ),
    ).rejects.toThrow("cannot be matched to current trade data");
    expect(requested).toBe(false);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("keeps the exact uncorrupted state in copied item search metadata", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let capturedSearch: Poe2ItemSearch | undefined;
  const item = {
    origin: "clipboard",
    item: {
      corrupted: false,
      frameType: 2,
      rarity: "Rare",
      typeLine: "Trapper Hood",
      baseType: "Trapper Hood",
      properties: [{ name: "Helmets", values: [], displayMode: 0 }],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearch = searchParams;
    return {
      id: "uncorrupted-query",
      complexity: 0,
      result: ["matching-helmet"],
      total: 1,
    };
  };

  try {
    expect(getItemSearchMetadata(item)).toMatchObject({ corrupted: "false" });
    await PriceChecker.findMatchingItem(item, "Standard");
    expect(capturedSearch).toMatchObject({ corrupted: "false" });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
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

test("omits unsupported rarity filters for currency trade searches", () => {
  expect(
    getItemSearchMetadata({
      item: {
        frameType: 5,
        rarity: "Currency",
        typeLine: "Exalted Orb",
        baseType: "Exalted Orb",
        properties: [{ name: "Currency", values: [], displayMode: 0 }],
      },
    } as Poe2Item),
  ).toMatchObject({
    baseType: "Exalted Orb",
    category: "currency",
    rarity: undefined,
  });
});

test("uses the explicitly configured league over stale item metadata", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  let requestedLeague: string | undefined;
  Poe2Trade.getItemByAttributes = async (_search, league) => {
    requestedLeague = league;
    return {
      id: "configured-league-query",
      complexity: 0,
      result: ["matching-ring"],
      total: 1,
    };
  };

  try {
    await PriceChecker.findMatchingItem(
      {
        id: "clipboard-ring",
        origin: "clipboard",
        item: {
          league: "Standard",
          frameType: 2,
          rarity: "Rare",
          typeLine: "Amethyst Ring",
          baseType: "Amethyst Ring",
          properties: [{ name: "Rings", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Runes of Aldur",
      { explicit: [], implicit: [] },
    );

    expect(requestedLeague).toBe("Runes of Aldur");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses reliable official exchange pricing before lower currency fallbacks", async () => {
  const originalGetTradeStaticData = Poe2Trade.client.getTradeStaticData;
  const originalGetExchangeListings = Poe2Trade.client.getExchangeListings;
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  let scoutCalls = 0;
  let regularTradeCalls = 0;

  Poe2Trade.client.getTradeStaticData = async () => ({
    result: [
      {
        id: "Currency",
        label: "Currency",
        entries: [{ id: "divine", text: "Divine Orb" }],
      },
    ],
  });
  Poe2Trade.client.getExchangeListings = async () => ({
    id: "exchange-id",
    result: Object.fromEntries(
      [100, 110, 120].map((amount, index) => [
        `listing-${index}`,
        {
          id: `listing-${index}`,
          listing: {
            account: { name: `seller-${index}` },
            offers: [
              {
                exchange: { currency: "exalted", amount },
                item: { currency: "divine", amount: 1, stock: 10 },
              },
            ],
          },
        },
      ]),
    ),
  } as Awaited<ReturnType<typeof Poe2Trade.client.getExchangeListings>>);
  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return undefined;
  };
  PriceChecker.findMatchingItem = async () => {
    regularTradeCalls += 1;
    throw new Error("Regular trade should not run after reliable exchange data");
  };
  PriceChecker.upscalePrice = async (price) => price;

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      {
        id: "clipboard-divine",
        origin: "clipboard",
        item: {
          id: "clipboard-divine",
          frameType: 5,
          rarity: "Currency",
          typeLine: "Divine Orb",
          baseType: "Divine Orb",
          properties: [{ name: "Currency", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      { explicit: [], implicit: [] },
      DEFAULT_MODIFIER_RANGE_PERCENT,
      { applyListingContext: false, recordResult: false },
    );

    expect(estimate).toMatchObject({
      price: { amount: 110, currency: "exalted" },
      source: "currency-exchange",
      method: "exchange-median",
      sourceComparableCount: 3,
      search: {
        strategy: "exchange-exact",
        searchId: "exchange-id",
        tradeTag: "divine",
        paymentCurrency: "exalted",
      },
    });
    expect(scoutCalls).toBe(0);
    expect(regularTradeCalls).toBe(0);
  } finally {
    Poe2Trade.client.getTradeStaticData = originalGetTradeStaticData;
    Poe2Trade.client.getExchangeListings = originalGetExchangeListings;
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.upscalePrice = originalUpscalePrice;
  }
});

test("uses Scout only after official exchange and regular trade are unavailable", async () => {
  const originalGetTradeStaticData = Poe2Trade.client.getTradeStaticData;
  const originalGetExchangeListings = Poe2Trade.client.getExchangeListings;
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  let regularTradeCalls = 0;

  Poe2Trade.client.getTradeStaticData = async () => ({
    result: [
      {
        id: "Currency",
        label: "Currency",
        entries: [{ id: "divine", text: "Divine Orb" }],
      },
    ],
  });
  Poe2Trade.client.getExchangeListings = async () => ({
    id: "exchange-id",
    result: {},
  } as Awaited<ReturnType<typeof Poe2Trade.client.getExchangeListings>>);
  Poe2Scout.getMarketValuation = async () => ({
    itemId: 1,
    itemName: "Divine Orb",
    price: { amount: 105, currency: "exalted" },
    quantity: 20,
    updatedAt: Date.now(),
    history: [{ amount: 105, quantity: 20, updatedAt: Date.now() }],
    method: "history",
  });
  PriceChecker.findMatchingItem = async () => {
    regularTradeCalls += 1;
    throw new Error("Regular trade should wait for the Scout fallback");
  };
  PriceChecker.upscalePrice = async (price) => price;

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      {
        id: "clipboard-divine",
        origin: "clipboard",
        item: {
          id: "clipboard-divine",
          frameType: 5,
          rarity: "Currency",
          typeLine: "Divine Orb",
          baseType: "Divine Orb",
          properties: [{ name: "Currency", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      { explicit: [], implicit: [] },
      DEFAULT_MODIFIER_RANGE_PERCENT,
      { applyListingContext: false, recordResult: false },
    );

    expect(estimate).toMatchObject({
      source: "poe2scout",
      method: "market-history",
      price: { amount: 105, currency: "exalted" },
    });
    expect(regularTradeCalls).toBe(1);
  } finally {
    Poe2Trade.client.getTradeStaticData = originalGetTradeStaticData;
    Poe2Trade.client.getExchangeListings = originalGetExchangeListings;
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.upscalePrice = originalUpscalePrice;
  }
});

test("uses regular trade before the Scout currency fallback", async () => {
  const originalGetTradeStaticData = Poe2Trade.client.getTradeStaticData;
  const originalGetExchangeListings = Poe2Trade.client.getExchangeListings;
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  let scoutCalls = 0;
  let regularTradeCalls = 0;

  Poe2Trade.client.getTradeStaticData = async () => ({
    result: [
      {
        id: "Currency",
        label: "Currency",
        entries: [{ id: "divine", text: "Divine Orb" }],
      },
    ],
  });
  Poe2Trade.client.getExchangeListings = async () => ({
    id: "exchange-id",
    result: {},
  });
  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return undefined;
  };
  PriceChecker.findMatchingItem = async () => {
    regularTradeCalls += 1;
    return {
      id: "regular-trade-id",
      complexity: 0,
      result: Array.from({ length: 7 }, (_value, index) => `item-${index}`),
      total: 7,
      strategy: "strict",
      selectedModifierCount: 0,
      minimumModifierCount: 0,
    };
  };
  PriceChecker.getPricesForItemIds = async () =>
    Array.from({ length: 7 }, (_value, index) => ({
      amount: 100 + index,
      currency: "exalted",
      itemId: `item-${index}`,
      listedAmount: 100 + index,
      listedCurrency: "exalted",
      item: {
        listing: { account: { name: `seller-${index}` } },
      } as Poe2Item,
    }));
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      {
        id: "clipboard-divine",
        origin: "clipboard",
        item: {
          id: "clipboard-divine",
          frameType: 5,
          rarity: "Currency",
          typeLine: "Divine Orb",
          baseType: "Divine Orb",
          properties: [{ name: "Currency", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      { explicit: [], implicit: [] },
      DEFAULT_MODIFIER_RANGE_PERCENT,
      {
        applyListingContext: false,
        recordResult: false,
        minimumIndependentSellers: 7,
      },
    );

    expect(estimate.source).toBe("official-trade");
    expect(estimate.comparables).toHaveLength(7);
    expect(scoutCalls).toBe(0);
    expect(regularTradeCalls).toBe(1);
  } finally {
    Poe2Trade.client.getTradeStaticData = originalGetTradeStaticData;
    Poe2Trade.client.getExchangeListings = originalGetExchangeListings;
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
  }
});

test("does not continue currency fallbacks after cancellation", async () => {
  const originalGetTradeStaticData = Poe2Trade.client.getTradeStaticData;
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const controller = new AbortController();
  let scoutCalls = 0;
  let regularTradeCalls = 0;

  Poe2Trade.client.getTradeStaticData = async () => {
    throw new Error("Request cancelled");
  };
  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return undefined;
  };
  PriceChecker.findMatchingItem = async () => {
    regularTradeCalls += 1;
    throw new Error("Regular trade should not run after cancellation");
  };
  controller.abort();

  try {
    await expect(
      PriceChecker.estimateItemPrice(
        {
          id: "clipboard-divine",
          origin: "clipboard",
          item: {
            frameType: 5,
            rarity: "Currency",
            typeLine: "Divine Orb",
            baseType: "Divine Orb",
            properties: [{ name: "Currency", values: [], displayMode: 0 }],
            explicitMods: [],
            implicitMods: [],
          },
        } as Poe2Item,
        "Standard",
        { explicit: [], implicit: [] },
        DEFAULT_MODIFIER_RANGE_PERCENT,
        { signal: controller.signal },
      ),
    ).rejects.toThrow("Request cancelled");
    expect(scoutCalls).toBe(0);
    expect(regularTradeCalls).toBe(0);
  } finally {
    Poe2Trade.client.getTradeStaticData = originalGetTradeStaticData;
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
  }
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

test("uses a socketed item's count by default and allows an editable minimum", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const capturedSearches: Poe2ItemSearch[] = [];
  const item = {
    id: "socketed-item",
    item: {
      frameType: 0,
      rarity: "Normal",
      typeLine: "Bolting Quarterstaff",
      baseType: "Bolting Quarterstaff",
      sockets: [{}, {}, {}],
      properties: [
        { name: "Quarterstaves", values: [], displayMode: 0 },
      ],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    capturedSearches.push(searchParams);
    return {
      id: "query-id",
      complexity: 0,
      result: ["comparable-item"],
      total: 1,
    };
  };

  try {
    expect(getItemSearchMetadata(item)).toMatchObject({ runeSocketCount: 3 });

    await PriceChecker.findMatchingItem(item, "Standard");
    await PriceChecker.findMatchingItem(item, "Standard", {
      explicit: [],
      implicit: [],
      runeSockets: true,
      runeSocketCount: 2,
    });
    await PriceChecker.findMatchingItem(item, "Standard", {
      explicit: [],
      implicit: [],
      runeSockets: false,
      runeSocketCount: 2,
    });

    expect(capturedSearches[0]).toMatchObject({ rune_sockets: 3 });
    expect(capturedSearches[1]).toMatchObject({ rune_sockets: 2 });
    expect(capturedSearches[2]).not.toHaveProperty("rune_sockets");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
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

test("compares a two-value damage modifier by its average roll", () => {
  const modifier = PriceChecker.extractMod(
    "Adds 3 to 106 Lightning Damage",
    "explicit",
  );

  expect(modifier).toMatchObject({ value1: 3, value2: 106 });
  expect(buildModifierSearchFilters([modifier]).explicit).toEqual([
    {
      id: "explicit.stat_3336890334",
      min: 47,
      max: 62,
    },
  ]);
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

test("serializes requirement, rune socket, and relaxed stat filters", async () => {
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
        rune_sockets: 2,
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
        equipment_filters: {
          filters: { rune_sockets: { min: number } };
        };
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
  expect(
    payload.query.filters.equipment_filters.filters.rune_sockets,
  ).toEqual({ min: 2 });
});

test("serializes the copied-item corruption state as an option filter", async () => {
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
      { baseType: "Fine Ring", corrupted: "false" },
      "Standard",
    );
  } finally {
    axios.post = originalPost;
  }

  const payload = capturedPayload as {
    query: {
      filters: {
        misc_filters: {
          filters: { corrupted: unknown };
        };
      };
    };
  };
  expect(payload.query.filters.misc_filters.filters.corrupted).toEqual({
    option: "false",
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

test("relaxes the Awakened-style rare search until it has enough peers", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    if (searches.length < 3) {
      return {
        id: `query-${searches.length}`,
        complexity: 0,
        result: ["priced-item"],
        total: 1,
      };
    }

    return {
      id: "query-3",
      complexity: 0,
      result: [
        "priced-item",
        ...Array.from(
          { length: 7 },
          (_value, index) => `comparable-${index}`,
        ),
      ],
      total: 8,
    };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "priced-item",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Adherent Bow",
          properties: [{ name: "Bows", values: [], displayMode: 0 }],
          explicitMods: Array.from({ length: 4 }, (_value, index) => ({
            description: `${index + 10}% increased Attack Speed`,
            hash: `explicit.stat_${index}`,
            mods: [],
          })),
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
    );

    expect(searches).toHaveLength(3);
    expect(searches.map((search) => search.statGroupMin)).toEqual([
      undefined,
      3,
      2,
    ]);
    expect(result).toMatchObject({
      id: "query-3",
      strategy: "market-pseudos",
      selectedModifierCount: 4,
      minimumModifierCount: 2,
    });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("continues Awakened-style relaxation when listings come from too few sellers", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const searches: Poe2ItemSearch[] = [];
  let scoutCalls = 0;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: `query-${searches.length}`,
      complexity: 0,
      result: Array.from(
        { length: 7 },
        (_value, index) => `query-${searches.length}-item-${index}`,
      ),
      total: 7,
    };
  };
  PriceChecker.getPricesForItemIds = async (ids) =>
    ids.map((id, index) => ({
      amount: 10 + index,
      currency: "exalted",
      itemId: id,
      listedAmount: 10 + index,
      listedCurrency: "exalted",
      item: {
        listing: {
          account: {
            name: searches.length < 3 ? "shared-seller" : `seller-${index}`,
          },
        },
      } as Poe2Item,
    }));
  PriceChecker.fetchManyExchangeRates = async () => {};
  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return undefined;
  };
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => false;
  PriceChecker.cachePriceEstimate = () => {};

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      {
        id: "priced-item",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Fine Ring",
          properties: [{ name: "Rings", values: [], displayMode: 0 }],
          explicitMods: Array.from({ length: 4 }, (_value, index) => ({
            description: `${index + 10}% increased Attack Speed`,
            hash: `explicit.stat_${index}`,
            mods: [],
          })),
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      { minimumIndependentSellers: 7 },
    );

    expect(searches.map((search) => search.statGroupMin)).toEqual([
      undefined,
      3,
      2,
    ]);
    expect(estimate).toMatchObject({
      source: "official-trade",
      search: {
        strategy: "market-pseudos",
        selectedModifierCount: 4,
        minimumModifierCount: 2,
      },
    });
    expect(scoutCalls).toBe(0);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
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
    origin: "clipboard",
    item: {
      id: "item-id",
      baseType: "Fine Ring",
      corrupted: false,
      sockets: [{}, {}, {}],
      explicitMods: ["100 to maximum Life", "50% increased Attack Speed"],
      implicitMods: [],
      enchantMods: [
        "8% increased Reservation Efficiency of Minion Skills",
      ],
    },
  } as Poe2Item;
  const modifierSelection = {
    explicit: [true, true],
    implicit: [],
    enchant: [true],
    itemLevel: false,
    runeSockets: true,
    runeSocketCount: 2,
  };
  const searchArguments: unknown[][] = [];
  const pricedIds: string[][] = [];
  const matchingIds = Array.from(
    { length: 7 },
    (_value, index) => `matching-${index}`,
  );

  PriceChecker.findMatchingItem = (async (...args) => {
    searchArguments.push(args);
    return {
      id: "search-id",
      complexity: 0,
      result: matchingIds,
      total: matchingIds.length,
      strategy: "one-mod-relaxed",
      selectedModifierCount: 2,
      minimumModifierCount: 1,
    };
  }) as typeof PriceChecker.findMatchingItem;
  PriceChecker.getPricesForItemIds = (async (ids) => {
    pricedIds.push(ids);
    return ids.map((id, index) => ({
        amount: 10 + index,
        currency: "exalted",
        itemId: id,
        listedAmount: 10 + index,
        listedCurrency: "exalted",
      }));
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
    expect(searchArguments[0].slice(0, 5)).toEqual([
      item,
      "Standard",
      modifierSelection,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      {},
    ]);
    expect(typeof searchArguments[0][5]).toBe("function");
    expect(pricedIds).toEqual([matchingIds]);
    expect(estimate.confidence).toBe("low");
    expect(estimate.search).toMatchObject({
      strategy: "one-mod-relaxed",
      selectedModifierCount: 2,
      minimumModifierCount: 1,
      enchantCount: 1,
      enchantHashes: ["rune.stat_1805633363"],
      corrupted: "false",
      runeSocketCount: 2,
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

test("uses one official seller before requesting a Poe2Scout fallback", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  let scoutCalls = 0;

  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return {
      itemId: 4993,
      itemName: "Darkness Enthroned",
      price: { amount: 42, currency: "exalted" },
      quantity: 17,
      updatedAt: Date.now(),
      history: [],
    };
  };
  PriceChecker.findMatchingItem = async () => ({
    id: "official-search",
    complexity: 0,
    result: ["item-0"],
    total: 1,
    strategy: "strict",
    selectedModifierCount: 0,
    minimumModifierCount: 0,
  });
  PriceChecker.getPricesForItemIds = async () => [
    {
      amount: 100,
      currency: "exalted",
      itemId: "item-0",
      listedAmount: 100,
      listedCurrency: "exalted",
      item: {
        listing: { account: { name: "seller-0" } },
      } as Poe2Item,
    },
  ];
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      {
        id: "clipboard-unique",
        origin: "clipboard",
        item: {
          frameType: 3,
          rarity: "Unique",
          name: "Darkness Enthroned",
          typeLine: "Darkness Enthroned",
          baseType: "Fine Belt",
          properties: [{ name: "Belts", values: [], displayMode: 0 }],
          explicitMods: [],
          implicitMods: [],
        },
      } as Poe2Item,
      "Standard",
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      {
        applyListingContext: false,
        recordResult: false,
      },
    );

    expect(estimate.source).toBe("official-trade");
    expect(estimate.comparables).toHaveLength(1);
    expect(estimate.confidence).toBe("low");
    expect(scoutCalls).toBe(0);
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
  }
});

test("does not apply listing context or record clipboard-only estimates", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalPriceEstimate = PriceChecker.priceEstimate;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  let matchCalls = 0;
  let cacheCalls = 0;
  const item = {
    id: "clipboard-item",
    origin: "clipboard",
    listing: {
      indexed: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
      price: { amount: 1, currency: "exalted" },
      stash: { name: "Clipboard", x: 0, y: 0 },
    },
    item: {
      id: "clipboard-item",
      baseType: "Fine Ring",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Scout.getMarketValuation = async () => undefined;
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: ["matching-id"],
    total: 1,
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
  PriceChecker.priceEstimate = () => ({
    price: { amount: 100, currency: "exalted" },
    stdDev: { amount: 20, currency: "exalted" },
    comparables: [],
  });
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => {
    matchCalls += 1;
    return false;
  };
  PriceChecker.cachePriceEstimate = () => {
    cacheCalls += 1;
  };

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      item,
      "Standard",
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      { applyListingContext: false, recordResult: false },
    );

    expect(estimate.price).toEqual({ amount: 100, currency: "exalted" });
    expect(estimate.stdDev).toEqual({ amount: 20, currency: "exalted" });
    expect(estimate.listingAgeAdjustmentFactor).toBeUndefined();
    expect(estimate.matchesCurrentPrice).toBeUndefined();
    expect(matchCalls).toBe(0);
    expect(cacheCalls).toBe(0);
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.priceEstimate = originalPriceEstimate;
    PriceChecker.upscalePrice = originalUpscalePrice;
    PriceChecker.matchesCurrentPrice = originalMatchesCurrentPrice;
    PriceChecker.cachePriceEstimate = originalCachePriceEstimate;
  }
});

test("rejects clipboard trade pricing below the independent seller threshold", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const item = {
    id: "clipboard-unique",
    origin: "clipboard",
    item: {
      id: "clipboard-unique",
      frameType: 3,
      rarity: "Unique",
      name: "Darkness Enthroned",
      typeLine: "Darkness Enthroned",
      baseType: "Fine Belt",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Scout.getMarketValuation = async () => undefined;
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: Array.from({ length: 6 }, (_value, index) => `item-${index}`),
    total: 6,
  });
  PriceChecker.getPricesForItemIds = async () =>
    Array.from({ length: 6 }, (_value, index) => ({
      amount: 10 + index,
      currency: "exalted",
      itemId: `item-${index}`,
      listedAmount: 10 + index,
      listedCurrency: "exalted",
      item: {
        listing: { account: { name: `seller-${index}` } },
      } as Poe2Item,
    }));
  PriceChecker.fetchManyExchangeRates = async () => {};

  try {
    await expect(
      PriceChecker.estimateItemPrice(
        item,
        "Standard",
        undefined,
        DEFAULT_MODIFIER_RANGE_PERCENT,
        {
          applyListingContext: false,
          recordResult: false,
          minimumIndependentSellers: 7,
          maxTradeListings: 100,
        },
      ),
    ).rejects.toThrow("at least 7 independent sellers");
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
  }
});

test("falls back to Scout when clipboard trade pricing is under-sampled", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const item = {
    id: "clipboard-unique",
    origin: "clipboard",
    item: {
      id: "clipboard-unique",
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
    updatedAt: Date.now(),
    history: [],
  });
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: Array.from({ length: 6 }, (_value, index) => `item-${index}`),
    total: 6,
    strategy: "strict",
    selectedModifierCount: 1,
    minimumModifierCount: 1,
  });
  PriceChecker.getPricesForItemIds = async () =>
    Array.from({ length: 6 }, (_value, index) => ({
      amount: 100 + index,
      currency: "exalted",
      itemId: `item-${index}`,
      listedAmount: 100 + index,
      listedCurrency: "exalted",
      item: {
        listing: { account: { name: `seller-${index}` } },
      } as Poe2Item,
    }));
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;

  try {
    const estimate = await PriceChecker.estimateItemPrice(
      item,
      "Standard",
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      {
        applyListingContext: false,
        recordResult: false,
        minimumIndependentSellers: 7,
        maxTradeListings: 100,
      },
    );

    expect(estimate.source).toBe("poe2scout");
    expect(estimate.price).toEqual({ amount: 42, currency: "exalted" });
    expect(estimate.comparables).toHaveLength(0);
    expect(estimate.sourceComparableCount).toBe(6);
  } finally {
    Poe2Scout.getMarketValuation = originalGetMarketValuation;
    PriceChecker.findMatchingItem = originalFindMatchingItem;
    PriceChecker.getPricesForItemIds = originalGetPricesForItemIds;
    PriceChecker.fetchManyExchangeRates = originalFetchManyExchangeRates;
    PriceChecker.upscalePrice = originalUpscalePrice;
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
      indexed: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
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

test("uses exact-corruption trade comparables over a generic Scout baseline", async () => {
  const originalGetMarketValuation = Poe2Scout.getMarketValuation;
  const originalFindMatchingItem = PriceChecker.findMatchingItem;
  const originalGetPricesForItemIds = PriceChecker.getPricesForItemIds;
  const originalFetchManyExchangeRates = PriceChecker.fetchManyExchangeRates;
  const originalUpscalePrice = PriceChecker.upscalePrice;
  const originalMatchesCurrentPrice = PriceChecker.matchesCurrentPrice;
  const originalCachePriceEstimate = PriceChecker.cachePriceEstimate;
  const updatedAt = Date.parse("2026-07-18T10:25:16Z");
  let scoutCalls = 0;
  const item = {
    id: "rolled-unique-item",
    origin: "clipboard",
    item: {
      id: "rolled-unique-item",
      frameType: 3,
      rarity: "Unique",
      name: "Darkness Enthroned",
      typeLine: "Darkness Enthroned",
      baseType: "Fine Belt",
      corrupted: true,
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Scout.getMarketValuation = async () => {
    scoutCalls += 1;
    return {
      itemId: 4993,
      itemName: "Darkness Enthroned",
      price: { amount: 42, currency: "exalted" },
      quantity: 17,
      updatedAt,
      history: [{ amount: 42, quantity: 17, updatedAt }],
    };
  };
  PriceChecker.findMatchingItem = async () => ({
    id: "search-id",
    complexity: 0,
    result: Array.from({ length: 7 }, (_value, index) => `matching-${index}`),
    total: 7,
    strategy: "strict",
    selectedModifierCount: 0,
    minimumModifierCount: 0,
  });
  PriceChecker.getPricesForItemIds = async (ids) =>
    ids.map((id, index) => ({
      amount: 100 + index,
      currency: "exalted",
      itemId: id,
      listedAmount: 100 + index,
      listedCurrency: "exalted",
    }));
  PriceChecker.fetchManyExchangeRates = async () => {};
  PriceChecker.upscalePrice = async (price) => price;
  PriceChecker.matchesCurrentPrice = async () => false;
  PriceChecker.cachePriceEstimate = () => {};

  try {
    const estimate = await PriceChecker.estimateItemPrice(item, "Standard");

    expect(estimate.source).toBe("official-trade");
    expect(estimate.method).toBe("median");
    expect(estimate.price).toEqual({ amount: 103, currency: "exalted" });
    expect(estimate.market).toBeUndefined();
    expect(scoutCalls).toBe(0);
    expect(estimate.search?.corrupted).toBe("true");
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

test("uses Scout when an explicit seller threshold is under-sampled", async () => {
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
    history: [{ amount: 42, quantity: 17, updatedAt }],
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
    const estimate = await PriceChecker.estimateItemPrice(
      item,
      "Standard",
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      { minimumIndependentSellers: 2 },
    );

    expect(estimate.source).toBe("poe2scout");
    expect(estimate.method).toBe("market-history");
    expect(estimate.price).toEqual({ amount: 42, currency: "exalted" });
    expect(estimate.market).toMatchObject({
      itemId: 4993,
      quantity: 17,
      updatedAt,
    });
    expect(estimate.comparables).toHaveLength(0);
    expect(estimate.sourceComparableCount).toBe(1);
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

test("uses an Awakened-style DPS query for an unconfigured rare weapon", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: "weapon-dps-search",
      complexity: 0,
      result: Array.from(
        { length: 7 },
        (_value, index) => `comparable-${index}`,
      ),
      total: 7,
    };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "rare-bow",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Adherent Bow",
          properties: [
            { name: "Bows", values: [], displayMode: 0 },
            {
              name: "Physical Damage",
              values: [["35-72", 0]],
              displayMode: 0,
            },
            {
              name: "Lightning Damage",
              values: [["1-50", 0]],
              displayMode: 0,
            },
            {
              name: "Attacks per Second",
              values: [["1.20", 0]],
              displayMode: 0,
            },
          ],
          explicitMods: [
            {
              description: "Adds 1 to 50 Lightning Damage",
              hash: "explicit.stat_3336890334",
              mods: [],
            },
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
    );

    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      status: "securable",
      rarity: "nonunique",
      category: "weapon.bow",
      dps: 83,
      explicit: [],
      implicit: [],
      pseudo: [],
    });
    expect(searches[0]).not.toHaveProperty("baseType");
    expect(result).toMatchObject({
      strategy: "market-properties",
      selectedModifierCount: 1,
      minimumModifierCount: 1,
    });
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses weapon properties when copied modifiers are unresolved", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: "weapon-property-search",
      complexity: 0,
      result: Array.from({ length: 7 }, (_value, index) => `item-${index}`),
      total: 7,
    };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "copied-bow",
        origin: "clipboard",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Adherent Bow",
          properties: [
            { name: "Bows", values: [], displayMode: 0 },
            {
              name: "Lightning Damage",
              values: [["3-106", 0]],
              displayMode: 0,
            },
            {
              name: "Attacks per Second",
              values: [["1.20", 0]],
              displayMode: 0,
            },
          ],
          explicitMods: ["82% increased effect of Socketed [Augment] Items"],
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
      { explicit: [false], implicit: [] },
    );

    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      rarity: "nonunique",
      category: "weapon.bow",
      edps: 57,
    });
    expect(result.strategy).toBe("market-properties");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("applies selected non-DPS modifiers to the weapon market query", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];
  const item = {
    id: "rare-bow",
    item: {
      frameType: 2,
      rarity: "Rare",
      baseType: "Adherent Bow",
      properties: [
        { name: "Bows", values: [], displayMode: 0 },
        {
          name: "Lightning Damage",
          values: [["3-106", 0]],
          displayMode: 0,
        },
        {
          name: "Attacks per Second",
          values: [["1.20", 0]],
          displayMode: 0,
        },
      ],
      explicitMods: [
        {
          description: "100 to maximum Life",
          hash: "explicit.stat_3299347043",
          mods: [],
        },
      ],
      implicitMods: [],
    },
  } as Poe2Item;

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: `weapon-query-${searches.length}`,
      complexity: 0,
      result: Array.from({ length: 7 }, (_value, index) => `item-${index}`),
      total: 7,
    };
  };

  try {
    await PriceChecker.findMatchingItem(item, "HC Runes of Aldur", {
      explicit: [true],
      implicit: [],
    });
    await PriceChecker.findMatchingItem(item, "HC Runes of Aldur", {
      explicit: [false],
      implicit: [],
    });

    expect(searches).toHaveLength(2);
    expect(searches[0].pseudo).toEqual([
      { id: "pseudo.pseudo_total_life", min: 88 },
    ]);
    expect(searches[1].pseudo).toEqual([]);
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses Awakened-style pseudo totals before exact rare accessory mods", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: "rare-pseudo-search",
      complexity: 0,
      result: Array.from({ length: 7 }, (_value, index) => `item-${index}`),
      total: 7,
    };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "rare-amulet",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Lapis Amulet",
          properties: [{ name: "Amulets", values: [], displayMode: 0 }],
          explicitMods: [
            {
              description: "100 to maximum Life",
              hash: "explicit.stat_3299347043",
              mods: [],
            },
            {
              description: "25% to Fire Resistance",
              hash: "explicit.stat_3372524247",
              mods: [],
            },
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
      { explicit: [true, true], implicit: [] },
    );

    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      status: "securable",
      rarity: "nonunique",
      category: "accessory.amulet",
      pseudo: [
        { id: "pseudo.pseudo_total_life", min: 88 },
        { id: "pseudo.pseudo_total_elemental_resistance", min: 22 },
      ],
    });
    expect(result.strategy).toBe("market-pseudos");
  } finally {
    Poe2Trade.getItemByAttributes = originalGetItemByAttributes;
  }
});

test("uses an Awakened-style defence property for single-defence rare armour", async () => {
  const originalGetItemByAttributes = Poe2Trade.getItemByAttributes;
  const searches: Poe2ItemSearch[] = [];

  Poe2Trade.getItemByAttributes = async (searchParams) => {
    searches.push(searchParams);
    return {
      id: "armour-market-query",
      complexity: 0,
      result: Array.from({ length: 7 }, (_value, index) => `item-${index}`),
      total: 7,
    };
  };

  try {
    const result = await PriceChecker.findMatchingItem(
      {
        id: "rare-armour",
        item: {
          frameType: 2,
          rarity: "Rare",
          baseType: "Expert Oiled Coat",
          properties: [
            { name: "Body Armours", values: [], displayMode: 0 },
            { name: "Armour", values: [["500", 0]], displayMode: 0 },
          ],
          explicitMods: [
            {
              description: "90% increased Armour",
              hash: "explicit.stat_1062208444",
              mods: [],
            },
            {
              description: "100 to maximum Life",
              hash: "explicit.stat_3299347043",
              mods: [],
            },
          ],
          implicitMods: [],
        },
      } as Poe2Item,
      "HC Runes of Aldur",
    );

    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({
      rarity: "nonunique",
      category: "armour.chest",
      ar: 440,
      explicit: [],
      pseudo: [{ id: "pseudo.pseudo_total_life", min: 88 }],
    });
    expect(result).toMatchObject({
      strategy: "market-properties",
      marketProperty: "ar",
      selectedModifierCount: 2,
      minimumModifierCount: 2,
    });
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

test("uses a copied plural item class before ambiguous base-type text", () => {
  const cases = [
    {
      itemClass: "Body Armours",
      baseType: "Experimental Ring Mail",
      category: "armour.chest",
    },
    {
      itemClass: "Two Hand Maces",
      baseType: "Experimental Crusher",
      category: "weapon.twomace",
    },
    {
      itemClass: "Foci",
      baseType: "Experimental Device",
      category: "armour.focus",
    },
    {
      itemClass: "Quarterstaves",
      baseType: "Experimental Rod",
      category: "weapon.warstaff",
    },
  ];

  for (const { itemClass, baseType, category } of cases) {
    expect(
      getItemSearchMetadata({
        origin: "clipboard",
        item: {
          rarity: "Rare",
          typeLine: baseType,
          baseType,
          properties: [{ name: itemClass, values: [], displayMode: 0 }],
        },
      } as Poe2Item).category,
    ).toBe(category);
  }
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
        properties: [{ name: "Level", values: [["15", 0]], displayMode: 0 }],
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
      properties: [{ name: "Body Armour", values: [], displayMode: 0 }],
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

test("invalidates cached estimates created before expanded trade evidence", () => {
  const item = {
    item: {
      baseType: "Fine Ring",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      {
        search: {
          category: "accessory.ring",
          modifierComparisonVersion: 7,
        },
      } as Estimate,
      undefined,
    ),
  ).toBe(false);
});

test("does not reuse a cached estimate from another league", () => {
  const item = {
    item: {
      baseType: "Fine Ring",
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      league: "Standard",
      category: "accessory.ring",
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      undefined,
      DEFAULT_MODIFIER_RANGE_PERCENT,
      "HC Runes of Aldur",
    ),
  ).toBe(false);
});

test("loads cached estimates only for the configured league", () => {
  const originalGetJson = Cache.getJson;
  Cache.getJson = () => ({
    standard: { search: { league: "Standard" } } as Estimate,
    hardcore: {
      search: { league: "HC Runes of Aldur" },
    } as Estimate,
  });

  try {
    expect(Object.keys(PriceChecker.getCachedEstimates("HC Runes of Aldur")))
      .toEqual(["hardcore"]);
  } finally {
    Cache.getJson = originalGetJson;
  }
});

test("reuses market-property estimates only while DPS and selected modifiers match", () => {
  const item = {
    item: {
      frameType: 2,
      rarity: "Rare",
      baseType: "Adherent Bow",
      properties: [
        { name: "Bows", values: [], displayMode: 0 },
        { name: "Physical Damage", values: [["35-72", 0]], displayMode: 0 },
        { name: "Lightning Damage", values: [["1-50", 0]], displayMode: 0 },
        {
          name: "Attacks per Second",
          values: [["1.20", 0]],
          displayMode: 0,
        },
      ],
      explicitMods: [
        {
          description: "Adds 1 to 50 Lightning Damage",
          hash: "explicit.stat_3336890334",
          mods: [],
        },
        {
          description: "100 to maximum Life",
          hash: "explicit.stat_3299347043",
          mods: [],
        },
      ],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      league: "HC Runes of Aldur",
      category: "weapon.bow",
      rarity: "nonunique",
      strategy: "market-properties",
      marketProperty: "dps",
      marketPropertyMinimum: 83,
      modifierRangePercent: 12,
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
      explicitHashes: [
        "explicit.stat_3336890334",
        "explicit.stat_3299347043",
      ],
      implicitHashes: [],
      enchantHashes: [],
    },
  } as Estimate;
  const selection = { explicit: [true, true], implicit: [] };

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      selection,
      12,
      "HC Runes of Aldur",
    ),
  ).toBe(true);

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      { explicit: [true, false], implicit: [] },
      12,
      "HC Runes of Aldur",
    ),
  ).toBe(false);

  item.item.properties = item.item.properties.map((property) =>
    property.name === "Lightning Damage"
      ? { ...property, values: [["1-100", 0]] }
      : property,
  );
  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      selection,
      12,
      "HC Runes of Aldur",
    ),
  ).toBe(false);
});

test("reuses market-pseudo estimates only for the aggregate modifier selection", () => {
  const item = {
    item: {
      frameType: 2,
      rarity: "Rare",
      baseType: "Lapis Amulet",
      properties: [{ name: "Amulets", values: [], displayMode: 0 }],
      explicitMods: [
        {
          description: "100 to maximum Life",
          hash: "explicit.stat_3299347043",
          mods: [],
        },
        {
          description: "25% to Fire Resistance",
          hash: "explicit.stat_3372524247",
          mods: [],
        },
      ],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      league: "HC Runes of Aldur",
      category: "accessory.amulet",
      rarity: "nonunique",
      strategy: "market-pseudos",
      selectedModifierCount: 1,
      minimumModifierCount: 1,
      modifierRangePercent: 12,
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
      explicitHashes: ["explicit.stat_3299347043"],
      implicitHashes: [],
      enchantHashes: [],
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      { explicit: [true, false], implicit: [] },
      12,
      "HC Runes of Aldur",
    ),
  ).toBe(true);
  expect(
    PriceChecker.matchesModifierSelection(
      item,
      estimate,
      { explicit: [true, true], implicit: [] },
      12,
      "HC Runes of Aldur",
    ),
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

test("matches cached estimates with the selected rune socket minimum", () => {
  const item = {
    item: {
      sockets: [{}, {}, {}],
      explicitMods: [],
      implicitMods: [],
    },
  } as Poe2Item;
  const estimate = {
    search: {
      explicitHashes: [],
      implicitHashes: [],
      enchantHashes: [],
      runeSocketCount: 2,
      modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
    },
  } as Estimate;

  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      runeSockets: true,
      runeSocketCount: 2,
    }),
  ).toBe(true);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      runeSockets: true,
      runeSocketCount: 3,
    }),
  ).toBe(false);
  expect(
    PriceChecker.matchesModifierSelection(item, estimate, {
      explicit: [],
      implicit: [],
      runeSockets: false,
      runeSocketCount: 2,
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

test("keeps usable comparables when one listing currency cannot be converted", async () => {
  const originalFetchItems = Poe2Trade.fetchItems;
  const originalExchangeRate = PriceChecker.exchangeRate;
  const ids = Array.from({ length: 8 }, (_value, index) => `item-${index}`);

  Poe2Trade.fetchItems = async () =>
    ({
      result: ids.map((id, index) => ({
        id,
        listing: {
          price: {
            amount: index === ids.length - 1 ? 1 : 10 + index,
            currency: index === ids.length - 1 ? "mirror" : "exalted",
          },
          account: { name: `seller-${index}` },
        },
      })),
    }) as { result: Poe2Item[] };
  PriceChecker.exchangeRate = async (_iWant, iHave) => {
    if (iHave === "mirror") {
      throw new Error("No exchange rate found for mirror to exalted.");
    }
    return 1;
  };

  try {
    const prices = await PriceChecker.getPricesForItemIds(
      ids,
      "exalted",
      "HC Runes of Aldur",
      { minimumIndependentSellers: 7 },
    );
    const estimate = PriceChecker.priceEstimate(prices, {
      minimumIndependentSellers: 7,
    });

    expect(estimate.comparables).toHaveLength(7);
    expect(estimate.excludedByReason?.invalid).toBe(1);
  } finally {
    Poe2Trade.fetchItems = originalFetchItems;
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("fetches more trade listings until seven independent sellers are available", async () => {
  const originalFetchItems = Poe2Trade.fetchItems;
  const ids = Array.from({ length: 30 }, (_value, index) => `item-${index}`);
  const requestedBatches: string[][] = [];

  Poe2Trade.fetchItems = async (requestedIds) => {
    requestedBatches.push([...requestedIds]);
    return {
      result: requestedIds.slice(0, 10).map((id) => {
        const index = Number(id.split("-")[1]);
        return {
          id,
          listing: {
            indexed: new Date().toISOString(),
            account: { name: index < 10 ? "shared-seller" : `seller-${index}` },
            price: { amount: 10 + index, currency: "exalted" },
          },
        } as Poe2Item;
      }),
    };
  };

  try {
    const prices = await PriceChecker.getPricesForItemIds(
      ids,
      "exalted",
      "Standard",
      { minimumIndependentSellers: 7, maxTradeListings: 100 },
    );

    expect(prices.some((price) => price.itemId === "item-10")).toBe(true);
    expect(requestedBatches).toEqual([ids.slice(0, 10), ids.slice(10, 20)]);
  } finally {
    Poe2Trade.fetchItems = originalFetchItems;
  }
});

test("caps expanded comparable fetching at one hundred listings", async () => {
  const originalFetchItems = Poe2Trade.fetchItems;
  const ids = Array.from({ length: 110 }, (_value, index) => `item-${index}`);
  const requestedBatches: string[][] = [];

  Poe2Trade.fetchItems = async (requestedIds) => {
    requestedBatches.push([...requestedIds]);
    return {
      result: requestedIds.map((id, index) => ({
        id,
        listing: {
          account: { name: "shared-seller" },
          price: { amount: 10 + index, currency: "exalted" },
        },
      })) as Poe2Item[],
    };
  };

  try {
    await PriceChecker.getPricesForItemIds(ids, "exalted", "Standard", {
      minimumIndependentSellers: 7,
      maxTradeListings: 100,
    });

    expect(requestedBatches).toHaveLength(10);
    expect(requestedBatches.at(-1)).toEqual(ids.slice(90, 100));
    expect(requestedBatches.flat()).not.toContain("item-100");
  } finally {
    Poe2Trade.fetchItems = originalFetchItems;
  }
});

test("uses the first twenty official listings for ordinary stash estimates", async () => {
  const originalFetchItems = Poe2Trade.fetchItems;
  const ids = Array.from({ length: 30 }, (_value, index) => `item-${index}`);
  const requestedBatches: string[][] = [];

  Poe2Trade.fetchItems = async (requestedIds) => {
    requestedBatches.push([...requestedIds]);
    return {
      result: requestedIds.map((id, index) => ({
        id,
        listing: {
          account: { name: `seller-${index}` },
          price: { amount: 10 + index, currency: "exalted" },
        },
      })) as Poe2Item[],
    };
  };

  try {
    await PriceChecker.getPricesForItemIds(ids, "exalted", "Standard");

    expect(requestedBatches).toEqual([
      ids.slice(0, 10),
      ids.slice(10, 20),
    ]);
  } finally {
    Poe2Trade.fetchItems = originalFetchItems;
  }
});
