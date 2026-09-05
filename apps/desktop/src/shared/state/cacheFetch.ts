interface CacheEntry<T> {
  value: T;
  expiry: number;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

type UnknownCacheEntry = CacheEntry<unknown>;

// sessionStorage is synchronous. Keep the parsed entry (including misses) in
// memory and share an in-flight request with all callers for the same key.
const memoryEntries = new Map<string, UnknownCacheEntry | null>();
const inFlightRequests = new Map<string, Promise<unknown>>();

function isCacheEntry(value: unknown): value is UnknownCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<UnknownCacheEntry>;
  return Object.prototype.hasOwnProperty.call(entry, "value") &&
    typeof entry.expiry === "number" &&
    Number.isFinite(entry.expiry) &&
    entry.expiry >= 0;
}

function isFresh(entry: UnknownCacheEntry): boolean {
  return entry.expiry === 0 || Date.now() < entry.expiry;
}

function removeStorageEntry(key: string): void {
  try {
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(key);
  } catch {
    // Storage access is best-effort; the in-memory cache remains usable.
  }
}

function readEntry<T>(key: string): CacheEntry<T> | null {
  if (memoryEntries.has(key)) {
    const cached = memoryEntries.get(key);
    if (cached && isFresh(cached)) return cached as CacheEntry<T>;
    if (cached) removeStorageEntry(key);
    memoryEntries.set(key, null);
    return null;
  }

  let raw: string | null = null;
  try {
    if (typeof sessionStorage !== "undefined") raw = sessionStorage.getItem(key);
  } catch {
    // Storage access is best-effort; fall through to the network fetch.
  }

  if (!raw) {
    memoryEntries.set(key, null);
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCacheEntry(parsed) && isFresh(parsed)) {
      memoryEntries.set(key, parsed);
      return parsed as CacheEntry<T>;
    }
  } catch {
    // Corrupted cache entries are discarded below.
  }

  removeStorageEntry(key);
  memoryEntries.set(key, null);
  return null;
}

function writeEntry<T>(key: string, value: T, ttlMs: number): void {
  const entry: CacheEntry<T> = {
    value,
    expiry: ttlMs < 0 ? 0 : Date.now() + ttlMs
  };
  memoryEntries.set(key, entry);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(key, JSON.stringify(entry));
    }
  } catch {
    // Storage full or unavailable; keep the memory entry for this session.
  }
}

/** Clear parsed entries and pending requests without touching sessionStorage. */
export function clearCacheFetchMemoryByPrefix(prefix: string): void {
  for (const key of memoryEntries.keys()) {
    if (key.startsWith(prefix)) memoryEntries.delete(key);
  }
  for (const key of inFlightRequests.keys()) {
    if (key.startsWith(prefix)) inFlightRequests.delete(key);
  }
}

export function cacheFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const cached = readEntry<T>(key);
  if (cached) {
    return Promise.resolve(cached.value);
  }

  const pending = inFlightRequests.get(key);
  if (pending) return pending as Promise<T>;

  const request = Promise.resolve()
    .then(fetcher)
    .then((value) => {
      // A prefix clear invalidates this request too, so an old response cannot
      // repopulate storage after the caller deliberately discarded it.
      if (inFlightRequests.get(key) === request) writeEntry(key, value, ttlMs);
      return value;
    });
  inFlightRequests.set(key, request);
  const clearRequest = () => {
    if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
  };
  void request.then(clearRequest, clearRequest);
  return request;
}
