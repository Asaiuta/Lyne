import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COVER_ART_URL, resolveArtworkUrl } from "./artwork";

const urls = {
  getCoverArtUrl: (mediaId: string) => `http://127.0.0.1/cover?media_id=${mediaId}`
};

test("resolveArtworkUrl prefers external artwork", () => {
  assert.equal(
    resolveArtworkUrl({
      externalArtworkUrl: "https://img.example/cover.jpg",
      mediaId: "media-1",
      hasCoverArt: true,
      urls,
      fallbackUrl: DEFAULT_COVER_ART_URL
    }),
    "https://img.example/cover.jpg"
  );
});

test("resolveArtworkUrl uses local cover endpoint when embedded art exists", () => {
  assert.equal(
    resolveArtworkUrl({
      mediaId: "media-1",
      hasCoverArt: true,
      urls,
      fallbackUrl: DEFAULT_COVER_ART_URL
    }),
    "http://127.0.0.1/cover?media_id=media-1"
  );
});

test("resolveArtworkUrl can fall back to the default song image", () => {
  assert.equal(
    resolveArtworkUrl({
      mediaId: "media-1",
      hasCoverArt: false,
      urls,
      fallbackUrl: DEFAULT_COVER_ART_URL
    }),
    DEFAULT_COVER_ART_URL
  );
});

test("resolveArtworkUrl returns null when no fallback is requested", () => {
  assert.equal(
    resolveArtworkUrl({
      mediaId: "media-1",
      hasCoverArt: false,
      urls
    }),
    null
  );
});
