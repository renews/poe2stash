import { expect, test } from "bun:test";
import { formatItemMod } from "../src/services/types";

test("formats structured Path of Exile 2 modifiers for display", () => {
  expect(
    formatItemMod({
      description: "+5 to Spirit",
      hash: "stat_hash",
      mods: [],
    }),
  ).toBe("+5 to Spirit");
});
