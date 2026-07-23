import { expect, test } from "bun:test";
import { parseModifierSelections } from "../src/contexts/AppContext";

test("restores valid modifier selections and ignores invalid saved entries", () => {
  expect(
    parseModifierSelections(
      JSON.stringify({
        "item-1": {
          explicit: [true, false],
          implicit: [true],
          itemLevel: true,
          requiredLevel: true,
          requiredLevelMin: 60,
          requiredLevelMax: 70,
          runeSockets: true,
          runeSocketCount: 2,
        },
        invalid: { explicit: "not-an-array", implicit: [] },
      }),
    ),
  ).toEqual({
    "item-1": {
      explicit: [true, false],
      implicit: [true],
      itemLevel: true,
      requiredLevel: true,
      requiredLevelMin: 60,
      requiredLevelMax: 70,
      runeSockets: true,
      runeSocketCount: 2,
    },
  });
});

test("ignores saved modifier selections with invalid requirement ranges", () => {
  expect(
    parseModifierSelections(
      JSON.stringify({
        invalid: {
          explicit: [],
          implicit: [],
          requiredLevel: true,
          requiredLevelMin: "sixty",
        },
      }),
    ),
  ).toEqual({});
});

test("ignores saved modifier selections with invalid rune socket counts", () => {
  expect(
    parseModifierSelections(
      JSON.stringify({
        invalid: {
          explicit: [],
          implicit: [],
          runeSockets: true,
          runeSocketCount: "three",
        },
      }),
    ),
  ).toEqual({});
});

test("returns no selections for missing or invalid storage", () => {
  expect(parseModifierSelections(null)).toEqual({});
  expect(parseModifierSelections("not-json")).toEqual({});
  expect(parseModifierSelections(JSON.stringify([]))).toEqual({});
});
