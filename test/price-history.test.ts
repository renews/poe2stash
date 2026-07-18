import { expect, test } from "bun:test";
import {
  createPriceSnapshot,
  loadPriceSnapshots,
  savePriceSnapshot,
} from "../src/services/priceHistory";
import {
  matchSalesToPriceSnapshots,
  summarizeSaleCalibration,
} from "../src/services/saleCalibration";
import { Estimate } from "../src/services/PriceEstimator";
import { MerchantHistoryEntry } from "../src/services/merchantHistory";
import { Poe2Item } from "../src/services/types";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function snapshotItem(): Poe2Item {
  return {
    id: "listing-id",
    listing: {
      price: { amount: 20, currency: "exalted" },
    },
    item: {
      id: "item-id",
      name: "Test Item",
      typeLine: "Test Base",
      league: "Standard",
    },
  } as Poe2Item;
}

function snapshotEstimate(checkedAt: number): Estimate {
  return {
    checkedAt,
    price: {
      amount: 2,
      currency: "chaos",
      lowerPrice: { amount: 24, currency: "exalted" },
    },
    stdDev: { amount: 1, currency: "exalted" },
    comparables: [],
    search: { league: "Standard", explicitCount: 0 },
  };
}

function soldEntry(timestamp: string): MerchantHistoryEntry {
  return {
    id: "sale-id",
    timestamp,
    itemId: "item-id",
    itemName: "Test Item",
    itemTypeLine: "Test Base",
    item: {},
    amount: 30,
    currency: "exalted",
    raw: {},
  };
}

test("persists price snapshots for later sale calibration", () => {
  const storage = new MemoryStorage();
  const snapshot = createPriceSnapshot(
    snapshotItem(),
    snapshotEstimate(Date.parse("2026-07-17T10:00:00Z")),
  );

  savePriceSnapshot(snapshot, storage);
  expect(loadPriceSnapshots(storage)).toEqual([snapshot]);
  expect(snapshot.listed).toEqual({ amount: 20, currency: "exalted" });
});

test("matches a sale to the latest preceding suggestion in its currency", () => {
  const first = createPriceSnapshot(
    snapshotItem(),
    snapshotEstimate(Date.parse("2026-07-17T08:00:00Z")),
  );
  const latest = createPriceSnapshot(
    snapshotItem(),
    snapshotEstimate(Date.parse("2026-07-17T10:00:00Z")),
  );
  const sale = soldEntry("2026-07-17T12:00:00Z");

  const [match] = matchSalesToPriceSnapshots([sale], [first, latest]);
  expect(match.snapshot.id).toBe(latest.id);
  expect(match.suggestedAmount).toBe(24);
  expect(match.percentError).toBe(-20);
  expect(match.hoursToSell).toBe(2);
});

test("keeps sale calibration scoped to the selected league", () => {
  const standard = createPriceSnapshot(
    snapshotItem(),
    snapshotEstimate(Date.parse("2026-07-17T08:00:00Z")),
  );
  const hardcore = {
    ...createPriceSnapshot(
      snapshotItem(),
      snapshotEstimate(Date.parse("2026-07-17T10:00:00Z")),
    ),
    league: "Hardcore",
  };

  const [match] = matchSalesToPriceSnapshots(
    [soldEntry("2026-07-17T12:00:00Z")],
    [standard, hardcore],
    "Standard",
  );

  expect(match.snapshot.id).toBe(standard.id);
});

test("summarizes estimator accuracy across completed sales", () => {
  const snapshot = createPriceSnapshot(
    snapshotItem(),
    snapshotEstimate(Date.parse("2026-07-17T10:00:00Z")),
  );
  const matches = matchSalesToPriceSnapshots(
    [soldEntry("2026-07-17T12:00:00Z")],
    [snapshot],
  );

  expect(summarizeSaleCalibration(matches)).toMatchObject({
    matchedSales: 1,
    medianAbsoluteErrorPercent: 20,
    underpriced: 1,
    overpriced: 0,
    medianHoursToSell: 2,
  });
});
