import {
  extractMerchantHistoryRows,
  MerchantHistoryEntry,
  normalizeMerchantHistoryRow,
} from "./merchantHistory";

export interface MerchantHistorySession {
  loggedIn: boolean;
  cookiePresent: boolean;
}

interface MerchantHistoryResponse {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
}

export class MerchantHistoryError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "MerchantHistoryError";
  }
}

export class MerchantHistoryService {
  private getDesktopApi() {
    if (typeof window === "undefined" || !window.desktopApi?.merchantHistory) {
      throw new MerchantHistoryError(
        "Merchant History is only available in the desktop app.",
      );
    }

    return window.desktopApi.merchantHistory;
  }

  getSession() {
    return this.getDesktopApi().getSession() as Promise<MerchantHistorySession>;
  }

  login() {
    return this.getDesktopApi().login() as Promise<MerchantHistorySession>;
  }

  async fetchHistory(league: string): Promise<MerchantHistoryEntry[]> {
    const response = (await this.getDesktopApi().fetchHistory(
      league,
    )) as MerchantHistoryResponse;

    if (!response.ok) {
      throw new MerchantHistoryError(
        response.error ||
          `Unable to fetch merchant history (HTTP ${response.status}).`,
        response.status,
      );
    }

    return extractMerchantHistoryRows(response.data)
      .map(normalizeMerchantHistoryRow)
      .sort((left, right) => {
        const leftTime = Date.parse(String(left.timestamp));
        const rightTime = Date.parse(String(right.timestamp));
        return rightTime - leftTime;
      });
  }
}

export const merchantHistoryService = new MerchantHistoryService();
