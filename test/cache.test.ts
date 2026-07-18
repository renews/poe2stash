import { expect, test } from "bun:test";
import {
  CACHE_SCHEMA_VERSION,
  CacheService,
} from "../src/services/Cache";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("recovers from malformed cache data and removes its expiry", () => {
  const storage = new MemoryStorage();
  const cache = new CacheService(storage);
  storage.setItem("items", "{");
  storage.setItem("items_expiry", "5000");

  expect(cache.getJson("items")).toBeNull();
  expect(storage.getItem("items")).toBeNull();
  expect(storage.getItem("items_expiry")).toBeNull();
});

test("removes expired cache values and metadata", () => {
  const storage = new MemoryStorage();
  const cache = new CacheService(storage, () => 2_000);
  storage.setItem("items", JSON.stringify(["old-item"]));
  storage.setItem("items_expiry", "1000");

  expect(cache.getJson("items")).toBeNull();
  expect(storage.getItem("items")).toBeNull();
  expect(storage.getItem("items_expiry")).toBeNull();
});

test("writes versioned values while reading legacy values", () => {
  const storage = new MemoryStorage();
  const cache = new CacheService(storage);
  storage.setItem("legacy", JSON.stringify({ value: 1 }));

  expect(cache.getJson("legacy")).toEqual({ value: 1 });

  cache.setJson("current", { value: 2 });
  expect(JSON.parse(storage.getItem("current") || "{}")).toEqual({
    schemaVersion: CACHE_SCHEMA_VERSION,
    data: { value: 2 },
  });
  expect(cache.getJson("current")).toEqual({ value: 2 });
});

test("rejects cache data written by an unsupported schema", () => {
  const storage = new MemoryStorage();
  const cache = new CacheService(storage);
  storage.setItem(
    "future",
    JSON.stringify({
      schemaVersion: CACHE_SCHEMA_VERSION + 1,
      data: { value: 3 },
    }),
  );

  expect(cache.getJson("future")).toBeNull();
  expect(storage.getItem("future")).toBeNull();
});

test("replacing a timed value without a duration clears its old expiry", () => {
  const storage = new MemoryStorage();
  const cache = new CacheService(storage, () => 1_000);

  cache.setJson("value", 1, 100);
  expect(storage.getItem("value_expiry")).toBe("1100");

  cache.setJson("value", 2);
  expect(storage.getItem("value_expiry")).toBeNull();
  expect(cache.getJson("value")).toBe(2);
});
