import { contextBridge, ipcRenderer } from "electron";

type WindowControlAction = "minimize" | "toggle-maximize" | "close";

contextBridge.exposeInMainWorld("windowControls", {
  perform(action: WindowControlAction) {
    return ipcRenderer.invoke("window-control", action) as Promise<boolean>;
  },
  isMaximized() {
    return ipcRenderer.invoke("window-is-maximized") as Promise<boolean>;
  },
  onMaximizedChange(callback: (isMaximized: boolean) => void) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      callback(value === true);
    };
    ipcRenderer.on("window-maximized-change", listener);
    return () =>
      ipcRenderer.removeListener("window-maximized-change", listener);
  },
});

contextBridge.exposeInMainWorld("desktopApi", {
  merchantHistory: {
    getSession() {
      return ipcRenderer.invoke("poe-get-session") as Promise<unknown>;
    },
    login() {
      return ipcRenderer.invoke("poe-login") as Promise<unknown>;
    },
    fetchHistory(league: string) {
      return ipcRenderer.invoke(
        "poe-fetch-history",
        league,
      ) as Promise<unknown>;
    },
  },
  showPriceAlert(payload: unknown) {
    return ipcRenderer.invoke("show-price-alert", payload) as Promise<boolean>;
  },
});
