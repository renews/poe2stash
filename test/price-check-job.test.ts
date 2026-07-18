import { expect, test } from "bun:test";
import {
  getApiRequestProgressLabel,
  getPriceCheckProgressLabel,
  PriceCheckAllItems,
} from "../src/jobs/PriceCheckAllItems";
import { Job } from "../src/jobs/Job";
import {
  Estimate,
  PriceChecker,
} from "../src/services/PriceEstimator";
import { ApiRequestRunOptions } from "../src/services/ApiRequestQueue";
import { Poe2Item } from "../src/services/types";

const item = (overrides: Partial<Poe2Item["item"]> = {}) =>
  ({
    item: {
      name: "",
      typeLine: "Fiery Buckler",
      baseType: "Fiery Buckler",
      ...overrides,
    },
  }) as Poe2Item;

test("shows the current item while a tab price check is running", () => {
  expect(getPriceCheckProgressLabel(2, 4, item())).toBe(
    "Checking item 2 of 4: Fiery Buckler",
  );
  expect(
    getPriceCheckProgressLabel(
      1,
      1,
      item({ name: "Darkness Enthroned", typeLine: "Fine Belt" }),
    ),
  ).toBe("Checking item 1 of 1: Darkness Enthroned");
});

test("shows rate-limit waits and retries during a price check", () => {
  expect(
    getApiRequestProgressLabel({
      status: "retrying",
      attempt: 1,
      delayMs: 2_000,
    }),
  ).toBe("Rate limited; retrying in 2s");
  expect(
    getApiRequestProgressLabel({
      status: "waiting",
      attempt: 0,
      delayMs: 2_500,
    }),
  ).toBe("Waiting 3s for the API rate limit");
  expect(
    getApiRequestProgressLabel({ status: "running", attempt: 1 }),
  ).toBeNull();
});

test("fails a job instead of leaving it running when its task throws", async () => {
  class FailingJob extends Job<number> {
    constructor() {
      super("failing-job", "Failing Job", "Testing failure handling");
    }

    async *_task() {
      yield* [] as number[];
      throw new Error("request failed");
    }
  }

  const job = new FailingJob();
  await expect(job.start()).rejects.toThrow("request failed");
  expect(job.status).toBe("failed");
  expect(job.error).toBe("request failed");
});

test("runs the cancellation handler immediately", () => {
  class CancellableJob extends Job<number> {
    async *_task() {
      yield* [] as number[];
    }
  }

  const job = new CancellableJob(
    "cancellable-job",
    "Cancellable Job",
    "Testing cancellation handling",
  );
  let cancelled = false;
  job.onCancel = async () => {
    cancelled = true;
  };

  job.cancel();

  expect(cancelled).toBe(true);
  expect(job.status).toBe("cancelled");
  expect(job.cancelling).toBe(true);
});

test("aborts in-flight request signals when a job is cancelled", () => {
  class CancellableJob extends Job<number> {
    async *_task() {
      yield* [] as number[];
    }

    get requestSignal() {
      return this.signal;
    }
  }

  const job = new CancellableJob(
    "abortable-job",
    "Abortable Job",
    "Testing request cancellation",
  );

  expect(job.requestSignal.aborted).toBe(false);
  job.cancel();
  expect(job.requestSignal.aborted).toBe(true);
});

test("passes its cancellation signal to price-check requests", async () => {
  type EstimateWithOptions = (
    item: Poe2Item,
    league?: string,
    selection?: never,
    range?: number,
    options?: ApiRequestRunOptions,
  ) => Promise<Estimate>;
  const priceChecker = PriceChecker as unknown as {
    estimateItemPrice: EstimateWithOptions;
  };
  const originalEstimate = priceChecker.estimateItemPrice;
  const originalGetCachedEstimates = PriceChecker.getCachedEstimates;
  let receivedSignal: AbortSignal | undefined;

  PriceChecker.getCachedEstimates = () => ({});

  priceChecker.estimateItemPrice = async (
    _item,
    _league,
    _selection,
    _range,
    options,
  ) => {
    receivedSignal = options?.signal;
    return {
      checkedAt: Date.now(),
      price: { amount: 1, currency: "exalted" },
      stdDev: { amount: 0, currency: "exalted" },
      comparables: [],
      sourceComparableCount: 0,
      excludedComparableCount: 0,
      excludedByReason: {
        invalid: 0,
        duplicateSeller: 0,
        stale: 0,
        outlier: 0,
      },
      confidence: "low",
      method: "median",
    };
  };

  try {
    const job = new PriceCheckAllItems([item()], false);
    await job.start();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  } finally {
    priceChecker.estimateItemPrice = originalEstimate;
    PriceChecker.getCachedEstimates = originalGetCachedEstimates;
  }
});
