import assert from "node:assert/strict";
import test from "node:test";
import {
  formatMediaDuration,
  resolveMediaListArtworkUrl
} from "./mediaListFormatting";

test("resolveMediaListArtworkUrl requests a 100px NCM thumbnail for online songs", () => {
  assert.equal(
    resolveMediaListArtworkUrl("https://p1.music.126.net/image/cover.jpg", 123),
    "https://p1.music.126.net/image/cover.jpg?param=100y100"
  );
});

test("resolveMediaListArtworkUrl preserves local and non-NCM artwork URLs", () => {
  assert.equal(
    resolveMediaListArtworkUrl("http://127.0.0.1:3000/domain/library/cover/track", 123),
    "http://127.0.0.1:3000/domain/library/cover/track"
  );
  assert.equal(
    resolveMediaListArtworkUrl("https://example.com/image/cover.jpg", 123),
    "https://example.com/image/cover.jpg"
  );
});

test("resolveMediaListArtworkUrl preserves artwork without an online song id", () => {
  assert.equal(
    resolveMediaListArtworkUrl("https://p1.music.126.net/image/cover.jpg", undefined),
    "https://p1.music.126.net/image/cover.jpg"
  );
});

test("formatMediaDuration renders M:SS for valid seconds", () => {
  assert.equal(formatMediaDuration(0), "0:00");
  assert.equal(formatMediaDuration(75), "1:15");
});

test("formatMediaDuration falls back to em dash for null and non-finite", () => {
  assert.equal(formatMediaDuration(null), "—");
  assert.equal(formatMediaDuration(Number.NaN), "—");
});
