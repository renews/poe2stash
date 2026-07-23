import { expect, test } from "bun:test";
import {
  capturePoeItemText,
  createBufferedPriceCheckChannel,
  createPriceCheckShortcutTracker,
  isPriceCheckShortcutEvent,
  isPoeItemText,
  isPathOfExileForegroundWindow,
  pressPoeCopyShortcut,
} from "../electron/app/priceCheckClipboard";
import {
  getLivePriceCheckPlatformIssue,
  isNiriSession,
  parseNiriFocusedWindow,
} from "../electron/app/foregroundWindow";
import {
  PriceCheckGlobalShortcut,
  toElectronAccelerator,
} from "../electron/app/priceCheckGlobalShortcut";
import { pressPoeItemCopyWithXdotool } from "../electron/app/poeCopyKeyboard";
import {
  DEFAULT_PRICE_CHECK_SHORTCUT,
  parsePriceCheckShortcut,
  shortcutFromKeyboardEvent,
} from "../src/services/priceCheckShortcut";

const OLD_ITEM = `Item Class: Rings
Rarity: Rare
Old Grip
Iron Ring
--------
Item Level: 20`;

const NEW_ITEM = `Item Class: Rings
Rarity: Rare
New Grip
Amethyst Ring
--------
Item Level: 74`;

test("captures only newly copied Path of Exile item text", async () => {
  let clipboard = OLD_ITEM;
  const writes: string[] = [];

  const captured = await capturePoeItemText({
    readText: () => clipboard,
    writeText: (text) => {
      writes.push(text);
      clipboard = text;
    },
    pressCopy: () => {
      clipboard = NEW_ITEM;
    },
    wait: async () => {},
  });

  expect(captured).toBe(NEW_ITEM);
  expect(writes).toEqual([""]);
  expect(isPoeItemText("my clipboard secret")).toBe(false);
  expect(isPoeItemText(NEW_ITEM)).toBe(true);
});

test("primes the Linux clipboard with a non-empty marker before copying", async () => {
  let clipboard = "notes to preserve";
  const events: string[] = [];
  const marker = "__POE_DASH_FORCE_COPY_test";

  const captured = await capturePoeItemText(
    {
      readText: () => clipboard,
      writeText: (text) => {
        events.push(`write:${text}`);
        clipboard = text;
      },
      pressCopy: () => {
        events.push(`copy-after:${clipboard}`);
        clipboard = NEW_ITEM;
      },
      wait: async () => {},
    },
    { clipboardMarker: marker },
  );

  expect(captured).toBe(NEW_ITEM);
  expect(events).toEqual([`write:${marker}`, `copy-after:${marker}`]);
});

test("restores the clipboard when the game does not provide an item", async () => {
  let clipboard = "notes to preserve";

  await expect(
    capturePoeItemText(
      {
        readText: () => clipboard,
        writeText: (text) => {
          clipboard = text;
        },
        pressCopy: () => {},
        wait: async () => {},
      },
      { pollIntervalMs: 50, timeoutMs: 100 },
    ),
  ).rejects.toThrow("No Path of Exile item was copied");
  expect(clipboard).toBe("notes to preserve");
});

test("restores the clipboard when native copy injection fails", async () => {
  let clipboard = OLD_ITEM;

  await expect(
    capturePoeItemText({
      readText: () => clipboard,
      writeText: (text) => {
        clipboard = text;
      },
      pressCopy: async () => {
        throw new Error("native copy failed");
      },
      wait: async () => {},
    }),
  ).rejects.toThrow("native copy failed");
  expect(clipboard).toBe(OLD_ITEM);
});

test("releases the price-check combo before sending one copy action", async () => {
  const events: string[] = [];

  await pressPoeCopyShortcut({
    keyUp: (key) => events.push(`up:${key}`),
    keyDown: (key) => events.push(`down:${key}`),
    keyTap: (key) => events.push(`tap:${key}`),
    wait: async () => {},
  });

  expect(events).toEqual(["up:D", "up:Ctrl", "down:Ctrl", "tap:C", "up:Ctrl"]);
});

test("releases Ctrl when native copy injection throws", async () => {
  const events: string[] = [];

  await expect(
    pressPoeCopyShortcut({
      keyUp: (key) => events.push(`up:${key}`),
      keyDown: (key) => events.push(`down:${key}`),
      keyTap: (key) => {
        events.push(`tap:${key}`);
        throw new Error("copy injection failed");
      },
      wait: async () => {},
    }),
  ).rejects.toThrow("copy injection failed");
  expect(events.at(-1)).toBe("up:Ctrl");
});

test("releases the configured key and modifiers before copying", async () => {
  const events: string[] = [];
  const shortcut = parsePriceCheckShortcut("Ctrl+Shift+P");
  expect(shortcut).toBeDefined();

  await pressPoeCopyShortcut(
    {
      keyUp: (key) => events.push(`up:${key}`),
      keyDown: (key) => events.push(`down:${key}`),
      keyTap: (key) => events.push(`tap:${key}`),
      wait: async () => {},
    },
    shortcut,
  );

  expect(events).toEqual([
    "up:P",
    "up:Ctrl",
    "up:Shift",
    "down:Ctrl",
    "tap:C",
    "up:Ctrl",
  ]);
});

test("releases the Niri shortcut grab before copying through Xdotool", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const shortcut = parsePriceCheckShortcut("Alt+Y");
  expect(shortcut).toBeDefined();

  await pressPoeItemCopyWithXdotool(
    async (command, args) => {
      calls.push({ command, args });
    },
    shortcut!,
  );

  expect(calls).toEqual([
    {
      command: "xdotool",
      args: ["keyup", "y", "keyup", "Alt_L"],
    },
    {
      command: "xdotool",
      args: ["key", "--clearmodifiers", "ctrl+c"],
    },
  ]);
});

test("allows native copy only while Path of Exile is foreground", () => {
  expect(
    isPathOfExileForegroundWindow({
      processName: "PathOfExile2.exe",
      title: "Path of Exile 2",
    }),
  ).toBe(true);
  expect(
    isPathOfExileForegroundWindow({
      processName: "Path of Exile",
      title: "Path of Exile",
    }),
  ).toBe(true);
  expect(
    isPathOfExileForegroundWindow({
      processName: "Google Chrome",
      title: "Path of Exile 2 Trade",
    }),
  ).toBe(false);
  expect(
    isPathOfExileForegroundWindow({
      processName: "firefox",
      title: "Path of Exile Wiki",
    }),
  ).toBe(false);
});

test("observes only an unmodified Ctrl+D chord without reserving a global shortcut", () => {
  expect(
    isPriceCheckShortcutEvent({
      keycode: 32,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBe(true);
  expect(
    isPriceCheckShortcutEvent({
      keycode: 32,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: true,
    }),
  ).toBe(false);
  expect(
    isPriceCheckShortcutEvent({
      keycode: 46,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBe(false);
});

test("fires once on release after repeated Ctrl+D keydown events", () => {
  let captures = 0;
  const tracker = createPriceCheckShortcutTracker(() => {
    captures += 1;
  });
  const chord = {
    keycode: 32,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  };

  tracker.keyDown(chord);
  tracker.keyDown(chord);
  tracker.keyUp({ ...chord, ctrlKey: false });
  tracker.keyUp({ ...chord, ctrlKey: false });

  expect(captures).toBe(1);
});

test("matches a configured modifier chord instead of the default shortcut", () => {
  let captures = 0;
  const shortcut = {
    keycode: 25,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: true,
  };
  const tracker = createPriceCheckShortcutTracker(() => {
    captures += 1;
  }, shortcut);

  expect(
    isPriceCheckShortcutEvent(
      {
        keycode: 25,
        ctrlKey: true,
        altKey: false,
        metaKey: false,
        shiftKey: true,
      },
      shortcut,
    ),
  ).toBe(true);
  tracker.keyDown({
    keycode: 25,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: true,
  });
  tracker.keyUp({ keycode: 25 });

  expect(captures).toBe(1);
});

test("normalizes configurable shortcuts and rejects unsafe incomplete chords", () => {
  expect(DEFAULT_PRICE_CHECK_SHORTCUT).toBe("Ctrl+D");
  expect(parsePriceCheckShortcut("shift + ctrl + p")).toMatchObject({
    label: "Ctrl+Shift+P",
    key: "P",
    ctrlKey: true,
    shiftKey: true,
  });
  expect(parsePriceCheckShortcut("D")).toBeUndefined();
  expect(parsePriceCheckShortcut("Shift+D")).toBeUndefined();
  expect(parsePriceCheckShortcut("Ctrl+Escape")).toBeUndefined();
});

test("captures a supported shortcut from the Settings key field", () => {
  expect(
    shortcutFromKeyboardEvent({
      key: "p",
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      shiftKey: true,
    }),
  ).toBe("Ctrl+Shift+P");
  expect(
    shortcutFromKeyboardEvent({
      key: "p",
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      shiftKey: false,
    }),
  ).toBeUndefined();
});

test("supports Niri while keeping other Wayland sessions disabled", () => {
  expect(
    getLivePriceCheckPlatformIssue("linux", { XDG_SESSION_TYPE: "wayland" }),
  ).toContain("X11");
  const niriEnvironment = {
    XDG_SESSION_TYPE: "wayland",
    XDG_CURRENT_DESKTOP: "niri",
    NIRI_SOCKET: "/run/user/1000/niri.wayland-1.sock",
  };
  expect(isNiriSession(niriEnvironment)).toBe(true);
  expect(getLivePriceCheckPlatformIssue("linux", niriEnvironment)).toBeUndefined();
  expect(
    getLivePriceCheckPlatformIssue("linux", { XDG_SESSION_TYPE: "x11" }),
  ).toBeUndefined();
  expect(getLivePriceCheckPlatformIssue("darwin", {})).toBeUndefined();
});

test("maps the Niri focused XWayland window to the existing PoE identity", () => {
  const focusedWindow = parseNiriFocusedWindow(
    JSON.stringify({
      id: 6,
      title: "Path of Exile 2",
      app_id: "steam_app_2694490",
      pid: 1923,
      is_focused: true,
    }),
  );

  expect(focusedWindow).toEqual({
    processName: "steam_app_2694490",
    title: "Path of Exile 2",
  });
  expect(isPathOfExileForegroundWindow(focusedWindow)).toBe(true);
});

test("reserves only the configured Niri shortcut through the app", () => {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const callbacks = new Map<string, () => void>();
  const shortcut = new PriceCheckGlobalShortcut({
    register: (accelerator, callback) => {
      registered.push(accelerator);
      callbacks.set(accelerator, callback);
      return true;
    },
    unregister: (accelerator) => {
      unregistered.push(accelerator);
      callbacks.delete(accelerator);
    },
  });
  let captures = 0;
  const capture = () => {
    captures += 1;
  };
  const oldBinding = parsePriceCheckShortcut("Ctrl+Alt+D");
  const newBinding = parsePriceCheckShortcut("Alt+Y");
  expect(oldBinding).toBeDefined();
  expect(newBinding).toBeDefined();

  expect(shortcut.register(oldBinding!, capture)).toBe(true);
  expect(shortcut.register(newBinding!, capture)).toBe(true);
  callbacks.get("Alt+Y")?.();

  expect(registered).toEqual(["Control+Alt+D", "Alt+Y"]);
  expect(unregistered).toEqual(["Control+Alt+D"]);
  expect(captures).toBe(1);
  expect(toElectronAccelerator(parsePriceCheckShortcut("Meta+Shift+F10")!)).toBe(
    "Super+Shift+F10",
  );
});

test("buffers a captured item until the renderer subscribes", () => {
  const channel = createBufferedPriceCheckChannel();
  const received: string[] = [];

  channel.publish(NEW_ITEM);
  const unsubscribe = channel.subscribe((itemText) => received.push(itemText));
  channel.publish(OLD_ITEM);
  unsubscribe();
  channel.publish("ignored after unsubscribe");

  expect(received).toEqual([NEW_ITEM, OLD_ITEM]);
});

test("delivers a captured item without stealing focus from Path of Exile", async () => {
  const mainSource = await Bun.file(
    `${import.meta.dir}/../electron/main.ts`,
  ).text();
  const deliverySource = mainSource.slice(
    mainSource.indexOf("function deliverCapturedPriceCheckItem"),
    mainSource.indexOf("async function captureLivePriceCheckItem"),
  );

  expect(deliverySource).toContain(
    'win.webContents.send("price-check-item-copied", itemText)',
  );
  expect(deliverySource).not.toContain("focusMainWindow()");
});
