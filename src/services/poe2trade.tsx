import { Poe2Item, Poe2ItemSearch } from "./types";
import { Cache } from "../services/Cache";
import { Poe2TradeClient } from "./Poe2TradeClient";
import {
  getAccountItemDetailsCacheKey,
  getAccountItemsCacheKey,
} from "./accountCache";
import { ApiRequestRunOptions } from "./ApiRequestQueue";

class Poe2TradeService {
  client = new Poe2TradeClient();

  toUniqueItems(items: string[]) {
    return [...new Set(items)];
  }

  async getAccountItems(
    account: string,
    price = 1,
    currency = "exalted",
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    return this.client.getAccountItems(
      account,
      price,
      currency,
      league,
      options,
    );
  }

  async getAccountLiveSearch(
    account: string,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    return this.client.getAccountLiveSearch(account, league, options);
  }

  async getAccountItemsByCategory(
    account: string,
    category: string,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    return this.client.getAccountItemsByCategory(
      account,
      category,
      league,
      options,
    );
  }

  async getAllAccountItemsByItemLevel(
    account: string,
    price: number,
    currency: string,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    const initial = await this.getAccountItemsByItemLevel(
      account,
      price,
      currency,
      undefined,
      undefined,
      league,
      options,
    );

    const itemsAtSamePrice = initial.total;
    let allItems: string[] = [...initial.result];

    console.log("Splitting ", price, currency, "by item level");

    let minItemLevel = undefined;
    let maxItemLevel = undefined;

    while (allItems.length < itemsAtSamePrice) {
      const previousItemCount = allItems.length;
      console.log(
        "Fetching items with min",
        minItemLevel,
        "and max",
        maxItemLevel,
        "we found",
        allItems.length,
        "so far",
      );
      const iLevelRange = await this.getAccountItemsByItemLevel(
        account,
        price,
        currency,
        minItemLevel,
        maxItemLevel,
        league,
        options,
      );

      const fetches = await this.fetchAllItems(
        account,
        iLevelRange.result.slice(-5),
        false,
        league,
        options,
      );
      const lastItem = fetches.sort((a, b) => b.item.ilvl - a.item.ilvl)[0];
      if (!lastItem) {
        break;
      }

      if (
        !iLevelRange.result.length ||
        (minItemLevel && lastItem.item.ilvl < minItemLevel)
      ) {
        // we are done
        break;
      }

      if (iLevelRange.total > 100 && minItemLevel && !maxItemLevel) {
        // we had a minimum and it still came back with too many, so lets set the max to be the same number
        maxItemLevel = minItemLevel;
      }

      if (iLevelRange.total <= 100 && minItemLevel && maxItemLevel) {
        // we had a min and max set and it was fine, so lets set the min to be the same as the max
        minItemLevel = maxItemLevel + 1;
        maxItemLevel = undefined;
      }

      if (
        minItemLevel &&
        (!lastItem.item.ilvl || minItemLevel == lastItem.item.ilvl)
      ) {
        // we have found a page where the last item is still our current level
        // or there's no item level on it at all for some reason
        minItemLevel = minItemLevel + 1;
      }

      if (!minItemLevel || lastItem.item.ilvl > minItemLevel) {
        // we have a new minimum as the largest item level we've seen
        minItemLevel = lastItem.item.ilvl;
        maxItemLevel = undefined;
      }

      if (maxItemLevel && maxItemLevel < minItemLevel) {
        maxItemLevel = minItemLevel;
      }

      allItems.push(...iLevelRange.result);
      allItems = this.toUniqueItems(allItems);

      if (
        allItems.length === previousItemCount &&
        allItems.length < itemsAtSamePrice
      ) {
        throw new Error(
          `Account sync stalled while splitting ${price} ${currency} listings by item level.`,
        );
      }
    }

    return allItems;
  }

  public async pruneAccountItemsLessThan(
    account: string,
    price: number,
    currency: string,
    seenItems: string[],
    league?: string,
  ) {
    let allCachedItems = this.getCachedAccountItems(account, league);

    for (const item of allCachedItems) {
      const cachedItem = this.getCachedAccountItemDetails(account, item, league);
      if (
        cachedItem &&
        cachedItem.listing.price.amount < price &&
        cachedItem.listing.price.currency === currency &&
        !seenItems.includes(item)
      ) {
        console.log(
          "Pruning",
          cachedItem.item.name,
          "for",
          cachedItem.listing.price.amount,
          cachedItem.listing.price.currency,
        );
        allCachedItems = allCachedItems.filter((i) => i !== item);
        this.setCachedAccountItems(account, allCachedItems, league);

        const itemDetails = this.getAccountItemDetailsCache(account, league);
        delete itemDetails[item];
        this.setAccountItemDetails(account, itemDetails, league);
      }
    }
  }

  public async getAllCachedAccountItems(account: string, league?: string) {
    const allCachedItems = this.getCachedAccountItems(account, league);
    const allCachedItemDetails = this.getAccountItemDetailsCache(account, league);

    return allCachedItems
      .map((itemId) => allCachedItemDetails[itemId])
      .filter(Boolean);
  }

  public getCachedAccountItems(account: string, league?: string): string[] {
    const cacheKey = getAccountItemsCacheKey(account, league);
    return Cache.getJson<string[]>(cacheKey) || [];
  }

  upsertCachedAccountItems(account: string, items: string[], league?: string) {
    const existingItems = this.getCachedAccountItems(account, league);

    if (existingItems) {
      items = [...new Set([...existingItems, ...items])];
    }

    this.setCachedAccountItems(account, items, league);
  }

  setCachedAccountItems(account: string, items: string[], league?: string) {
    const cacheKey = getAccountItemsCacheKey(account, league);
    const uniqueItems = [...new Set(items)];
    Cache.setJson(cacheKey, uniqueItems);
  }

  range(min?: number | undefined, max?: number | undefined) {
    const params = {
      ...(min && { min: min }),
      ...(max && { max: max }),
    };

    return min || max ? params : undefined;
  }

  async getItemByAttributes(
    searchParams: Poe2ItemSearch,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    return this.client.getItemByAttributes(searchParams, league, options);
  }

  async getAccountItemsByItemLevel(
    account: string,
    price = 1,
    currency = "exalted",
    minItemLevel?: number,
    maxItemLevel?: number,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    return this.client.getAccountItemsByItemLevel(
      account,
      price,
      currency,
      minItemLevel,
      maxItemLevel,
      league,
      options,
    );
  }

  async fetchItems(items: string[], options: ApiRequestRunOptions = {}) {
    return this.client.fetchItems(items, options);
  }

  getCachedAccountItemDetails(
    account: string,
    itemId: string,
    league?: string,
  ): Poe2Item {
    const cachedItems = this.getAccountItemDetailsCache(account, league);
    return cachedItems[itemId];
  }

  getAccountItemDetailsCache(account: string, league?: string): {
    [key: string]: Poe2Item;
  } {
    const cacheKey = getAccountItemDetailsCacheKey(account, league);
    return Cache.getJson(cacheKey) || {};
  }

  upsertAccountItemDetails(account: string, item: Poe2Item, league?: string) {
    const cachedItems = this.getAccountItemDetailsCache(account, league);
    cachedItems[item.id] = item;
    this.setAccountItemDetails(account, cachedItems, league);
  }

  setAccountItemDetails(
    account: string,
    items: { [key: string]: Poe2Item },
    league?: string,
  ) {
    const cacheKey = getAccountItemDetailsCacheKey(account, league);
    Cache.setJson(cacheKey, items);
  }

  async fetchAllItems(
    account: string,
    items: string[],
    refresh = false,
    league?: string,
    options: ApiRequestRunOptions = {},
  ) {
    const allItems: Poe2Item[] = [];
    const itemsToFetch: string[] = [];

    // Check cache first
    for (const itemId of items) {
      const cachedItem = this.getCachedAccountItemDetails(
        account,
        itemId,
        league,
      );
      if (cachedItem && !refresh) {
        allItems.push(cachedItem);
      } else {
        itemsToFetch.push(itemId);
      }
    }

    items = itemsToFetch;

    while (items.length) {
      console.log(`Fetching ${items.length} items`);
      const response = await this.fetchItems(items, options);

      // Store fetched items in cache
      response.result.forEach((item) =>
        this.upsertAccountItemDetails(account, item, league),
      );

      allItems.push(...response.result);
      items = items.slice(10);
    }
    return allItems;
  }

  getStashTabs(items: Poe2Item[]) {
    const stashTabs = items.reduce(
      (acc, item) => {
        const { stash } = item.listing;
        if (acc[stash.name]) {
          acc[stash.name].push(item);
        } else {
          acc[stash.name] = [item];
        }
        return acc;
      },
      {} as Record<string, Poe2Item[]>,
    );
    return stashTabs;
  }
}

export const Poe2Trade = new Poe2TradeService();
