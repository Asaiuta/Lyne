import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_VISIBLE_PX,
  isDesktopLyricRectVisible,
  shouldEmitTransitionTick,
  type DesktopLyricRect
} from "./desktopLyricPolicy";

/** Simulates the bridge's emission sources over a period of playback.
 *
 *  The transition effect in `useDesktopLyricBridge` is `on(isPlaying, ...)`
 *  with the payload built under `untrack`, so position frames (~60/s) never
 *  re-run it; only player-state updates do, and the decision function filters
 *  those down to genuine play/pause transitions. Steady-state position flow
 *  is a separate 500ms interval.
 */
const simulateTickEmissions = (options: {
  active: boolean;
  durationMs: number;
  tickIntervalMs: number;
  playingTransitions: readonly boolean[];
  initialPlaying: boolean;
}): { transitionTicks: number; intervalTicks: number } => {
  let previousPlaying: boolean | undefined = options.initialPlaying;
  let transitionTicks = 0;
  for (const playing of options.playingTransitions) {
    // The effect's tracked source derives from the player-state object, which
    // can notify without the boolean changing — so the decision function must
    // see every run, including equal-value ones, and reject non-transitions
    // itself via its previousPlaying !== playing guard.
    if (shouldEmitTransitionTick(options.active, previousPlaying, playing)) {
      transitionTicks += 1;
    }
    previousPlaying = playing;
  }
  const intervalTicks = options.active
    ? Math.floor(options.durationMs / options.tickIntervalMs)
    : 0;
  return { transitionTicks, intervalTicks };
};

test("position-only updates emit no transition ticks: 5s of playback stays at interval cadence", () => {
  // 5 seconds of uninterrupted playback: ~300 position frames occur, but the
  // effect's only tracked source (isPlaying) never changes, so total IPC is
  // the 500ms interval alone: 10 ticks, not ~300.
  const { transitionTicks, intervalTicks } = simulateTickEmissions({
    active: true,
    durationMs: 5000,
    tickIntervalMs: 500,
    playingTransitions: Array<boolean>(300).fill(true),
    initialPlaying: true
  });
  assert.equal(transitionTicks, 0);
  assert.equal(intervalTicks, 10);
});

test("play/pause transitions emit exactly one immediate tick each", () => {
  const { transitionTicks } = simulateTickEmissions({
    active: true,
    durationMs: 5000,
    tickIntervalMs: 500,
    playingTransitions: [true, true, false, false, true],
    initialPlaying: false
  });
  assert.equal(transitionTicks, 3);
});

test("transition ticks are suppressed while the overlay is inactive", () => {
  assert.equal(shouldEmitTransitionTick(false, false, true), false);
  assert.equal(shouldEmitTransitionTick(false, true, false), false);
});

test("first observed change (no recorded prior input) still emits", () => {
  // `on(..., { defer: true })` records no previous input until the callback
  // has run once; the first real transition must not be swallowed.
  assert.equal(shouldEmitTransitionTick(true, undefined, true), true);
});

test("equal play state emits nothing", () => {
  assert.equal(shouldEmitTransitionTick(true, true, true), false);
  assert.equal(shouldEmitTransitionTick(true, false, false), false);
});

const monitor = (x: number, y: number, width: number, height: number): DesktopLyricRect => ({
  x,
  y,
  width,
  height
});

const OVERLAY = { width: 820, height: 180 };
const PRIMARY = monitor(0, 0, 1920, 1080);

test("stored position fully inside a monitor is visible", () => {
  assert.equal(
    isDesktopLyricRectVisible({ x: 100, y: 800, ...OVERLAY }, [PRIMARY]),
    true
  );
});

test("stored position on a removed second monitor is rejected", () => {
  // Overlay was parked on a monitor at +1920 that no longer exists.
  assert.equal(
    isDesktopLyricRectVisible({ x: 2200, y: 300, ...OVERLAY }, [PRIMARY]),
    false
  );
});

test("partially visible position with at least the minimum margin is kept", () => {
  // Hanging off the right edge but MIN_VISIBLE_PX still on-screen.
  assert.equal(
    isDesktopLyricRectVisible(
      { x: 1920 - MIN_VISIBLE_PX, y: 200, ...OVERLAY },
      [PRIMARY]
    ),
    true
  );
});

test("a sliver below the minimum visible margin is rejected", () => {
  assert.equal(
    isDesktopLyricRectVisible(
      { x: 1920 - MIN_VISIBLE_PX + 1, y: 200, ...OVERLAY },
      [PRIMARY]
    ),
    false
  );
  // Same for vertical: only a few px poking up from the bottom edge.
  assert.equal(
    isDesktopLyricRectVisible({ x: 100, y: 1080 - 10, ...OVERLAY }, [PRIMARY]),
    false
  );
});

test("multi-monitor: visible on the secondary monitor counts", () => {
  const secondary = monitor(1920, 0, 2560, 1440);
  assert.equal(
    isDesktopLyricRectVisible({ x: 2200, y: 300, ...OVERLAY }, [PRIMARY, secondary]),
    true
  );
});

test("negative-coordinate monitors (left of primary) are handled", () => {
  const left = monitor(-1920, 0, 1920, 1080);
  assert.equal(
    isDesktopLyricRectVisible({ x: -1500, y: 400, ...OVERLAY }, [PRIMARY, left]),
    true
  );
});
