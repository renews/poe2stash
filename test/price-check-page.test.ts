import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  getCompletedPriceCheckTradeUrl,
  prepareCopiedItemPreview,
  PriceCheckPageView,
} from "../src/components/PriceCheckPage";
import { parseCopiedItemText } from "../src/services/copiedItemParser";
import type { Estimate } from "../src/services/PriceEstimator";
import { completeModifierSelection } from "../src/services/modifierSelection";

test("presents an accessible manual item-text price check", () => {
  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "",
      selectedLeague: "Runes of Aldur",
      status: "idle",
      shortcutStatus: { registered: true, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain("<h1>Price Check</h1>");
  expect(markup).toContain('for="price-check-item-data"');
  expect(markup).toContain('id="price-check-item-data"');
  expect(markup).toContain(
    'aria-describedby="price-check-item-data-help price-check-status"',
  );
  expect(markup).toContain("Paste item details copied from Path of Exile 2");
  expect(markup).toContain("Ctrl+D");
  expect(markup).toContain("Runes of Aldur");
  expect(markup).toContain("<button");
  expect(markup).toContain("disabled");
  expect(markup).toContain("Check price</button>");
});

test("identifies invalid copied item text with an actionable alert", () => {
  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "not an item",
      selectedLeague: "Standard",
      status: "idle",
      error: "Paste a complete English Path of Exile item description.",
      shortcutStatus: { registered: false, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain('role="alert"');
  expect(markup).toContain(
    "Paste a complete English Path of Exile item description.",
  );
  expect(markup).toContain("Retry price check</button>");
});

test("makes an active price check prominent beyond the submit button", () => {
  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "copied item",
      selectedLeague: "HC Runes of Aldur",
      status: "checking",
      shortcutStatus: { registered: true, shortcut: "Alt+Y" },
      onItemTextChange: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain('data-checking="true"');
  expect(markup).toContain('class="price-check-status__spinner"');
  expect(markup).toContain("Checking price…");
  expect(markup).toContain(
    "Searching comparable listings in HC Runes of Aldur.",
  );
});

test("shows the parsed item and comparable market evidence", () => {
  const item = parseCopiedItemText(`Item Class: Rings
Rarity: Rare
Miracle Grip
Amethyst Ring
--------
Item Level: 74
--------
+90 to maximum Life`);
  const estimate = {
    price: { amount: 11, currency: "exalted" },
    stdDev: { amount: 1, currency: "exalted" },
    confidence: "medium",
    comparables: Array.from({ length: 7 }, (_, index) => ({
      amount: 10 + index,
      currency: "exalted",
      itemId: `item-${index}`,
      listedAmount: 10 + index,
      listedCurrency: "exalted",
    })),
    source: "official-trade",
    method: "median",
    search: {
      league: "Standard",
      strategy: "strict",
      explicitCount: 1,
      explicitHashes: ["explicit.stat_3299347043"],
    },
  } as Estimate;

  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "copied item",
      item,
      estimate,
      modifierSelection: completeModifierSelection(item),
      selectedLeague: "Standard",
      status: "idle",
      shortcutStatus: { registered: true, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onModifierSelectionChange: () => {},
      onOpenOfficialTrade: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain("Miracle Grip");
  expect(markup).toContain("~11 exalted");
  expect(markup).toContain("medium");
  expect(markup).toContain("Comparable listings");
  expect(markup).toContain("+90 to maximum Life");
  expect(markup).toContain("Price check options for Miracle Grip");
  expect(markup).toContain("Official trade");
  expect(markup).toContain("Listing median");
  expect(markup).toContain("Exact selected filters");
  expect(markup).toContain("7 independent sellers");
  expect(markup).toContain(
    "Price check complete. Recommended price ~11 exalted in Standard.",
  );
  expect(markup).toContain("Open official trade</button>");
  expect(markup).not.toContain("Listed price");
});

test("shows exchange identity and independent seller evidence", () => {
  const item = parseCopiedItemText(`Item Class: Stackable Currency
Rarity: Currency
Divine Orb
--------
Stack Size: 1/20`);
  const estimate = {
    price: { amount: 110, currency: "exalted" },
    stdDev: { amount: 0, currency: "exalted" },
    confidence: "low",
    comparables: [],
    sourceComparableCount: 3,
    source: "currency-exchange",
    method: "exchange-median",
    search: {
      league: "Standard",
      strategy: "exchange-exact",
      searchId: "exchange-id",
      tradeTag: "divine",
      paymentCurrency: "exalted",
      explicitCount: 0,
    },
  } as Estimate;

  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "copied currency",
      item,
      estimate,
      modifierSelection: completeModifierSelection(item),
      selectedLeague: "Standard",
      status: "idle",
      shortcutStatus: { registered: true, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onModifierSelectionChange: () => {},
      onOpenOfficialTrade: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain("Official currency exchange");
  expect(markup).toContain("Exchange offer median");
  expect(markup).toContain("Exact exchange identity");
  expect(markup).toContain("3 independent sellers");
  expect(markup).toContain("Exchange sellers");
  expect(markup).toContain("Open official exchange</button>");
  expect(markup).not.toContain(
    "Check this item to load comparable listings.",
  );
});

test("opens completed exchange evidence at its exact official query", () => {
  expect(
    getCompletedPriceCheckTradeUrl(
      {
        price: { amount: 110, currency: "exalted" },
        stdDev: { amount: 0, currency: "exalted" },
        comparables: [],
        source: "currency-exchange",
        method: "exchange-median",
        search: {
          league: "Runes of Aldur",
          strategy: "exchange-exact",
          searchId: "exchange/123",
          explicitCount: 0,
        },
      },
      "Runes of Aldur",
    ),
  ).toBe(
    "https://www.pathofexile.com/trade2/exchange/poe2/Runes%20of%20Aldur/exchange%2F123",
  );
  expect(
    getCompletedPriceCheckTradeUrl(
      {
        price: { amount: 10, currency: "exalted" },
        stdDev: { amount: 1, currency: "exalted" },
        comparables: [],
        source: "official-trade",
        method: "median",
        search: { league: "Runes of Aldur", explicitCount: 0 },
      },
      "Runes of Aldur",
    ),
  ).toBeUndefined();
});

test("does not describe retained trade listings as the Scout price sample", () => {
  const item = parseCopiedItemText(`Item Class: Belts
Rarity: Unique
Darkness Enthroned
Fine Belt
--------
Item Level: 82`);
  const estimate = {
    price: { amount: 42, currency: "exalted" },
    stdDev: { amount: 0, currency: "exalted" },
    confidence: "medium",
    comparables: Array.from({ length: 7 }, (_, index) => ({
      amount: 40 + index,
      currency: "exalted",
      itemId: `item-${index}`,
      listedAmount: 40 + index,
      listedCurrency: "exalted",
    })),
    source: "poe2scout",
    method: "market-history",
    market: {
      itemId: 4993,
      itemName: "Darkness Enthroned",
      price: { amount: 42, currency: "exalted" },
      quantity: 18,
      updatedAt: Date.now(),
      history: [],
    },
    search: { league: "Standard", explicitCount: 0 },
  } as Estimate;

  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "copied unique",
      item,
      estimate,
      modifierSelection: completeModifierSelection(item),
      selectedLeague: "Standard",
      status: "idle",
      shortcutStatus: { registered: true, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onModifierSelectionChange: () => {},
      onOpenOfficialTrade: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain("Poe2Scout");
  expect(markup).toContain("18 market observations");
  expect(markup).not.toContain("Reliable sample");
  expect(markup).not.toContain("independent sellers");
});

test("invalidates a displayed quote when pricing filters change", async () => {
  const source = await Bun.file(
    `${import.meta.dir}/../src/components/PriceCheckPage.tsx`,
  ).text();
  const handler = source.slice(
    source.indexOf("const changeModifierSelection"),
    source.indexOf("const openOfficialTrade"),
  );

  expect(handler).toContain("activeRequest.current?.abort()");
  expect(handler).toContain("setEstimate(undefined)");
  expect(source).toContain("officialTradeRequest.current?.abort()");
  expect(source).toContain("{ signal: controller.signal }");
  expect(source).toContain("if (controller.signal.aborted)");
});

test("names copied modifiers omitted from the price search", () => {
  const item = parseCopiedItemText(`Item Class: Rings
Rarity: Rare
Miracle Grip
Amethyst Ring
--------
Item Level: 74
--------
+90 to maximum Life
82% increased effect of Socketed [Augment] Items`);

  const markup = renderToStaticMarkup(
    createElement(PriceCheckPageView, {
      itemText: "copied item",
      item,
      modifierSelection: {
        ...completeModifierSelection(item),
        explicit: [true, false],
      },
      selectedLeague: "Standard",
      status: "idle",
      shortcutStatus: { registered: true, shortcut: "Ctrl+D" },
      onItemTextChange: () => {},
      onModifierSelectionChange: () => {},
      onOpenOfficialTrade: () => {},
      onSubmit: () => {},
    }),
  );

  expect(markup).toContain("Skipped or unsupported modifiers");
  expect(markup).toContain(
    "82% increased effect of Socketed [Augment] Items",
  );
});

test("prepares recoverable item filters before the remote price check", () => {
  const preview = prepareCopiedItemPreview(
    `Item Class: Rings
Rarity: Rare
Miracle Grip
Amethyst Ring
--------
Item Level: 74
--------
+90 to maximum Life
82% increased effect of Socketed [Augment] Items`,
    "Standard",
  );

  expect(preview.item.item.league).toBe("Standard");
  expect(preview.selection.explicit).toEqual([true, false]);
});

test("gives textareas the shared typography and keyboard focus treatment", async () => {
  const css = await Bun.file(`${import.meta.dir}/../src/index.css`).text();

  expect(css).toMatch(/button,\s*input,\s*select,\s*textarea\s*\{/);
  expect(css).toMatch(
    /input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible,/,
  );
});
