import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TradeWorkspace } from "../src/components/TradeWorkspace";
import { Estimate } from "../src/services/PriceEstimator";
import { resolveSelectedItem } from "../src/services/itemSelection";
import {
  createDefaultTradeSidebarVisibility,
  shouldOpenMarketInspectorForSelection,
  toggleTradeSidebar,
} from "../src/services/tradeSidebarState";
import { Poe2Item } from "../src/services/types";

function createItem(id: string, name: string, rarity = "Rare") {
  return {
    id,
    listing: {
      indexed: new Date(2026, 6, 20, 12, 0).toISOString(),
      stash: { name: "~b/o 1 divine", x: 0, y: 0 },
      price: { amount: 2, currency: "chaos" },
    },
    item: {
      id,
      name,
      typeLine: "Sapphire Ring",
      baseType: "Sapphire Ring",
      rarity,
      ilvl: 78,
      icon: "https://example.com/item.png",
      implicitMods: ["+24% to Cold Resistance"],
      explicitMods: ["+37 to maximum Mana"],
    },
  } as Poe2Item;
}

const estimate = {
  price: { amount: 3, currency: "chaos" },
  stdDev: { amount: 0.5, currency: "chaos" },
  comparables: [],
  confidence: "high",
  search: { explicitCount: 1 },
} as Estimate;

test("falls back to the first visible item when selection leaves the filter", () => {
  const items = [
    createItem("first", "Doom Loop"),
    createItem("second", "Rune Ward"),
  ];

  expect(resolveSelectedItem(items, "second")).toBe(items[1]);
  expect(resolveSelectedItem(items, "missing")).toBe(items[0]);
  expect(resolveSelectedItem([], "missing")).toBeUndefined();
});

test("renders toggleable sales sidebars with the inspector collapsed by default", () => {
  const item = createItem("first", "Doom Loop");
  const markup = renderToStaticMarkup(
    createElement(TradeWorkspace, {
      items: [item],
      allItems: [item],
      stashTabs: ["All", "~b/o 1 divine"],
      selectedStash: "All",
      priceEstimates: { first: estimate },
      modifierSelections: {},
      league: "Standard",
      openMarketInspectorOnSelect: true,
      isPriceChecking: false,
      onStashSelect: () => {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
    }),
  );

  expect(markup).toContain('aria-label="Filter sales by stash tab"');
  expect(markup).toContain('aria-labelledby="your-sales-title"');
  expect(markup).toContain("Your sales");
  expect(markup).toContain("<dt>Price checked</dt><dd>1</dd>");
  expect(markup).not.toContain("<dt>Priced</dt>");
  expect(markup).not.toContain("Public listings");
  expect(markup).not.toContain("Public stash tabs");
  expect(markup).toContain('data-stash-sidebar="open"');
  expect(markup).toContain('data-market-sidebar="closed"');
  expect(markup).toContain('aria-label="Hide stash tabs"');
  expect(markup).toContain('aria-controls="sales-stash-tabs"');
  expect(markup).toContain('aria-label="Show market inspector"');
  expect(markup).toContain('aria-controls="market-inspector"');
  expect(markup).toContain('id="market-inspector"');
  expect(markup).toContain('aria-labelledby="market-inspector-title"');
  expect(markup).toContain('aria-label="Inspect Doom Loop"');
  expect(markup).toContain('aria-pressed="true"');
  expect(markup).toContain('data-rarity="rare"');
  expect(markup).toContain("2 chaos");
  expect(markup).toContain("~3 chaos");
  expect(markup).toContain('aria-label="Price check Doom Loop"');

  const stashSidebar = markup.match(
    /<(?:nav)[^>]*id="sales-stash-tabs"[^>]*>/,
  )?.[0];
  const marketSidebar = markup.match(
    /<(?:aside)[^>]*id="market-inspector"[^>]*>/,
  )?.[0];
  const stashToggle = markup.match(
    /<button[^>]*aria-label="Hide stash tabs"[^>]*>/,
  )?.[0];
  const marketToggle = markup.match(
    /<button[^>]*aria-label="Show market inspector"[^>]*>/,
  )?.[0];
  expect(stashSidebar).toBeDefined();
  expect(stashSidebar).not.toContain('hidden=""');
  expect(marketSidebar).toContain('hidden=""');
  expect(stashToggle).toContain('aria-expanded="true"');
  expect(marketToggle).toContain('aria-expanded="false"');
});

test("toggles either sales sidebar without changing the other", () => {
  const initial = createDefaultTradeSidebarVisibility();
  const marketOpen = toggleTradeSidebar(initial, "market");
  const stashClosed = toggleTradeSidebar(marketOpen, "stash");

  expect(initial).toEqual({ stash: true, market: false });
  expect(marketOpen).toEqual({ stash: true, market: true });
  expect(stashClosed).toEqual({ stash: false, market: true });
});

test("opens the inspector for a different item only when configured", () => {
  expect(
    shouldOpenMarketInspectorForSelection("first", "second", true),
  ).toBe(true);
  expect(
    shouldOpenMarketInspectorForSelection("first", "first", true),
  ).toBe(false);
  expect(
    shouldOpenMarketInspectorForSelection("first", "second", false),
  ).toBe(false);
});

test("does not render a stray zero when the selected item has no modifiers", () => {
  const item = createItem("plain", "Plain Ring", "Normal");
  item.item.implicitMods = [];
  item.item.explicitMods = [];

  const markup = renderToStaticMarkup(
    createElement(TradeWorkspace, {
      items: [item],
      allItems: [item],
      stashTabs: ["All"],
      selectedStash: "All",
      priceEstimates: {},
      modifierSelections: {},
      league: "Standard",
      openMarketInspectorOnSelect: true,
      isPriceChecking: false,
      onStashSelect: () => {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
    }),
  );

  expect(markup).not.toContain("</section>0<button");
});

test("uses the statistical median for an even number of comparables", () => {
  const item = createItem("even", "Doom Loop");
  const lowerComparable = createItem("lower", "Foe Halo", "Magic");
  const upperComparable = createItem("upper", "Rune Knot", "Rare");
  const evenEstimate = {
    ...estimate,
    comparables: [
      {
        amount: 2,
        currency: "exalted",
        itemId: lowerComparable.id,
        listedAmount: 1,
        listedCurrency: "divine",
        item: lowerComparable,
      },
      {
        amount: 10,
        currency: "exalted",
        itemId: upperComparable.id,
        listedAmount: 10,
        listedCurrency: "exalted",
        item: upperComparable,
      },
    ],
  } as Estimate;

  const markup = renderToStaticMarkup(
    createElement(TradeWorkspace, {
      items: [item],
      allItems: [item],
      stashTabs: ["All"],
      selectedStash: "All",
      priceEstimates: { even: evenEstimate },
      modifierSelections: {},
      league: "Standard",
      openMarketInspectorOnSelect: true,
      isPriceChecking: false,
      onStashSelect: () => {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
    }),
  );

  expect(markup).toContain("<dt>Minimum</dt><dd>2 exalted</dd>");
  expect(markup).toContain("<dt>Median</dt><dd>6 exalted</dd>");
  expect(markup).toContain("<dt>Maximum</dt><dd>10 exalted</dd>");
  expect(markup).toContain('aria-label="Recent market range"');
  expect(markup).not.toContain("market-range__currency");
  expect(markup).not.toContain("market-summary__hero");
  const listedPriceIndex = markup.indexOf("<dt>Listed price</dt>");
  const recommendedPriceIndex = markup.indexOf("<dt>Recommended price</dt>");
  const confidenceIndex = markup.indexOf("<dt>Confidence</dt>");
  const comparableCountIndex = markup.indexOf("<dt>Comparable listings</dt>");
  expect(listedPriceIndex).toBeLessThan(recommendedPriceIndex);
  expect(recommendedPriceIndex).toBeLessThan(confidenceIndex);
  expect(confidenceIndex).toBeLessThan(comparableCountIndex);
  expect(markup).toContain('aria-label="Comparable listings"');
  expect(markup).toContain('aria-label="View details for Foe Halo"');
  expect(markup).toContain('aria-label="View details for Rune Knot"');
  expect(markup).toContain('<span class="market-comparable__name">Foe Halo</span>');
  expect(markup).toContain('<span class="market-comparable__name">Rune Knot</span>');
  expect(markup).toContain('<span class="market-comparable__price">1 divine</span>');
  expect(markup).toContain('<span class="market-comparable__price">10 exalted</span>');
});

test("does not combine comparable amounts from different currencies", () => {
  const item = createItem("mixed", "Doom Loop");
  const mixedEstimate = {
    ...estimate,
    comparables: [
      { amount: 2, currency: "chaos" },
      { amount: 10, currency: "exalted" },
    ],
  } as Estimate;

  const markup = renderToStaticMarkup(
    createElement(TradeWorkspace, {
      items: [item],
      allItems: [item],
      stashTabs: ["All"],
      selectedStash: "All",
      priceEstimates: { mixed: mixedEstimate },
      modifierSelections: {},
      league: "Standard",
      openMarketInspectorOnSelect: true,
      isPriceChecking: false,
      onStashSelect: () => {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
    }),
  );

  expect(markup).toContain("Mixed comparable currencies cannot be combined.");
  expect(markup).not.toContain("<dt>Median</dt>");
});
