import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTIVE_PAGES,
  DEFAULT_LIBRARY_DESTINATION,
  LIBRARY_TABS,
  isOnlineOnlyPage,
  isPlaceholderPage,
  isSearchEnabledPage,
  libraryDestinationMotionKey,
  libraryDestinationToTab,
  libraryDestinationsEqual,
  normalizeLibraryDestination,
  normalizeOfflineLibraryDestination
} from "./navigation";

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

test("library destinations normalize every supported tab and playlist", () => {
  for (const tab of LIBRARY_TABS) {
    assert.deepEqual(normalizeLibraryDestination({ kind: "tab", tab }), { kind: "tab", tab });
  }

  assert.deepEqual(
    normalizeLibraryDestination({ kind: "playlist", playlistId: "  local-42  " }),
    { kind: "playlist", playlistId: "local-42" }
  );
  assert.equal(
    libraryDestinationToTab({ kind: "playlist", playlistId: "local-42" }),
    "playlists"
  );
});

test("invalid library destinations fall back to songs", () => {
  for (const value of [
    null,
    "albums",
    { kind: "tab", tab: "unknown" },
    { kind: "playlist", playlistId: "" },
    { kind: "playlist", playlistId: 42 }
  ]) {
    assert.deepEqual(normalizeLibraryDestination(value), DEFAULT_LIBRARY_DESTINATION);
  }
});

test("library destination equality includes tab and playlist identity", () => {
  assert.equal(
    libraryDestinationsEqual(
      { kind: "tab", tab: "albums" },
      { kind: "tab", tab: "albums" }
    ),
    true
  );
  assert.equal(
    libraryDestinationsEqual(
      { kind: "playlist", playlistId: "one" },
      { kind: "playlist", playlistId: "two" }
    ),
    false
  );
  assert.equal(
    libraryDestinationsEqual(
      { kind: "tab", tab: "playlists" },
      { kind: "playlist", playlistId: "one" }
    ),
    false
  );
});

test("library destination motion keys are stable and preserve playlist identity", () => {
  assert.deepEqual(
    LIBRARY_TABS.map((tab) =>
      libraryDestinationMotionKey({ kind: "tab", tab })
    ),
    LIBRARY_TABS.map((tab) => `tab:${tab}`)
  );
  assert.equal(
    libraryDestinationMotionKey({ kind: "playlist", playlistId: "local-42" }),
    "playlist:local-42"
  );
  assert.equal(
    libraryDestinationMotionKey({ kind: "tab", tab: "playlists" }) ===
      libraryDestinationMotionKey({
        kind: "playlist",
        playlistId: "playlists"
      }),
    false
  );
});

test("offline normalization removes only the playlist overview destination", () => {
  assert.deepEqual(
    normalizeOfflineLibraryDestination({ kind: "tab", tab: "playlists" }),
    DEFAULT_LIBRARY_DESTINATION
  );
  assert.deepEqual(
    normalizeOfflineLibraryDestination({ kind: "playlist", playlistId: "local-42" }),
    { kind: "playlist", playlistId: "local-42" }
  );
  assert.deepEqual(
    normalizeOfflineLibraryDestination({ kind: "tab", tab: "artists" }),
    { kind: "tab", tab: "artists" }
  );
});
