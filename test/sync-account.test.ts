import { expect, test } from "bun:test";
import { SyncAccount } from "../src/jobs/SyncAccount";
import { Poe2Trade } from "../src/services/poe2trade";
import { Poe2Item } from "../src/services/types";

function createListedItem(id: string, amount: number): Poe2Item {
  return {
    id,
    listing: {
      price: { amount, currency: "exalted" },
    },
    item: { id },
  } as Poe2Item;
}

test("sync reconciles every result page and scopes cache writes by league", async () => {
  const originalGetCached = Poe2Trade.getCachedAccountItems;
  const originalSetCached = Poe2Trade.setCachedAccountItems;
  const originalUpsertCached = Poe2Trade.upsertCachedAccountItems;
  const originalPrune = Poe2Trade.pruneAccountItemsLessThan;
  const originalGetAccountItems = Poe2Trade.getAccountItems;
  const originalFetchAllItems = Poe2Trade.fetchAllItems;
  const originalGetByItemLevel = Poe2Trade.getAllAccountItemsByItemLevel;
  const cacheWrites: Array<{ ids: string[]; league?: string }> = [];
  const cacheReads: Array<string | undefined> = [];
  let searchCount = 0;

  Poe2Trade.getCachedAccountItems = ((_account, league?: string) => {
    cacheReads.push(league);
    return ["stale-item"];
  }) as typeof Poe2Trade.getCachedAccountItems;
  Poe2Trade.setCachedAccountItems = ((_account, ids, league?: string) => {
    cacheWrites.push({ ids: [...ids], league });
  }) as typeof Poe2Trade.setCachedAccountItems;
  Poe2Trade.upsertCachedAccountItems = (() => {}) as typeof Poe2Trade.upsertCachedAccountItems;
  Poe2Trade.pruneAccountItemsLessThan = (async () => {}) as typeof Poe2Trade.pruneAccountItemsLessThan;
  Poe2Trade.getAccountItems = (async () => {
    searchCount += 1;
    return searchCount <= 25
      ? {
          id: `search-${searchCount}`,
          complexity: 0,
          result: [`item-${searchCount}`],
          total: 25,
        }
      : { id: "done", complexity: 0, result: [], total: 25 };
  }) as typeof Poe2Trade.getAccountItems;
  Poe2Trade.fetchAllItems = (async (_account, ids) => [
    createListedItem(ids[0], searchCount + 1),
  ]) as typeof Poe2Trade.fetchAllItems;
  Poe2Trade.getAllAccountItemsByItemLevel = (async () => []) as typeof Poe2Trade.getAllAccountItemsByItemLevel;

  try {
    const sync = new SyncAccount("Account#1234", "HC Runes of Aldur");
    let finalIds: string[] = [];

    for await (const progress of sync._task()) {
      finalIds = progress.data;
    }

    expect(finalIds).toHaveLength(25);
    expect(finalIds).not.toContain("stale-item");
    expect(cacheReads).toEqual(["HC Runes of Aldur"]);
    expect(cacheWrites.at(-1)).toEqual({
      ids: finalIds,
      league: "HC Runes of Aldur",
    });
  } finally {
    Poe2Trade.getCachedAccountItems = originalGetCached;
    Poe2Trade.setCachedAccountItems = originalSetCached;
    Poe2Trade.upsertCachedAccountItems = originalUpsertCached;
    Poe2Trade.pruneAccountItemsLessThan = originalPrune;
    Poe2Trade.getAccountItems = originalGetAccountItems;
    Poe2Trade.fetchAllItems = originalFetchAllItems;
    Poe2Trade.getAllAccountItemsByItemLevel = originalGetByItemLevel;
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
