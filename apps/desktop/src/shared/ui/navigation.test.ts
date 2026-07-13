import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_PAGES, isOnlineOnlyPage, isPlaceholderPage, isSearchEnabledPage } from "./navigation";

test("top-nav search is available on every content page", () => {
  for (const page of ACTIVE_PAGES) {
    assert.equal(isSearchEnabledPage(page), true);
  }
});

test("online search page is online-only", () => {
  assert.equal(isSearchEnabledPage("search"), true);
  assert.equal(isOnlineOnlyPage("search"), true);
  assert.equal(isPlaceholderPage("search"), false);
});

test("detail pages are online-only, searchable, and not placeholders", () => {
  for (const page of [
    "album-detail",
    "playlist-detail",
    "daily-songs",
    "artist-detail",
    "video-detail",
    "radio-detail"
  ] as const) {
    assert.equal(isOnlineOnlyPage(page), true);
    assert.equal(isSearchEnabledPage(page), true);
    assert.equal(isPlaceholderPage(page), false);
  }
});

test("library remains local content while top-nav search stays enabled", () => {
  assert.equal(isSearchEnabledPage("library"), true);
  assert.equal(isOnlineOnlyPage("library"), false);
});
