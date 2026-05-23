import assert from "node:assert/strict";
import test from "node:test";
import { getPlaybackPollingMode } from "./usePlaybackController";

test("playback polling is off when playback is idle", () => {
  assert.deepEqual(
    getPlaybackPollingMode({
      isPlaying: false,
      isLoading: false,
      wsStatus: "disconnected",
      lastSocketActivityAt: 1000,
      now: 7000
    }),
    { kind: "off" }
  );
});

test("playback polling waits while the connected socket is fresh", () => {
  assert.deepEqual(
    getPlaybackPollingMode({
      isPlaying: true,
      isLoading: false,
      wsStatus: "connected",
      lastSocketActivityAt: 1000,
      now: 3000
    }),
    { kind: "wait-for-stale", delayMs: 3000 }
  );
});

test("playback polling falls back when the connected socket goes stale", () => {
  assert.deepEqual(
    getPlaybackPollingMode({
      isPlaying: true,
      isLoading: false,
      wsStatus: "connected",
      lastSocketActivityAt: 1000,
      now: 6000
    }),
    { kind: "interval" }
  );
});

test("playback polling falls back while socket is not connected", () => {
  assert.deepEqual(
    getPlaybackPollingMode({
      isPlaying: false,
      isLoading: true,
      wsStatus: "connecting",
      lastSocketActivityAt: 1000,
      now: 1000
    }),
    { kind: "interval" }
  );
});
