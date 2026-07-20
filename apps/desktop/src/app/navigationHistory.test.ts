import assert from "node:assert/strict";
import test from "node:test";
import type { NavigationLocation } from "../shared/ui/navigation";
import {
  createNavigationHistory,
  enterOfflineNavigation,
  moveNavigationHistory,
  pushNavigationLocation,
  replaceNavigationLocation
} from "./navigationHistory";

const location = (
  page: NavigationLocation["page"],
  tab: "songs" | "albums" | "artists" | "playlists" | "folders" = "songs"
): NavigationLocation => ({
  page,
  libraryDestination: { kind: "tab", tab }
});

test("history records distinct destinations within the library page", () => {
  const initial = createNavigationHistory(location("library"));
  const albums = pushNavigationLocation(initial, location("library", "albums"));
  const artists = pushNavigationLocation(albums, location("library", "artists"));

  assert.equal(artists.entries.length, 3);
  assert.deepEqual(moveNavigationHistory(artists, -1).entries[1], location("library", "albums"));
  assert.equal(moveNavigationHistory(artists, -1).index, 1);
});

test("history deduplicates the current location and truncates forward entries", () => {
  const albums = pushNavigationLocation(
    createNavigationHistory(location("library")),
    location("library", "albums")
  );
  assert.equal(pushNavigationLocation(albums, location("library", "albums")), albums);

  const back = moveNavigationHistory(albums, -1);
  const folders = pushNavigationLocation(back, location("library", "folders"));
  assert.deepEqual(folders.entries, [location("library"), location("library", "folders")]);
  assert.equal(folders.index, 1);
});

test("replace changes only the current destination", () => {
  const playlist: NavigationLocation = {
    page: "library",
    libraryDestination: { kind: "playlist", playlistId: "local-42" }
  };
  const state = pushNavigationLocation(createNavigationHistory(location("library")), playlist);
  const replaced = replaceNavigationLocation(state, location("library"));

  assert.deepEqual(replaced.entries, [location("library")]);
  assert.equal(replaced.index, 0);
});

test("replace removes matching destinations on both sides of the current entry", () => {
  const playlist: NavigationLocation = {
    page: "library",
    libraryDestination: { kind: "playlist", playlistId: "deleted-local" }
  };
  const withPlaylist = pushNavigationLocation(
    createNavigationHistory(location("library")),
    playlist
  );
  const withForwardSongs = pushNavigationLocation(withPlaylist, location("library"));
  const backToPlaylist = moveNavigationHistory(withForwardSongs, -1);
  const replaced = replaceNavigationLocation(backToPlaylist, location("library"));

  assert.deepEqual(replaced.entries, [location("library")]);
  assert.equal(replaced.index, 0);
});

test("entering offline from an online page retains local history and falls back to songs", () => {
  const albums = pushNavigationLocation(
    createNavigationHistory(location("library", "albums")),
    location("search", "albums")
  );
  const offline = enterOfflineNavigation(albums);

  assert.deepEqual(offline.entries, [location("library", "albums"), location("library")]);
  assert.equal(offline.index, 1);
});

test("entering offline converts playlist overview but keeps specific local playlists", () => {
  const overview = enterOfflineNavigation(createNavigationHistory(location("library", "playlists")));
  assert.deepEqual(overview.entries, [location("library")]);

  const playlist: NavigationLocation = {
    page: "library",
    libraryDestination: { kind: "playlist", playlistId: "local-42" }
  };
  assert.deepEqual(enterOfflineNavigation(createNavigationHistory(playlist)).entries, [playlist]);
});

test("entering offline discards forward history that may contain online pages", () => {
  const search = pushNavigationLocation(
    createNavigationHistory(location("library")),
    location("search")
  );
  const recent = pushNavigationLocation(search, location("recent"));
  const backToSearch = moveNavigationHistory(recent, -1);
  const offline = enterOfflineNavigation(backToSearch);

  assert.deepEqual(offline.entries, [location("library")]);
  assert.equal(offline.index, 0);
});
