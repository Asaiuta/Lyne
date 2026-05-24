import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_PLAYER_LYRIC_WINDOW_AFTER,
  FULL_PLAYER_LYRIC_WINDOW_BEFORE,
  resolveFullPlayerLyricWindow,
  resolveFullPlayerLyricWindows
} from "./fullPlayerLyricsVirtualization";

test("full player lyrics keep short lyric sets unvirtualized", () => {
  assert.deepEqual(
    resolveFullPlayerLyricWindow({ totalLines: 24, activeIndex: 12 }),
    { start: 0, end: 24, virtualized: false }
  );
});

test("full player lyrics bound long lyric windows around the active line", () => {
  const window = resolveFullPlayerLyricWindow({ totalLines: 300, activeIndex: 150 });
  assert.equal(window.virtualized, true);
  assert.equal(window.start, 150 - FULL_PLAYER_LYRIC_WINDOW_BEFORE);
  assert.equal(window.end, 150 + FULL_PLAYER_LYRIC_WINDOW_AFTER + 1);
  assert.equal(window.end - window.start, FULL_PLAYER_LYRIC_WINDOW_BEFORE + FULL_PLAYER_LYRIC_WINDOW_AFTER + 1);
});

test("full player lyrics clamp windows at the beginning and end", () => {
  const firstWindow = resolveFullPlayerLyricWindow({ totalLines: 300, activeIndex: 3 });
  assert.equal(firstWindow.start, 0);
  assert.equal(firstWindow.end, FULL_PLAYER_LYRIC_WINDOW_BEFORE + FULL_PLAYER_LYRIC_WINDOW_AFTER + 1);

  const lastWindow = resolveFullPlayerLyricWindow({ totalLines: 300, activeIndex: 298 });
  assert.equal(lastWindow.end, 300);
  assert.equal(lastWindow.start, 300 - (FULL_PLAYER_LYRIC_WINDOW_BEFORE + FULL_PLAYER_LYRIC_WINDOW_AFTER + 1));
});

test("full player lyrics include both active and manually scrolled windows", () => {
  const windows = resolveFullPlayerLyricWindows({
    totalLines: 300,
    activeIndex: 20,
    scrollTop: 220 * 128,
    viewportHeight: 512
  });

  assert.equal(windows.length, 2);
  assert.deepEqual(windows[0], { start: 0, end: FULL_PLAYER_LYRIC_WINDOW_BEFORE + FULL_PLAYER_LYRIC_WINDOW_AFTER + 1 });
  assert.equal(windows[1].start < 220, true);
  assert.equal(windows[1].end > 220, true);
});
