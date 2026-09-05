import assert from "node:assert/strict";
import test from "node:test";
import { cacheFetch, clearCacheFetchMemoryByPrefix } from "./cacheFetch";

interface StorageHarness {
  readonly storage: Storage;
  readonly values: Map<string, string>;
  readonly reads: Map<string, number>;
}

function createStorageHarness(initial: Readonly<Record<string, string>> = {}): StorageHarness {
  const values = new Map(Object.entries(initial));
  const reads = new Map<string, number>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => {
      reads.set(key, (reads.get(key) ?? 0) + 1);
      return values.get(key) ?? null;
    },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => {
      values.delete(key);
    },
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  } satisfies Storage;
  return { storage, values, reads };
}

function installStorage(storage: Storage): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage
  });
  return () => {
    clearCacheFetchMemoryByPrefix("");
    if (descriptor) {
      Object.defineProperty(globalThis, "sessionStorage", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  };
}

test("cacheFetch parses a session storage hit only once", async () => {
  const key = "cache-test.storage-hit";
  const harness = createStorageHarness({
    [key]: JSON.stringify({ value: { title: "cached" }, expiry: Date.now() + 10_000 })
  });
  const restore = installStorage(harness.storage);
  try {
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount += 1;
      return { title: "network" };
    };

    assert.deepEqual(await cacheFetch(key, fetcher), { title: "cached" });
    assert.deepEqual(await cacheFetch(key, fetcher), { title: "cached" });
    assert.equal(harness.reads.get(key), 1);
    assert.equal(fetchCount, 0);
  } finally {
    restore();
  }
});

test("cacheFetch coalesces concurrent misses", async () => {
  const key = "cache-test.in-flight";
  const harness = createStorageHarness();
  const restore = installStorage(harness.storage);
  try {
    let resolveFetch: ((value: string) => void) | undefined;
    let fetchCount = 0;
    const fetcher = () => {
      fetchCount += 1;
      return new Promise<string>((resolve) => {
        resolveFetch = resolve;
      });
    };

    const first = cacheFetch(key, fetcher);
    const second = cacheFetch(key, fetcher);
    assert.equal(first, second);
    await Promise.resolve();
    assert.equal(fetchCount, 1);
    resolveFetch?.("shared");
    assert.deepEqual(await Promise.all([first, second]), ["shared", "shared"]);
  } finally {
    restore();
  }
});

test("cacheFetch discards expired entries before fetching", async () => {
  const key = "cache-test.expired";
  const harness = createStorageHarness({
    [key]: JSON.stringify({ value: "old", expiry: Date.now() - 1 })
  });
  const restore = installStorage(harness.storage);
  try {
    assert.equal(await cacheFetch(key, async () => "fresh"), "fresh");
    assert.equal(JSON.parse(harness.values.get(key) ?? "null").value, "fresh");
  } finally {
    restore();
  }
});

test("clearing a prefix prevents an old request from repopulating the cache", async () => {
  const key = "cache-test.clear.pending";
  const harness = createStorageHarness();
  const restore = installStorage(harness.storage);
  try {
    let resolveFetch: ((value: string) => void) | undefined;
    const pending = cacheFetch(
      key,
      () => new Promise<string>((resolve) => {
        resolveFetch = resolve;
      })
    );
    await Promise.resolve();
    clearCacheFetchMemoryByPrefix("cache-test.clear");
    resolveFetch?.("stale");
    assert.equal(await pending, "stale");
    assert.equal(harness.values.has(key), false);

    assert.equal(await cacheFetch(key, async () => "fresh"), "fresh");
    assert.equal(JSON.parse(harness.values.get(key) ?? "null").value, "fresh");
  } finally {
    restore();
  }
});
