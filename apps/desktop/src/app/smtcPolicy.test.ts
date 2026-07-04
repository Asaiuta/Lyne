import assert from "node:assert/strict";
import test from "node:test";
import {
  SMTC_TIMELINE_INTERVAL_MS,
  hasSmtcTrack,
  isValidSmtcSeekPosition,
  normalizeSmtcCoverUrl,
  normalizeSmtcDurationSec,
  shouldPushSmtcTransition,
  shouldRouteSmtcControl,
  smtcMetadataKey,
  type SmtcMetadataSnapshot
} from "./smtcPolicy";

const snapshot = (overrides: Partial<SmtcMetadataSnapshot> = {}): SmtcMetadataSnapshot => ({
  title: "Song",
  artist: "Artist",
  album: "Album",
  coverUrl: "https://example.com/cover.jpg",
  durationSec: 200,
  ...overrides
});

/** The node-assert shim in `test-node.d.ts` only declares `equal`/`deepEqual`;
 *  express inequality through it instead of `notStrictEqual`. */
const assertKeysDiffer = (left: string, right: string) =>
  assert.equal(left === right, false, `expected keys to differ, both were: ${left}`);

/** Simulates the bridge's SMTC invoke sources over a period of playback.
 *
 *  The metadata effect in `useSmtcBridge` is `on(metadataKey, ...)` — a memo
 *  over this key — so per-frame position updates can never re-run it: the key
 *  reads no position signal. The playback-transition effect is
 *  `on(isPlaying, ...)` with the payload read under `untrack`, and the
 *  steady-state timeline flow is a coarse interval gated on enabled+playing.
 *
 *  Both `on(...)` effects use `defer: true`, so the mount-time value is
 *  recorded but does not push (the registration effect owns the initial
 *  push); `initialMetadataKey`/`initialPlaying` model that recorded value.
 */
const simulateSmtcPushes = (options: {
  enabled: boolean;
  durationMs: number;
  playing: boolean;
  initialMetadataKey: string;
  metadataKeys: readonly string[];
  playingTransitions: readonly boolean[];
  initialPlaying: boolean;
}): { metadataPushes: number; transitionPushes: number; intervalPushes: number } => {
  let previousKey: string = options.initialMetadataKey;
  let metadataPushes = 0;
  for (const key of options.metadataKeys) {
    // The memo dedupes equal recomputations; only key CHANGES reach the effect.
    if (key !== previousKey && options.enabled) {
      metadataPushes += 1;
    }
    previousKey = key;
  }

  let previousPlaying: boolean | undefined = options.initialPlaying;
  let transitionPushes = 0;
  for (const playing of options.playingTransitions) {
    if (shouldPushSmtcTransition(options.enabled, previousPlaying, playing)) {
      transitionPushes += 1;
    }
    previousPlaying = playing;
  }

  const intervalPushes =
    options.enabled && options.playing
      ? Math.floor(options.durationMs / SMTC_TIMELINE_INTERVAL_MS)
      : 0;
  return { metadataPushes, transitionPushes, intervalPushes };
};

test("steady playback produces only coarse timeline pushes: 60s stays at interval cadence", () => {
  // 60 seconds of uninterrupted playback: ~3600 position frames occur, but
  // the metadata key never changes and isPlaying never flips, so total IPC is
  // the 5s interval alone: 12 pushes, not ~3600.
  const key = smtcMetadataKey(snapshot());
  const { metadataPushes, transitionPushes, intervalPushes } = simulateSmtcPushes({
    enabled: true,
    durationMs: 60_000,
    playing: true,
    initialMetadataKey: key,
    metadataKeys: Array<string>(3600).fill(key),
    playingTransitions: Array<boolean>(3600).fill(true),
    initialPlaying: true
  });
  assert.equal(metadataPushes, 0);
  assert.equal(transitionPushes, 0);
  assert.equal(intervalPushes, 12);
});

test("a track change mid-playback pushes metadata exactly once", () => {
  const first = smtcMetadataKey(snapshot());
  const second = smtcMetadataKey(snapshot({ title: "Next Track", durationSec: 180 }));
  const { metadataPushes } = simulateSmtcPushes({
    enabled: true,
    durationMs: 10_000,
    playing: true,
    initialMetadataKey: first,
    metadataKeys: [...Array<string>(50).fill(first), ...Array<string>(50).fill(second)],
    playingTransitions: [],
    initialPlaying: true
  });
  assert.equal(metadataPushes, 1);
});

test("play/pause transitions push exactly once each", () => {
  const { transitionPushes } = simulateSmtcPushes({
    enabled: true,
    durationMs: 0,
    playing: false,
    initialMetadataKey: smtcMetadataKey(snapshot()),
    metadataKeys: [],
    playingTransitions: [true, true, false, false, true],
    initialPlaying: false
  });
  assert.equal(transitionPushes, 3);
});

test("disabled bridge pushes nothing", () => {
  const { metadataPushes, transitionPushes, intervalPushes } = simulateSmtcPushes({
    enabled: false,
    durationMs: 60_000,
    playing: true,
    initialMetadataKey: smtcMetadataKey(snapshot({ title: "Before" })),
    metadataKeys: [smtcMetadataKey(snapshot()), smtcMetadataKey(snapshot({ title: "Other" }))],
    playingTransitions: [true, false, true],
    initialPlaying: false
  });
  assert.equal(metadataPushes, 0);
  assert.equal(transitionPushes, 0);
  assert.equal(intervalPushes, 0);
});

test("first observed play state change (no recorded prior input) still pushes", () => {
  // `on(..., { defer: true })` records no previous input until the callback
  // has run once; the first real transition must not be swallowed.
  assert.equal(shouldPushSmtcTransition(true, undefined, true), true);
});

test("equal play state pushes nothing", () => {
  assert.equal(shouldPushSmtcTransition(true, true, true), false);
  assert.equal(shouldPushSmtcTransition(true, false, false), false);
});

test("metadata key changes when any identity field changes", () => {
  const base = smtcMetadataKey(snapshot());
  assertKeysDiffer(smtcMetadataKey(snapshot({ title: "Other" })), base);
  assertKeysDiffer(smtcMetadataKey(snapshot({ artist: "Other" })), base);
  assertKeysDiffer(smtcMetadataKey(snapshot({ album: null })), base);
  assertKeysDiffer(smtcMetadataKey(snapshot({ coverUrl: null })), base);
  assertKeysDiffer(smtcMetadataKey(snapshot({ durationSec: 201 })), base);
});

test("metadata key is stable for identical snapshots", () => {
  assert.equal(smtcMetadataKey(snapshot()), smtcMetadataKey(snapshot()));
});

test("metadata key does not collide across field boundaries", () => {
  // Space-separated joins would make ("a b", "c") equal ("a", "b c").
  const left = smtcMetadataKey(snapshot({ title: "a b", artist: "c" }));
  const right = smtcMetadataKey(snapshot({ title: "a", artist: "b c" }));
  assertKeysDiffer(left, right);
});

test("empty title means no loaded track", () => {
  assert.equal(hasSmtcTrack(""), false);
  assert.equal(hasSmtcTrack("   "), false);
  assert.equal(hasSmtcTrack("Song"), true);
});

test("cover url keeps absolute http(s) urls, including embedded query tokens", () => {
  assert.equal(
    normalizeSmtcCoverUrl("http://127.0.0.1:63790/domain/media_items/cover_art?media_id=m&token=abc"),
    "http://127.0.0.1:63790/domain/media_items/cover_art?media_id=m&token=abc"
  );
  assert.equal(
    normalizeSmtcCoverUrl("https://p1.music.126.net/foo/109951.jpg"),
    "https://p1.music.126.net/foo/109951.jpg"
  );
  assert.equal(normalizeSmtcCoverUrl("HTTPS://EXAMPLE.COM/A.JPG"), "HTTPS://EXAMPLE.COM/A.JPG");
  assert.equal(normalizeSmtcCoverUrl("file:///C:/covers/a.jpg"), "file:///C:/covers/a.jpg");
  assert.equal(normalizeSmtcCoverUrl("  https://example.com/a.jpg  "), "https://example.com/a.jpg");
});

test("cover url drops webview-relative and unusable values", () => {
  // The renderer's default artwork fallback: meaningless outside the webview.
  assert.equal(normalizeSmtcCoverUrl("/images/song.jpg"), null);
  assert.equal(normalizeSmtcCoverUrl("images/song.jpg"), null);
  assert.equal(normalizeSmtcCoverUrl("data:image/png;base64,AAAA"), null);
  assert.equal(normalizeSmtcCoverUrl(""), null);
  assert.equal(normalizeSmtcCoverUrl(null), null);
});

test("unknown duration (engine reports 0) is treated as absent", () => {
  assert.equal(normalizeSmtcDurationSec(0), null);
  assert.equal(normalizeSmtcDurationSec(-1), null);
  assert.equal(normalizeSmtcDurationSec(Number.NaN), null);
  assert.equal(normalizeSmtcDurationSec(null), null);
  assert.equal(normalizeSmtcDurationSec(207.4), 207.4);
});

test("control routing is gated on the enabled setting", () => {
  assert.equal(shouldRouteSmtcControl(true), true);
  assert.equal(shouldRouteSmtcControl(false), false);
});

test("seek positions must be finite non-negative numbers", () => {
  assert.equal(isValidSmtcSeekPosition(93.5), true);
  assert.equal(isValidSmtcSeekPosition(0), true);
  assert.equal(isValidSmtcSeekPosition(-2), false);
  assert.equal(isValidSmtcSeekPosition(Number.NaN), false);
  assert.equal(isValidSmtcSeekPosition(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidSmtcSeekPosition(undefined), false);
  assert.equal(isValidSmtcSeekPosition("10"), false);
});
