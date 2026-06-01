import assert from "node:assert/strict";
import test from "node:test";
import {
  NAVIGATION_SCROLL_STORAGE_KEY,
  NAVIGATION_STATE_STORAGE_KEY,
  normalizeNavigationStateSnapshot,
  persistNavigationScrollPosition,
  persistNavigationStateSnapshot,
  readNavigationScrollPosition,
  readNavigationStateSnapshot
} from "./navigationPersistence";
import type { UISettingsRuntime } from "./uiSettingsStorage";

interface MutableRuntime extends UISettingsRuntime {
  readonly values: Record<string, string>;
}

const createMutableRuntime = (values: Record<string, string> = {}): MutableRuntime => ({
  values,
  storage: {
    getItem: (key) => values[key] ?? null,
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    }
  },
  events: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }
});

test("readNavigationStateSnapshot restores a valid persisted page and tabs", () => {
  const runtime = createMutableRuntime({
    [NAVIGATION_STATE_STORAGE_KEY]: JSON.stringify({
      activePage: "discover",
      selectedPlaylistId: 7,
      discoverTab: "artists",
      likedCollectionTab: "albums"
    })
  });

  assert.deepEqual(readNavigationStateSnapshot({ runtime }), {
    activePage: "discover",
    selectedPlaylistId: null,
    discoverTab: "artists",
    likedCollectionTab: "albums"
  });
});

test("normalizeNavigationStateSnapshot falls back from stale page and tab values", () => {
  assert.deepEqual(
    normalizeNavigationStateSnapshot({
      activePage: "old-route",
      selectedPlaylistId: 9,
      discoverTab: "",
      likedCollectionTab: "videos"
    }),
    {
      activePage: "recommend",
      selectedPlaylistId: null,
      discoverTab: "playlists",
      likedCollectionTab: "playlists"
    }
  );
});

test("playlist id is restored only for playlist pages", () => {
  assert.deepEqual(
    normalizeNavigationStateSnapshot({
      activePage: "created-playlists",
      selectedPlaylistId: 12,
      discoverTab: "new",
      likedCollectionTab: "artists"
    }),
    {
      activePage: "created-playlists",
      selectedPlaylistId: 12,
      discoverTab: "new",
      likedCollectionTab: "artists"
    }
  );

  assert.equal(
    normalizeNavigationStateSnapshot({
      activePage: "liked",
      selectedPlaylistId: 12
    }).selectedPlaylistId,
    null
  );
});

test("persistNavigationStateSnapshot writes normalized state", () => {
  const runtime = createMutableRuntime();

  assert.equal(
    persistNavigationStateSnapshot(
      {
        activePage: "library",
        selectedPlaylistId: 5,
        discoverTab: "mvs",
        likedCollectionTab: "playlists"
      },
      { runtime }
    ),
    true
  );

  assert.deepEqual(JSON.parse(runtime.values[NAVIGATION_STATE_STORAGE_KEY] ?? "null"), {
    activePage: "library",
    selectedPlaylistId: null,
    discoverTab: "mvs",
    likedCollectionTab: "playlists"
  });
});

test("readNavigationStateSnapshot falls back when JSON is invalid", () => {
  const runtime = createMutableRuntime({
    [NAVIGATION_STATE_STORAGE_KEY]: "{"
  });

  assert.deepEqual(readNavigationStateSnapshot({ runtime }), {
    activePage: "recommend",
    selectedPlaylistId: null,
    discoverTab: "playlists",
    likedCollectionTab: "playlists"
  });
});

test("navigation scroll positions round-trip by key", () => {
  const runtime = createMutableRuntime({
    [NAVIGATION_SCROLL_STORAGE_KEY]: JSON.stringify({
      positions: {
        discover: 120,
        stale: "nope"
      }
    })
  });

  assert.equal(readNavigationScrollPosition("discover", { runtime }), 120);
  assert.equal(readNavigationScrollPosition("missing", { runtime }), 0);
  assert.equal(persistNavigationScrollPosition("created-playlists:44", 245.9, { runtime }), true);
  assert.equal(readNavigationScrollPosition("created-playlists:44", { runtime }), 245);
  assert.deepEqual(JSON.parse(runtime.values[NAVIGATION_SCROLL_STORAGE_KEY] ?? "null"), {
    positions: {
      discover: 120,
      "created-playlists:44": 245
    }
  });
});
