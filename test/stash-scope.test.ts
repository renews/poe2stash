import { expect, test } from "bun:test";
import {
  getPublicListingStashCounts,
  getPublicListingStashLabel,
} from "../src/services/stashScope";
import { Poe2Item } from "../src/services/types";

function listedItem(id: string, stashName: string) {
  return {
    id,
    listing: {
      stash: { name: stashName },
      price: { amount: 1, currency: "exalted" },
    },
    item: { id },
  } as Poe2Item;
}

test("counts publicly listed items by stash tab", () => {
  const items = [
    listedItem("one", "Shop A"),
    listedItem("two", "Shop A"),
    listedItem("three", "Shop B"),
  ];

  expect(getPublicListingStashCounts(items)).toEqual({
    All: 3,
    "Shop A": 2,
    "Shop B": 1,
  });
});

test("labels the all-items option as public and includes tab counts", () => {
  const counts = { All: 3, "Shop A": 2 };

  expect(getPublicListingStashLabel("All", counts)).toBe(
    "All publicly listed items (3)",
  );
  expect(getPublicListingStashLabel("Shop A", counts)).toBe("Shop A (2)");
});
