import assert from "node:assert/strict";
import test from "node:test";
import { createFullPlayerWarmupCoordinator } from "./fullPlayerWarmupCoordinator";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createFrameHarness() {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    schedule: (callback: FrameRequestCallback): number => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel: (handle: number): void => {
      callbacks.delete(handle);
    },
    runNext: (): void => {
      const next = callbacks.entries().next().value as
        | [number, FrameRequestCallback]
        | undefined;
      if (!next) throw new Error("expected a scheduled animation frame");
      callbacks.delete(next[0]);
      next[1](0);
    },
    pending: (): number => callbacks.size
  };
}

test("idle warmup loads and mounts once without opening", async () => {
  const frames = createFrameHarness();
  let loads = 0;
  let mounts = 0;
  let opens = 0;
  const coordinator = createFullPlayerWarmupCoordinator({
    load: async () => {
      loads += 1;
    },
    requestMount: () => {
      mounts += 1;
    },
    commitOpen: () => {
      opens += 1;
    },
    canMountClosed: () => true,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel
  });

  coordinator.warmup();
  coordinator.warmup();
  await flushMicrotasks();

  assert.equal(loads, 1);
  assert.equal(mounts, 1);
  assert.equal(opens, 0);

  coordinator.notifyShellMounted();
  frames.runNext();
  frames.runNext();
  coordinator.requestOpen();
  assert.equal(opens, 1, "a painted warm shell opens synchronously");
});

test("closed mount waits for visibility and reuses the resolved module", async () => {
  const frames = createFrameHarness();
  let visible = false;
  let loads = 0;
  let mounts = 0;
  const coordinator = createFullPlayerWarmupCoordinator({
    load: async () => {
      loads += 1;
    },
    requestMount: () => {
      mounts += 1;
    },
    commitOpen: () => {},
    canMountClosed: () => visible,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel
  });

  coordinator.warmup();
  await flushMicrotasks();
  assert.equal(loads, 1);
  assert.equal(mounts, 0);

  visible = true;
  coordinator.warmup();
  assert.equal(loads, 1);
  assert.equal(mounts, 1);
});

test("open requested during loading waits for mount and two paint frames", async () => {
  const frames = createFrameHarness();
  const moduleLoad = deferred<void>();
  let mounts = 0;
  let opens = 0;
  const coordinator = createFullPlayerWarmupCoordinator({
    load: () => moduleLoad.promise,
    requestMount: () => {
      mounts += 1;
    },
    commitOpen: () => {
      opens += 1;
    },
    canMountClosed: () => false,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel
  });

  coordinator.requestOpen();
  coordinator.requestOpen();
  await flushMicrotasks();
  assert.equal(mounts, 0);
  assert.equal(opens, 0);

  moduleLoad.resolve();
  await flushMicrotasks();
  assert.equal(mounts, 1, "explicit open bypasses the hidden closed-mount gate");

  coordinator.notifyShellMounted();
  assert.equal(frames.pending(), 1);
  frames.runNext();
  assert.equal(opens, 0);
  frames.runNext();
  assert.equal(opens, 1);
});

test("preload failure is reported and explicit open mounts the error boundary", async () => {
  const frames = createFrameHarness();
  const expectedError = new Error("chunk failed");
  let reported: unknown = null;
  let mounts = 0;
  const coordinator = createFullPlayerWarmupCoordinator({
    load: async () => {
      throw expectedError;
    },
    requestMount: () => {
      mounts += 1;
    },
    commitOpen: () => {},
    canMountClosed: () => true,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel,
    reportLoadError: (error) => {
      reported = error;
    }
  });

  coordinator.warmup();
  await flushMicrotasks();
  assert.equal(reported, expectedError);
  assert.equal(mounts, 0);

  coordinator.requestOpen();
  assert.equal(mounts, 1);
});

test("dispose cancels paint frames and ignores late load completion", async () => {
  const frames = createFrameHarness();
  const moduleLoad = deferred<void>();
  let mounts = 0;
  let opens = 0;
  const coordinator = createFullPlayerWarmupCoordinator({
    load: () => moduleLoad.promise,
    requestMount: () => {
      mounts += 1;
    },
    commitOpen: () => {
      opens += 1;
    },
    canMountClosed: () => true,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel
  });

  coordinator.requestOpen();
  await flushMicrotasks();
  coordinator.dispose();
  moduleLoad.resolve();
  await flushMicrotasks();

  assert.equal(mounts, 0);
  assert.equal(opens, 0);

  const mountedCoordinator = createFullPlayerWarmupCoordinator({
    load: async () => {},
    requestMount: () => {},
    commitOpen: () => {
      opens += 1;
    },
    canMountClosed: () => true,
    scheduleFrame: frames.schedule,
    cancelFrame: frames.cancel
  });
  mountedCoordinator.notifyShellMounted();
  assert.equal(frames.pending(), 1);
  mountedCoordinator.dispose();
  assert.equal(frames.pending(), 0);
});
