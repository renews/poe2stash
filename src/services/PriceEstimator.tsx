import {
  formatItemMod,
  ItemMod,
  ModifierSelection,
  Price,
  Poe2Item,
} from "./types";
import { Poe2Trade } from "./poe2trade";
import { getCurrencyRateFromOverview } from "./Poe2TradeClient";
import { Cache } from "./Cache";
import { Stats } from "../data/stats";

export type Stat = (typeof Stats)[0]["entries"][0];
export type Explicit = Poe2Item["item"]["extended"]["mods"]["explicit"][0];
export type ComparablePrice = Price & {
  itemId: string;
  listedAmount: number;
  listedCurrency: string;
  item?: Poe2Item;
};
export type Estimate = {
  price: Price;
  stdDev: Price;
  comparables: ComparablePrice[];
  search: {
    league?: string;
    baseType?: string;
    name?: string;
    rarity?: string;
    explicitCount: number;
    implicitCount?: number;
    explicitHashes?: string[];
    implicitHashes?: string[];
  };
};

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
  return uniqueCurrencies.length === 1 ? uniqueCurrencies[0] : preferredCurrency;
}

export function selectSelectedModifiers<T>(
  modifiers: T[],
  selection?: boolean[],
) {
  return modifiers.filter((_modifier, index) => selection?.[index] !== false);
}

function normalizeStatHash(hash: string) {
  return hash.startsWith("stat.") ? hash.slice("stat.".length) : hash;
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
  const rarity = rawRarity?.toLowerCase();
  const baseType = item.item?.baseType || item.item?.typeLine;

  return {
    baseType,
    name:
      rarity === "unique"
        ? item.item?.name || item.item?.typeLine
        : undefined,
    rarity,
  };
}

class PriceEstimator {
  async findMatchingItem(item: Poe2Item, league?: string) {
    const itemLeague = item.item?.league || league;
    const { baseType, name, rarity } = getItemSearchMetadata(item);
    if (!baseType) {
      throw new Error("Item data is incomplete: base type is missing.");
    }

    const parsedMods = this.parseItemMods(item);
    const topMods = await this.getHighTierMods(
      item,
      parsedMods.explicits?.length || 0,
    );

    const highTierStats = topMods
      .map((s) => s.magnitudes)
      .flat()
      .map((mag) => mag.hash)
      .map((hash) => parsedMods?.explicits?.find((p) => p.hash === hash))
      .filter((p) => p);
    const topStats = highTierStats.length
      ? highTierStats
      : (parsedMods.explicits || []).slice(0, parsedMods.explicits?.length || 0);

    const topMatch = await Poe2Trade.getItemByAttributes({
      name,
      rarity,
      baseType,
      explicit: topStats.map((s) => ({
        id: s!.hash,
        ...Poe2Trade.range(s!.value1),
      })),
      status: "securable",
    }, itemLeague);

    return topMatch;
  }

  async estimateItemPrice(
    item: Poe2Item,
    league?: string,
    modifierSelection?: ModifierSelection,
  ) {
    const itemLeague = item.item?.league || league;
    const { baseType, name, rarity } = getItemSearchMetadata(item);
    if (!baseType) {
      throw new Error("Item data is incomplete: base type is missing.");
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
    console.log("Estimating price for item in league:", league);

    const allPrices: ComparablePrice[] = [];
    const currency = "exalted";

    // loop until we have 10 prices or we have no more mods to search
    for (
      let i = selectedExplicits.length;
      i >= 1 && allPrices.length < 10;
      i--
    ) {
      const { explicit, implicit } = await this.getSelectedSearchMods(
        item,
        selectedExplicits,
        selectedImplicits,
        i,
      );

      const topMatch = await Poe2Trade.getItemByAttributes({
        status: "securable",
        name,
        rarity,
        baseType,
        explicit: explicit.map((s) => ({
          id: s!.hash,
          ...Poe2Trade.range(s!.value1),
        })),
        implicit: implicit.map((s) => ({
          id: s!.hash,
          ...Poe2Trade.range(s!.value1),
        })),
      }, itemLeague);
      //await wait(1000);

      // ignore your own listing
      const filtered = (topMatch.result || []).filter((i) => i != item.id);
      const topPrices = await this.getPricesForItemIds(
        filtered,
        "exalted",
        itemLeague,
      );
      //await wait(5000);

      allPrices.push(...topPrices);
    }

    if (!selectedExplicits.length) {
      // Items without explicit mods need a base-item lookup instead.
      console.log("fetching normal item", allPrices);
      const normal = await Poe2Trade.getItemByAttributes({
        name,
        rarity,
        baseType,
        implicit: selectedImplicits.map((s) => ({
          id: s!.hash,
          ...Poe2Trade.range(s!.value1),
        })),
        status: "securable",
      }, itemLeague);
      //await wait(1000);
      const filtered = (normal.result || []).filter((i) => i != item.id);
      const sampledItems = this.sampleRange(filtered, 10);
      const normalPrices = await this.getPricesForItemIds(
        sampledItems,
        "exalted",
        itemLeague,
      );
      allPrices.push(...normalPrices);
    }

    await this.fetchManyExchangeRates(
      currency,
      allPrices.map((p) => p.currency),
      itemLeague,
    );
    const estimate = {
      ...this.priceEstimate(allPrices),
      comparables: allPrices,
      search: {
        league: itemLeague,
        baseType,
        name,
        rarity,
        explicitCount: selectedExplicits.length,
        implicitCount: selectedImplicits.length,
        explicitHashes: selectedExplicits.map((modifier) => modifier.hash),
        implicitHashes: selectedImplicits.map((modifier) => modifier.hash),
      },
    };

    estimate.price = await this.upscalePrice(estimate.price, itemLeague);
    estimate.stdDev = await this.upscalePrice(estimate.stdDev, itemLeague);

    console.log({ allPrices, estimate, item });

    this.cachePriceEstimate(item.item.id, estimate);
    return estimate as Estimate;
    // perform some searches based off the explicits to see if we can find comparable items
    // but we also want to learn about which mods are valuable for rares
    // we can detect this by the general pattern of item_type, item_rarity, (mod1, mod2, ...modN) => price floor
    // we can also learn the max tiers by performing a search for item_type, mod descending. we should save these facts
    // unique items should be handled by searching for the exact item with the mods equal or greater
  }

  async getSelectedSearchMods(
    item: Poe2Item,
    selectedExplicits: ReturnType<PriceEstimator["parseItemMods"]>["explicits"],
    selectedImplicits: ReturnType<PriceEstimator["parseItemMods"]>["implicits"],
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
      .filter((p) => p && selectedHashes.has(p.hash));

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
  ): Promise<ComparablePrice[]> {
    const items = await Poe2Trade.fetchItems(ids);
    const fetchedItems = items.result || [];

    const currencies = Poe2Trade.toUniqueItems(
      fetchedItems
        .map((i) => i.listing.price.currency)
        .concat(fetchedItems.map((i) => i.listing.price.currency)),
    );
    const priceCurrency = getComparablePriceCurrency(currency, currencies);

    await this.fetchManyExchangeRates(priceCurrency, currencies, league);

    const prices = this.toEquivalentPrices(
      priceCurrency,
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

  async upscalePrice(price: Price, league?: string) {
    if (price.currency !== "exalted") {
      return price;
    }

    const divineRate = await this.exchangeRate("exalted", "divine", league);
    if (price.amount > divineRate) {
      // convert from exalted to divine if large enough
      price.amount = price.amount / divineRate;
      price.currency = "divine";
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
    data[itemId] = estimate;
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

    const priceAmounts = prices.map((p) => p.amount);

    const price = this.mean(priceAmounts);

    const stdDev = this.stdDev(priceAmounts);

    const currency = currencies[0];

    return {
      price: { amount: price, currency },
      stdDev: { amount: stdDev, currency },
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
    const cache = localStorage.getItem(cacheKey);
    const cacheData = cache ? JSON.parse(cache) : {};

    const key = getExchangeRateCacheKey(iWant, iHave, league);
    cacheData[key] = rate;

    Cache.setJson(cacheKey, cacheData, Cache.times.hour);
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
  ) {
    for (const currency of Poe2Trade.toUniqueItems(iHave)) {
      await this.exchangeRate(iWant, currency, league);
    }
  }

  async avgExchangeRate(iWant: string, iHave: string, league?: string) {
    const rate1 = await this.exchangeRate(iWant, iHave, league);
    const rate2 = 1 / (await this.exchangeRate(iHave, iWant, league));

    return (rate1 + rate2) / 2;
  }

  async exchangeRate(iWant: string, iHave: string, league?: string) {
    const cached = this.getCachedExchangeRates(iWant, iHave, league);

    if (typeof cached === "number" && Number.isFinite(cached) && cached > 0) {
      return cached;
    }

    if (iWant === iHave) {
      await this.cacheExchangeRates(iWant, iHave, 1, league);
      return 1;
    }

    try {
      const overview = await Poe2Trade.client.getCurrencyExchangeOverview(
        league,
      );
      const rate = getCurrencyRateFromOverview(overview, iWant, iHave);

      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        await this.cacheExchangeRates(iWant, iHave, rate, league);
        return rate;
      }
    } catch (error) {
      console.warn("Currency overview unavailable, using trade exchange", error);
    }

    const swaps = await Poe2Trade.client.getCurrencySwaps(iWant, iHave, league);
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
    const parseMods = (mods?: ItemMod[]) =>
      (mods || []).flatMap((mod) => {
        try {
          return [this.extractMod(formatItemMod(mod))];
        } catch {
          if (typeof mod !== "string") {
            const values = formatItemMod(mod)
              .match(/[-+]?\d+(?:\.\d+)?/g)
              ?.map(Number);

            return [
              {
                mod: mod.description,
                parsed: mod.description,
                value1: values?.[0],
                value2: values?.[1],
                hash: normalizeStatHash(mod.hash),
              },
            ];
          }

          console.warn("Skipping modifier that is not in the local stat table", mod);
          return [];
        }
      });

    const explicits = parseMods(item.item?.explicitMods);
    const implicits = parseMods(item.item?.implicitMods);
    const enchants = parseMods(item.item?.enchantMods);

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
