import assert from "node:assert/strict";
import test from "node:test";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaylistDetailInfo } from "../playlistParsers";
import type { OnlineTrackItem } from "./types";
import {
  createPlaylistDetailCache,
  shouldRefreshPlaylistDetailCache,
  type PlaylistDetailCacheStorage
} from "./playlistDetailCache";

const createMemoryStorage = (): PlaylistDetailCacheStorage & { keys: () => string[] } => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()]
  };
};

const playlist = (input: {
  id: number;
  trackCount?: number | null;
  updateTime?: number | null;
}): OnlinePlaylistSummary => ({
  id: input.id,
  name: `Playlist ${input.id}`,
  userId: 42,
  creatorId: 42,
  creator: "Creator",
  coverUrl: "https://p1.music.126.net/cover.jpg",
  trackCount: "trackCount" in input ? input.trackCount ?? null : 2,
  playCount: 10,
  description: "cached",
  tags: ["流行"],
  createTime: 100,
  updateTime: "updateTime" in input ? input.updateTime ?? null : 200,
  privacy: 0,
  subscribed: false
});

const detail = (summary: OnlinePlaylistSummary): PlaylistDetailInfo => ({
  ...summary,
  commentCount: 3,
  shareCount: 4,
  bookedCount: 5
});

const track = (id: number): OnlineTrackItem => ({
  id: `ncm:${id}`,
  source_path: `ncm://song/${id}`,
  songId: id,
  title: `Song ${id}`,
  artist: "Artist",
  album: "Album",
  duration_secs: 180,
  artworkUrl: null,
  size_bytes: null,
  qualityLabel: null,
  privilegeTag: null,
  explicit: false,
  originalTag: null,
  mvId: null,
  isCloud: false
});

test("playlist detail cache restores a persisted snapshot in a new cache instance", () => {
  const storage = createMemoryStorage();
  const firstCache = createPlaylistDetailCache(() => storage);
  const originalPlaylist = playlist({ id: 1 });
  firstCache.write({
    playlist: originalPlaylist,
    detailInfo: detail(originalPlaylist),
    tracks: [track(1), track(2)]
  });

  const secondCache = createPlaylistDetailCache(() => storage);
  const restored = secondCache.read(1);

  assert.equal(restored?.playlist.id, 1);
  assert.deepEqual(restored?.tracks.map((item) => item.songId), [1, 2]);
  assert.equal(restored?.detailInfo?.commentCount, 3);
});

test("playlist detail cache evicts older persisted entries while keeping memory snapshots", () => {
  const storage = createMemoryStorage();
  const cache = createPlaylistDetailCache(() => storage);

  for (let id = 1; id <= 7; id += 1) {
    const summary = playlist({ id });
    cache.write({ playlist: summary, detailInfo: detail(summary), tracks: [track(id)] });
  }

  assert.equal(cache.read(1)?.playlist.id, 1);
  assert.equal(createPlaylistDetailCache(() => storage).read(1), null);
  assert.equal(createPlaylistDetailCache(() => storage).read(7)?.playlist.id, 7);
});

test("playlist detail cache update check follows timestamp then count rule", () => {
  const cachedPlaylist = playlist({ id: 1, trackCount: 2, updateTime: 100 });
  const cached = {
    playlist: cachedPlaylist,
    detailInfo: detail(cachedPlaylist),
    tracks: [track(1), track(2)],
    savedAt: 1
  };

  assert.equal(
    shouldRefreshPlaylistDetailCache(cached, playlist({ id: 1, trackCount: 2, updateTime: 100 })),
    false
  );
  assert.equal(
    shouldRefreshPlaylistDetailCache(cached, playlist({ id: 1, trackCount: 2, updateTime: 101 })),
    true
  );
  assert.equal(
    shouldRefreshPlaylistDetailCache(
      { ...cached, playlist: playlist({ id: 1, trackCount: 2, updateTime: null }) },
      playlist({ id: 1, trackCount: 3, updateTime: null })
    ),
    true
  );
});
