const ACCOUNT_CACHE_VERSION = "v2";
const DEFAULT_LEAGUE = "Standard";

function normalizeCacheSegment(value: string, fallback: string) {
  return encodeURIComponent(value.trim() || fallback);
}

function getAccountCacheScope(account: string, league?: string) {
  return [
    normalizeCacheSegment(account, "unknown-account"),
    normalizeCacheSegment(league || DEFAULT_LEAGUE, DEFAULT_LEAGUE),
  ].join("_");
}

export function getAccountItemsCacheKey(account: string, league?: string) {
  return `poe2trade_account_${ACCOUNT_CACHE_VERSION}_${getAccountCacheScope(account, league)}`;
}

export function getAccountItemDetailsCacheKey(
  account: string,
  league?: string,
) {
  return `${getAccountItemsCacheKey(account, league)}_items`;
}
