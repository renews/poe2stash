import { expect, test } from "bun:test";
import { SyncAccount } from "../src/jobs/SyncAccount";
import { Poe2Trade } from "../src/services/poe2trade";
import { Poe2Item } from "../src/services/types";

test("sync reconciles category results and scopes cache writes by league", async () => {
  const originalGetLiveSearch = Poe2Trade.getAccountLiveSearch;
  const originalGetByCategory = Poe2Trade.getAccountItemsByCategory;
  const originalSetCached = Poe2Trade.setCachedAccountItems;
  const cacheWrites: Array<{ ids: string[]; league?: string }> = [];
  const searchLeagues: Array<string | undefined> = [];
  const expectedIds = Array.from({ length: 25 }, (_, index) => `item-${index}`);

  Poe2Trade.getAccountLiveSearch = (async (_account, league) => {
    searchLeagues.push(league);
    return {
      id: "all-account-items",
      complexity: 0,
      result: expectedIds.slice(0, 10),
      total: expectedIds.length,
    };
  }) as typeof Poe2Trade.getAccountLiveSearch;
  Poe2Trade.getAccountItemsByCategory = (async (
    _account,
    category,
    league,
  ) => {
    searchLeagues.push(league);
    const result =
      category === "weapon"
        ? expectedIds.slice(10, 20)
        : category === "armour"
          ? expectedIds.slice(20)
          : [];
    return {
      id: `category-${category}`,
      complexity: 0,
      result,
      total: result.length,
    };
  }) as typeof Poe2Trade.getAccountItemsByCategory;
  Poe2Trade.setCachedAccountItems = ((_account, ids, league?: string) => {
    cacheWrites.push({ ids: [...ids], league });
  }) as typeof Poe2Trade.setCachedAccountItems;

  try {
    const sync = new SyncAccount("Account#1234", "HC Runes of Aldur");
    let finalIds: string[] = [];

    for await (const progress of sync._task()) {
      finalIds = progress.data;
    }

    expect(finalIds).toHaveLength(25);
    expect(finalIds).toEqual(expectedIds);
    expect(searchLeagues).toEqual([
      "HC Runes of Aldur",
      "HC Runes of Aldur",
      "HC Runes of Aldur",
    ]);
    expect(cacheWrites.at(-1)).toEqual({
      ids: finalIds,
      league: "HC Runes of Aldur",
    });
  } finally {
    Poe2Trade.getAccountLiveSearch = originalGetLiveSearch;
    Poe2Trade.getAccountItemsByCategory = originalGetByCategory;
    Poe2Trade.setCachedAccountItems = originalSetCached;
  }
});

test("sync reconciles mixed-currency listings without a price cursor", async () => {
  const originalGetLiveSearch = Poe2Trade.getAccountLiveSearch;
  const originalGetAccountItems = Poe2Trade.getAccountItems;
  const originalSetCached = Poe2Trade.setCachedAccountItems;
  const originalGetByCategory = Poe2Trade.getAccountItemsByCategory;
  const categoryItems: Record<string, string[]> = {
    weapon: ["one"],
    armour: ["two"],
    gem: ["three"],
  };
  const cacheWrites: string[][] = [];

  Poe2Trade.getAccountLiveSearch = (async () => ({
    id: "all-account-items",
    complexity: 0,
    result: ["one"],
    total: 3,
  })) as typeof Poe2Trade.getAccountLiveSearch;
  Poe2Trade.getAccountItems = (async () => {
    throw new Error("sync must not paginate with a converted price cursor");
  }) as typeof Poe2Trade.getAccountItems;
  Poe2Trade.getAccountItemsByCategory = (async (
    _account,
    category,
  ) => ({
    id: `category-${category}`,
    complexity: 0,
    result: categoryItems[category] || [],
    total: categoryItems[category]?.length || 0,
  })) as typeof Poe2Trade.getAccountItemsByCategory;
  Poe2Trade.setCachedAccountItems = ((_account, ids) => {
    cacheWrites.push([...ids]);
  }) as typeof Poe2Trade.setCachedAccountItems;

  try {
    const sync = new SyncAccount("Account#1234", "HC Runes of Aldur");
    let finalIds: string[] = [];

    for await (const progress of sync._task()) {
      finalIds = progress.data;
    }

    expect(finalIds).toEqual(["one", "two", "three"]);
    expect(cacheWrites.at(-1)).toEqual(finalIds);
  } finally {
    Poe2Trade.getAccountLiveSearch = originalGetLiveSearch;
    Poe2Trade.getAccountItems = originalGetAccountItems;
    Poe2Trade.getAccountItemsByCategory = originalGetByCategory;
    Poe2Trade.setCachedAccountItems = originalSetCached;
  }
});

test("item-level pagination fails safely when a page adds no new items", async () => {
  const originalSearch = Poe2Trade.getAccountItemsByItemLevel;
  const originalFetch = Poe2Trade.fetchAllItems;
  const ids = Array.from({ length: 100 }, (_, index) => `item-${index}`);
  let searchCount = 0;

  Poe2Trade.getAccountItemsByItemLevel = (async () => {
    searchCount += 1;
    if (searchCount > 2) {
      throw new Error("test stopped runaway pagination");
    }

    return {
      id: `search-${searchCount}`,
      complexity: 0,
      result: ids,
      total: 500,
    };
  }) as typeof Poe2Trade.getAccountItemsByItemLevel;
  Poe2Trade.fetchAllItems = (async () => [
    {
      id: ids.at(-1),
      item: { id: ids.at(-1), ilvl: 80 },
      listing: { price: { amount: 1, currency: "exalted" } },
    } as Poe2Item,
  ]) as typeof Poe2Trade.fetchAllItems;

  try {
    await expect(
      Poe2Trade.getAllAccountItemsByItemLevel(
        "Account#1234",
        1,
        "exalted",
        "HC Runes of Aldur",
      ),
    ).rejects.toThrow("stalled");
    expect(searchCount).toBe(2);
  } finally {
    Poe2Trade.getAccountItemsByItemLevel = originalSearch;
    Poe2Trade.fetchAllItems = originalFetch;
  }
});
