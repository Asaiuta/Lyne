import assert from "node:assert/strict";
import test from "node:test";
import type { NcmPlaylistSummary } from "../../shared/api/client";
import {
  groupUserPlaylistsLikeSplayer,
  loadAllNcmUserPlaylists
} from "./ncmPlaylistSummary";

const playlist = (id: number, userId: number | null): NcmPlaylistSummary => ({
  id,
  name: `Playlist ${id}`,
  userId,
  creatorId: userId,
  creator: null,
  coverUrl: null,
  trackCount: null,
  playCount: null,
  description: null,
  tags: [],
  createTime: null,
  updateTime: null,
  privacy: null,
  subscribed: userId !== 42
});

test("groups user playlists with SPlayer's created and collected rules", () => {
  const groups = groupUserPlaylistsLikeSplayer(
    [
      playlist(1, 42),
      playlist(2, 42),
      playlist(3, 7),
      playlist(4, null)
    ],
    42
  );

  assert.deepEqual(groups.created.map((item) => item.id), [2]);
  assert.deepEqual(groups.collected.map((item) => item.id), [3, 4]);
});

test("loads every user playlist page instead of stopping at the first 100", async () => {
  const pages = [
    Array.from({ length: 100 }, (_, index) => playlist(index + 1, 42)),
    [playlist(101, 7), playlist(102, 7)]
  ];
  const calls: Array<{ limit?: number; offset?: number }> = [];

  const result = await loadAllNcmUserPlaylists(
    {
      listNcmUserPlaylists: async (input) => {
        calls.push({ limit: input.limit, offset: input.offset });
        return pages[input.offset === 100 ? 1 : 0] ?? [];
      }
    },
    42
  );

  assert.equal(result.length, 102);
  assert.deepEqual(calls, [
    { limit: 100, offset: 0 },
    { limit: 100, offset: 100 }
  ]);
});
