import { app, BrowserWindow, net, session } from "electron";

export interface MerchantHistoryFetchResult {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

export interface MerchantHistorySession {
  loggedIn: boolean;
  cookiePresent: boolean;
}

export class MerchantHistoryService {
  private loginPromise: Promise<MerchantHistorySession> | null = null;

  async getSession(): Promise<MerchantHistorySession> {
    try {
      const cookies = await session.defaultSession.cookies.get({
        url: "https://www.pathofexile.com",
        name: "POESESSID",
      });
      const cookiePresent = cookies.some((cookie) => Boolean(cookie.value));
      return { loggedIn: cookiePresent, cookiePresent };
    } catch (error) {
      console.error("Unable to read Path of Exile session:", error);
      return { loggedIn: false, cookiePresent: false };
    }
  }

  async login(): Promise<MerchantHistorySession> {
    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = new Promise<MerchantHistorySession>((resolve) => {
      const loginWindow = new BrowserWindow({
        width: 900,
        height: 720,
        title: "Log in to pathofexile.com",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      loginWindow.once("closed", () => {
        void this.getSession().then(resolve);
      });

      void loginWindow
        .loadURL("https://www.pathofexile.com/login")
        .catch((error) => console.error("Unable to open Path of Exile login:", error));
    }).finally(() => {
      this.loginPromise = null;
    });

    return this.loginPromise;
  }

  async fetchHistory(league: string): Promise<MerchantHistoryFetchResult> {
    const normalizedLeague = league.trim();
    if (!normalizedLeague) {
      return { ok: false, status: 400, error: "A league is required." };
    }

    const sessionState = await this.getSession();
    if (!sessionState.loggedIn) {
      return {
        ok: false,
        status: 401,
        error: "Log in to pathofexile.com to view Ange Merchant History.",
      };
    }

    const url = `https://www.pathofexile.com/api/trade2/history/${encodeURIComponent(normalizedLeague)}`;

    return new Promise((resolve) => {
      const request = net.request({
        url,
        method: "GET",
        useSessionCookies: true,
        headers: {
          Accept: "application/json",
          Referer: "https://www.pathofexile.com/trade2/history",
          "X-Requested-With": "XMLHttpRequest",
          "User-Agent": `${app.userAgentFallback} (Poe Dash Merchant History)`,
        },
      });
      const chunks: Buffer[] = [];

      request.on("response", (response) => {
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          const status = response.statusCode || 0;
          const body = Buffer.concat(chunks).toString("utf8");
          let data: unknown;

          try {
            data = JSON.parse(body);
          } catch {
            data = body;
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            data: status >= 200 && status < 300 ? data : undefined,
            error:
              status >= 200 && status < 300
                ? undefined
                : `Path of Exile returned HTTP ${status}.`,
          });
        });
      });

      request.on("error", (error) => {
        resolve({ ok: false, status: 0, error: error.message });
      });

      request.end();
    });
  }
}

export const merchantHistoryService = new MerchantHistoryService();
