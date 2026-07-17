import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
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

const PORT = process.env.PORT || 7555;
const execFileAsync = promisify(execFile);

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

nativeTheme.themeSource = "dark";

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

let win: BrowserWindow | null;

async function openExternalUrl(url: string) {
  if (process.platform === "linux") {
    await execFileAsync("xdg-open", [url]);
    return;
  }

  await shell.openExternal(url);
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void openExternalUrl(url).catch((error) =>
        console.error("Unable to open external URL", error),
      );
    }

    return { action: "deny" };
  });

  // Test active push message to Renderer-process.
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", new Date().toLocaleString());
  });

  if (process.env.NODE_ENV === "development") {
    win.webContents.openDevTools();
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    // win.loadFile('dist/index.html')
    console.log("RENDERER_DIST", { RENDERER_DIST });
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
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

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(createWindow);

expressApp.use(cors());
expressApp.use("/proxy", routes.proxy);
expressApp.use(express.json());
expressApp.use("/chat", routes.chatRouter);

const server = http.createServer(expressApp);
const wss = new WebSocketServer({ server });

ipcMain.handle("open-external-url", async (_event, url: unknown) => {
  if (!isAllowedExternalUrl(url)) {
    throw new Error("Blocked external URL");
  }

  await openExternalUrl(url);
});

wss.on("connection", (ws, request) => {
  console.log(request.url);
  if (request.url?.startsWith("/chat")) {
    routes.wsChat(ws, request as Request);
    return;
  }
  if (request?.url?.startsWith("/proxy")) {
    routes.wsProxy(ws, request as Request);
    return;
  }
});

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
