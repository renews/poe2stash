import { expect, test } from "bun:test";
import {
  getSavedChatFilePath,
  saveChatFilePath,
} from "../src/services/ChatService";
import { getStableConfigPath } from "../electron/app/config";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

test("persists and restores the selected chat log path", () => {
  const storage = createMemoryStorage();
  const path = "/home/coder/.local/share/Path of Exile 2/Client.txt";

  saveChatFilePath(path, storage);

  expect(getSavedChatFilePath(storage)).toBe(path);
});

test("ignores an empty saved chat log path", () => {
  const storage = createMemoryStorage();
  storage.setItem("chatFilePath", "   ");

  expect(getSavedChatFilePath(storage)).toBeUndefined();
});

test("uses a stable per-user config path", () => {
  expect(getStableConfigPath("/home/coder", undefined)).toBe(
    "/home/coder/.config/poe-dash/config.json",
  );
  expect(getStableConfigPath("/home/coder", "/tmp/config")).toBe(
    "/tmp/config/poe-dash/config.json",
  );
});
