import { expect, test } from "bun:test";
import {
  getListingSinceDateTime,
  getListingSinceLabel,
} from "../src/services/listing";

test("formats the listing timestamp in local date and time", () => {
  const localTime = new Date(2026, 6, 18, 14, 30);

  expect(getListingSinceLabel(localTime.toISOString())).toBe(
    "On sale since: 07.18.2026 14:30",
  );
  expect(getListingSinceLabel("not-a-date")).toBeUndefined();
  expect(getListingSinceLabel(undefined)).toBeUndefined();
});

test("formats the listing timestamp for a compact table cell", () => {
  const localTime = new Date(2026, 6, 18, 14, 30);

  expect(getListingSinceDateTime(localTime.toISOString())).toBe(
    "07.18.2026 14:30",
  );
  expect(getListingSinceDateTime(undefined)).toBeUndefined();
});
