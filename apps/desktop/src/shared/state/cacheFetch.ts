interface CacheEntry<T> {
  value: T;
  expiry: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const entry: CacheEntry<T> = JSON.parse(raw);
      if (entry.expiry === 0 || Date.now() < entry.expiry) {
        return Promise.resolve(entry.value);
      }
    }
  } catch {
    // corrupted cache — ignore
  }

  return fetcher().then((value) => {
    try {
      const expiry = ttlMs < 0 ? 0 : Date.now() + ttlMs;
      sessionStorage.setItem(key, JSON.stringify({ value, expiry }));
    } catch {
      // storage full — ignore
    }
    return value;
  });
}
