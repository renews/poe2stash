export const CACHE_SCHEMA_VERSION = 1;

type CacheStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

type CacheEnvelope<T> = {
  schemaVersion: number;
  data: T;
};

function isCacheEnvelope(value: unknown): value is CacheEnvelope<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    "data" in value
  );
}

export class CacheService {
  constructor(
    private readonly storage?: CacheStorage,
    private readonly now: () => number = Date.now,
  ) {}

  private getStorage() {
    if (this.storage) {
      return this.storage;
    }

    return typeof localStorage === "undefined" ? undefined : localStorage;
  }

  private remove(key: string) {
    const storage = this.getStorage();
    storage?.removeItem(key);
    storage?.removeItem(`${key}_expiry`);
  }

  setExpiry(key: string, expiry?: number) {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    const expiryKey = `${key}_expiry`;
    if (expiry === undefined) {
      storage.removeItem(expiryKey);
      return;
    }

    storage.setItem(expiryKey, expiry.toString());
  }

  hasExpired(key: string) {
    const storage = this.getStorage();
    if (!storage) {
      return false;
    }

    const expiryKey = `${key}_expiry`;
    const expiry = storage.getItem(expiryKey);
    if (!expiry) {
      return false;
    }

    const parsedExpiry = Number(expiry);
    if (!Number.isFinite(parsedExpiry)) {
      storage.removeItem(expiryKey);
      return false;
    }

    return this.now() > parsedExpiry;
  }

  getJson<T>(key: string): T | null {
    const storage = this.getStorage();
    if (!storage) {
      return null;
    }

    if (this.hasExpired(key)) {
      this.remove(key);
      return null;
    }

    const value = storage.getItem(key);
    if (!value) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (!isCacheEnvelope(parsed)) {
        return parsed as T;
      }

      if (parsed.schemaVersion !== CACHE_SCHEMA_VERSION) {
        this.remove(key);
        return null;
      }

      return parsed.data as T;
    } catch {
      this.remove(key);
      return null;
    }
  }

  setJson<T>(key: string, value: T, time?: number) {
    const storage = this.getStorage();
    if (!storage) {
      return;
    }

    const envelope: CacheEnvelope<T> = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      data: value,
    };
    storage.setItem(key, JSON.stringify(envelope));
    this.setExpiry(key, time === undefined ? undefined : this.future(time));
  }

  future(when: number) {
    return this.now() + when;
  }

  times = {
    second: 1000,
    minute: 1000 * 60,
    hour: 1000 * 60 * 60,
    day: 1000 * 60 * 60 * 24,
  };
}

export const Cache = new CacheService();
