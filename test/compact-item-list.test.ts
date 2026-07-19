import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CompactItemNameButton,
  CompactItemList,
  ItemViewToggle,
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
  expect(markup).toContain("On sale since");
  expect(markup).toContain("07.18.2026 14:30");
  expect(markup).toContain("Unknown");
  expect(markup).not.toContain("Already with a great price!");
  expect(markup).toContain(
    'class="whitespace-nowrap text-green-400">Great price!',
  );
  expect(markup).toContain("Action");
  expect(markup).toContain('aria-label="Price check Doom Loop"');
  expect(markup).toContain('aria-label="Price check stash Alpha"');
  expect(markup).toContain('aria-label="Price check stash Shop"');
  expect(markup.indexOf("Alpha (1 item)")).toBeLessThan(
    markup.indexOf("Shop (2 items)"),
  );
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
    /aria-label="Doom Loop prices" class="([^"]+)"/,
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
  item.item.implicitMods = ["+10 to maximum Life"];
  item.item.explicitMods = [
    "+25 to maximum Energy Shield",
    "+20% to Fire Resistance",
  ];

  const markup = renderToStaticMarkup(
    createElement(ItemPriceCheckOptions, {
      item,
      modifierSelection: {
        implicit: [true],
        explicit: [true, false],
        itemLevel: false,
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
  expect(markup).toContain("Implicit Mods:");
  expect(markup).toContain("+10 to maximum Life");
  expect(markup).toContain("Explicit Mods:");
  expect(markup).toContain("+20% to Fire Resistance");
  expect(detailedSource).toContain("<ItemPriceCheckOptions");
  expect(compactSource).toContain("<ItemPriceCheckOptions");
  expect(mainPageSource).toContain(
    "onModifierSelectionChange={setModifierSelection}",
  );
});

test("offers compact view without removing the detailed view", async () => {
  const toggleMarkup = renderToStaticMarkup(
    createElement(ItemViewToggle, {
      value: "detailed",
      onChange: () => {},
    }),
  );
  const mainPageSource = await Bun.file(
    `${import.meta.dir}/../src/components/MainPage.tsx`,
  ).text();

  expect(toggleMarkup).toContain("Detailed");
  expect(toggleMarkup).toContain("Compact");
  expect(toggleMarkup).toContain('aria-pressed="true"');
  expect(mainPageSource).toContain("<PoeListItem");
  expect(mainPageSource).toContain("<CompactItemList");
  expect(mainPageSource).toContain(
    'React.useState<ItemViewMode>("compact")',
  );
  expect(mainPageSource).toContain("onPriceCheck={priceCheckItem}");
  expect(mainPageSource).toContain("onStashPriceCheck={priceCheckItems}");
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
