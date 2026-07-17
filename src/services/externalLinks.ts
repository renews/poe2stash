const TRADE_HOSTNAME = "www.pathofexile.com";

export function createTradeSearchUrl(league: string, searchId: string) {
  return `https://${TRADE_HOSTNAME}/trade2/search/poe2/${encodeURIComponent(league)}/${encodeURIComponent(searchId)}`;
}

export function isAllowedExternalUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === TRADE_HOSTNAME &&
      url.pathname.startsWith("/trade2/search/poe2/")
    );
  } catch {
    return false;
  }
}
