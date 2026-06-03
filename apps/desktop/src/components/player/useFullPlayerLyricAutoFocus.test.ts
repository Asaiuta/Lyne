import assert from "node:assert/strict";
import test from "node:test";
import { resolveFullPlayerLyricScrollTarget } from "./useFullPlayerLyricAutoFocus";

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
