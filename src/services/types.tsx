export type Poe2ItemSearch = Partial<{
  name: string;
  baseType: string;
  category: string;
  rarity: string;
  ilvl: number;
  quality: number;
  quality_max: number;

  explicit?: Array<{ id: string; min?: number; max?: number }>;
  implicit?: Array<{ id: string; min?: number; max?: number }>;
  pseudo?: Array<{ id: string; min?: number; max?: number }>;

  // equipment
  ar: number;
  es: number;
  ev: number;
  damage: number;
  crit: number;
  pdps: number;
  edps: number;
  dps: number;
  aps: number;
  block: number;
  rune_sockets: number;
  spirit: number;

  // requirements
  lvl: number;
  lvl_max: number;
  dex: number;
  str: number;
  int: number;

  statGroupType: "and" | "count";
  statGroupMin: number;

  //maps
  map_tier: number;

  // misc
  gem_level: number;
  gem_level_max: number;
  gem_sockets: number;
  area_level: number;
  stack_size: number;
  corrupted: "true" | "false" | "any";

  status: "online" | "any" | "securable" | "available";

  price: number;
  currency: string;

  sort: string;
  direction: "asc" | "desc";
}>;

export interface Poe2TradeSearch {
  id: string;
  complexity: number;
  result: string[];
  total: number;
  strategy?:
    | "market-properties"
    | "market-pseudos"
    | "strict"
    | "one-mod-relaxed"
    | "modifier-count-relaxed";
  marketProperty?: "dps" | "pdps" | "edps" | "ar" | "ev" | "es";
  marketPropertyMinimum?: number;
  selectedModifierCount?: number;
  minimumModifierCount?: number;
}

export interface Poe2FetchItems {
  result: Poe2Item[];
}

export interface Poe2ExchangeSearch {
  id: string;
  result: Record<string, ExchangeItem>;
}

export interface Poe2CurrencyExchangeOverview {
  core?: {
    primary?: string;
    rates?: Record<string, number>;
  };
  lines?: Array<{
    id: string;
    primaryValue: number;
  }>;
}

export interface ExchangeItem {
  id: string;
  listing: ExchangeListing;
}

export interface ExchangeListing {
  indexed: string; // ISO date string
  account: Account;
  offers: Offer[];
  whisper: string;
  whisper_token: string;
}

export interface Account {
  name: string;
  online: {
    league: string;
  };
  lastCharacterName: string;
  language: string;
  realm: string;
}

export interface Offer {
  exchange: ExchangeCurrencyOffer;
  item: ExchangeCurrencyItem;
}

export interface ExchangeCurrencyOffer {
  currency: string;
  amount: number;
  whisper: string;
}

export interface ExchangeCurrencyItem {
  currency: string;
  amount: number;
  stock: number;
  id: string;
  whisper: string;
}

export type Price = {
  amount: number;
  currency: string;
  lowerPrice?: Price;
};

export function formatPriceAmount(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "n/a";
  }

  const absoluteAmount = Math.abs(amount);
  const decimals =
    absoluteAmount >= 100
      ? 0
      : absoluteAmount >= 1
        ? 2
        : absoluteAmount >= 0.1
          ? 3
          : 4;

  const formatted = amount.toFixed(decimals);
  return formatted.includes(".")
    ? formatted.replace(/0+$/, "").replace(/\.$/, "")
    : formatted;
}

export const GREAT_PRICE_LABEL = "Great price!";

export function formatSuggestedPriceLabel(
  price: Price | undefined,
  matchesCurrentPrice = false,
  includeLabel = false,
) {
  if (matchesCurrentPrice) {
    return GREAT_PRICE_LABEL;
  }

  if (!price) {
    return "Not checked";
  }

  const prefix = includeLabel ? "suggested price: " : "";
  return `${prefix}~${formatPriceAmount(price.amount)} ${price.currency}`;
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}.${day}.${year}`;
}

export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(timestamp)} ${hours}:${minutes}`;
}

export type ItemMod =
  | string
  | {
      description: string;
      hash: string;
      mods: ItemModDetail[];
    };

export interface ItemModDetail {
  name?: string;
  tier?: string;
  level?: number;
  magnitudes?: Array<{
    hash?: string;
    min?: string;
    max?: string;
  }>;
}

export type ModifierSection = "implicit" | "explicit" | "enchant";
export type ModifierDisplayKind = ModifierSection | "prefix" | "suffix";

export function formatItemMod(mod: ItemMod): string {
  return typeof mod === "string" ? mod : mod.description;
}

export function normalizeModifierHash(hash: string) {
  return hash.startsWith("stat.") ? hash.slice("stat.".length) : hash;
}

export function getModifierDisplayKind(
  item: Poe2Item,
  section: ModifierSection,
  index: number,
): ModifierDisplayKind {
  if (section !== "explicit") {
    return section;
  }

  const tierTokens = getItemModifierTierLabels(item, section, index).map(
    ({ token }) => token.toLowerCase(),
  );
  if (
    tierTokens.length > 0 &&
    tierTokens.every(
      (tier) => tier.startsWith("p") || tier.includes("prefix"),
    )
  ) {
    return "prefix";
  }

  if (
    tierTokens.length > 0 &&
    tierTokens.every(
      (tier) => tier.startsWith("s") || tier.includes("suffix"),
    )
  ) {
    return "suffix";
  }

  return section;
}

export interface ModifierTierLabel {
  token: string;
  label: string;
}

function getModifierTierLabel(token: string) {
  const prefix = token.match(/^p(\d+)$/i);
  if (prefix) {
    return `Prefix tier ${prefix[1]}`;
  }

  const suffix = token.match(/^s(\d+)$/i);
  if (suffix) {
    return `Suffix tier ${suffix[1]}`;
  }

  return `Modifier tier ${token}`;
}

function getItemSectionModifier(
  item: Poe2Item,
  section: ModifierSection,
  index: number,
) {
  const modifiers =
    section === "implicit"
      ? item.item?.implicitMods
      : section === "enchant"
        ? item.item?.enchantMods
        : item.item?.explicitMods;

  return modifiers?.[index];
}

function toModifierTierLabels(tokens: string[]): ModifierTierLabel[] {
  return tokens
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => ({ token, label: getModifierTierLabel(token) }));
}

export function getItemModifierTierLabels(
  item: Poe2Item,
  section: ModifierSection,
  index: number,
  displayMod = getItemSectionModifier(item, section, index),
): ModifierTierLabel[] {
  if (displayMod && typeof displayMod !== "string") {
    const structuredTiers = displayMod.mods
      .map((mod) => mod.tier)
      .filter((tier): tier is string => typeof tier === "string");
    if (structuredTiers.length > 0) {
      return toModifierTierLabels(structuredTiers);
    }
  }

  const displayHash = getItemModifierHash(item, section, index, displayMod);
  if (!displayHash) {
    return [];
  }

  const extendedMods = item.item?.extended?.mods?.[section] || [];
  const matchingTiers = extendedMods
    .filter((mod) =>
      mod.magnitudes?.some(
        (magnitude) =>
          typeof magnitude.hash === "string" &&
          normalizeModifierHash(magnitude.hash) === displayHash,
      ),
    )
    .map((mod) => mod.tier)
    .filter((tier): tier is string => typeof tier === "string");

  return toModifierTierLabels(matchingTiers);
}

export function getItemModifierHash(
  item: Poe2Item,
  section: ModifierSection,
  index: number,
  mod?: ItemMod,
) {
  const structuredHash = mod && typeof mod !== "string" ? mod.hash : undefined;
  const extendedHash = item.item?.extended?.hashes?.[section]?.[index]?.[0];
  const hash = structuredHash || extendedHash;

  return hash ? normalizeModifierHash(hash) : undefined;
}

export type ModifierSelection = {
  implicit: boolean[];
  explicit: boolean[];
  enchant?: boolean[];
  itemLevel?: boolean;
  requiredLevel?: boolean;
  requiredLevelMin?: number;
  requiredLevelMax?: number;
  runeSockets?: boolean;
  runeSocketCount?: number;
};

export interface Poe2Item {
  id: string;
  origin?: "clipboard";
  listing: {
    method: string;
    indexed: string; // ISO date string
    stash: {
      name: string;
      x: number;
      y: number;
    };
    account: {
      name: string;
      online: null | boolean;
      current: boolean;
    };
    price: {
      type: string;
      amount: number;
      currency: string;
    };
  };
  item: {
    realm: string;
    corrupted: boolean;
    verified: boolean;
    w: number;
    h: number;
    icon: string;
    league: string;
    id: string;
    gemLevel?: number;
    quality?: number;
    sockets?: Array<unknown>;
    name: string;
    typeLine: string;
    baseType: string;
    rarity: string;
    ilvl: number;
    identified: boolean;
    properties: ItemProperty[];
    requirements: ItemRequirement[];
    implicitMods?: ItemMod[];
    explicitMods?: ItemMod[];
    enchantMods?: ItemMod[];
    frameType: number;
    extended: {
      mods: {
        explicit: ExtendedMod[];
        implicit?: ExtendedMod[];
        enchant?: ExtendedMod[];
      };
      hashes: {
        explicit: Array<[string, number[]]>;
        implicit?: Array<[string, number[]]>;
        enchant?: Array<[string, number[]]>;
      };
    };
  };
}

export interface ItemProperty {
  name: string;
  values: Array<[string, number]>;
  displayMode: number;
}

export interface ItemRequirement {
  name: string;
  values: Array<[string, number]>;
  displayMode: number;
  type: number;
}

export interface ExtendedMod {
  name: string;
  tier: string;
  level: number;
  magnitudes: Array<{
    hash: string;
    min: string;
    max: string;
  }>;
}

export interface ChatOffer {
  message: string;
  timestamp: string;
  characterName: string;
  item: {
    name: string;
    price: string;
    stashTab: string;
    position: {
      left: number;
      top: number;
    };
  };
}
