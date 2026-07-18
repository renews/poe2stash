import { median } from "./priceAnalysis";
import { PriceSnapshot } from "./priceHistory";
import { MerchantHistoryEntry } from "./merchantHistory";
import { Price } from "./types";

export interface SaleCalibrationMatch {
  sale: MerchantHistoryEntry;
  snapshot: PriceSnapshot;
  suggestedAmount: number;
  soldAmount: number;
  currency: string;
  percentError: number;
  hoursToSell: number;
}

export interface SaleCalibrationSummary {
  matchedSales: number;
  medianAbsoluteErrorPercent: number;
  medianPercentError: number;
  underpriced: number;
  overpriced: number;
  wellPriced: number;
  medianHoursToSell: number;
}

export function matchSalesToPriceSnapshots(
  sales: MerchantHistoryEntry[],
  snapshots: PriceSnapshot[],
  league?: string,
) {
  const normalizedLeague = league?.trim().toLowerCase();
  return sales.flatMap((sale): SaleCalibrationMatch[] => {
    if (!sale.itemId || sale.amount === undefined || sale.amount <= 0) {
      return [];
    }

    const soldAt = normalizeTimestamp(sale.timestamp);
    if (!soldAt) {
      return [];
    }

    const snapshot = snapshots
      .filter(
        (entry) =>
          entry.itemId === sale.itemId &&
          entry.checkedAt <= soldAt &&
          (!normalizedLeague ||
            !entry.league ||
            entry.league.trim().toLowerCase() === normalizedLeague),
      )
      .sort((left, right) => right.checkedAt - left.checkedAt)[0];
    if (!snapshot) {
      return [];
    }

    const suggestedAmount = findPriceAmount(
      snapshot.suggested,
      sale.currency,
    );
    if (suggestedAmount === undefined) {
      return [];
    }

    return [
      {
        sale,
        snapshot,
        suggestedAmount,
        soldAmount: sale.amount,
        currency: sale.currency,
        percentError: ((suggestedAmount - sale.amount) / sale.amount) * 100,
        hoursToSell: (soldAt - snapshot.checkedAt) / (60 * 60 * 1000),
      },
    ];
  });
}

export function summarizeSaleCalibration(
  matches: SaleCalibrationMatch[],
): SaleCalibrationSummary {
  const errors = matches.map((match) => match.percentError);
  const tolerance = 5;

  return {
    matchedSales: matches.length,
    medianAbsoluteErrorPercent: median(errors.map(Math.abs)),
    medianPercentError: median(errors),
    underpriced: errors.filter((error) => error < -tolerance).length,
    overpriced: errors.filter((error) => error > tolerance).length,
    wellPriced: errors.filter((error) => Math.abs(error) <= tolerance).length,
    medianHoursToSell: median(matches.map((match) => match.hoursToSell)),
  };
}

export function findPriceAmount(
  price: Price | undefined,
  currency: string,
): number | undefined {
  let current = price;
  while (current) {
    if (current.currency === currency) {
      return current.amount;
    }
    current = current.lowerPrice;
  }
  return undefined;
}

function normalizeTimestamp(timestamp: string | number) {
  const value =
    typeof timestamp === "number" && timestamp < 2_000_000_000
      ? timestamp * 1000
      : timestamp;
  const normalized = new Date(value).getTime();
  return Number.isNaN(normalized) ? undefined : normalized;
}
