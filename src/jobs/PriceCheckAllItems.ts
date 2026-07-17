import { Job } from "./Job";
import { Estimate, PriceChecker } from "../services/PriceEstimator";
import { ModifierSelection, Poe2Item } from "../services/types";

export class PriceCheckAllItems extends Job<Estimate> {
  constructor(
    private filteredItems: Poe2Item[],
    private skipAlreadyChecked = true,
    private league?: string,
    private modifierSelections: Record<string, ModifierSelection> = {},
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

      const hasModifierSelection = Boolean(this.modifierSelections[item.id]);

      if (cached[item.id] && this.skipAlreadyChecked && !hasModifierSelection) {
        yield {
          total: this.filteredItems.length,
          current: i + 1,
          data: cached[item.id],
        };
      } else {
        try {
          const price = await PriceChecker.estimateItemPrice(
            item,
            this.league,
            this.modifierSelections[item.id],
          );
          yield {
            total: this.filteredItems.length,
            current: i + 1,
            data: price,
          };
        } catch (error: any) {
          console.error(error);
          this.error =
            error?.response?.data?.error?.message ||
            error?.response?.data ||
            error?.message ||
            "No comparable listings found";
        }
      }
    }
  }
}
