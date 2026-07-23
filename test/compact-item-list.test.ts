import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompactItemNameButton,
  CompactItemList,
} from "../src/components/CompactItemList";
import { ItemPriceCheckOptions } from "../src/components/ItemPriceCheckOptions";
import { PoeListItem } from "../src/components/PoeListItem";
import { Estimate } from "../src/services/PriceEstimator";
import { toggleExpandedItemIds } from "../src/services/compactItemState";
import { groupItemsByStash } from "../src/services/stashScope";
import { Poe2Item } from "../src/services/types";

function createItem(
  id: string,
  stashName: string,
  name: string,
  amount: number,
  currency: string,
) {
  return {
    id,
    listing: {
      stash: { name: stashName, x: 0, y: 0 },
      price: { amount, currency },
    },
    item: {
      id,
      name,
      typeLine: name,
      baseType: name,
      rarity: "Rare",
    },
  } as Poe2Item;
}

test("groups compact items by naturally sorted stash name", () => {
  const items = [
    createItem("third", "Shop 10", "Third Item", 3, "chaos"),
    createItem("first", "alpha", "First Item", 1, "chaos"),
    createItem("second", "Shop 2", "Second Item", 2, "chaos"),
  ];

  expect(
    groupItemsByStash(items).map((group) => ({
      stashName: group.stashName,
      itemIds: group.items.map((item) => item.id),
    })),
  ).toEqual([
    { stashName: "alpha", itemIds: ["first"] },
    { stashName: "Shop 2", itemIds: ["second"] },
    { stashName: "Shop 10", itemIds: ["third"] },
  ]);
});

test("renders one compact price row per item inside stash accordions", () => {
  const items = [
    createItem("second", "Shop", "Doom Loop", 2, "chaos"),
    createItem("first", "Alpha", "Rune Ward", 120, "exalted"),
    createItem("third", "Shop", "Spirit Shelter", 1, "divine"),
  ];
  items[0].listing.indexed = new Date(2026, 6, 18, 14, 30).toISOString();
  const priceEstimates = {
    second: {
      price: { amount: 3, currency: "chaos" },
    } as Estimate,
    third: {
      price: { amount: 1, currency: "divine" },
      matchesCurrentPrice: true,
    } as Estimate,
  };

  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items,
      priceEstimates,
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );

  expect(markup).toContain('aria-label="Compact item list"');
  expect(markup).toContain("Alpha (1 item)");
  expect(markup).toContain("Shop (2 items)");
  expect(markup).toContain('aria-label="Doom Loop prices"');
  expect(markup).toContain("2 chaos");
  expect(markup).toContain("~3 chaos");
  expect(markup).toContain("Not checked");
  expect(markup).toContain("Great price!");
  expect(markup).toContain("Age");
  expect(markup).toContain('title="On sale since: 07.18.2026 14:30"');
  expect(markup).not.toContain(">07.18.2026 14:30<");
  expect(markup).toContain("Unknown");
  expect(markup).not.toContain("Already with a great price!");
  expect(markup).toContain(
    'data-price-status="matches" class="whitespace-nowrap suggested-price">Great price!',
  );
  expect(markup).toContain("Action");
  expect(markup).toContain('aria-label="Price check Doom Loop"');
  expect(markup).toContain('aria-label="Price check stash Alpha"');
  expect(markup).toContain('aria-label="Price check stash Shop"');
  expect(markup.indexOf("Alpha (1 item)")).toBeLessThan(
    markup.indexOf("Shop (2 items)"),
  );
});

test("shows the level of a synced gem from its item properties", () => {
  const gem = createItem("gem", "Shop", "Spark", 1, "divine");
  gem.item.rarity = "Gem";
  gem.item.frameType = 4;
  gem.item.properties = [
    { name: "Level", values: [["20 (Max)", 0]], displayMode: 0 },
  ];

  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items: [gem],
      priceEstimates: {},
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );

  expect(markup).toContain("Gem level 20");
});

test("distinguishes failed price checks from items that were never checked", () => {
  const failed = createItem("failed", "Shop", "Failed Ring", 2, "chaos");
  const unchecked = createItem(
    "unchecked",
    "Shop",
    "Unchecked Ring",
    3,
    "chaos",
  );

  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items: [failed, unchecked],
      priceEstimates: {
        failed: {
          price: { amount: 4, currency: "chaos" },
        } as Estimate,
      },
      priceCheckErrors: {
        failed: "No comparable listings found in the selected league.",
      },
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );

  expect(markup).toContain('data-price-status="failed"');
  expect(markup).toContain(">Unavailable<");
  expect(markup).toContain(">Failed<");
  expect(markup).toContain(">Retry<");
  expect(markup).toContain(
    'title="No comparable listings found in the selected league."',
  );
  expect(markup).toContain('data-price-status="unchecked"');
  expect(markup).toContain("Not checked");
  expect(markup).toContain(">Unchecked<");
});

test("colors only the age cell when a listing becomes aging or stale", () => {
  const aging = createItem("aging", "Shop", "Aging Item", 2, "chaos");
  const stale = createItem("stale", "Shop", "Stale Item", 2, "chaos");
  aging.listing.indexed = new Date(
    Date.now() - 5 * 24 * 60 * 60 * 1000,
  ).toISOString();
  stale.listing.indexed = new Date(
    Date.now() - 10 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items: [aging, stale],
      priceEstimates: {},
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );

  expect(markup).toContain('data-age-status="aging"');
  expect(markup).toContain('aria-label="5d, aging listing"');
  expect(markup).toContain('data-age-status="stale"');
  expect(markup).toContain('aria-label="10d, stale listing"');
  expect(markup).not.toContain('class="compact-price-grid trade-row trade-age');
});

test("reserves status color for suggested-price meaning", () => {
  const items = [
    createItem("review", "Shop", "Doom Loop", 2, "chaos"),
    createItem("match", "Shop", "Rune Ward", 1, "divine"),
  ];
  const priceEstimates = {
    review: {
      price: { amount: 3, currency: "chaos" },
    } as Estimate,
    match: {
      price: { amount: 1, currency: "divine" },
      matchesCurrentPrice: true,
    } as Estimate,
  };

  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items,
      priceEstimates,
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );

  expect(markup).toContain('class="whitespace-nowrap listing-price"');
  expect(markup).toContain(
    'data-price-status="review" class="whitespace-nowrap suggested-price"',
  );
  expect(markup).toContain(
    'data-price-status="matches" class="whitespace-nowrap suggested-price"',
  );
  expect(markup).toContain("app-button--quiet");
});

test("uses a text-only item-name toggle for compact price-check options", () => {
  const markup = renderToStaticMarkup(
    createElement(CompactItemNameButton, {
      itemName: "Doom Loop",
      rarity: "Rare",
      expanded: false,
      onToggle: () => {},
    }),
  );

  expect(markup).toContain(
    'aria-label="Edit price check options for Doom Loop"',
  );
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain("Doom Loop");
  const buttonClassName = markup.match(/<button[^>]+class="([^"]+)"/)?.[1];
  expect(buttonClassName).toContain("bg-transparent");
  expect(buttonClassName).toContain("hover:bg-transparent");
  expect(buttonClassName).toContain("border-0");
  expect(buttonClassName).toContain("p-0");
  expect(buttonClassName).not.toContain("bg-gray");
  expect(buttonClassName).not.toContain("bg-blue");
  expect(markup).toContain('style="background:none;border:0;padding:0"');
});

test("does not paint a compact item row when its name is hovered", () => {
  const item = createItem("row", "Shop", "Doom Loop", 2, "chaos");
  const markup = renderToStaticMarkup(
    createElement(CompactItemList, {
      items: [item],
      priceEstimates: {},
      modifierSelections: {},
      onPriceCheck: async () => {},
      onModifierSelectionChange: () => {},
      onStashPriceCheck: async () => {},
      isPriceChecking: false,
    }),
  );
  const rowClassName = markup.match(
    /aria-label="Doom Loop prices"[^>]*class="([^"]+)"/,
  )?.[1];

  expect(rowClassName).toBeDefined();
  expect(rowClassName).not.toContain("hover:bg-");
});

test("toggles compact price-check options without mutating existing state", () => {
  const initial = new Set<string>();
  const expanded = toggleExpandedItemIds(initial, "item-1");
  const collapsed = toggleExpandedItemIds(expanded, "item-1");

  expect(initial.has("item-1")).toBe(false);
  expect(expanded.has("item-1")).toBe(true);
  expect(collapsed.has("item-1")).toBe(false);
});

test("shares the detailed modifier editor with the compact view", async () => {
  const item = createItem("mods", "Shop", "Doom Loop", 2, "chaos");
  item.item.ilvl = 82;
  item.item.sockets = [{}, {}, {}];
  item.item.implicitMods = ["+10 to maximum Life"];
  item.item.explicitMods = [
    {
      description: "+25 to maximum Energy Shield",
      hash: "energy-shield",
      mods: [{ tier: "P3" }],
    },
    {
      description: "+20% to Fire Resistance",
      hash: "fire-resistance",
      mods: [{ tier: "S2" }],
    },
  ];

  const markup = renderToStaticMarkup(
    createElement(ItemPriceCheckOptions, {
      item,
      modifierSelection: {
        implicit: [true],
        explicit: [true, false],
        itemLevel: false,
        runeSockets: true,
        runeSocketCount: 2,
      },
      onModifierSelectionChange: () => {},
    }),
  );
  const detailedSource = await Bun.file(
    `${import.meta.dir}/../src/components/PoeListItem.tsx`,
  ).text();
  const compactSource = await Bun.file(
    `${import.meta.dir}/../src/components/CompactItemList.tsx`,
  ).text();
  const mainPageSource = await Bun.file(
    `${import.meta.dir}/../src/components/MainPage.tsx`,
  ).text();

  expect(markup).toContain('aria-label="Price check options for Doom Loop"');
  expect(markup).toContain("Item level (minimum): 82");
  expect(markup).toContain("Rune sockets (minimum)");
  expect(markup).toContain('aria-label="Minimum rune sockets"');
  expect(markup).toContain('value="2"');
  expect(markup).toContain("Implicit Mods:");
  expect(markup).toContain("+10 to maximum Life");
  expect(markup).toContain("Explicit Mods:");
  expect(markup).toContain("+20% to Fire Resistance");
  expect(markup).toContain('aria-label="Prefix tier 3"');
  expect(markup).toContain(">P3<");
  expect(markup).toContain('aria-label="Suffix tier 2"');
  expect(markup).toContain(">S2<");
  expect(detailedSource).toContain("<ItemPriceCheckOptions");
  expect(compactSource).toContain("<ItemPriceCheckOptions");
  expect(mainPageSource).toContain(
    "onModifierSelectionChange={setModifierSelection}",
  );
});

test("lets users include or exclude rune and enchant price filters", () => {
  const item = createItem("enchanted", "Shop", "Rune Hood", 2, "chaos");
  item.item.enchantMods = [
    "8% increased Reservation Efficiency of Minion Skills",
  ];

  const markup = renderToStaticMarkup(
    createElement(ItemPriceCheckOptions, {
      item,
      modifierSelection: {
        implicit: [],
        explicit: [],
        enchant: [false],
      },
      onModifierSelectionChange: () => {},
    }),
  );

  expect(markup).toContain(
    'aria-label="Include enchant modifier: 8% increased Reservation Efficiency of Minion Skills"',
  );
});

test("uses the compact sales workspace as the single main view", async () => {
  const mainPageSource = await Bun.file(
    `${import.meta.dir}/../src/components/MainPage.tsx`,
  ).text();

  expect(mainPageSource).toContain("<TradeWorkspace");
  expect(mainPageSource).not.toContain("<ItemViewToggle");
  expect(mainPageSource).not.toContain("<PoeListItem");
  expect(mainPageSource).not.toContain("ItemViewMode");
  expect(mainPageSource).not.toContain("Detailed sales");
  const workspaceSource = await Bun.file(
    `${import.meta.dir}/../src/components/TradeWorkspace.tsx`,
  ).text();
  expect(workspaceSource).toContain("<CompactItemList");
  expect(mainPageSource).toContain("onPriceCheck={priceCheckItem}");
  expect(mainPageSource).toContain("onStashPriceCheck={priceCheckItems}");
});

test("reconciles sold listings on refresh and prices the full loaded inventory", async () => {
  const contextSource = await Bun.file(
    `${import.meta.dir}/../src/contexts/AppContext.tsx`,
  ).text();

  expect(contextSource).toContain("await getItems(accountName);");
  expect(contextSource).toContain('if (sync.status !== "done")');
  expect(contextSource).toContain("await priceCheckItems(accountItems);");
  expect(contextSource).not.toContain("await priceCheckItems(filteredItems);");
});

test("uses the current-price color for a great detailed suggestion", () => {
  const item = createItem("great", "Shop", "Perfect Loop", 2, "chaos");
  const estimate = {
    price: { amount: 2, currency: "chaos" },
    matchesCurrentPrice: true,
  } as Estimate;
  const markup = renderToStaticMarkup(
    createElement(PoeListItem, {
      item,
      league: "Standard",
      priceSuggestion: estimate.price,
      priceEstimate: estimate,
    }),
  );

  expect(markup).toContain("Great price!");
  expect(markup).not.toContain("Already with a great price!");
  expect(markup).toContain('class="font-normal text-green-600">Great price!');
});
