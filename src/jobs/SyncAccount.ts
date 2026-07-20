import { Job } from "./Job";
import { Poe2Trade } from "../services/poe2trade";

const ACCOUNT_ITEM_CATEGORIES = [
  "weapon",
  "armour",
  "accessory",
  "gem",
  "jewel",
  "flask",
  "map",
  "card",
  "sanctum.relic",
  "currency",
] as const;

export class SyncAccount extends Job<string[]> {
  constructor(private account: string, private league: string = "Standard") {
    super(
      "account-sync",
      "Sync Account",
      "Finds every publicly listed trade item for this account. This might take a few minutes.",
    );
  }

  async *_task() {
    try {
      const initial = await Poe2Trade.getAccountLiveSearch(
        this.account,
        this.league,
        { signal: this.signal },
      );
      const totalNeeded = initial.total;
      let allItems = Poe2Trade.toUniqueItems(initial.result);

      if (allItems.length) {
        yield {
          total: totalNeeded,
          current: allItems.length,
          data: allItems,
        };
      }

      for (const category of ACCOUNT_ITEM_CATEGORIES) {
        if (allItems.length >= totalNeeded) {
          break;
        }

        const response = await Poe2Trade.getAccountItemsByCategory(
          this.account,
          category,
          this.league,
          { signal: this.signal },
        );
        const previousItemCount = allItems.length;
        allItems = Poe2Trade.toUniqueItems([...allItems, ...response.result]);

        if (allItems.length > previousItemCount) {
          yield {
            total: totalNeeded,
            current: allItems.length,
            data: allItems,
          };
        }
      }

      if (allItems.length !== totalNeeded) {
        throw new Error(
          `Account sync found ${allItems.length} of ${totalNeeded} listings.`,
        );
      }

      Poe2Trade.setCachedAccountItems(
        this.account,
        allItems,
        this.league,
      );

      if (!allItems.length) {
        yield {
          total: totalNeeded,
          current: 0,
          data: allItems,
        };
      }

      return allItems;
    } catch (error: unknown) {
      console.error(error);
      this.error = getSyncErrorMessage(error);
      throw error;
    }
  }
}

function getSyncErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (!error || typeof error !== "object" || !("response" in error)) {
    return "Account sync failed.";
  }

  const response = error.response;
  if (!response || typeof response !== "object" || !("data" in response)) {
    return "Account sync failed.";
  }

  const data = response.data;
  if (typeof data === "string") {
    return data;
  }

  if (data && typeof data === "object" && "error" in data) {
    const detail = data.error;
    if (
      detail &&
      typeof detail === "object" &&
      "message" in detail &&
      typeof detail.message === "string"
    ) {
      return detail.message;
    }
  }

  return "Account sync failed.";
}
