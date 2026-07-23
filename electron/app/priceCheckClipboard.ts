import {
  DEFAULT_PRICE_CHECK_SHORTCUT,
  DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
  type PriceCheckShortcutBinding,
  type PriceCheckShortcutKey,
} from "../../src/services/priceCheckShortcut";

export const LIVE_PRICE_CHECK_SHORTCUT_LABEL = DEFAULT_PRICE_CHECK_SHORTCUT;
export const LIVE_PRICE_CHECK_KEYCODE =
  DEFAULT_PRICE_CHECK_SHORTCUT_BINDING.keycode;
const PATH_OF_EXILE_STEAM_WINDOW_CLASSES = new Set([
  "steamapp238960",
  "steamapp2694490",
]);

interface PriceCheckClipboardDependencies {
  readText: () => string;
  writeText: (text: string) => void;
  pressCopy: () => void | Promise<void>;
  wait?: (milliseconds: number) => Promise<void>;
}

interface PriceCheckClipboardOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  clipboardMarker?: string;
}

type PoeCopyKey = PriceCheckShortcutKey | "Ctrl" | "Alt" | "Meta" | "Shift";

interface PoeCopyKeyboard {
  keyUp: (key: PoeCopyKey) => void;
  keyDown: (key: PoeCopyKey) => void;
  keyTap: (key: PoeCopyKey) => void;
  wait?: (milliseconds: number) => Promise<void>;
}

const defaultWait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createBufferedPriceCheckChannel() {
  const pendingItems: string[] = [];
  const listeners = new Set<(itemText: string) => void>();

  return {
    publish(itemText: string) {
      if (!listeners.size) {
        pendingItems.push(itemText);
        return;
      }
      listeners.forEach((listener) => listener(itemText));
    },
    subscribe(listener: (itemText: string) => void) {
      listeners.add(listener);
      pendingItems.splice(0).forEach((itemText) => listener(itemText));
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function isPriceCheckShortcutEvent(
  event: {
    keycode: number;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  shortcut: Pick<
    PriceCheckShortcutBinding,
    "keycode" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
  > = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
) {
  return (
    event.keycode === shortcut.keycode &&
    event.ctrlKey === shortcut.ctrlKey &&
    event.altKey === shortcut.altKey &&
    event.metaKey === shortcut.metaKey &&
    event.shiftKey === shortcut.shiftKey
  );
}

export function createPriceCheckShortcutTracker(
  onPriceCheck: () => void,
  shortcut: Pick<
    PriceCheckShortcutBinding,
    "keycode" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey"
  > = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
) {
  let armed = false;

  return {
    keyDown(event: Parameters<typeof isPriceCheckShortcutEvent>[0]) {
      if (isPriceCheckShortcutEvent(event, shortcut)) {
        armed = true;
      }
    },
    keyUp(event: { keycode: number }) {
      if (armed && event.keycode === shortcut.keycode) {
        armed = false;
        onPriceCheck();
      }
    },
  };
}

export function isPoeItemText(value: string) {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trim());
  const rarityIndex = lines[0]?.startsWith("Item Class: ") ? 1 : 0;

  return (
    (rarityIndex === 1 || lines[0]?.startsWith("Rarity: ")) &&
    lines[rarityIndex]?.startsWith("Rarity: ") &&
    Boolean(lines[rarityIndex + 1]) &&
    lines.includes("--------")
  );
}

export function isPathOfExileForegroundWindow(value: {
  processName: string;
  title: string;
}) {
  const normalizedProcessName = value.processName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return (
    normalizedProcessName.startsWith("pathofexile") ||
    PATH_OF_EXILE_STEAM_WINDOW_CLASSES.has(normalizedProcessName)
  );
}

export async function pressPoeCopyShortcut(
  keyboard: PoeCopyKeyboard,
  shortcut: PriceCheckShortcutBinding = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
) {
  const wait = keyboard.wait || defaultWait;
  keyboard.keyUp(shortcut.key);
  if (shortcut.ctrlKey) keyboard.keyUp("Ctrl");
  if (shortcut.altKey) keyboard.keyUp("Alt");
  if (shortcut.metaKey) keyboard.keyUp("Meta");
  if (shortcut.shiftKey) keyboard.keyUp("Shift");
  keyboard.keyDown("Ctrl");
  try {
    keyboard.keyTap("C");
    await wait(10);
  } finally {
    keyboard.keyUp("Ctrl");
  }
}

export async function capturePoeItemText(
  dependencies: PriceCheckClipboardDependencies,
  options: PriceCheckClipboardOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 48;
  const timeoutMs = options.timeoutMs ?? 500;
  const wait = dependencies.wait || defaultWait;
  const previousText = dependencies.readText();
  const clearedStaleItem = isPoeItemText(previousText);
  const clipboardResetText =
    options.clipboardMarker ?? (clearedStaleItem ? "" : undefined);

  if (clipboardResetText !== undefined) {
    dependencies.writeText(clipboardResetText);
  }

  try {
    await dependencies.pressCopy();

    for (let elapsed = 0; elapsed < timeoutMs; elapsed += pollIntervalMs) {
      await wait(pollIntervalMs);
      const copiedText = dependencies.readText();
      if (isPoeItemText(copiedText)) {
        return copiedText;
      }
    }

    throw new Error(
      "No Path of Exile item was copied. Hover an item and try again.",
    );
  } catch (error) {
    if (
      clipboardResetText !== undefined ||
      dependencies.readText() !== previousText
    ) {
      dependencies.writeText(previousText);
    }
    throw error;
  }
}
