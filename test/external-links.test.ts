import { expect, test } from "bun:test";
import {
  createTradeSearchUrl,
  isAllowedExternalUrl,
} from "../src/services/externalLinks";

test("builds and validates official trade search links", () => {
  const url = createTradeSearchUrl("HC Runes of Aldur", "query/123");

  expect(url).toBe(
    "https://www.pathofexile.com/trade2/search/poe2/HC%20Runes%20of%20Aldur/query%2F123",
  );
  expect(isAllowedExternalUrl(url)).toBe(true);
  expect(
    isAllowedExternalUrl("https://example.com/trade2/search/poe2/test"),
  ).toBe(false);
  expect(isAllowedExternalUrl("not a URL")).toBe(false);
});
