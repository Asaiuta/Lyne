import assert from "node:assert/strict";
import test from "node:test";
import {
  createLatestAnimationFrameScheduler,
  resolveFullPlayerLyricScrollTarget
} from "./useFullPlayerLyricAutoFocus";

test("full player lyric autofocus keeps current scroll origin when resolving the next target", () => {
  assert.equal(
    resolveFullPlayerLyricScrollTarget({
      containerScrollTop: 1200,
      containerHeight: 800,
      lineOffsetFromViewportTop: 500,
      lineHeight: 80,
      scrollOffset: 0.25
    }),
    1540
  );
});

test("full player lyric autofocus clamps negative scroll targets to the top", () => {
  assert.equal(
    resolveFullPlayerLyricScrollTarget({
      containerScrollTop: 80,
      containerHeight: 800,
      lineOffsetFromViewportTop: 40,
      lineHeight: 80,
      scrollOffset: 0.5
    }),
    0
  );
});

test("full player lyric autofocus clamps configured lyric offsets to a useful range", () => {
  assert.equal(
    resolveFullPlayerLyricScrollTarget({
      containerScrollTop: 0,
      containerHeight: 800,
      lineOffsetFromViewportTop: 720,
      lineHeight: 80,
      scrollOffset: 2
    }),
    40
  );
});

test("full player lyric autofocus scheduler keeps only the latest task per frame", () => {
  const callbacks: Array<() => void> = [];
  const cancelled: number[] = [];
  const scheduler = createLatestAnimationFrameScheduler(
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    (handle) => cancelled.push(handle)
  );
  const calls: string[] = [];

  scheduler.schedule(() => calls.push("first"));
  scheduler.schedule(() => calls.push("latest"));
  assert.equal(callbacks.length, 1);
  callbacks[0]?.();
  assert.deepEqual(calls, ["latest"]);
  assert.deepEqual(cancelled, []);
});

test("full player lyric autofocus scheduler cancels pending work", () => {
  const callbacks: Array<() => void> = [];
  const cancelled: number[] = [];
  const scheduler = createLatestAnimationFrameScheduler(
    (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    },
    (handle) => cancelled.push(handle)
  );

  scheduler.schedule(() => {});
  scheduler.cancel();
  callbacks[0]?.();

  assert.deepEqual(cancelled, [1]);
});
