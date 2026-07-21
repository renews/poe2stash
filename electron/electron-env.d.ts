/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string;
    /** /dist/ or /public/ */
    VITE_PUBLIC: string;
  }
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
  desktopApi?: {
    merchantHistory: {
      getSession: () => Promise<unknown>;
      login: () => Promise<unknown>;
      fetchHistory: (league: string) => Promise<unknown>;
    };
    showPriceAlert: (payload: unknown) => Promise<boolean>;
  };
  windowControls: {
    perform: (
      action: "minimize" | "toggle-maximize" | "close",
    ) => Promise<boolean>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void;
  };
}
