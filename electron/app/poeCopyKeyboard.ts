import { UiohookKey, uIOhook } from "uiohook-napi";
import {
  createPriceCheckShortcutTracker,
  pressPoeCopyShortcut,
} from "./priceCheckClipboard";
import {
  DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
  type PriceCheckShortcutBinding,
} from "../../src/services/priceCheckShortcut";

let activeShortcut = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING;
let priceCheckCallback: (() => void) | undefined;
let shortcutTracker:
  | ReturnType<typeof createPriceCheckShortcutTracker>
  | undefined;

let shortcutKeyDownListener:
  | ((event: {
      keycode: number;
      ctrlKey: boolean;
      altKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }) => void)
  | undefined;
let shortcutKeyUpListener: ((event: { keycode: number }) => void) | undefined;

type XdotoolCommandRunner = (
  command: string,
  args: string[],
) => Promise<unknown>;

export async function pressPoeItemCopyWithXdotool(
  runCommand: XdotoolCommandRunner,
  shortcut: PriceCheckShortcutBinding = activeShortcut,
) {
  const keysToRelease = [
    shortcut.key.toLowerCase(),
    shortcut.ctrlKey ? "Control_L" : undefined,
    shortcut.altKey ? "Alt_L" : undefined,
    shortcut.metaKey ? "Super_L" : undefined,
    shortcut.shiftKey ? "Shift_L" : undefined,
  ].filter((key): key is string => Boolean(key));

  await runCommand(
    "xdotool",
    keysToRelease.flatMap((key) => ["keyup", key]),
  );
  await runCommand("xdotool", ["key", "--clearmodifiers", "ctrl+c"]);
}

export function startPoeCopyKeyboard(
  onPriceCheck: () => void,
  shortcut: PriceCheckShortcutBinding = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
) {
  activeShortcut = shortcut;
  priceCheckCallback = onPriceCheck;
  shortcutTracker = createPriceCheckShortcutTracker(onPriceCheck, shortcut);
  shortcutKeyDownListener = (event) => shortcutTracker?.keyDown(event);
  shortcutKeyUpListener = (event) => shortcutTracker?.keyUp(event);
  uIOhook.on("keydown", shortcutKeyDownListener);
  uIOhook.on("keyup", shortcutKeyUpListener);

  try {
    uIOhook.start();
  } catch (error) {
    uIOhook.off("keydown", shortcutKeyDownListener);
    uIOhook.off("keyup", shortcutKeyUpListener);
    shortcutKeyDownListener = undefined;
    shortcutKeyUpListener = undefined;
    shortcutTracker = undefined;
    priceCheckCallback = undefined;
    throw error;
  }
}

export function updatePoeCopyKeyboardShortcut(
  shortcut: PriceCheckShortcutBinding,
) {
  activeShortcut = shortcut;
  if (priceCheckCallback) {
    shortcutTracker = createPriceCheckShortcutTracker(
      priceCheckCallback,
      shortcut,
    );
  }
}

export function stopPoeCopyKeyboard() {
  if (shortcutKeyDownListener) {
    uIOhook.off("keydown", shortcutKeyDownListener);
    shortcutKeyDownListener = undefined;
  }
  if (shortcutKeyUpListener) {
    uIOhook.off("keyup", shortcutKeyUpListener);
    shortcutKeyUpListener = undefined;
  }
  shortcutTracker = undefined;
  priceCheckCallback = undefined;
  uIOhook.stop();
}

export function pressPoeItemCopy() {
  return pressPoeCopyShortcut(
    {
      keyUp: (key) => uIOhook.keyToggle(UiohookKey[key], "up"),
      keyDown: (key) => uIOhook.keyToggle(UiohookKey[key], "down"),
      keyTap: (key) => uIOhook.keyTap(UiohookKey[key]),
    },
    activeShortcut,
  );
}
