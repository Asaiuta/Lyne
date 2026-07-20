import assert from "node:assert/strict";
import test from "node:test";

import libraryPlaylistsSource from "./LibraryPlaylistsView.tsx?raw";

test("a selected local playlist renders its tracks instead of the playlist overview", () => {
  assert.equal(/when=\{selectedPlaylist\(\)\}/.test(libraryPlaylistsSource), true);
  assert.equal(/<MediaList\b/.test(libraryPlaylistsSource), true);
  assert.equal(/items=\{selectedPlaylistItems\(\)\}/.test(libraryPlaylistsSource), true);
  assert.equal(
    /emptyState=\{t\("library\.playlists\.emptyTracks"\)\}/.test(libraryPlaylistsSource),
    true
  );
});

test("the unselected playlists destination keeps the existing cover-grid overview", () => {
  assert.equal(/fallback=\{[\s\S]*local-playlist-grid-view/.test(libraryPlaylistsSource), true);
  assert.equal(/<For each=\{props\.playlists\}>/.test(libraryPlaylistsSource), true);
});

test("selected playlist rows keep playback identity and removal actions", () => {
  assert.equal(/currentSourcePath=\{props\.currentTrackPath\}/.test(libraryPlaylistsSource), true);
  assert.equal(/currentMediaId=\{props\.currentMediaId\}/.test(libraryPlaylistsSource), true);
  assert.equal(/"delete-from-playlist"/.test(libraryPlaylistsSource), true);
});
