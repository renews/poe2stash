import { expect, test } from "bun:test";
import {
  getAccountItemDetailsCacheKey,
  getAccountItemsCacheKey,
} from "../src/services/accountCache";

test("isolates account item caches by league", () => {
  expect(getAccountItemsCacheKey("Account#1234", "Standard")).not.toBe(
    getAccountItemsCacheKey("Account#1234", "HC Runes of Aldur"),
  );
  expect(getAccountItemDetailsCacheKey("Account#1234", "Standard")).not.toBe(
    getAccountItemDetailsCacheKey("Account#1234", "HC Runes of Aldur"),
  );
});

test("normalizes surrounding whitespace in account cache keys", () => {
  expect(getAccountItemsCacheKey(" Account#1234 ", " Standard ")).toBe(
    getAccountItemsCacheKey("Account#1234", "Standard"),
  );
});
