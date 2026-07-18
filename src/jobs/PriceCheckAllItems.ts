import { Job } from "./Job";
import {
  DEFAULT_MODIFIER_RANGE_PERCENT,
  DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES,
  Estimate,
  isEstimateFresh,
  PriceChecker,
} from "../services/PriceEstimator";
import { ModifierSelection, Poe2Item } from "../services/types";

export type PriceCheckItemProgress = {
  current: number;
  total: number;
  item: Poe2Item;
};

export function getPriceCheckItemName(item: Poe2Item) {
  return (
    item.item?.name ||
    item.item?.typeLine ||
    item.item?.baseType ||
    "Unknown item"
  );
}

export function getPriceCheckProgressLabel(
  current: number,
  total: number,
  item: Poe2Item,
) {
  return `Checking item ${current} of ${total}: ${getPriceCheckItemName(item)}`;
}

export class PriceCheckAllItems extends Job<Estimate> {
  onItemStart: (progress: PriceCheckItemProgress) => Promise<void> | void =
    async () => {};

  constructor(
    private filteredItems: Poe2Item[],
    private skipAlreadyChecked = true,
    private league?: string,
    private modifierSelections: Record<string, ModifierSelection> = {},
    private cooldownMinutes = DEFAULT_PRICE_CHECK_COOLDOWN_MINUTES,
    private modifierRangePercent = DEFAULT_MODIFIER_RANGE_PERCENT,
  ) {
    super(
      "price-check-items",
      "Price Checking Items",
      "Checking items listed...",
    );
  }

  async *_task() {
    const cached = PriceChecker.getCachedEstimates();
    for (let i = 0; i < this.filteredItems.length; i++) {
      const item = this.filteredItems[i];
      await this.onItemStart({
        current: i + 1,
        total: this.filteredItems.length,
        item,
      });

      const modifierSelection = this.modifierSelections[item.id];
      const cachedEstimate = cached[item.id];
      const canUseCachedEstimate =
        cachedEstimate &&
        this.skipAlreadyChecked &&
        isEstimateFresh(cachedEstimate, this.cooldownMinutes) &&
        PriceChecker.matchesModifierSelection(
          item,
          cachedEstimate,
          modifierSelection,
          this.modifierRangePercent,
        );

      if (canUseCachedEstimate) {
        yield {
          total: this.filteredItems.length,
          current: i + 1,
          data: cachedEstimate,
        };
      } else {
        try {
          const price = await PriceChecker.estimateItemPrice(
            item,
            this.league,
            modifierSelection,
            this.modifierRangePercent,
          );
          yield {
            total: this.filteredItems.length,
            current: i + 1,
            data: price,
          };
        } catch (error: unknown) {
          console.error(error);
          this.error = getPriceCheckErrorMessage(error);
        }
      }
    }
  }
}

function getPriceCheckErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error && typeof error === "object" && "response" in error) {
    const response = error.response;
    if (response && typeof response === "object" && "data" in response) {
      const data = response.data;
      if (typeof data === "string") {
        return data;
      }

      if (
        data &&
        typeof data === "object" &&
        "error" in data &&
        data.error &&
        typeof data.error === "object" &&
        "message" in data.error &&
        typeof data.error.message === "string"
      ) {
        return data.error.message;
      }
    }
  }

  return "No comparable listings found";
}
