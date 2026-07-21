import { expect, test } from "bun:test";
import { Leagues } from "../src/data/leagues";
import {
  parseSavedLeague,
  parseSavedModifierRange,
  parseSavedOpenMarketInspectorOnSelect,
  parseSavedPriceCheckCooldown,
} from "../src/contexts/AppContext";
import {
  canStartAccountSync,
  canViewSaleHistory,
  getAccountStatusLabel,
  hasConfiguredAccount,
  shouldOpenConfiguration,
} from "../src/appNavigation";

test("restores a saved league when it is still available", () => {
  expect(parseSavedLeague("HC Runes of Aldur")).toBe("HC Runes of Aldur");
});

test("falls back to the first league for an unknown saved league", () => {
  expect(parseSavedLeague("Old League")).toBe(Leagues[0]);
  expect(parseSavedLeague(null)).toBe(Leagues[0]);
});

test("clamps the saved modifier range to the supported slider limits", () => {
  expect(parseSavedModifierRange("12")).toBe(12);
  expect(parseSavedModifierRange("4")).toBe(5);
  expect(parseSavedModifierRange("101")).toBe(100);
  expect(parseSavedModifierRange(null)).toBe(12);
});

test("defaults a missing price-check cooldown without overriding an explicit zero", () => {
  expect(parseSavedPriceCheckCooldown(null)).toBe(5);
  expect(parseSavedPriceCheckCooldown(" ")).toBe(5);
  expect(parseSavedPriceCheckCooldown("invalid")).toBe(5);
  expect(parseSavedPriceCheckCooldown("-1")).toBe(5);
  expect(parseSavedPriceCheckCooldown("0")).toBe(0);
  expect(parseSavedPriceCheckCooldown("15")).toBe(15);
});

test("opens the market inspector on item selection by default", () => {
  expect(parseSavedOpenMarketInspectorOnSelect(null)).toBe(true);
  expect(parseSavedOpenMarketInspectorOnSelect("true")).toBe(true);
  expect(parseSavedOpenMarketInspectorOnSelect("false")).toBe(false);
  expect(parseSavedOpenMarketInspectorOnSelect("invalid")).toBe(true);
});

test("exposes the market inspector behavior in configuration", async () => {
  const source = await Bun.file(
    `${import.meta.dir}/../src/components/ConfigurationPage.tsx`,
  ).text();

  expect(source).toContain("Open Market Inspector when selecting an item");
  expect(source).toContain("setOpenMarketInspectorOnSelect");
});

test("opens configuration when no account is configured", () => {
  expect(shouldOpenConfiguration("/", "")).toBe(true);
  expect(shouldOpenConfiguration("/", "BoostCoder#0407")).toBe(false);
  expect(shouldOpenConfiguration("/currency-rates", "")).toBe(false);
});

test("only enables account sync for a non-empty account when idle", () => {
  expect(canStartAccountSync("", false)).toBe(false);
  expect(canStartAccountSync("BoostCoder#0407", true)).toBe(false);
  expect(canStartAccountSync("BoostCoder#0407", false)).toBe(true);
});

test("only allows sale history for a configured account", () => {
  expect(canViewSaleHistory("")).toBe(false);
  expect(canViewSaleHistory("   ")).toBe(false);
  expect(canViewSaleHistory("BoostCoder#0407")).toBe(true);
});

test("describes account readiness without claiming a network connection", () => {
  expect(hasConfiguredAccount("   ")).toBe(false);
  expect(hasConfiguredAccount("BoostCoder#0407")).toBe(true);
  expect(getAccountStatusLabel("")).toBe("Setup required");
  expect(getAccountStatusLabel("BoostCoder#0407")).toBe("Account ready");
});
