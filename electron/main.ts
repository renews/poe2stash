import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeTheme,
  Notification,
  shell,
  systemPreferences,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
//import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import { Request } from "express";
import cors from "cors";
import * as routes from "./app/routes";
import { WebSocketServer } from "ws";
import http from "http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAllowedExternalUrl } from "../src/services/externalLinks";
import { merchantHistoryService } from "./app/services/MerchantHistoryService";
import { getRendererUrl } from "./app/renderer";
import {
  getAllowedRendererOrigins,
  isAllowedRendererOrigin,
  isTrustedRendererUrl,
  LOCAL_SERVER_HOST,
} from "./app/proxySecurity";
import { parsePriceAlertPayload } from "./app/priceAlert";
import {
  isWindowControlAction,
  performWindowControl,
} from "./app/windowControls";
import {
  getForegroundWindowInfo,
  getLivePriceCheckPlatformIssue,
  isNiriSession,
} from "./app/foregroundWindow";
import {
  capturePoeItemText,
  isPathOfExileForegroundWindow,
} from "./app/priceCheckClipboard";
import { PriceCheckGlobalShortcut } from "./app/priceCheckGlobalShortcut";
import {
  DEFAULT_PRICE_CHECK_SHORTCUT_BINDING,
  parsePriceCheckShortcut,
  type PriceCheckShortcutBinding,
} from "../src/services/priceCheckShortcut";

const PORT = process.env.PORT || 7555;
const execFileAsync = promisify(execFile);
const useNiriGlobalShortcut = process.platform === "linux" && isNiriSession();

//const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const expressApp = express();

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, "..");

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
const allowedRendererOrigins = getAllowedRendererOrigins(
  PORT,
  VITE_DEV_SERVER_URL,
);

nativeTheme.themeSource = "dark";

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let activePriceCheckCapture: Promise<void> | undefined;
let pressPoeItemCopy: (() => Promise<void>) | undefined;
let stopPoeCopyKeyboard: (() => void) | undefined;
let updatePoeCopyKeyboardShortcut:
  | ((shortcut: PriceCheckShortcutBinding) => boolean)
  | undefined;
let activePriceCheckShortcut = DEFAULT_PRICE_CHECK_SHORTCUT_BINDING;
let pendingPriceCheckItemText: string | undefined;
let priceCheckRegistrationPromise: Promise<void> | undefined;
let priceCheckShortcutStatus = {
  registered: false,
  shortcut: activePriceCheckShortcut.label,
  error: "The desktop shortcut has not been registered.",
};

async function openExternalUrl(url: string) {
  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [url]);
    return;
  }

  await shell.openExternal(url);
}

function createWindow() {
  const createdWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    frame: false,
    show: false,
    backgroundColor: "#121212",
    icon: path.join(process.env.VITE_PUBLIC, "poe-dash-icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win = createdWindow;

  createdWindow.setTitle("Poe Dash");
  createdWindow.once("ready-to-show", () => createdWindow.show());
  createdWindow.on("maximize", () =>
    createdWindow.webContents.send("window-maximized-change", true),
  );
  createdWindow.on("unmaximize", () =>
    createdWindow.webContents.send("window-maximized-change", false),
  );
  createdWindow.on("closed", () => {
    if (win === createdWindow) {
      win = null;
    }
  });

  if (process.platform === "darwin") {
    app.dock?.setIcon(path.join(process.env.VITE_PUBLIC, "poe-dash-icon.png"));
  }

  createdWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void openExternalUrl(url).catch((error) =>
        console.error("Unable to open external URL", error),
      );
    }

    return { action: "deny" };
  });

  createdWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url, allowedRendererOrigins)) {
      event.preventDefault();
    }
  });

  createdWindow.webContents.on("did-finish-load", () => {
    if (!pendingPriceCheckItemText || createdWindow.isDestroyed()) {
      return;
    }
    const itemText = pendingPriceCheckItemText;
    pendingPriceCheckItemText = undefined;
    createdWindow.webContents.send("price-check-item-copied", itemText);
  });

  if (process.env.POE_DASH_OPEN_DEVTOOLS === "1") {
    createdWindow.webContents.openDevTools();
  }

  if (VITE_DEV_SERVER_URL) {
    void createdWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    console.log("RENDERER_DIST", { RENDERER_DIST });
    void createdWindow.loadURL(getRendererUrl(PORT));
  }
}

function getControlledWindow(sender: WebContents) {
  const senderWindow = BrowserWindow.fromWebContents(sender);
  return senderWindow && senderWindow === win ? senderWindow : null;
}

function requireTrustedIpcSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (
    !frame ||
    frame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(frame.url, allowedRendererOrigins)
  ) {
    throw new Error("Blocked untrusted IPC sender");
  }
}

function focusMainWindow() {
  const mainWindow =
    win && !win.isDestroyed()
      ? win
      : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!mainWindow) {
    return false;
  }

  win = mainWindow;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function notifyPriceCheckFailure(message: string) {
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({ title: "Price check failed", body: message }).show();
}

function deliverCapturedPriceCheckItem(itemText: string) {
  pendingPriceCheckItemText = itemText;
  let createdWindow = false;
  if (!win || win.isDestroyed()) {
    createWindow();
    createdWindow = true;
  }

  if (win && !createdWindow && !win.webContents.isLoadingMainFrame()) {
    pendingPriceCheckItemText = undefined;
    win.webContents.send("price-check-item-copied", itemText);
  }
}

async function captureLivePriceCheckItem() {
  let foregroundWindow: Awaited<ReturnType<typeof getForegroundWindowInfo>>;
  try {
    foregroundWindow = await getForegroundWindowInfo();
  } catch (error) {
    console.warn("Unable to identify the foreground window", error);
    notifyPriceCheckFailure(
      "Poe Dash could not verify that Path of Exile is active. Manual paste is still available.",
    );
    return;
  }
  if (!isPathOfExileForegroundWindow(foregroundWindow)) {
    return;
  }

  try {
    const itemText = await capturePoeItemText({
      readText: () => clipboard.readText(),
      writeText: (text) => clipboard.writeText(text),
      pressCopy: () => {
        if (!pressPoeItemCopy) {
          throw new Error("Native keyboard access is unavailable.");
        }
        return pressPoeItemCopy();
      },
    }, {
      clipboardMarker:
        process.platform === "linux"
          ? `__POE_DASH_FORCE_COPY_${Date.now()}`
          : undefined,
    });
    deliverCapturedPriceCheckItem(itemText);
  } catch (error) {
    notifyPriceCheckFailure(
      error instanceof Error
        ? error.message
        : "No Path of Exile item was copied.",
    );
  }
}

function requestLivePriceCheckCapture() {
  if (activePriceCheckCapture) {
    return;
  }
  activePriceCheckCapture = captureLivePriceCheckItem().finally(() => {
    activePriceCheckCapture = undefined;
  });
}

async function registerLivePriceCheckShortcut() {
  try {
    const platformIssue = getLivePriceCheckPlatformIssue();
    if (platformIssue) {
      priceCheckShortcutStatus = {
        registered: false,
        shortcut: activePriceCheckShortcut.label,
        error: platformIssue,
      };
      return;
    }

    if (process.platform === "linux") {
      try {
        await execFileAsync("xdotool", ["--version"]);
      } catch {
        priceCheckShortcutStatus = {
          registered: false,
          shortcut: activePriceCheckShortcut.label,
          error:
            "Live price check requires xdotool on Linux. Manual paste is still available.",
        };
        return;
      }
    }

    if (
      process.platform === "darwin" &&
      !systemPreferences.isTrustedAccessibilityClient(true)
    ) {
      priceCheckShortcutStatus = {
        registered: false,
        shortcut: activePriceCheckShortcut.label,
        error: "Grant Poe Dash Accessibility access, then restart the app.",
      };
      return;
    }

    const keyboard = await import("./app/poeCopyKeyboard");
    if (useNiriGlobalShortcut) {
      pressPoeItemCopy = () =>
        keyboard.pressPoeItemCopyWithXdotool(
          (command, args) => execFileAsync(command, args),
          activePriceCheckShortcut,
        );
      const shortcut = new PriceCheckGlobalShortcut(globalShortcut);
      if (
        !shortcut.register(
          activePriceCheckShortcut,
          requestLivePriceCheckCapture,
        )
      ) {
        throw new Error(
          `Poe Dash could not reserve ${activePriceCheckShortcut.label}.`,
        );
      }
      updatePoeCopyKeyboardShortcut = (binding) => {
        if (!shortcut.register(binding, requestLivePriceCheckCapture)) {
          return false;
        }
        return true;
      };
      stopPoeCopyKeyboard = () => shortcut.stop();
    } else {
      pressPoeItemCopy = keyboard.pressPoeItemCopy;
      updatePoeCopyKeyboardShortcut = (shortcut) => {
        keyboard.updatePoeCopyKeyboardShortcut(shortcut);
        return true;
      };
      keyboard.startPoeCopyKeyboard(
        requestLivePriceCheckCapture,
        activePriceCheckShortcut,
      );
      stopPoeCopyKeyboard = keyboard.stopPoeCopyKeyboard;
    }
    priceCheckShortcutStatus = {
      registered: true,
      shortcut: activePriceCheckShortcut.label,
      error: "",
    };
  } catch (error) {
    pressPoeItemCopy = undefined;
    stopPoeCopyKeyboard = undefined;
    updatePoeCopyKeyboardShortcut = undefined;
    priceCheckShortcutStatus = {
      registered: false,
      shortcut: activePriceCheckShortcut.label,
      error:
        error instanceof Error
          ? error.message
          : "Native keyboard access could not be started.",
    };
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("will-quit", () => {
  if (stopPoeCopyKeyboard) {
    stopPoeCopyKeyboard();
    stopPoeCopyKeyboard = undefined;
  }
});

app.on("activate", () => {
  if (!focusMainWindow()) {
    createWindow();
  }
});

if (hasSingleInstanceLock) {
  app.on("second-instance", () => {
    if (!focusMainWindow()) {
      createWindow();
    }
  });
}

expressApp.use((req, res, next) => {
  const origin = req.get("origin");
  if (!isAllowedRendererOrigin(origin, allowedRendererOrigins)) {
    res.status(403).send("Blocked origin");
    return;
  }
  next();
});
expressApp.use(
  cors({
    origin(origin, callback) {
      callback(null, isAllowedRendererOrigin(origin, allowedRendererOrigins));
    },
  }),
);
expressApp.use("/proxy", routes.proxy);
expressApp.use(express.json());
expressApp.use("/chat", routes.chatRouter);
expressApp.use(express.static(RENDERER_DIST));

const server = http.createServer(expressApp);
const wss = new WebSocketServer({ server });

ipcMain.handle("window-control", (event, action: unknown) => {
  requireTrustedIpcSender(event);
  const target = getControlledWindow(event.sender);
  if (!target || !isWindowControlAction(action)) {
    throw new Error("Invalid window control request");
  }

  return performWindowControl(target, action);
});

ipcMain.handle("window-is-maximized", (event) => {
  requireTrustedIpcSender(event);
  return Boolean(getControlledWindow(event.sender)?.isMaximized());
});

ipcMain.handle("show-price-alert", (event, value: unknown) => {
  requireTrustedIpcSender(event);
  const payload = parsePriceAlertPayload(value);
  if (!payload) {
    throw new Error("Invalid price alert payload");
  }
  if (!Notification.isSupported()) {
    return false;
  }

  const notification = new Notification({
    title: payload.title,
    body: payload.body,
  });
  notification.on("click", focusMainWindow);
  notification.show();
  return true;
});

ipcMain.handle("price-check-shortcut-status", async (event) => {
  requireTrustedIpcSender(event);
  await priceCheckRegistrationPromise;
  return priceCheckShortcutStatus;
});

ipcMain.handle("price-check-shortcut-update", async (event, value: unknown) => {
  requireTrustedIpcSender(event);
  const shortcut =
    typeof value === "string" ? parsePriceCheckShortcut(value) : undefined;
  if (!shortcut) {
    throw new Error("Invalid live price check shortcut");
  }

  await priceCheckRegistrationPromise;
  if (updatePoeCopyKeyboardShortcut?.(shortcut) === false) {
    priceCheckShortcutStatus = {
      registered: true,
      shortcut: activePriceCheckShortcut.label,
      error: `${shortcut.label} could not be reserved; ${activePriceCheckShortcut.label} remains active.`,
    };
    return priceCheckShortcutStatus;
  }
  activePriceCheckShortcut = shortcut;
  priceCheckShortcutStatus = {
    ...priceCheckShortcutStatus,
    shortcut: shortcut.label,
  };
  return priceCheckShortcutStatus;
});

ipcMain.handle("poe-get-session", (event) => {
  requireTrustedIpcSender(event);
  return merchantHistoryService.getSession();
});
ipcMain.handle("poe-login", (event) => {
  requireTrustedIpcSender(event);
  return merchantHistoryService.login();
});
ipcMain.handle("poe-fetch-history", (event, league: unknown) => {
  requireTrustedIpcSender(event);
  return merchantHistoryService.fetchHistory(
    typeof league === "string" ? league : "",
  );
});

wss.on("connection", (ws, request) => {
  if (
    !isAllowedRendererOrigin(request.headers.origin, allowedRendererOrigins)
  ) {
    ws.close(1008, "Blocked origin");
    return;
  }

  console.log(request.url);
  if (request.url?.startsWith("/chat")) {
    routes.wsChat(ws);
    return;
  }
  if (request?.url?.startsWith("/proxy")) {
    routes.wsProxy(ws, request as Request);
    return;
  }
});

if (hasSingleInstanceLock) {
  app.whenReady().then(() => {
    createWindow();
    priceCheckRegistrationPromise = registerLivePriceCheckShortcut();
  });
  server.listen(Number(PORT), LOCAL_SERVER_HOST, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
} else {
  app.quit();
}
