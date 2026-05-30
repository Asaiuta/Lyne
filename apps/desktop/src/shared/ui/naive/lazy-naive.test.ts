import assert from "node:assert/strict";
import test from "node:test";
import { createLazyNaive, scheduleIdlePreload } from "./lazy-naive";

test("createLazyNaive resolves the import thunk once and caches the value", async () => {
  let calls = 0;
  const lazy = createLazyNaive(async () => {
    calls += 1;
    return { name: "impl" as const };
  });

  assert.equal(lazy.getLoaded(), null);

  const first = await lazy.load();
  const second = await lazy.load();

  assert.equal(first, second);
  assert.equal(first.name, "impl");
  assert.equal(calls, 1, "thunk runs only once across loads");
  assert.equal(lazy.getLoaded(), first, "getLoaded returns the resolved value");
});

test("createLazyNaive load is in-flight deduplicated for concurrent callers", async () => {
  let calls = 0;
  const lazy = createLazyNaive(async () => {
    calls += 1;
    return calls;
  });

  const [a, b] = await Promise.all([lazy.load(), lazy.load()]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(calls, 1, "concurrent loads share one pending promise");
});

test("createLazyNaive preload warms the cache without throwing", async () => {
  let calls = 0;
  const lazy = createLazyNaive(async () => {
    calls += 1;
    return "value";
  });

  lazy.preload();
  // Allow the microtask queue to flush the load promise.
  await Promise.resolve();
  await lazy.load();
  assert.equal(calls, 1);
  assert.equal(lazy.getLoaded(), "value");
});

test("scheduleIdlePreload uses requestIdleCallback when available", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const captured: { idle: (() => void) | null } = { idle: null };
  let idleArgs: { timeout: number } | null = null;
  let cancelled: number | null = null;

  (globalThis as { window?: unknown }).window = {
    requestIdleCallback: (cb: () => void, options?: { timeout: number }) => {
      captured.idle = cb;
      idleArgs = options ?? null;
      return 7;
    },
    cancelIdleCallback: (handle: number) => {
      cancelled = handle;
    }
  };

  try {
    let preloaded = false;
    const cleanup = scheduleIdlePreload(
      () => {
        preloaded = true;
      },
      { idleTimeout: 800, fallbackDelay: 300 }
    );

    assert.equal(typeof captured.idle, "function", "schedules an idle callback");
    assert.deepEqual(idleArgs, { timeout: 800 });

    captured.idle?.();
    assert.equal(preloaded, true, "idle callback invokes preload");

    cleanup();
    assert.equal(cancelled, 7, "cleanup cancels the idle handle");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("scheduleIdlePreload falls back to setTimeout without requestIdleCallback", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  let timeoutDelay: number | null = null;
  let clearedHandle: number | null = null;

  (globalThis as { window?: unknown }).window = {
    setTimeout: (_cb: () => void, delay?: number) => {
      timeoutDelay = delay ?? null;
      return 42;
    },
    clearTimeout: (handle: number) => {
      clearedHandle = handle;
    }
  };

  try {
    const cleanup = scheduleIdlePreload(() => {}, { idleTimeout: 800, fallbackDelay: 300 });

    assert.equal(timeoutDelay, 300, "schedules the setTimeout fallback delay");

    cleanup();
    assert.equal(clearedHandle, 42, "cleanup clears the timeout handle");
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

test("scheduleIdlePreload is a no-op when window is undefined", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  delete (globalThis as { window?: unknown }).window;
  try {
    const cleanup = scheduleIdlePreload(() => {}, { idleTimeout: 1, fallbackDelay: 1 });
    assert.equal(typeof cleanup, "function");
    cleanup();
  } finally {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});
