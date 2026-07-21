import {
  formatItemMod,
  getItemModifierHash,
  ItemMod,
  ModifierSelection,
  normalizeModifierHash,
  Price,
  Poe2Item,
  Poe2ItemSearch,
  Poe2TradeSearch,
} from "./types";
import { Poe2Trade } from "./poe2trade";
import { getCurrencyRateFromOverview } from "./Poe2TradeClient";
import { Cache } from "./Cache";
import { Stats } from "../data/stats";
import {
  analyzeComparablePrices,
  ComparableExclusionReason,
  PriceConfidence,
} from "./priceAnalysis";
import { recordPriceSnapshot } from "./priceHistory";
import { ApiRequestRunOptions } from "./ApiRequestQueue";
import {
  Poe2Scout,
  Poe2ScoutMarketValuation,
} from "./Poe2ScoutClient";
import {
  classifyPricePosition,
  PricePosition,
} from "./pricePosition";
import { getItemCategory } from "./itemCategory";
import { getListingSuggestionPriceFactor } from "./listingPricePolicy";

function rethrowIfRequestCancelled(
  error: unknown,
  options: ApiRequestRunOptions,
) {
  if (options.signal?.aborted) {
    throw error;
  }
}

export type Stat = (typeof Stats)[0]["entries"][0];
export type Explicit = Poe2Item["item"]["extended"]["mods"]["explicit"][0];
export type ComparablePrice = Price & {
  itemId: string;
  listedAmount: number;
  listedCurrency: string;
  item?: Poe2Item;
};
export type Estimate = {
  checkedAt?: number;
  listingAgeAdjustmentFactor?: number;
  matchesCurrentPrice?: boolean;
  price: Price;
  stdDev: Price;
  comparables: ComparablePrice[];
  sourceComparableCount?: number;
  excludedComparableCount?: number;
  excludedByReason?: Record<ComparableExclusionReason, number>;
  confidence?: PriceConfidence;
  source?: "official-trade" | "poe2scout";
  method?: "median" | "market-history" | "market-current";
  market?: Poe2ScoutMarketValuation;
  search: {
    league?: string;
    baseType?: string;
    category?: string;
    name?: string;
    rarity?: string;
    itemLevel?: number;
    requiredLevelMin?: number;
    requiredLevelMax?: number;
    strategy?: "strict" | "one-mod-relaxed";
    selectedModifierCount?: number;
    minimumModifierCount?: number;
    modifierComparisonVersion?: number;
    explicitCount: number;
    implicitCount?: number;
    explicitHashes?: string[];
    implicitHashes?: string[];
    modifierRangePercent?: number;
  };
};

export const DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES = 5;
export const MIN_MODIFIER_RANGE_PERCENT = 5;
export const MAX_MODIFIER_RANGE_PERCENT = 100;
export const DEFAULT_MODIFIER_RANGE_PERCENT = 12;
export const CURRENCY_RATE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MODIFIER_COMPARISON_VERSION = 7;

const CURRENCY_IDS = ["exalted", "chaos", "divine", "mirror"] as const;
export type CurrencyRates = Record<string, number>;

export type ParsedItemMod = {
  mod: string;
  parsed: string;
  value1: number | undefined;
  value2?: number;
  hash: string;
};

type SearchModifier = {
  id: string;
  min?: number;
  max?: number;
};

export type ModifierSearchFilters = {
  explicit: SearchModifier[];
  implicit: SearchModifier[];
  pseudo: SearchModifier[];
};

const PSEUDO_MODIFIER_IDS = {
  life: "pseudo.pseudo_total_life",
  energyShield: "pseudo.pseudo_total_energy_shield",
  resistance: "pseudo.pseudo_total_resistance",
} as const;

export function isEstimateFresh(
  estimate: Pick<Estimate, "checkedAt">,
  cooldownMinutes: number,
  now = Date.now(),
) {
  if (
    cooldownMinutes <= 0 ||
    typeof estimate.checkedAt !== "number" ||
    !Number.isFinite(estimate.checkedAt)
  ) {
    return false;
  }

  return now - estimate.checkedAt < cooldownMinutes * 60_000;
}

export function getExchangeRateCacheKey(
  iWant: string,
  iHave: string,
  league?: string,
) {
  return `v2_${iWant}_${iHave}_${league || "default"}`;
}

export function getComparablePriceCurrency(
  preferredCurrency: string,
  currencies: string[],
) {
  const uniqueCurrencies = [...new Set(currencies)];
  return uniqueCurrencies.length === 1
    ? uniqueCurrencies[0]
    : preferredCurrency;
}

export function selectSelectedModifiers<T>(
  modifiers: T[],
  selection?: boolean[],
) {
  return modifiers.filter((_modifier, index) => selection?.[index] !== false);
}

export function roundCurrencyAmount(amount: number) {
  return Math.floor(amount + 0.5);
}

function getPrecisePrice(price: Price) {
  let precisePrice = price;
  for (let depth = 0; depth < CURRENCY_IDS.length; depth++) {
    const lowerPrice = precisePrice.lowerPrice;
    if (!lowerPrice) {
      break;
    }
    precisePrice = lowerPrice;
  }
  return precisePrice;
}

export function normalizeModifierRangePercent(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MODIFIER_RANGE_PERCENT;
  }

  return Math.min(
    MAX_MODIFIER_RANGE_PERCENT,
    Math.max(MIN_MODIFIER_RANGE_PERCENT, Math.round(value)),
  );
}

export function getModifierSearchRange(
  value: number,
  minimumOnly = false,
  modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
): Omit<SearchModifier, "id"> {
  if (minimumOnly) {
    return { min: value };
  }

  const tolerance = normalizeModifierRangePercent(modifierRangePercent) / 100;
  const lower = value * (1 - tolerance);
  const upper = value * (1 + tolerance);
  return {
    min: Math.floor(Number(Math.min(lower, upper).toFixed(10))),
    max: Math.ceil(Number(Math.max(lower, upper).toFixed(10))),
  };
}

function isMinimumOnlyModifier(modifier: ParsedItemMod) {
  const text = `${modifier.mod} ${modifier.parsed}`.toLowerCase();
  return (
    text.includes("gem") ||
    (text.includes("level of") && text.includes("skill"))
  );
}

function getResistanceCount(text: string) {
  if (text.includes("all resistances")) return 4;
  if (text.includes("all elemental resistances")) return 3;

  return ["fire", "cold", "lightning", "chaos"].filter((type) =>
    text.includes(type),
  ).length;
}

function getPseudoModifier(
  modifier: ParsedItemMod,
): { kind: keyof typeof PSEUDO_MODIFIER_IDS; value: number } | undefined {
  if (modifier.value1 === undefined) return undefined;

  const text = `${modifier.mod} ${modifier.parsed}`.toLowerCase();
  const isConditional =
    text.includes("increased") ||
    text.includes("regenerat") ||
    text.includes("recover") ||
    text.includes("gain") ||
    text.includes("per socket") ||
    text.includes("while ");

  if (text.includes("maximum life") && !isConditional) {
    return { kind: "life", value: modifier.value1 };
  }

  if (text.includes("maximum energy shield") && !isConditional) {
    return { kind: "energyShield", value: modifier.value1 };
  }

  const isResistance =
    text.includes("resistance") &&
    !text.includes("maximum") &&
    !text.includes("penetrat") &&
    !text.includes("damage") &&
    !text.includes("enemy") &&
    !text.includes("minion") &&
    !text.includes("ally") &&
    !text.includes("overcapped") &&
    !text.includes("unaffected");
  if (isResistance) {
    const resistanceCount = getResistanceCount(text);
    if (resistanceCount > 0) {
      return {
        kind: "resistance",
        value: modifier.value1 * resistanceCount,
      };
    }
  }

  return undefined;
}

export function buildModifierSearchFilters(
  explicit: ParsedItemMod[],
  implicit: ParsedItemMod[] = [],
  modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
): ModifierSearchFilters {
  const filters: ModifierSearchFilters = {
    explicit: [],
    implicit: [],
    pseudo: [],
  };
  const pseudoTotals = new Map<keyof typeof PSEUDO_MODIFIER_IDS, number>();

  const addModifiers = (
    modifiers: ParsedItemMod[],
    target: SearchModifier[],
  ) => {
    for (const modifier of modifiers) {
      const pseudo = getPseudoModifier(modifier);
      if (pseudo) {
        pseudoTotals.set(
          pseudo.kind,
          (pseudoTotals.get(pseudo.kind) || 0) + pseudo.value,
        );
        continue;
      }

      target.push({
        id: modifier.hash,
        ...(modifier.value1 !== undefined
          ? getModifierSearchRange(
              modifier.value1,
              isMinimumOnlyModifier(modifier),
              modifierRangePercent,
            )
          : {}),
      });
    }
  };

  addModifiers(explicit, filters.explicit);
  addModifiers(implicit, filters.implicit);

  for (const [kind, value] of pseudoTotals) {
    filters.pseudo.push({
      id: PSEUDO_MODIFIER_IDS[kind],
      ...getModifierSearchRange(value, false, modifierRangePercent),
    });
  }

  return filters;
}

function getNumericItemProperty(item: Poe2Item, name: string) {
  const property = item.item?.properties?.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );
  const value = property?.values?.[0]?.[0];
  const numericValue = value?.match(/[-+]?\d+(?:\.\d+)?/)?.[0];
  return numericValue === undefined ? undefined : Number(numericValue);
}

export function getItemRequiredLevel(item: Poe2Item) {
  const requirement = item.item?.requirements?.find(
    (entry) => entry.name?.trim().toLowerCase() === "level",
  );
  const value = requirement?.values?.[0]?.[0];
  const numericValue = value?.match(/\d+/)?.[0];
  return numericValue === undefined ? undefined : Number(numericValue);
}

export function getItemSearchMetadata(item: Poe2Item) {
  const frameRarities: Record<number, string> = {
    0: "normal",
    1: "magic",
    2: "rare",
    3: "unique",
  };
  const rawRarity =
    item.item?.rarity || frameRarities[item.item?.frameType ?? -1];
  const baseType = item.item?.baseType || item.item?.typeLine;
  const gemLevel = item.item?.gemLevel ?? getNumericItemProperty(item, "Level");
  const quality = item.item?.quality ?? getNumericItemProperty(item, "Quality");
  const isGem = isGemItem(item);
  const requiredLevel = isGem ? undefined : getItemRequiredLevel(item);
  const rarity = isGem ? undefined : rawRarity?.toLowerCase();
  const category = getItemCategory(item, isGem);

  return {
    baseType,
    name:
      rarity === "unique" || isGem
        ? item.item?.name || item.item?.typeLine
        : undefined,
    rarity,
    ...(category ? { category } : {}),
    ...(!isGem && item.item?.ilvl !== undefined
      ? { itemLevel: item.item.ilvl }
      : {}),
    ...(requiredLevel !== undefined ? { requiredLevel } : {}),
    ...(gemLevel !== undefined ? { gemLevel } : {}),
    ...(quality !== undefined ? { quality } : {}),
  };
}

export type RequiredLevelRange = {
  min: number;
  max: number;
};

export function getDefaultRequiredLevelRange(
  requiredLevel: number | undefined,
): RequiredLevelRange {
  return requiredLevel === undefined
    ? { min: 0, max: 2 }
    : { min: requiredLevel, max: requiredLevel };
}

function normalizeRequiredLevel(value: number | undefined, fallback: number) {
  return Math.max(
    0,
    Math.round(Number.isFinite(value) ? (value as number) : fallback),
  );
}

export function getRequiredLevelSearchRange(
  requiredLevel: number | undefined,
  selection?: ModifierSelection,
): RequiredLevelRange | undefined {
  if (selection?.requiredLevel !== true) {
    return undefined;
  }

  const defaults = getDefaultRequiredLevelRange(requiredLevel);

  const first = normalizeRequiredLevel(
    selection.requiredLevelMin,
    defaults.min,
  );
  const second = normalizeRequiredLevel(
    selection.requiredLevelMax,
    defaults.max,
  );

  return {
    min: Math.min(first, second),
    max: Math.max(first, second),
  };
}

export function isGemItem(item: Poe2Item) {
  const rarity = item.item?.rarity?.toLowerCase();
  const gemLevel = item.item?.gemLevel ?? getNumericItemProperty(item, "Level");
  return (
    item.item?.frameType === 4 || rarity === "gem" || gemLevel !== undefined
  );
}

export function getItemSearchFilters(
  metadata: {
    itemLevel?: number;
    gemLevel?: number;
    quality?: number;
  },
  includeItemLevel = false,
  requiredLevelRange?: RequiredLevelRange,
) {
  return {
    ...(includeItemLevel && metadata.itemLevel !== undefined
      ? { ilvl: metadata.itemLevel }
      : {}),
    ...(metadata.gemLevel !== undefined
      ? { gem_level: metadata.gemLevel, gem_level_max: metadata.gemLevel }
      : {}),
    ...(metadata.quality !== undefined
      ? { quality: metadata.quality, quality_max: metadata.quality }
      : {}),
    ...(requiredLevelRange
      ? { lvl: requiredLevelRange.min, lvl_max: requiredLevelRange.max }
      : {}),
  };
}

class PriceEstimator {
  async getComparableSearchParams(
    item: Poe2Item,
    metadata: ReturnType<typeof getItemSearchMetadata>,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    topN: number,
    includeItemLevel: boolean,
    requiredLevelRange?: RequiredLevelRange,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
  ): Promise<Poe2ItemSearch> {
    const gem = isGemItem(item);
    const { explicit, implicit } = selectedExplicits.length
      ? await this.getSelectedSearchMods(
          item,
          selectedExplicits,
          selectedImplicits,
          topN,
        )
      : { explicit: [], implicit: selectedImplicits };

    return {
      status: "securable",
      ...(!gem && metadata.name ? { name: metadata.name } : {}),
      rarity: metadata.rarity,
      ...(metadata.rarity === "rare"
        ? {}
        : { baseType: metadata.baseType }),
      ...(metadata.category ? { category: metadata.category } : {}),
      ...getItemSearchFilters(
        metadata,
        includeItemLevel,
        requiredLevelRange,
      ),
      ...buildModifierSearchFilters(
        explicit,
        implicit,
        modifierRangePercent,
      ),
    };
  }

  async findMatchingItem(
    item: Poe2Item,
    league?: string,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
    options: ApiRequestRunOptions = {},
  ): Promise<Poe2TradeSearch> {
    const itemLeague = item.item?.league || league;
    const metadata = getItemSearchMetadata(item);
    const { baseType } = metadata;
    if (!baseType && metadata.rarity !== "rare") {
      throw new Error("Item data is incomplete: base type is missing.");
    }
    if (!metadata.category) {
      throw new Error("Item data is incomplete: category is missing.");
    }

    const parsedMods = this.parseItemMods(item);
    const selectedExplicits = selectSelectedModifiers(
      parsedMods.explicits || [],
      modifierSelection?.explicit,
    );
    const selectedImplicits = selectSelectedModifiers(
      parsedMods.implicits || [],
      modifierSelection?.implicit,
    );
    const gem = isGemItem(item);
    const includeItemLevel = !gem && modifierSelection?.itemLevel === true;
    const requiredLevelRange = gem
      ? undefined
      : getRequiredLevelSearchRange(
          metadata.requiredLevel,
          modifierSelection,
        );

    const strictSearch = await this.getComparableSearchParams(
      item,
      metadata,
      selectedExplicits,
      selectedImplicits,
      selectedExplicits.length,
      includeItemLevel,
      requiredLevelRange,
      modifierRangePercent,
    );
    const selectedModifierCount = [
      ...(strictSearch.explicit || []),
      ...(strictSearch.implicit || []),
      ...(strictSearch.pseudo || []),
    ].length;
    const strictMatch = await Poe2Trade.getItemByAttributes(
      strictSearch,
      itemLeague,
      options,
    );
    const hasStrictComparable = (strictMatch.result || []).some(
      (id) => !item.id || id !== item.id,
    );

    if (hasStrictComparable || selectedModifierCount < 2) {
      return {
        ...strictMatch,
        strategy: "strict",
        selectedModifierCount,
        minimumModifierCount: selectedModifierCount,
      };
    }

    const minimumModifierCount = selectedModifierCount - 1;
    const relaxedMatch = await Poe2Trade.getItemByAttributes(
      {
        ...strictSearch,
        statGroupType: "count",
        statGroupMin: minimumModifierCount,
      },
      itemLeague,
      options,
    );

    return {
      ...relaxedMatch,
      strategy: "one-mod-relaxed",
      selectedModifierCount,
      minimumModifierCount,
    };
  }

  async estimateItemPrice(
    item: Poe2Item,
    league?: string,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
    options: ApiRequestRunOptions = {},
  ) {
    const itemLeague = item.item?.league || league;
    const metadata = getItemSearchMetadata(item);
    const { baseType, name, rarity } = metadata;
    if (!baseType && metadata.rarity !== "rare") {
      throw new Error("Item data is incomplete: base type is missing.");
    }
    if (!metadata.category) {
      throw new Error("Item data is incomplete: category is missing.");
    }

    const parsedMods = this.parseItemMods(item);
    const selectedExplicits = selectSelectedModifiers(
      parsedMods.explicits || [],
      modifierSelection?.explicit,
    );
    const selectedImplicits = selectSelectedModifiers(
      parsedMods.implicits || [],
      modifierSelection?.implicit,
    );
    const gem = isGemItem(item);
    const includeItemLevel = !gem && modifierSelection?.itemLevel === true;
    const requiredLevelRange = gem
      ? undefined
      : getRequiredLevelSearchRange(
          metadata.requiredLevel,
          modifierSelection,
        );
    console.log("Estimating price for item in league:", league);

    const currency = "exalted";

    const marketValuationPromise = Poe2Scout.getMarketValuation(
      item,
      itemLeague,
      options,
    );
    const tradeComparablesPromise = (async () => {
      // Keep the official comparables in exact parity with the Search button.
      const matchingItems = await this.findMatchingItem(
        item,
        itemLeague,
        modifierSelection,
        modifierRangePercent,
        options,
      );
      const filtered = (matchingItems.result || []).filter(
        (id) => id !== item.id,
      );
      return {
        matchingItems,
        prices: await this.getPricesForItemIds(
          filtered,
          currency,
          itemLeague,
          options,
        ),
      };
    })();
    const [marketResult, tradeResult] = await Promise.allSettled([
      marketValuationPromise,
      tradeComparablesPromise,
    ]);

    if (options.signal?.aborted) {
      const cancelledResult = [marketResult, tradeResult].find(
        (result) => result.status === "rejected",
      );
      throw cancelledResult?.status === "rejected"
        ? cancelledResult.reason
        : new Error("Request cancelled");
    }

    const marketValuation =
      marketResult.status === "fulfilled" ? marketResult.value : undefined;
    if (marketResult.status === "rejected") {
      console.warn(
        "Unable to fetch Poe2Scout market valuation; using trade comparables",
        marketResult.reason,
      );
    }

    if (tradeResult.status === "rejected" && !marketValuation) {
      throw tradeResult.reason;
    }
    if (tradeResult.status === "rejected") {
      console.warn(
        "Unable to fetch official trade comparables; using Poe2Scout valuation",
        tradeResult.reason,
      );
    }

    const tradeSearch =
      tradeResult.status === "fulfilled"
        ? tradeResult.value.matchingItems
        : undefined;
    const allPrices =
      tradeResult.status === "fulfilled" ? tradeResult.value.prices : [];

    if (allPrices.length) {
      await this.fetchManyExchangeRates(
        currency,
        allPrices.map((p) => p.currency),
        itemLeague,
        options,
      );
    }
    const tradeEstimate = allPrices.length
      ? this.priceEstimate(allPrices)
      : undefined;
    if (!marketValuation && !tradeEstimate) {
      throw new Error("No comparable listings found in the selected league.");
    }

    const hasSpecificSearchFilters =
      (tradeSearch?.selectedModifierCount || 0) > 0 ||
      includeItemLevel ||
      requiredLevelRange !== undefined ||
      metadata.gemLevel !== undefined ||
      metadata.quality !== undefined;
    const useTradeAsPrimary =
      tradeEstimate !== undefined &&
      (marketValuation === undefined || hasSpecificSearchFilters);

    const estimate: Estimate = {
      checkedAt: Date.now(),
      ...(tradeEstimate || {
        price: marketValuation!.price,
        stdDev: { amount: 0, currency: marketValuation!.price.currency },
        comparables: [],
        sourceComparableCount: 0,
        excludedComparableCount: 0,
      }),
      ...(useTradeAsPrimary
        ? {
            source: "official-trade" as const,
            method: "median" as const,
          }
        : marketValuation
        ? {
            source: "poe2scout" as const,
            method:
              marketValuation.method === "current-snapshot"
                ? ("market-current" as const)
                : ("market-history" as const),
            price: marketValuation.price,
          }
        : {
            source: "official-trade" as const,
            method: "median" as const,
          }),
      ...(marketValuation ? { market: marketValuation } : {}),
      search: {
        league: itemLeague,
        baseType,
        category: metadata.category,
        name,
        rarity,
        ...(includeItemLevel && metadata.itemLevel !== undefined
          ? { itemLevel: metadata.itemLevel }
          : {}),
        ...(requiredLevelRange
          ? {
              requiredLevelMin: requiredLevelRange.min,
              requiredLevelMax: requiredLevelRange.max,
            }
          : {}),
        ...(tradeSearch?.strategy
          ? {
              strategy: tradeSearch.strategy,
              selectedModifierCount: tradeSearch.selectedModifierCount,
              minimumModifierCount: tradeSearch.minimumModifierCount,
            }
          : {}),
        modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
        explicitCount: selectedExplicits.length,
        implicitCount: selectedImplicits.length,
        explicitHashes: selectedExplicits.map((modifier) => modifier.hash),
        implicitHashes: selectedImplicits.map((modifier) => modifier.hash),
        modifierRangePercent: normalizeModifierRangePercent(
          modifierRangePercent,
        ),
      },
    };

    if (
      useTradeAsPrimary &&
      tradeSearch?.strategy === "one-mod-relaxed"
    ) {
      estimate.confidence = "low";
    }

    const listingAgeAdjustmentFactor = getListingSuggestionPriceFactor(
      item.listing?.indexed,
    );
    estimate.listingAgeAdjustmentFactor = listingAgeAdjustmentFactor;
    if (listingAgeAdjustmentFactor !== 1) {
      const precisePrice = getPrecisePrice(estimate.price);
      const preciseSpread = getPrecisePrice(estimate.stdDev);
      estimate.price = {
        amount: precisePrice.amount * listingAgeAdjustmentFactor,
        currency: precisePrice.currency,
      };
      estimate.stdDev = {
        amount: preciseSpread.amount * listingAgeAdjustmentFactor,
        currency: preciseSpread.currency,
      };
    }

    estimate.price = await this.upscalePrice(estimate.price, itemLeague, options);
    if (estimate.stdDev.amount > 0) {
      estimate.stdDev = await this.upscalePrice(
        estimate.stdDev,
        itemLeague,
        options,
      );
    }
    estimate.matchesCurrentPrice = await this.matchesCurrentPrice(
      item,
      estimate.price,
      itemLeague,
      options,
      estimate.stdDev,
    );

    console.log({ allPrices, estimate, item });

    this.cachePriceEstimate(item.item.id, estimate);
    recordPriceSnapshot(item, estimate);
    return estimate;
  }

  matchesModifierSelection(
    item: Poe2Item,
    estimate: Estimate,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
  ) {
    if (
      estimate.search?.modifierComparisonVersion !== MODIFIER_COMPARISON_VERSION
    ) {
      return false;
    }

    if (estimate.search?.category !== getItemSearchMetadata(item).category) {
      return false;
    }

    if (
      estimate.search?.modifierRangePercent !== undefined &&
      estimate.search.modifierRangePercent !==
        normalizeModifierRangePercent(modifierRangePercent)
    ) {
      return false;
    }

    const expectedItemLevel = estimate.search?.itemLevel;
    const selectedItemLevel =
      modifierSelection?.itemLevel === true && !isGemItem(item)
        ? item.item?.ilvl
        : undefined;

    if (expectedItemLevel !== selectedItemLevel) {
      return false;
    }

    const selectedRequiredLevelRange = isGemItem(item)
      ? undefined
      : getRequiredLevelSearchRange(
          getItemRequiredLevel(item),
          modifierSelection,
        );
    if (
      estimate.search?.requiredLevelMin !== selectedRequiredLevelRange?.min ||
      estimate.search?.requiredLevelMax !== selectedRequiredLevelRange?.max
    ) {
      return false;
    }

    if (!modifierSelection) {
      return true;
    }

    const expectedExplicitHashes = estimate.search?.explicitHashes;
    const expectedImplicitHashes = estimate.search?.implicitHashes;
    if (
      !Array.isArray(expectedExplicitHashes) ||
      !Array.isArray(expectedImplicitHashes)
    ) {
      return false;
    }

    const parsedMods = this.parseItemMods(item);
    const selectedExplicitHashes = selectSelectedModifiers(
      parsedMods.explicits || [],
      modifierSelection.explicit,
    ).map((modifier) => normalizeModifierHash(modifier.hash));
    const selectedImplicitHashes = selectSelectedModifiers(
      parsedMods.implicits || [],
      modifierSelection.implicit,
    ).map((modifier) => normalizeModifierHash(modifier.hash));

    return (
      selectedExplicitHashes.join("|") ===
        expectedExplicitHashes.map(normalizeModifierHash).join("|") &&
      selectedImplicitHashes.join("|") ===
        expectedImplicitHashes.map(normalizeModifierHash).join("|")
    );
  }

  async matchesCurrentPrice(
    item: Poe2Item,
    suggestedPrice: Price,
    league?: string,
    options: ApiRequestRunOptions = {},
    spread?: Price,
  ) {
    return (
      (await this.getListingPricePosition(
        item,
        suggestedPrice,
        spread,
        league,
        options,
      )) === "fair"
    );
  }

  async getListingPricePosition(
    item: Poe2Item,
    suggestedPrice: Price,
    spread?: Price,
    league?: string,
    options: ApiRequestRunOptions = {},
  ): Promise<PricePosition> {
    const listedPrice = item.listing?.price;
    if (!listedPrice) {
      return "unpriced";
    }

    try {
      const preciseSuggestedPrice = getPrecisePrice(suggestedPrice);
      const preciseSpread = spread ? getPrecisePrice(spread) : undefined;
      const listedRate = await this.exchangeRate(
        preciseSuggestedPrice.currency,
        listedPrice.currency,
        league,
        false,
        options,
      );
      const spreadRate = preciseSpread
        ? await this.exchangeRate(
            preciseSuggestedPrice.currency,
            preciseSpread.currency,
            league,
            false,
            options,
          )
        : 1;

      return classifyPricePosition(
        listedPrice.amount * listedRate,
        preciseSuggestedPrice.amount,
        (preciseSpread?.amount || 0) * spreadRate,
      );
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      console.warn("Unable to compare suggested and listed prices", error);
      return "unpriced";
    }
  }

  async getSelectedSearchMods(
    item: Poe2Item,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    topN: number,
  ) {
    const topMods = await this.getHighTierMods(item, topN);
    const selectedHashes = new Set(
      selectedExplicits.map((modifier) => modifier.hash),
    );
    const highTierStats = topMods
      .map((s) => s.magnitudes)
      .flat()
      .map((mag) => mag.hash)
      .map((hash) => selectedExplicits.find((p) => p.hash === hash))
      .filter(
        (p): p is NonNullable<typeof p> =>
          p !== undefined && selectedHashes.has(p.hash),
      );

    return {
      explicit: highTierStats.length
        ? highTierStats
        : selectedExplicits.slice(0, topN),
      implicit: selectedImplicits,
    };
  }

  async getPricesForItemIds(
    ids: string[],
    currency = "exalted",
    league?: string,
    options: ApiRequestRunOptions = {},
  ): Promise<ComparablePrice[]> {
    const items = await Poe2Trade.fetchItems(ids, options);
    const fetchedItems = items.result || [];

    const currencies = Poe2Trade.toUniqueItems(
      fetchedItems
        .map((i) => i.listing.price.currency)
        .concat(fetchedItems.map((i) => i.listing.price.currency)),
    );
    await this.fetchManyExchangeRates(currency, currencies, league, options);

    const prices = this.toEquivalentPrices(
      currency,
      fetchedItems.map((i) => ({
        amount: i.listing.price.amount,
        currency: i.listing.price.currency,
      })),
      league,
    );

    return fetchedItems.map((item, index) => ({
      ...prices[index],
      itemId: item.id,
      listedAmount: item.listing.price.amount,
      listedCurrency: item.listing.price.currency,
      item,
    }));
  }

  sampleRange(items: string[], want: number) {
    if (items.length <= want) {
      return items;
    }
    const skip = Math.floor(items.length / want);
    return new Array(want).fill(0).map((_v, i) => items[i * skip]);
  }

  async upscalePrice(
    price: Price,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    try {
      if (price.currency === "exalted") {
        const chaosRate = await this.exchangeRate(
          "exalted",
          "chaos",
          league,
          false,
          options,
        );
        const chaosAmount = price.amount / chaosRate;

        if (chaosAmount >= 0.5) {
          const chaosPrice: Price = {
            amount: roundCurrencyAmount(chaosAmount),
            currency: "chaos",
            lowerPrice: { ...price },
          };

          try {
            const divineRate = await this.exchangeRate(
              "chaos",
              "divine",
              league,
              false,
              options,
            );
            const divineAmount = chaosAmount / divineRate;

            if (divineAmount >= 0.5) {
              return this.promoteDivineToMirror(
                {
                  amount: roundCurrencyAmount(divineAmount),
                  currency: "divine",
                  lowerPrice: chaosPrice,
                },
                league,
                options,
              );
            }
          } catch (error) {
            rethrowIfRequestCancelled(error, options);
            console.warn("Unable to promote price to divine", error);
          }

          return chaosPrice;
        }
      }

      if (price.currency === "chaos") {
        const divineRate = await this.exchangeRate(
          "chaos",
          "divine",
          league,
          false,
          options,
        );
        const divineAmount = price.amount / divineRate;

        if (divineAmount >= 0.5) {
          return this.promoteDivineToMirror(
            {
              amount: roundCurrencyAmount(divineAmount),
              currency: "divine",
              lowerPrice: { ...price },
            },
            league,
            options,
          );
        }
      }

      if (price.currency === "divine") {
        const chaosRate = await this.exchangeRate(
          "chaos",
          "divine",
          league,
          false,
          options,
        );
        return this.promoteDivineToMirror(
          {
            ...price,
            lowerPrice: {
              amount: price.amount * chaosRate,
              currency: "chaos",
            },
          },
          league,
          options,
        );
      }

      if (price.currency === "mirror") {
        const divineRate = await this.exchangeRate(
          "divine",
          "mirror",
          league,
          false,
          options,
        );
        return {
          ...price,
          lowerPrice: {
            amount: price.amount * divineRate,
            currency: "divine",
          },
        };
      }
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      console.warn("Unable to promote suggested price currency", error);
    }

    return price;
  }

  async upscalePrices(
    prices: Price[],
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    const upscaledPrices: Price[] = [];

    for (const price of prices) {
      upscaledPrices.push(await this.upscalePrice(price, league, options));
    }

    return upscaledPrices;
  }

  async upscalePricePerHour(
    total: Price,
    elapsedMilliseconds: number,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    const preciseTotal = getPrecisePrice(total);
    const elapsedHours = elapsedMilliseconds / 3_600_000;

    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
      return { amount: 0, currency: preciseTotal.currency };
    }

    return this.upscalePrice(
      {
        amount: preciseTotal.amount / elapsedHours,
        currency: preciseTotal.currency,
      },
      league,
      options,
    );
  }

  async promoteDivineToMirror(
    price: Price,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    try {
      const mirrorRate = await this.exchangeRate(
        "divine",
        "mirror",
        league,
        false,
        options,
      );
      const mirrorAmount = price.amount / mirrorRate;

      if (mirrorAmount >= 0.5) {
        return {
          amount: roundCurrencyAmount(mirrorAmount),
          currency: "mirror",
          lowerPrice: { ...price },
        };
      }
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      console.warn("Unable to promote suggested price to mirror", error);
    }

    return price;
  }

  getCachedEstimates() {
    const cacheKey = `price_estimates`;
    const data = Cache.getJson<Record<string, Estimate>>(cacheKey) || {};
    return data;
  }

  cachePriceEstimate(itemId: string, estimate: Estimate) {
    const cacheKey = `price_estimates`;
    const data = Cache.getJson<Record<string, Estimate>>(cacheKey) || {};
    data[itemId] = { ...estimate, checkedAt: estimate.checkedAt || Date.now() };
    Cache.setJson(cacheKey, data, Cache.times.day);
  }

  priceEstimate(prices: Price[]) {
    if (!prices.length) {
      throw new Error("No comparable listings found in the selected league.");
    }

    // check to make sure currency is the same

    const currencies = Poe2Trade.toUniqueItems(prices.map((p) => p.currency));

    if (currencies.length > 1) {
      throw new Error("Multiple currencies found");
    }

    const currency = currencies[0];
    const analysis = analyzeComparablePrices(prices);
    if (!analysis.included.length) {
      throw new Error("No reliable comparable listings were found.");
    }

    return {
      price: { amount: analysis.median, currency },
      stdDev: { amount: analysis.spread, currency },
      comparables: analysis.included as ComparablePrice[],
      sourceComparableCount: prices.length,
      excludedComparableCount: prices.length - analysis.included.length,
      excludedByReason: analysis.excludedByReason,
      confidence: analysis.confidence,
      method: "median" as const,
    };
  }

  getCachedExchangeRates(iWant: string, iHave: string, league?: string) {
    const cacheKey = `exchange_rates`;
    const cacheData = Cache.getJson<Record<string, number>>(cacheKey) || {};

    const key = getExchangeRateCacheKey(iWant, iHave, league);
    return cacheData[key];
  }

  cacheExchangeRates(
    iWant: string,
    iHave: string,
    rate: number,
    league?: string,
  ) {
    const cacheKey = `exchange_rates`;
    const cacheData = Cache.getJson<Record<string, number>>(cacheKey) || {};

    const key = getExchangeRateCacheKey(iWant, iHave, league);
    cacheData[key] = rate;

    Cache.setJson(cacheKey, cacheData, Cache.times.hour);
  }

  async refreshExchangeRates(league?: string): Promise<CurrencyRates> {
    const rates: CurrencyRates = {};
    let overview;

    try {
      overview = await Poe2Trade.client.getCurrencyExchangeOverview(league);
    } catch (error) {
      console.warn("Unable to refresh currency rates", error);
      return rates;
    }

    for (const iWant of CURRENCY_IDS) {
      for (const iHave of CURRENCY_IDS) {
        if (iWant === iHave) {
          await this.cacheExchangeRates(iWant, iHave, 1, league);
          rates[`${iWant}:${iHave}`] = 1;
          continue;
        }

        const rate = getCurrencyRateFromOverview(overview, iWant, iHave);
        if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
          await this.cacheExchangeRates(iWant, iHave, rate, league);
          rates[`${iWant}:${iHave}`] = rate;
        }
      }
    }

    if (!rates["divine:mirror"]) {
      try {
        const mirrorRate = await this.exchangeRate(
          "divine",
          "mirror",
          league,
          true,
        );
        rates["divine:mirror"] = mirrorRate;
        rates["mirror:divine"] = 1 / mirrorRate;
        await this.cacheExchangeRates("divine", "mirror", mirrorRate, league);
        await this.cacheExchangeRates(
          "mirror",
          "divine",
          1 / mirrorRate,
          league,
        );
      } catch (error) {
        console.warn("Unable to refresh divine to mirror rate", error);
      }
    }

    return rates;
  }

  toEquivalentPrices(iWant: string, prices: Price[], league?: string) {
    return prices.map((p) => ({
      amount: this.equivalentPrice(iWant, p, league),
      currency: iWant,
    }));
  }

  equivalentPrice(iWant: string, price: Price, league?: string) {
    if (price.currency === iWant) {
      return price.amount;
    }

    const cachedRate = this.getCachedExchangeRates(
      iWant,
      price.currency,
      league,
    );

    console.log(
      price.amount,
      price.currency,
      `=`,
      price.amount * cachedRate,
      iWant,
    );
    return price.amount * cachedRate;
  }

  async fetchManyExchangeRates(
    iWant: string,
    iHave: string[],
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    for (const currency of Poe2Trade.toUniqueItems(iHave)) {
      await this.exchangeRate(iWant, currency, league, false, options);
    }
  }

  async avgExchangeRate(
    iWant: string,
    iHave: string,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    const rate1 = await this.exchangeRate(
      iWant,
      iHave,
      league,
      false,
      options,
    );
    const rate2 =
      1 /
      (await this.exchangeRate(
        iHave,
        iWant,
        league,
        false,
        options,
      ));

    return (rate1 + rate2) / 2;
  }

  async exchangeRate(
    iWant: string,
    iHave: string,
    league?: string,
    forceRefresh = false,
    options: ApiRequestRunOptions = {},
  ) {
    const cached = this.getCachedExchangeRates(iWant, iHave, league);

    if (
      !forceRefresh &&
      typeof cached === "number" &&
      Number.isFinite(cached) &&
      cached > 0
    ) {
      return cached;
    }

    if (iWant === iHave) {
      await this.cacheExchangeRates(iWant, iHave, 1, league);
      return 1;
    }

    try {
      const overview =
        await Poe2Trade.client.getCurrencyExchangeOverview(league, options);
      const rate = getCurrencyRateFromOverview(overview, iWant, iHave);

      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        await this.cacheExchangeRates(iWant, iHave, rate, league);
        return rate;
      }
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      console.warn(
        "Currency overview unavailable, using trade exchange",
        error,
      );
    }

    if (
      (iWant === "divine" && iHave === "mirror") ||
      (iWant === "mirror" && iHave === "divine")
    ) {
      const divinePerMirror = await Poe2Trade.client.getMirrorRate(
        league,
        options,
      );
      const rate = iWant === "divine" ? divinePerMirror : 1 / divinePerMirror;
      await this.cacheExchangeRates(iWant, iHave, rate, league);
      return rate;
    }

    const swaps = await Poe2Trade.client.getCurrencySwaps(
      iWant,
      iHave,
      league,
      options,
    );
    const amounts = Object.values(swaps.result)
      .map((s) =>
        s.listing.offers.map((o) => ({
          amount: o.item.amount / o.exchange.amount,
          currency: o.exchange.currency,
        })),
      )
      .flat() as Price[];

    const prices = amounts.map((a) => a.amount).slice(0, 10);
    const weights = Object.values(swaps.result)
      .map((s) => s.listing.offers.map((o) => o.item.amount))
      .flat()
      .slice(0, 10);

    console.log({ iWant, iHave, amounts, weights });

    if (!prices.length || !weights.length) {
      throw new Error(`No exchange rate found for ${iHave} to ${iWant}.`);
    }

    const mean = this.weightedAvg(prices, weights);

    if (!Number.isFinite(mean) || mean <= 0) {
      throw new Error(`Invalid exchange rate found for ${iHave} to ${iWant}.`);
    }

    await this.cacheExchangeRates(iWant, iHave, mean, league);
    return mean;
  }

  sumPrice(prices: Price[]) {
    if (!prices.length) {
      return { amount: 0, currency: "exalted" } as Price;
    }

    const currencies = Poe2Trade.toUniqueItems(prices.map((p) => p.currency));

    if (currencies.length > 1) {
      throw new Error("Multiple currencies found");
    }

    const currency = prices[0].currency;
    const amount = this.sum(prices.map((p) => p.amount));

    return { amount, currency } as Price;
  }

  sum(values: number[]) {
    return values.reduce((a, b) => a + b, 0);
  }

  mean(values: number[]) {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  weightedAvg(values: number[], weights: number[]) {
    return this.sum(values.map((v, i) => v * weights[i])) / this.sum(weights);
  }

  variance(values: number[]) {
    const mean = this.mean(values);
    return this.mean(values.map((v) => Math.pow(v - mean, 2)));
  }

  stdDev(values: number[]) {
    return Math.sqrt(this.variance(values));
  }

  extractMod(mod: string) {
    // This regex captures a number (integer or decimal) at the beginning of the string
    const numberCapture = /^.*?([-+]?\d+(?:\.\d+)?)(.*)$/;

    // First, replace bracketed alternatives:
    // This handles patterns with a pipe, e.g. "[Foo|Bar]"
    const bracketCapture = /\[([^|\]]+)\|([^\]]+)\]/g;
    const withoutPipeBrackets = mod.replace(bracketCapture, "$2");

    // Next, replace any remaining single brackets (without a pipe)
    const singleBracketCapture = /\[([^\]]+)\]/g;
    const withoutBrackets = withoutPipeBrackets.replace(
      singleBracketCapture,
      "$1",
    );

    // Finally, replace all numbers globally with "#"
    const output = withoutBrackets.replace(/[-+]?\d+(?:\.\d+)?/g, "#"); // Replace the number with a '#' and capture the rest of the string in group 2.

    // To capture the numbers that were replaced:
    const match = mod.match(numberCapture);

    // Look for generalized match, or exact match
    const statEntry = this.getStatEntryForMod(output, withoutBrackets);

    if (!statEntry) {
      console.log(`No stat entry found for mod: ${mod}, ${output}`);
      throw new Error(`No stat entry found for mod: ${mod}, ${output}`);
    }

    let value1 = match ? Number(match[1]) : undefined;
    let value2 = match && match[2] ? Number(match[2]) : undefined;

    const inverted =
      (statEntry.text.includes("increased") && output.includes("reduced")) ||
      (statEntry.text.includes("reduced") && output.includes("increased"));

    if (statEntry.text !== output && inverted) {
      // we had to invert to find the stat entry
      if (value1) value1 = -value1;
      if (value2) value2 = -value2;
    }

    return {
      mod: mod,
      parsed: output,
      value1,
      value2,
      hash: statEntry.id,
    };
  }

  getStatEntryForMod(mod: string, original?: string) {
    const stats = Stats.map((statGroup) =>
      statGroup.entries.filter(
        (entry) =>
          entry.text === mod ||
          entry.text === mod.replace("increased", "reduced") ||
          entry.text === mod.replace("reduced", "increased") ||
          entry.text === mod.replace("in your Maps", "in Area") ||
          entry.text === mod.replace("in your Maps", "in this Area") ||
          (original && entry.text === original),
      ),
    ).flat();
    return stats.length > 0 ? stats[0] : null;
  }

  parseItemMods(item: Poe2Item) {
    const parseMods = (
      mods: ItemMod[] | undefined,
      section: "explicit" | "implicit" | "enchant",
    ) =>
      (mods || []).flatMap((mod, index) => {
        const description = formatItemMod(mod);
        const authoritativeHash = getItemModifierHash(
          item,
          section,
          index,
          mod,
        );
        try {
          const parsed = this.extractMod(description);
          return [
            authoritativeHash
              ? { ...parsed, hash: authoritativeHash }
              : parsed,
          ];
        } catch {
          if (authoritativeHash) {
            const values = description
              .match(/[-+]?\d+(?:\.\d+)?/g)
              ?.map(Number);

            return [
              {
                mod: description,
                parsed: description,
                value1: values?.[0],
                value2: values?.[1],
                hash: authoritativeHash,
              },
            ];
          }

          console.warn(
            "Skipping modifier that is not in the local stat table",
            mod,
          );
          return [];
        }
      });

    const explicits = parseMods(item.item?.explicitMods, "explicit");
    const implicits = parseMods(item.item?.implicitMods, "implicit");
    const enchants = parseMods(item.item?.enchantMods, "enchant");

    console.log({ explicits, implicits, enchants });

    return {
      explicits,
      implicits,
      enchants,
    };
  }

  getStatEntry(mod: Explicit) {
    return mod.magnitudes
      .map((magnitude) => {
        return Stats.map((statGroup) =>
          statGroup.entries.filter((entry) => entry.id === magnitude.hash),
        );
      })
      .flat();
  }

  async getHighTierMods(item: Poe2Item, topN: number) {
    const explicitMods = item.item?.extended?.mods?.explicit;
    if (!Array.isArray(explicitMods)) {
      return [];
    }

    return explicitMods
      .map((mod) => {
        return {
          mod: mod.name,
          tier: mod.tier,
          level: mod.level,
          tierNum: Number((mod.tier || "").replace("S", "").replace("P", "")),
          magnitudes: mod.magnitudes || [],
        };
      })
      .sort((a, b) => b.tierNum - a.tierNum)
      .slice(0, topN);
  }
}

export const PriceChecker = new PriceEstimator();
