import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { performWindowControl } from "../electron/app/windowControls";
import { WindowControls } from "../src/components/WindowControls";

function createWindowDouble(maximized = false) {
  const calls: string[] = [];
  let isMaximized = maximized;
  return {
    calls,
    window: {
      minimize: () => calls.push("minimize"),
      maximize: () => {
        calls.push("maximize");
        isMaximized = true;
      },
      unmaximize: () => {
        calls.push("unmaximize");
        isMaximized = false;
      },
      close: () => calls.push("close"),
      isMaximized: () => isMaximized,
    },
  };
}

test("performs only the requested native window action", () => {
  const normal = createWindowDouble(false);
  expect(performWindowControl(normal.window, "minimize")).toBe(false);
  expect(performWindowControl(normal.window, "toggle-maximize")).toBe(true);
  expect(performWindowControl(normal.window, "close")).toBe(false);
  expect(normal.calls).toEqual(["minimize", "maximize", "close"]);

  const maximized = createWindowDouble(true);
  expect(performWindowControl(maximized.window, "toggle-maximize")).toBe(false);
  expect(maximized.calls).toEqual(["unmaximize"]);
});

test("renders accessible custom window controls", () => {
  const markup = renderToStaticMarkup(createElement(WindowControls));

  expect(markup).toContain('aria-label="Window controls"');
  expect(markup).toContain('aria-label="Minimize Poe Dash"');
  expect(markup).toContain('aria-label="Maximize Poe Dash"');
  expect(markup).toContain('aria-label="Close Poe Dash"');
});

test("configures the Electron window as a custom frameless surface", async () => {
  const mainSource = await Bun.file(
    `${import.meta.dir}/../electron/main.ts`,
  ).text();
  const preloadSource = await Bun.file(
    `${import.meta.dir}/../electron/preload.ts`,
  ).text();

  expect(mainSource).toContain("frame: false");
  expect(mainSource).toContain('backgroundColor: "#121212"');
  expect(preloadSource).toContain("windowControls");
  expect(preloadSource).toContain("window-control");
  expect(preloadSource).toContain("desktopApi");
  expect(preloadSource).not.toContain("exposeInMainWorld('ipcRenderer'");
  expect(mainSource).toContain('createdWindow.on("closed"');
  expect(mainSource).toContain("isDestroyed()");
  expect(mainSource).toContain('webContents.on("will-navigate"');
  expect(mainSource).toContain(
    'app.on("activate", () => {\n  if (!focusMainWindow()) {\n    createWindow();',
  );
  expect(mainSource).toContain(
    'app.on("second-instance", () => {\n    if (!focusMainWindow()) {\n      createWindow();',
  );

  const handlerCount = mainSource.match(/ipcMain\.handle\(/g)?.length || 0;
  const senderGuardCount =
    mainSource.match(/requireTrustedIpcSender\(event\)/g)?.length || 0;
  expect(senderGuardCount).toBe(handlerCount);
});
