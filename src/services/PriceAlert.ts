import { Estimate, PriceChecker } from "./PriceEstimator";
import { PricePosition } from "./pricePosition";
import { formatPriceAmount, Poe2Item } from "./types";

export type PriceAlertKind = Extract<
  PricePosition,
  "underpriced" | "overpriced"
>;

export type PriceAlertPayload = {
  kind: PriceAlertKind;
  title: string;
  body: string;
};

type PriceAlertDependencies = {
  getPosition: (
    item: Poe2Item,
    estimate: Estimate,
    league?: string,
  ) => Promise<PricePosition>;
  dispatch: (payload: PriceAlertPayload) => Promise<boolean>;
};

function getItemName(item: Poe2Item) {
  return (
    item.item?.name || item.item?.typeLine || item.item?.baseType || "Item"
  );
}

function capitalize(value: string) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "Unknown";
}

export function createPriceAlertPayload(
  item: Poe2Item,
  estimate: Estimate,
  kind: PriceAlertKind,
): PriceAlertPayload {
  const listedPrice = item.listing.price;
  const suggestedPrice = estimate.price;

  return {
    kind,
    title: `Potentially ${kind}: ${getItemName(item)}`,
    body: `Listed: ${formatPriceAmount(listedPrice.amount)} ${listedPrice.currency} · Suggested: ${formatPriceAmount(suggestedPrice.amount)} ${suggestedPrice.currency} · ${capitalize(estimate.confidence || "unknown")} confidence`,
  };
}

const defaultDependencies: PriceAlertDependencies = {
  getPosition: (item, estimate, league) =>
    PriceChecker.getListingPricePosition(
      item,
      estimate.price,
      estimate.stdDev,
      league,
    ),
  dispatch: async (payload) => {
    if (
      typeof window === "undefined" ||
      typeof window.desktopApi?.showPriceAlert !== "function"
    ) {
      return false;
    }

    return Boolean(await window.desktopApi.showPriceAlert(payload));
  },
};

export async function alertOnMispricedItem(
  item: Poe2Item,
  estimate: Estimate,
  league?: string,
  dependencies: PriceAlertDependencies = defaultDependencies,
) {
  const position = await dependencies.getPosition(item, estimate, league);
  if (position !== "underpriced" && position !== "overpriced") {
    return false;
  }

  return dependencies.dispatch(
    createPriceAlertPayload(item, estimate, position),
  );
}
