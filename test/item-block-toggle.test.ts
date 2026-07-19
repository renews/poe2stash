import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemNameWithRarity } from "../src/components/PoeListItem";
import { Poe2Item } from "../src/services/types";

test("uses the item name and a chevron as the accessible block toggle", () => {
  const item = {
    item: { name: "Doom Loop", rarity: "Rare" },
  } as Poe2Item;
  const expanded = renderToStaticMarkup(
    createElement(ItemNameWithRarity, {
      item,
      expanded: true,
      onToggle: () => {},
    }),
  );
  const collapsed = renderToStaticMarkup(
    createElement(ItemNameWithRarity, {
      item,
      expanded: false,
      onToggle: () => {},
    }),
  );

  expect(expanded).toContain('aria-expanded="true"');
  expect(expanded).toContain('aria-label="Collapse Doom Loop"');
  expect(expanded).toContain("lucide-chevron-down");
  expect(expanded).toContain("Doom Loop");
  expect(expanded).not.toContain(">Collapse item<");
  expect(collapsed).toContain('aria-expanded="false"');
  expect(collapsed).toContain('aria-label="Expand Doom Loop"');
  expect(collapsed).toContain("-rotate-90");
});
