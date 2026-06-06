import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPlaybackDisplayPosition,
  resolvePlaybackDisplayAnchorPosition,
  resolvePlaybackDisplayPosition,
  type PlaybackDisplayClockAnchor,
  type PlaybackDisplayClockSource
} from "./playbackDisplayClock";

const source = (
  overrides: Partial<PlaybackDisplayClockSource> = {}
): PlaybackDisplayClockSource => ({
  livePosition: null,
  playerPosition: null,
  duration: 240,
  isPlaying: false,
  trackKey: "track-1",
  ...overrides
});

test("playback display clock interpolates from the anchor while playing", () => {
  const anchor: PlaybackDisplayClockAnchor = {
    position: 42,
    observedAtMs: 1000,
    isPlaying: true,
    duration: 240
  };

  assert.equal(resolvePlaybackDisplayPosition(anchor, 1500), 42.5);
});

test("playback display clock freezes when paused", () => {
  const anchor: PlaybackDisplayClockAnchor = {
    position: 42,
    observedAtMs: 1000,
    isPlaying: false,
    duration: 240
  };

  assert.equal(resolvePlaybackDisplayPosition(anchor, 2500), 42);
});

test("playback display clock clamps invalid and over-duration positions", () => {
  assert.equal(clampPlaybackDisplayPosition(-5, 240), 0);
  assert.equal(clampPlaybackDisplayPosition(245, 240), 240);
  assert.equal(clampPlaybackDisplayPosition(Number.NaN, 240), 0);
});

test("live position updates win over stale player snapshots", () => {
  const previous = source({
    livePosition: 10,
    playerPosition: 9,
    isPlaying: true
  });
  const next = source({
    livePosition: 11,
    playerPosition: 9,
    isPlaying: true
  });

  assert.equal(resolvePlaybackDisplayAnchorPosition(next, previous, 10.5), 11);
});

test("player position updates win when the raw live position did not change", () => {
  const previous = source({
    livePosition: 10,
    playerPosition: 10,
    isPlaying: true
  });
  const next = source({
    livePosition: 10,
    playerPosition: 12,
    isPlaying: true
  });

  assert.equal(resolvePlaybackDisplayAnchorPosition(next, previous, 10.5), 12);
});

test("track changes snap to the new track position even without a live update", () => {
  const previous = source({
    livePosition: 98,
    playerPosition: 98,
    isPlaying: true,
    trackKey: "old-track"
  });
  const next = source({
    livePosition: 98,
    playerPosition: 0,
    isPlaying: false,
    trackKey: "new-track"
  });

  assert.equal(resolvePlaybackDisplayAnchorPosition(next, previous, 99), 0);
});

test("playback state changes without a new position freeze at the displayed time", () => {
  const previous = source({
    livePosition: 10,
    playerPosition: 10,
    isPlaying: true
  });
  const next = source({
    livePosition: 10,
    playerPosition: 10,
    isPlaying: false
  });

  assert.equal(resolvePlaybackDisplayAnchorPosition(next, previous, 10.75), 10.75);
});
