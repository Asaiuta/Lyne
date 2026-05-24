import assert from "node:assert/strict";
import test from "node:test";
import { isVideoArtworkUrl, normalizeMediaUrlForDetection } from "./mediaUrls";

test("isVideoArtworkUrl detects common video extensions with query strings", () => {
  assert.equal(isVideoArtworkUrl("https://cdn.example.test/artwork/live-cover.webm?token=1"), true);
  assert.equal(isVideoArtworkUrl("https://cdn.example.test/artwork/live-cover.MP4#poster"), true);
});

test("isVideoArtworkUrl detects known NCM video artwork hosts", () => {
  assert.equal(isVideoArtworkUrl("https://vodkgeyttp9.vod.126.net/cloudmusic/example"), true);
});

test("isVideoArtworkUrl ignores normal image artwork and empty input", () => {
  assert.equal(isVideoArtworkUrl("https://img.example.test/cover.jpg?param=300y300"), false);
  assert.equal(isVideoArtworkUrl(null), false);
  assert.equal(isVideoArtworkUrl(undefined), false);
});

test("normalizeMediaUrlForDetection strips query and hash from relative paths", () => {
  assert.equal(normalizeMediaUrlForDetection("/media/cover.mov?x=1#frag"), "localhost/media/cover.mov");
});
