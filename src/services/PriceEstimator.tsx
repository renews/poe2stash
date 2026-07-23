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
import {
  getOfficialExchangePrice,
  resolveOfficialTradeTag,
} from "./OfficialExchangePricing";

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
  source?: "official-trade" | "poe2scout" | "currency-exchange";
  method?:
    | "median"
    | "market-history"
    | "market-current"
    | "exchange-median";
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
    runeSocketCount?: number;
    strategy?:
      | "market-properties"
      | "market-pseudos"
      | "strict"
      | "one-mod-relaxed"
      | "modifier-count-relaxed"
      | "exchange-exact";
    marketProperty?: "dps" | "pdps" | "edps" | "ar" | "ev" | "es";
    marketPropertyMinimum?: number;
    searchId?: string;
    tradeTag?: string;
    paymentCurrency?: string;
    selectedModifierCount?: number;
    minimumModifierCount?: number;
    modifierComparisonVersion?: number;
    explicitCount: number;
    implicitCount?: number;
    enchantCount?: number;
    explicitHashes?: string[];
    implicitHashes?: string[];
    enchantHashes?: string[];
    corrupted?: "true" | "false";
    modifierRangePercent?: number;
  };
};

export const DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES = 5;
export const MIN_MODIFIER_RANGE_PERCENT = 5;
export const MAX_MODIFIER_RANGE_PERCENT = 100;
export const DEFAULT_MODIFIER_RANGE_PERCENT = 12;
export const DEFAULT_MINIMUM_INDEPENDENT_SELLERS = 1;
export const DEFAULT_MINIMUM_TRADE_LISTINGS = 20;
export const DEFAULT_MAX_TRADE_LISTINGS = 100;
export const CURRENCY_RATE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MODIFIER_COMPARISON_VERSION = 10;

const CURRENCY_IDS = ["exalted", "chaos", "divine", "mirror"] as const;
const SUPPORTED_TRADE_RARITIES = new Set([
  "normal",
  "magic",
  "rare",
  "unique",
  "uniquefoil",
  "nonunique",
]);
export type CurrencyRates = Record<string, number>;

export interface PriceEstimateRequestOptions extends ApiRequestRunOptions {
  applyListingContext?: boolean;
  recordResult?: boolean;
  minimumIndependentSellers?: number;
  maxTradeListings?: number;
}

export interface PriceAnalysisOptions {
  minimumIndependentSellers?: number;
}

export type ParsedItemMod = {
  mod: string;
  parsed: string;
  value1: number | undefined;
  value2?: number;
  hash: string;
  sourceIndex?: number;
};

export type UnresolvedItemModifier = {
  section: "explicit" | "implicit" | "enchant";
  sourceIndex: number;
  text: string;
};

type ModifierSelectionWithEnchants = ModifierSelection & {
  enchant?: boolean[];
};

function getEnchantSelection(selection?: ModifierSelection) {
  return (selection as ModifierSelectionWithEnchants | undefined)?.enchant;
}

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
  return modifiers.filter((modifier, index) => {
    const sourceIndex =
      modifier &&
      typeof modifier === "object" &&
      "sourceIndex" in modifier &&
      typeof modifier.sourceIndex === "number"
        ? modifier.sourceIndex
        : index;
    return selection?.[sourceIndex] !== false;
  });
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

function getModifierComparisonValue(modifier: ParsedItemMod) {
  if (modifier.value1 === undefined) {
    return undefined;
  }

  return Number.isFinite(modifier.value2)
    ? (modifier.value1 + modifier.value2!) / 2
    : modifier.value1;
}

function buildExactModifierSearchFilters(
  modifiers: ParsedItemMod[],
  modifierRangePercent: number,
) {
  return modifiers.map((modifier) => {
    const comparisonValue = getModifierComparisonValue(modifier);
    return {
      id: modifier.hash,
      ...(comparisonValue !== undefined
        ? getModifierSearchRange(
            comparisonValue,
            isMinimumOnlyModifier(modifier),
            modifierRangePercent,
          )
        : {}),
    };
  });
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

      const comparisonValue = getModifierComparisonValue(modifier);
      target.push({
        id: modifier.hash,
        ...(comparisonValue !== undefined
          ? getModifierSearchRange(
              comparisonValue,
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

function getAverageItemPropertyValue(item: Poe2Item, name: string) {
  const property = item.item?.properties?.find(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );
  const averages = (property?.values || []).flatMap(([value]) => {
    const numbers = value.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
    if (!numbers.length) return [];
    return [
      numbers.reduce((total, number) => total + number, 0) / numbers.length,
    ];
  });

  return averages.length
    ? averages.reduce((total, average) => total + average, 0)
    : undefined;
}

function getAwakenedWeaponSearch(
  item: Poe2Item,
  metadata: ReturnType<typeof getItemSearchMetadata>,
  modifierRangePercent: number,
  includeItemLevel = false,
  requiredLevelRange?: RequiredLevelRange,
): Poe2ItemSearch | undefined {
  if (
    metadata.rarity !== "rare" ||
    !metadata.category?.startsWith("weapon.")
  ) {
    return undefined;
  }

  const attacksPerSecond = getNumericItemProperty(item, "Attacks per Second");
  if (!attacksPerSecond || attacksPerSecond <= 0) {
    return undefined;
  }

  const physicalDamage = getAverageItemPropertyValue(item, "Physical Damage");
  const combinedElementalDamage = getAverageItemPropertyValue(
    item,
    "Elemental Damage",
  );
  const elementalDamage =
    combinedElementalDamage ??
    ["Fire Damage", "Cold Damage", "Lightning Damage"].reduce(
      (total, name) =>
        total + (getAverageItemPropertyValue(item, name) || 0),
      0,
    );
  const physicalDps = (physicalDamage || 0) * attacksPerSecond;
  const elementalDps = elementalDamage * attacksPerSecond;
  const totalDps = physicalDps + elementalDps;
  if (totalDps <= 0) {
    return undefined;
  }

  const range = (value: number) =>
    getModifierSearchRange(value, false, modifierRangePercent).min;
  const damageFilter =
    physicalDps > 0 && elementalDps > 0
      ? { dps: range(totalDps) }
      : physicalDps > 0
        ? { pdps: range(physicalDps) }
        : { edps: range(elementalDps) };

  return {
    status: "securable",
    rarity: "nonunique",
    category: metadata.category,
    ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
    ...getItemSearchFilters(
      metadata,
      includeItemLevel,
      requiredLevelRange,
    ),
    ...damageFilter,
    explicit: [],
    implicit: [],
    pseudo: [],
  };
}

function getAwakenedArmourSearch(
  item: Poe2Item,
  metadata: ReturnType<typeof getItemSearchMetadata>,
  modifierRangePercent: number,
  includeItemLevel = false,
  requiredLevelRange?: RequiredLevelRange,
): Poe2ItemSearch | undefined {
  if (
    metadata.rarity !== "rare" ||
    !metadata.category?.startsWith("armour.")
  ) {
    return undefined;
  }

  const defenceProperties = [
    { property: "ar" as const, value: getNumericItemProperty(item, "Armour") },
    {
      property: "ev" as const,
      value: getNumericItemProperty(item, "Evasion Rating"),
    },
    {
      property: "es" as const,
      value: getNumericItemProperty(item, "Energy Shield"),
    },
  ].filter(
    (entry): entry is { property: "ar" | "ev" | "es"; value: number } =>
      typeof entry.value === "number" && entry.value > 0,
  );
  if (defenceProperties.length !== 1) {
    return undefined;
  }

  const [{ property, value }] = defenceProperties;
  return {
    status: "securable",
    rarity: "nonunique",
    category: metadata.category,
    ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
    ...getItemSearchFilters(
      metadata,
      includeItemLevel,
      requiredLevelRange,
    ),
    [property]: getModifierSearchRange(
      value,
      false,
      modifierRangePercent,
    ).min,
    explicit: [],
    implicit: [],
    pseudo: [],
  };
}

function getAwakenedPropertySearch(
  item: Poe2Item,
  metadata: ReturnType<typeof getItemSearchMetadata>,
  modifierRangePercent: number,
  includeItemLevel = false,
  requiredLevelRange?: RequiredLevelRange,
) {
  return (
    getAwakenedWeaponSearch(
      item,
      metadata,
      modifierRangePercent,
      includeItemLevel,
      requiredLevelRange,
    ) ||
    getAwakenedArmourSearch(
      item,
      metadata,
      modifierRangePercent,
      includeItemLevel,
      requiredLevelRange,
    )
  );
}

function getMarketPropertyFilter(search: Poe2ItemSearch) {
  for (const property of ["dps", "pdps", "edps", "ar", "ev", "es"] as const) {
    const minimum = search[property];
    if (minimum !== undefined) {
      return { property, minimum };
    }
  }

  return undefined;
}

const AWAKENED_PSEUDO_MODIFIER_IDS = {
  life: "pseudo.pseudo_total_life",
  energyShield: "pseudo.pseudo_total_energy_shield",
  elementalResistance: "pseudo.pseudo_total_elemental_resistance",
  chaosResistance: "pseudo.pseudo_total_chaos_resistance",
} as const;

type AwakenedPseudoKind = keyof typeof AWAKENED_PSEUDO_MODIFIER_IDS;

function getAwakenedPseudoContributions(modifier: ParsedItemMod) {
  if (modifier.value1 === undefined) {
    return [] as Array<{ kind: AwakenedPseudoKind; value: number }>;
  }

  const text = `${modifier.mod} ${modifier.parsed}`.toLowerCase();
  const isConditional =
    text.includes("increased") ||
    text.includes("regenerat") ||
    text.includes("recover") ||
    text.includes("gain") ||
    text.includes("per socket") ||
    text.includes("while ");

  if (text.includes("maximum life") && !isConditional) {
    return [{ kind: "life" as const, value: modifier.value1 }];
  }

  if (text.includes("maximum energy shield") && !isConditional) {
    return [{ kind: "energyShield" as const, value: modifier.value1 }];
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
  if (!isResistance) {
    return [];
  }

  const allResistances = text.includes("all resistances");
  const allElementalResistances = text.includes("all elemental resistances");
  const elementalCount =
    allResistances || allElementalResistances
      ? 3
      : ["fire", "cold", "lightning"].filter((type) => text.includes(type))
          .length;
  const includesChaos = allResistances || text.includes("chaos");
  return [
    ...(elementalCount
      ? [
          {
            kind: "elementalResistance" as const,
            value: modifier.value1 * elementalCount,
          },
        ]
      : []),
    ...(includesChaos
      ? [{ kind: "chaosResistance" as const, value: modifier.value1 }]
      : []),
  ];
}

function isWeaponPropertyModifier(modifier: ParsedItemMod) {
  const text = `${modifier.mod} ${modifier.parsed}`.toLowerCase();
  return (
    (/adds .* to .* (?:physical|fire|cold|lightning) damage/.test(text) &&
      !text.includes("spell")) ||
    text.includes("increased physical damage") ||
    text.includes("increased attack speed") ||
    text.includes("increased critical strike chance")
  );
}

function isArmourPropertyModifier(modifier: ParsedItemMod) {
  const text = `${modifier.mod} ${modifier.parsed}`.toLowerCase();
  return (
    /increased (?:armour|evasion rating|energy shield)/.test(text) ||
    /to (?:armour|evasion rating|maximum energy shield)/.test(text)
  );
}

function isMarketPropertyModifier(
  modifier: ParsedItemMod,
  category: string,
) {
  return category.startsWith("weapon.")
    ? isWeaponPropertyModifier(modifier)
    : category.startsWith("armour.")
      ? isArmourPropertyModifier(modifier)
      : false;
}

function buildAwakenedModifierSearchFilters(
  explicit: ParsedItemMod[],
  implicit: ParsedItemMod[],
  enchant: ParsedItemMod[],
  modifierRangePercent: number,
): ModifierSearchFilters {
  const filters: ModifierSearchFilters = {
    explicit: [],
    implicit: [],
    pseudo: [],
  };
  const pseudoTotals = new Map<AwakenedPseudoKind, number>();

  const addModifiers = (
    modifiers: ParsedItemMod[],
    target: SearchModifier[],
  ) => {
    for (const modifier of modifiers) {
      const contributions = getAwakenedPseudoContributions(modifier);
      if (contributions.length) {
        for (const contribution of contributions) {
          pseudoTotals.set(
            contribution.kind,
            (pseudoTotals.get(contribution.kind) || 0) + contribution.value,
          );
        }
        continue;
      }

      const comparisonValue = getModifierComparisonValue(modifier);
      target.push({
        id: modifier.hash,
        ...(comparisonValue !== undefined
          ? {
              min: getModifierSearchRange(
                comparisonValue,
                false,
                modifierRangePercent,
              ).min,
            }
          : {}),
      });
    }
  };

  addModifiers(explicit, filters.explicit);
  addModifiers(implicit, filters.implicit);
  addModifiers(enchant, filters.explicit);

  for (const [kind, value] of pseudoTotals) {
    filters.pseudo.push({
      id: AWAKENED_PSEUDO_MODIFIER_IDS[kind],
      min: getModifierSearchRange(
        value,
        false,
        modifierRangePercent,
      ).min,
    });
  }

  return filters;
}

type AwakenedRareSearch = {
  search: Poe2ItemSearch;
  modifierCount: number;
  propertyFilter?: ReturnType<typeof getMarketPropertyFilter>;
};

function getAwakenedRareSearch(
  item: Poe2Item,
  metadata: ReturnType<typeof getItemSearchMetadata>,
  selectedExplicits: ParsedItemMod[],
  selectedImplicits: ParsedItemMod[],
  selectedEnchants: ParsedItemMod[],
  modifierRangePercent: number,
  includeItemLevel = false,
  requiredLevelRange?: RequiredLevelRange,
): AwakenedRareSearch | undefined {
  if (metadata.rarity !== "rare" || !metadata.category) {
    return undefined;
  }
  const category = metadata.category;

  const propertySearch = getAwakenedPropertySearch(
    item,
    metadata,
    modifierRangePercent,
    includeItemLevel,
    requiredLevelRange,
  );
  const hasMarketProperty = Boolean(propertySearch);
  const modifierFilters = buildAwakenedModifierSearchFilters(
    hasMarketProperty
      ? selectedExplicits.filter((modifier) =>
          !isMarketPropertyModifier(modifier, category),
        )
      : selectedExplicits,
    hasMarketProperty
      ? selectedImplicits.filter((modifier) =>
          !isMarketPropertyModifier(modifier, category),
        )
      : selectedImplicits,
    selectedEnchants,
    modifierRangePercent,
  );
  const modifierCount = [
    ...modifierFilters.explicit,
    ...modifierFilters.implicit,
    ...modifierFilters.pseudo,
  ].length;
  if (!propertySearch && modifierCount === 0) {
    return undefined;
  }

  const search: Poe2ItemSearch = {
    ...(propertySearch || {
      status: "securable" as const,
      rarity: "nonunique",
      category,
      ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
      ...getItemSearchFilters(
        metadata,
        includeItemLevel,
        requiredLevelRange,
      ),
    }),
    ...modifierFilters,
  };

  return {
    search,
    modifierCount,
    propertyFilter: getMarketPropertyFilter(search),
  };
}

export function getItemGemLevel(item: Poe2Item) {
  return item.item?.gemLevel ?? getNumericItemProperty(item, "Level");
}

export function getItemRequiredLevel(item: Poe2Item) {
  const requirement = item.item?.requirements?.find(
    (entry) => entry.name?.trim().toLowerCase() === "level",
  );
  const value = requirement?.values?.[0]?.[0];
  const numericValue = value?.match(/\d+/)?.[0];
  return numericValue === undefined ? undefined : Number(numericValue);
}

export function getItemRuneSocketCount(item: Poe2Item) {
  return Array.isArray(item.item?.sockets)
    ? item.item.sockets.length
    : undefined;
}

function normalizeRuneSocketCount(value: number | undefined, fallback: number) {
  return Math.max(
    0,
    Math.round(Number.isFinite(value) ? (value as number) : fallback),
  );
}

export function getRuneSocketSearchMinimum(
  runeSocketCount: number | undefined,
  selection?: ModifierSelection,
) {
  if (selection?.runeSockets === false) {
    return undefined;
  }

  const minimum = normalizeRuneSocketCount(
    selection?.runeSocketCount,
    runeSocketCount || 0,
  );
  return minimum > 0 ? minimum : undefined;
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
  const gemLevel = getItemGemLevel(item);
  const quality = item.item?.quality ?? getNumericItemProperty(item, "Quality");
  const isGem = isGemItem(item);
  const requiredLevel = isGem ? undefined : getItemRequiredLevel(item);
  const runeSocketCount = isGem ? undefined : getItemRuneSocketCount(item);
  const normalizedRarity = rawRarity?.toLowerCase();
  const rarity =
    !isGem && normalizedRarity && SUPPORTED_TRADE_RARITIES.has(normalizedRarity)
      ? normalizedRarity
      : undefined;
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
    ...(runeSocketCount !== undefined ? { runeSocketCount } : {}),
    ...(gemLevel !== undefined ? { gemLevel } : {}),
    ...(quality !== undefined ? { quality } : {}),
    ...(item.origin === "clipboard"
      ? { corrupted: item.item?.corrupted ? "true" as const : "false" as const }
      : {}),
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
  const gemLevel = getItemGemLevel(item);
  return (
    item.item?.frameType === 4 || rarity === "gem" || gemLevel !== undefined
  );
}

export function getItemSearchFilters(
  metadata: {
    itemLevel?: number;
    gemLevel?: number;
    quality?: number;
    runeSocketCount?: number;
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
    ...(metadata.runeSocketCount !== undefined
      ? { rune_sockets: metadata.runeSocketCount }
      : {}),
  };
}

class PriceEstimator {
  async getComparableSearchParams(
    item: Poe2Item,
    metadata: ReturnType<typeof getItemSearchMetadata>,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    selectedEnchants: ParsedItemMod[],
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
    const modifierFilters = buildModifierSearchFilters(
      explicit,
      implicit,
      modifierRangePercent,
    );

    return {
      status: "securable",
      ...(!gem && metadata.name ? { name: metadata.name } : {}),
      rarity: metadata.rarity,
      ...(metadata.rarity === "rare"
        ? {}
        : { baseType: metadata.baseType }),
      ...(metadata.category ? { category: metadata.category } : {}),
      ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
      ...getItemSearchFilters(
        metadata,
        includeItemLevel,
        requiredLevelRange,
      ),
      ...modifierFilters,
      explicit: [
        ...modifierFilters.explicit,
        ...buildExactModifierSearchFilters(
          selectedEnchants,
          modifierRangePercent,
        ),
      ],
    };
  }

  async findMatchingItem(
    item: Poe2Item,
    league?: string,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
    options: PriceEstimateRequestOptions = {},
    isMatchSufficient?: (match: Poe2TradeSearch) => Promise<boolean>,
  ): Promise<Poe2TradeSearch> {
    const itemLeague = league || item.item?.league;
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
    const selectedEnchants = selectSelectedModifiers(
      parsedMods.enchants || [],
      getEnchantSelection(modifierSelection),
    );
    const gem = isGemItem(item);
    const includeItemLevel = !gem && modifierSelection?.itemLevel === true;
    const requiredLevelRange = gem
      ? undefined
      : getRequiredLevelSearchRange(
          metadata.requiredLevel,
          modifierSelection,
        );
    const runeSocketCount = gem
      ? undefined
      : getRuneSocketSearchMinimum(
          metadata.runeSocketCount,
          modifierSelection,
        );
    const searchMetadata = { ...metadata, runeSocketCount };

    const desiredComparableCount = Math.max(
      1,
      Math.round(
        options.minimumIndependentSellers ??
          DEFAULT_MINIMUM_INDEPENDENT_SELLERS,
      ),
    );
    const comparableCount = (match: Poe2TradeSearch) =>
      (match.result || []).filter((id) => !item.id || id !== item.id).length;
    const hasEnoughEvidence = async (match: Poe2TradeSearch) =>
      comparableCount(match) >= desiredComparableCount &&
      (!isMatchSufficient || (await isMatchSufficient(match)));

    const awakenedSearch = getAwakenedRareSearch(
      item,
      searchMetadata,
      selectedExplicits,
      selectedImplicits,
      selectedEnchants,
      modifierRangePercent,
      includeItemLevel,
      requiredLevelRange,
    );
    if (awakenedSearch) {
      const propertyCount = awakenedSearch.propertyFilter ? 1 : 0;
      const selectedMarketCount =
        awakenedSearch.modifierCount + propertyCount;
      const strategy = awakenedSearch.propertyFilter
        ? ("market-properties" as const)
        : ("market-pseudos" as const);
      const toMarketMatch = (
        match: Poe2TradeSearch,
        minimumModifierCount: number,
      ): Poe2TradeSearch => ({
        ...match,
        strategy,
        ...(awakenedSearch.propertyFilter
          ? {
              marketProperty: awakenedSearch.propertyFilter.property,
              marketPropertyMinimum: awakenedSearch.propertyFilter.minimum,
            }
          : {}),
        selectedModifierCount: selectedMarketCount,
        minimumModifierCount: minimumModifierCount + propertyCount,
      });

      let marketMatch = await Poe2Trade.getItemByAttributes(
        awakenedSearch.search,
        itemLeague,
        options,
      );
      if (await hasEnoughEvidence(marketMatch)) {
        return toMarketMatch(marketMatch, awakenedSearch.modifierCount);
      }

      const minimumMarketModifierCount = awakenedSearch.propertyFilter ? 0 : 1;
      for (
        let requiredModifierCount = awakenedSearch.modifierCount - 1;
        requiredModifierCount >= minimumMarketModifierCount;
        requiredModifierCount -= 1
      ) {
        const relaxedMarketSearch: Poe2ItemSearch =
          requiredModifierCount === 0
            ? {
                ...awakenedSearch.search,
                explicit: [],
                implicit: [],
                pseudo: [],
                statGroupType: undefined,
                statGroupMin: undefined,
              }
            : {
                ...awakenedSearch.search,
                statGroupType: "count",
                statGroupMin: requiredModifierCount,
              };
        marketMatch = await Poe2Trade.getItemByAttributes(
          relaxedMarketSearch,
          itemLeague,
          options,
        );
        if (await hasEnoughEvidence(marketMatch)) {
          return toMarketMatch(marketMatch, requiredModifierCount);
        }
      }
    }

    const copiedModifierCount =
      (item.item?.explicitMods || []).length +
      (item.item?.implicitMods || []).length +
      (item.item?.enchantMods || []).length;
    const requiresModifierMatch =
      item.item?.frameType === 1 || item.item?.frameType === 2;
    if (
      item.origin === "clipboard" &&
      requiresModifierMatch &&
      copiedModifierCount > 0 &&
      selectedExplicits.length +
        selectedImplicits.length +
        selectedEnchants.length ===
        0
    ) {
      throw new Error(
        "Selected modifiers cannot be matched to current trade data. Deselect unsupported modifiers or update the local trade data before retrying.",
      );
    }

    const strictSearch = await this.getComparableSearchParams(
      item,
      searchMetadata,
      selectedExplicits,
      selectedImplicits,
      selectedEnchants,
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

    if (
      (await hasEnoughEvidence(strictMatch)) ||
      selectedModifierCount < 2
    ) {
      return {
        ...strictMatch,
        strategy: "strict",
        selectedModifierCount,
        minimumModifierCount: selectedModifierCount,
      };
    }

    const minimumSafeModifierCount = selectedModifierCount === 2 ? 1 : 2;
    let relaxedMatch = strictMatch;
    let minimumModifierCount = selectedModifierCount;

    for (
      let requiredModifierCount = selectedModifierCount - 1;
      requiredModifierCount >= minimumSafeModifierCount;
      requiredModifierCount -= 1
    ) {
      minimumModifierCount = requiredModifierCount;
      relaxedMatch = await Poe2Trade.getItemByAttributes(
        {
          ...strictSearch,
          statGroupType: "count",
          statGroupMin: minimumModifierCount,
        },
        itemLeague,
        options,
      );

      if (await hasEnoughEvidence(relaxedMatch)) {
        break;
      }
    }

    return {
      ...relaxedMatch,
      strategy:
        selectedModifierCount - minimumModifierCount === 1
          ? "one-mod-relaxed"
          : "modifier-count-relaxed",
      selectedModifierCount,
      minimumModifierCount,
    };
  }

  async estimateItemPrice(
    item: Poe2Item,
    league?: string,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
    options: PriceEstimateRequestOptions = {},
  ) {
    const itemLeague = league || item.item?.league;
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
    const selectedEnchants = selectSelectedModifiers(
      parsedMods.enchants || [],
      getEnchantSelection(modifierSelection),
    );
    const gem = isGemItem(item);
    const includeItemLevel = !gem && modifierSelection?.itemLevel === true;
    const requiredLevelRange = gem
      ? undefined
      : getRequiredLevelSearchRange(
          metadata.requiredLevel,
          modifierSelection,
        );
    const runeSocketCount = gem
      ? undefined
      : getRuneSocketSearchMinimum(
          metadata.runeSocketCount,
          modifierSelection,
        );
    console.log("Estimating price for item in league:", league);

    const currency = "exalted";
    const exchangeEstimate = await this.getOfficialExchangeEstimate(
      item,
      itemLeague,
      metadata,
      selectedExplicits,
      selectedImplicits,
      selectedEnchants,
      modifierRangePercent,
      options,
    );
    if (exchangeEstimate) {
      return this.finishEstimate(item, exchangeEstimate, itemLeague, options);
    }

    let tradeSearch: Poe2TradeSearch | undefined;
    let allPrices: ComparablePrice[] = [];
    let tradeEstimate:
      | ReturnType<PriceEstimator["priceEstimate"]>
      | undefined;
    let officialTradeError: unknown;

    try {
      let lastEvaluatedSearchId: string | undefined;
      const evaluateTradeMatch = async (match: Poe2TradeSearch) => {
        lastEvaluatedSearchId = match.id;
        const filtered = (match.result || []).filter((id) => id !== item.id);
        allPrices = await this.getPricesForItemIds(
          filtered,
          currency,
          itemLeague,
          options,
        );
        if (allPrices.length) {
          await this.fetchManyExchangeRates(
            currency,
            allPrices.map((price) => price.currency),
            itemLeague,
            options,
          );
        }

        try {
          tradeEstimate = this.priceEstimate(allPrices, {
            minimumIndependentSellers:
              options.minimumIndependentSellers ??
              DEFAULT_MINIMUM_INDEPENDENT_SELLERS,
          });
          officialTradeError = undefined;
          return true;
        } catch (error) {
          officialTradeError = error;
          tradeEstimate = undefined;
          return false;
        }
      };

      tradeSearch = await this.findMatchingItem(
        item,
        itemLeague,
        modifierSelection,
        modifierRangePercent,
        options,
        evaluateTradeMatch,
      );
      if (lastEvaluatedSearchId !== tradeSearch.id) {
        await evaluateTradeMatch(tradeSearch);
      }
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      officialTradeError = error;
      console.warn(
        "Official trade pricing was unavailable; trying Poe2Scout",
        error,
      );
    }

    if (!tradeEstimate) {
      try {
        const marketValuation = await Poe2Scout.getMarketValuation(
          item,
          itemLeague,
          options,
        );
        if (marketValuation) {
          const fallbackEstimate = this.createMarketOnlyEstimate(
            marketValuation,
            itemLeague,
            metadata,
            selectedExplicits,
            selectedImplicits,
            selectedEnchants,
            modifierRangePercent,
            runeSocketCount,
          );
          fallbackEstimate.sourceComparableCount = allPrices.length;
          return this.finishEstimate(
            item,
            fallbackEstimate,
            itemLeague,
            options,
          );
        }
      } catch (error) {
        rethrowIfRequestCancelled(error, options);
        console.warn("Unable to fetch Poe2Scout fallback valuation", error);
      }

      throw (
        officialTradeError ||
        new Error("No comparable listings found in the selected league.")
      );
    }

    const usesAwakenedMarket =
      tradeSearch?.strategy === "market-properties" ||
      tradeSearch?.strategy === "market-pseudos";
    const estimate: Estimate = {
      checkedAt: Date.now(),
      ...tradeEstimate,
      source: "official-trade",
      method: "median",
      search: {
        league: itemLeague,
        baseType,
        category: metadata.category,
        name,
        rarity: usesAwakenedMarket ? "nonunique" : rarity,
        ...(includeItemLevel && metadata.itemLevel !== undefined
          ? { itemLevel: metadata.itemLevel }
          : {}),
        ...(requiredLevelRange
          ? {
              requiredLevelMin: requiredLevelRange.min,
              requiredLevelMax: requiredLevelRange.max,
            }
          : {}),
        ...(runeSocketCount !== undefined ? { runeSocketCount } : {}),
        ...(tradeSearch?.strategy
          ? {
              strategy: tradeSearch.strategy,
              selectedModifierCount: tradeSearch.selectedModifierCount,
              minimumModifierCount: tradeSearch.minimumModifierCount,
            }
          : {}),
        ...(tradeSearch?.strategy === "market-properties"
          ? {
              marketProperty: tradeSearch.marketProperty,
              marketPropertyMinimum: tradeSearch.marketPropertyMinimum,
            }
          : {}),
        modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
        explicitCount: selectedExplicits.length,
        implicitCount: selectedImplicits.length,
        enchantCount: selectedEnchants.length,
        explicitHashes: selectedExplicits.map((modifier) => modifier.hash),
        implicitHashes: selectedImplicits.map((modifier) => modifier.hash),
        enchantHashes: selectedEnchants.map((modifier) => modifier.hash),
        ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
        modifierRangePercent: normalizeModifierRangePercent(
          modifierRangePercent,
        ),
      },
    };

    if (
      tradeSearch?.strategy === "one-mod-relaxed" ||
      tradeSearch?.strategy === "modifier-count-relaxed" ||
      (usesAwakenedMarket &&
        (tradeSearch?.minimumModifierCount || 0) <
          (tradeSearch?.selectedModifierCount || 0))
    ) {
      estimate.confidence = "low";
    }

    console.log({ allPrices, estimate, item });
    return this.finishEstimate(item, estimate, itemLeague, options);
  }

  private isCurrencyExchangeCandidate(
    item: Poe2Item,
    metadata: ReturnType<typeof getItemSearchMetadata>,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    selectedEnchants: ParsedItemMod[],
  ) {
    const category = metadata.category || "";
    return (
      item.origin === "clipboard" &&
      (item.item?.frameType === 5 ||
        category === "currency" ||
        category.startsWith("currency.")) &&
      selectedExplicits.length +
        selectedImplicits.length +
        selectedEnchants.length ===
        0
    );
  }

  private createMarketOnlyEstimate(
    marketValuation: Poe2ScoutMarketValuation,
    itemLeague: string | undefined,
    metadata: ReturnType<typeof getItemSearchMetadata>,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    selectedEnchants: ParsedItemMod[],
    modifierRangePercent: number,
    runeSocketCount?: number,
  ): Estimate {
    return {
      checkedAt: Date.now(),
      price: marketValuation.price,
      stdDev: { amount: 0, currency: marketValuation.price.currency },
      comparables: [],
      sourceComparableCount: 0,
      excludedComparableCount: 0,
      source: "poe2scout",
      method:
        marketValuation.method === "current-snapshot"
          ? "market-current"
          : "market-history",
      market: marketValuation,
      search: {
        league: itemLeague,
        baseType: metadata.baseType,
        category: metadata.category,
        name: metadata.name,
        rarity: metadata.rarity,
        modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
        explicitCount: selectedExplicits.length,
        implicitCount: selectedImplicits.length,
        enchantCount: selectedEnchants.length,
        explicitHashes: selectedExplicits.map((modifier) => modifier.hash),
        implicitHashes: selectedImplicits.map((modifier) => modifier.hash),
        enchantHashes: selectedEnchants.map((modifier) => modifier.hash),
        ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
        ...(runeSocketCount !== undefined ? { runeSocketCount } : {}),
        modifierRangePercent: normalizeModifierRangePercent(
          modifierRangePercent,
        ),
      },
    };
  }

  private async getOfficialExchangeEstimate(
    item: Poe2Item,
    itemLeague: string | undefined,
    metadata: ReturnType<typeof getItemSearchMetadata>,
    selectedExplicits: ParsedItemMod[],
    selectedImplicits: ParsedItemMod[],
    selectedEnchants: ParsedItemMod[],
    modifierRangePercent: number,
    options: PriceEstimateRequestOptions,
  ): Promise<Estimate | undefined> {
    if (
      !this.isCurrencyExchangeCandidate(
        item,
        metadata,
        selectedExplicits,
        selectedImplicits,
        selectedEnchants,
      )
    ) {
      return undefined;
    }

    const visibleIdentity = (
      item.item?.baseType ||
      item.item?.typeLine ||
      item.item?.name ||
      ""
    ).trim();
    if (!visibleIdentity) {
      return undefined;
    }

    try {
      const resolution = resolveOfficialTradeTag(
        await Poe2Trade.client.getTradeStaticData(options),
        visibleIdentity,
      );
      if (resolution.status !== "resolved") {
        return undefined;
      }

      const paymentCurrencies = ["exalted", "chaos", "divine"].filter(
        (currency) => currency !== resolution.tag,
      );
      const exchangePrice = getOfficialExchangePrice(
        await Poe2Trade.client.getExchangeListings(
          resolution.tag,
          paymentCurrencies,
          itemLeague,
          options,
        ),
        resolution.tag,
        paymentCurrencies,
      );
      if (!exchangePrice) {
        return undefined;
      }

      return {
        checkedAt: Date.now(),
        price: {
          amount: exchangePrice.amount,
          currency: exchangePrice.currency,
        },
        stdDev: { amount: 0, currency: exchangePrice.currency },
        comparables: [],
        sourceComparableCount: exchangePrice.sellerCount,
        excludedComparableCount: 0,
        confidence:
          exchangePrice.sellerCount >= 8
            ? "high"
            : exchangePrice.sellerCount >= 4
              ? "medium"
              : "low",
        source: "currency-exchange",
        method: "exchange-median",
        search: {
          league: itemLeague,
          baseType: metadata.baseType,
          category: metadata.category,
          name: metadata.name,
          rarity: metadata.rarity,
          strategy: "exchange-exact",
          searchId: exchangePrice.searchId,
          tradeTag: exchangePrice.targetTag,
          paymentCurrency: exchangePrice.currency,
          selectedModifierCount: 0,
          minimumModifierCount: 0,
          modifierComparisonVersion: MODIFIER_COMPARISON_VERSION,
          explicitCount: 0,
          implicitCount: 0,
          enchantCount: 0,
          explicitHashes: [],
          implicitHashes: [],
          enchantHashes: [],
          ...(metadata.corrupted ? { corrupted: metadata.corrupted } : {}),
          modifierRangePercent: normalizeModifierRangePercent(
            modifierRangePercent,
          ),
        },
      };
    } catch (error) {
      rethrowIfRequestCancelled(error, options);
      console.warn(
        "Unable to use official currency exchange pricing; continuing with lower fallbacks",
        error,
      );
      return undefined;
    }
  }

  private async finishEstimate(
    item: Poe2Item,
    estimate: Estimate,
    itemLeague: string | undefined,
    options: PriceEstimateRequestOptions,
  ) {
    if (options.applyListingContext !== false) {
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
    }

    estimate.price = await this.upscalePrice(estimate.price, itemLeague, options);
    if (estimate.stdDev.amount > 0) {
      estimate.stdDev = await this.upscalePrice(
        estimate.stdDev,
        itemLeague,
        options,
      );
    }
    if (options.applyListingContext !== false) {
      estimate.matchesCurrentPrice = await this.matchesCurrentPrice(
        item,
        estimate.price,
        itemLeague,
        options,
        estimate.stdDev,
      );
    }

    if (options.recordResult !== false) {
      this.cachePriceEstimate(item.item.id, estimate);
      recordPriceSnapshot(item, estimate);
    }
    return estimate;
  }

  matchesModifierSelection(
    item: Poe2Item,
    estimate: Estimate,
    modifierSelection?: ModifierSelection,
    modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
    league?: string,
  ) {
    if (
      estimate.search?.modifierComparisonVersion !== MODIFIER_COMPARISON_VERSION
    ) {
      return false;
    }

    if (league !== undefined && estimate.search?.league !== league) {
      return false;
    }

    const metadata = getItemSearchMetadata(item);
    if (estimate.search?.category !== metadata.category) {
      return false;
    }

    if (estimate.search?.corrupted !== metadata.corrupted) {
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

    const selectedRuneSocketCount = isGemItem(item)
      ? undefined
      : getRuneSocketSearchMinimum(
          metadata.runeSocketCount,
          modifierSelection,
        );
    if (estimate.search?.runeSocketCount !== selectedRuneSocketCount) {
      return false;
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
    const selectedEnchants = selectSelectedModifiers(
      parsedMods.enchants || [],
      getEnchantSelection(modifierSelection),
    );

    if (
      estimate.search?.strategy === "market-properties" ||
      estimate.search?.strategy === "market-pseudos"
    ) {
      const marketSearch = getAwakenedRareSearch(
        item,
        { ...metadata, runeSocketCount: selectedRuneSocketCount },
        selectedExplicits,
        selectedImplicits,
        selectedEnchants,
        modifierRangePercent,
        selectedItemLevel !== undefined,
        selectedRequiredLevelRange,
      );
      const currentStrategy = marketSearch?.propertyFilter
        ? "market-properties"
        : marketSearch
          ? "market-pseudos"
          : undefined;
      if (currentStrategy !== estimate.search.strategy) {
        return false;
      }
      const marketProperty = marketSearch?.propertyFilter;
      if (
        currentStrategy === "market-properties" &&
        (marketProperty?.property !== estimate.search.marketProperty ||
          marketProperty?.minimum !==
            estimate.search.marketPropertyMinimum)
      ) {
        return false;
      }
    }

    const expectedExplicitHashes = estimate.search?.explicitHashes;
    const expectedImplicitHashes = estimate.search?.implicitHashes;
    const expectedEnchantHashes =
      estimate.search?.enchantHashes ||
      (parsedMods.enchants.length === 0 ? [] : undefined);
    if (
      !Array.isArray(expectedExplicitHashes) ||
      !Array.isArray(expectedImplicitHashes) ||
      !Array.isArray(expectedEnchantHashes)
    ) {
      return false;
    }

    const selectedExplicitHashes = selectedExplicits.map((modifier) =>
      normalizeModifierHash(modifier.hash),
    );
    const selectedImplicitHashes = selectedImplicits.map((modifier) =>
      normalizeModifierHash(modifier.hash),
    );
    const selectedEnchantHashes = selectedEnchants.map((modifier) =>
      normalizeModifierHash(modifier.hash),
    );

    return (
      selectedExplicitHashes.join("|") ===
        expectedExplicitHashes.map(normalizeModifierHash).join("|") &&
      selectedImplicitHashes.join("|") ===
        expectedImplicitHashes.map(normalizeModifierHash).join("|") &&
      selectedEnchantHashes.join("|") ===
        expectedEnchantHashes.map(normalizeModifierHash).join("|")
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
    options: PriceEstimateRequestOptions = {},
  ): Promise<ComparablePrice[]> {
    const maximumListings = Math.min(
      DEFAULT_MAX_TRADE_LISTINGS,
      Math.max(
        10,
        Math.round(
          options.maxTradeListings ?? DEFAULT_MAX_TRADE_LISTINGS,
        ),
      ),
    );
    const minimumListings = Math.min(
      maximumListings,
      DEFAULT_MINIMUM_TRADE_LISTINGS,
      ids.length,
    );
    const minimumIndependentSellers = Math.max(
      0,
      Math.round(
        options.minimumIndependentSellers ??
          DEFAULT_MINIMUM_INDEPENDENT_SELLERS,
      ),
    );
    const fetchedItems: Poe2Item[] = [];
    let comparablePrices: ComparablePrice[] = [];

    for (
      let offset = 0;
      offset < ids.length && offset < maximumListings;
      offset += 10
    ) {
      const batch = await Poe2Trade.fetchItems(
        ids.slice(offset, Math.min(offset + 10, maximumListings)),
        options,
      );
      fetchedItems.push(...(batch.result || []));

      const currencies = Poe2Trade.toUniqueItems(
        fetchedItems.map((item) => item.listing.price.currency),
      );
      await this.fetchManyExchangeRates(currency, currencies, league, options);
      const normalizedPrices = this.toEquivalentPrices(
        currency,
        fetchedItems.map((item) => ({
          amount: item.listing.price.amount,
          currency: item.listing.price.currency,
        })),
        league,
      );
      comparablePrices = fetchedItems.map((item, index) => ({
        ...normalizedPrices[index],
        itemId: item.id,
        listedAmount: item.listing.price.amount,
        listedCurrency: item.listing.price.currency,
        item,
      }));

      if (
        Math.min(offset + 10, ids.length, maximumListings) >= minimumListings &&
        (minimumIndependentSellers === 0 ||
          analyzeComparablePrices(comparablePrices).included.length >=
            minimumIndependentSellers)
      ) {
        break;
      }
    }

    return comparablePrices;
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

  getCachedEstimates(league?: string) {
    const cacheKey = `price_estimates`;
    const data = Cache.getJson<Record<string, Estimate>>(cacheKey) || {};
    if (league === undefined) {
      return data;
    }

    return Object.fromEntries(
      Object.entries(data).filter(
        ([, estimate]) => estimate.search?.league === league,
      ),
    );
  }

  cachePriceEstimate(itemId: string, estimate: Estimate) {
    const cacheKey = `price_estimates`;
    const data = Cache.getJson<Record<string, Estimate>>(cacheKey) || {};
    data[itemId] = { ...estimate, checkedAt: estimate.checkedAt || Date.now() };
    Cache.setJson(cacheKey, data, Cache.times.day);
  }

  removeCachedEstimate(itemId: string) {
    const cacheKey = `price_estimates`;
    const data = Cache.getJson<Record<string, Estimate>>(cacheKey) || {};
    if (!(itemId in data)) {
      return;
    }

    delete data[itemId];
    Cache.setJson(cacheKey, data, Cache.times.day);
  }

  priceEstimate(prices: Price[], options: PriceAnalysisOptions = {}) {
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
    const minimumIndependentSellers = Math.max(
      1,
      Math.round(options.minimumIndependentSellers || 1),
    );
    if (analysis.included.length < minimumIndependentSellers) {
      throw new Error(
        `Only ${analysis.included.length} reliable independent seller${analysis.included.length === 1 ? " was" : "s were"} found; at least ${minimumIndependentSellers} independent sellers are required.`,
      );
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
      try {
        await this.exchangeRate(iWant, currency, league, false, options);
      } catch (error) {
        rethrowIfRequestCancelled(error, options);
        console.warn(
          `Unable to convert ${currency} to ${iWant}; excluding those listings`,
          error,
        );
      }
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

  extractMod(
    mod: string,
    preferredSection?: "explicit" | "implicit" | "enchant",
  ) {
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

    const values = withoutBrackets
      .match(/[-+]?\d+(?:\.\d+)?/g)
      ?.map(Number);

    // Look for generalized match, or exact match
    const statEntry = this.getStatEntryForMod(
      output,
      withoutBrackets,
      preferredSection,
    );

    if (!statEntry) {
      console.log(`No stat entry found for mod: ${mod}, ${output}`);
      throw new Error(`No stat entry found for mod: ${mod}, ${output}`);
    }

    let value1 = values?.[0];
    let value2 = values?.[1];

    const inverted =
      (statEntry.text.includes("increased") && output.includes("reduced")) ||
      (statEntry.text.includes("reduced") && output.includes("increased"));

    if (statEntry.text !== output && inverted) {
      // we had to invert to find the stat entry
      if (value1 !== undefined) value1 = -value1;
      if (value2 !== undefined) value2 = -value2;
    }

    return {
      mod: mod,
      parsed: output,
      value1,
      value2,
      hash: statEntry.id,
    };
  }

  getStatEntryForMod(
    mod: string,
    original?: string,
    preferredSection?: "explicit" | "implicit" | "enchant",
  ) {
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
    const preferredEntry = preferredSection
      ? stats.find((entry) =>
          preferredSection === "enchant"
            ? /^(?:enchant|rune)\./.test(entry.id)
            : entry.id.startsWith(`${preferredSection}.`),
        )
      : undefined;
    return preferredEntry || stats[0] || null;
  }

  parseItemMods(item: Poe2Item) {
    const unresolved: UnresolvedItemModifier[] = [];
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
          const parsed = this.extractMod(description, section);
          return [
            authoritativeHash
              ? { ...parsed, hash: authoritativeHash, sourceIndex: index }
              : { ...parsed, sourceIndex: index },
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
                sourceIndex: index,
              },
            ];
          }

          unresolved.push({
            section,
            sourceIndex: index,
            text: description,
          });
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
      unresolved,
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
