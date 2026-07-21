import { Job } from "./Job";
import { Poe2Trade } from "../services/poe2trade";
import { PriceChecker } from "../services/PriceEstimator";

export class SyncAccount extends Job<string[]> {
  constructor(private account: string, private league: string = "Standard") {
    super(
      "account-sync",
      "Sync Account",
      "Finds every item in Your Sales for this account. This might take a few minutes.",
    );
  }

  async *_task() {
    try {
      let price = 1;
      const currency = "exalted";
      let allItems: string[] = [];
      const cachedItems = Poe2Trade.getCachedAccountItems(
        this.account,
        this.league,
      );
      let totalNeeded = 0;
      let previousCursor = "";

      while (true) {
        const response = await Poe2Trade.getAccountItems(
          this.account,
          price,
          currency,
          this.league,
          { signal: this.signal },
        );

        if (!totalNeeded) {
          totalNeeded = response.total;
        }

        if (!response.result.length) {
          break;
        }

        const pageItems = response.result.filter(
          (itemId) => !allItems.includes(itemId),
        );
        const [lastItem] = await Poe2Trade.fetchAllItems(
          this.account,
          [response.result[response.result.length - 1]],
          false,
          this.league,
          { signal: this.signal },
        );

        let lastItemPrice = lastItem?.listing.price.amount || price;
        const lastItemPriceCurrency =
          lastItem?.listing.price.currency || currency;

        if (lastItemPriceCurrency !== currency) {
          const exchangeRate = await PriceChecker.avgExchangeRate(
            currency,
            lastItemPriceCurrency,
            this.league,
            { signal: this.signal },
          );
          lastItemPrice = exchangeRate * lastItemPrice;
        }

        let samePriceItems: string[] = [];
        if (lastItemPrice == price) {
          samePriceItems = await Poe2Trade.getAllAccountItemsByItemLevel(
            this.account,
            price,
            currency,
            this.league,
            { signal: this.signal },
          );
          price++;
        } else {
          price = lastItemPrice > price ? lastItemPrice : price * 1.2;
        }

        allItems = Poe2Trade.toUniqueItems([
          ...allItems,
          ...pageItems,
          ...samePriceItems,
        ]);

        const cursor = `${price}:${allItems.length}`;
        if (cursor === previousCursor || (!pageItems.length && !samePriceItems.length)) {
          throw new Error(
            `Account sync stalled after finding ${allItems.length} of ${totalNeeded} listings.`,
          );
        }
        previousCursor = cursor;

        yield {
          total: totalNeeded,
          current: allItems.length,
          data: allItems,
        };

        if (totalNeeded > 0 && allItems.length >= totalNeeded) {
          break;
        }
      }

      const reconciledItems = totalNeeded === 0 ? [] : allItems;
      Poe2Trade.setCachedAccountItems(
        this.account,
        reconciledItems,
        this.league,
      );

      if (!allItems.length) {
        yield {
          total: totalNeeded,
          current: 0,
          data: reconciledItems,
        };
      }

      void cachedItems;
      return reconciledItems;
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
