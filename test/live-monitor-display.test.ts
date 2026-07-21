import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import LiveMonitor from "../src/components/LiveMonitor";
import { PriceChecker } from "../src/services/PriceEstimator";

function renderMonitor(
  status: "unavailable" | "starting" | "watching" | "paused" | "disconnected",
) {
  return renderToStaticMarkup(
    createElement(LiveMonitor, {
      items: [],
      priceSuggestions: {},
      league: "Standard",
      status,
      onToggle: () => {},
    }),
  );
}

test("keeps the compact live footer visible with an honest state", () => {
  const pausedMarkup = renderMonitor("paused");
  const watchingMarkup = renderMonitor("watching");
  const connectingMarkup = renderMonitor("starting");
  const disconnectedMarkup = renderMonitor("disconnected");

  expect(pausedMarkup).toStartWith("<footer");
  expect(pausedMarkup).toContain("Live monitor");
  expect(pausedMarkup).toContain("Paused");
  expect(watchingMarkup).toContain("Watching");
  expect(connectingMarkup).toContain("Connecting");
  expect(disconnectedMarkup).toContain("Disconnected");
  expect(pausedMarkup).toContain("0.00 exalted");
  expect(pausedMarkup).not.toContain("Suggested 0.00 exalted/hr");
});

test("keeps elapsed monitor time out of the visible footer", () => {
  const markup = renderToStaticMarkup(
    createElement(LiveMonitor, {
      items: [],
      priceSuggestions: {},
      league: "Standard",
      status: "paused",
      onToggle: () => {},
    }),
  );

  expect(markup).not.toContain("Time elapsed");
  expect(markup).toContain("New items");
});

test("reselects the currency for the derived listed value per hour", async () => {
  const originalExchangeRate = PriceChecker.exchangeRate;
  PriceChecker.exchangeRate = async (iWant, iHave) => {
    if (iWant === "exalted" && iHave === "chaos") return 75;
    if (iWant === "chaos" && iHave === "divine") return 6;
    if (iWant === "divine" && iHave === "mirror") return 100;
    return 1;
  };

  try {
    await expect(
      PriceChecker.upscalePricePerHour(
        {
          amount: 1,
          currency: "divine",
          lowerPrice: {
            amount: 6,
            currency: "chaos",
            lowerPrice: { amount: 450, currency: "exalted" },
          },
        },
        30 * 60 * 1000,
        "Standard",
      ),
    ).resolves.toMatchObject({ amount: 2, currency: "divine" });
  } finally {
    PriceChecker.exchangeRate = originalExchangeRate;
  }
});

test("renders the live footer at app level without a visibility condition", async () => {
  const [appSource, mainPageSource] = await Promise.all([
    Bun.file(`${import.meta.dir}/../src/App.tsx`).text(),
    Bun.file(`${import.meta.dir}/../src/components/MainPage.tsx`).text(),
  ]);

  expect(appSource).toContain("<LiveMonitor\n");
  expect(appSource).not.toContain("{isLiveMonitoring && (");
  expect(mainPageSource).not.toContain("<LiveMonitor\n");
});
