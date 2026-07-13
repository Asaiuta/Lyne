import type { ApiClient, NcmPlaylistSummary } from "../../shared/api/client";
import type { DiscoverCardItem, FeedCardItem } from "./shared/types";

export type UserPlaylistMode = "created-playlists" | "collected-playlists";

export type OnlinePlaylistSummary = NcmPlaylistSummary;

type UserPlaylistApi = Pick<ApiClient, "listNcmUserPlaylists">;

export interface UserPlaylistGroups {
  created: OnlinePlaylistSummary[];
  collected: OnlinePlaylistSummary[];
}

const USER_PLAYLIST_PAGE_SIZE = 100;
const USER_PLAYLIST_MAX_PAGES = 50;

export const createOnlinePlaylistSummary = (input: {
  id: number;
  name: string;
  userId?: number | null;
  creatorId?: number | null;
  creator?: string | null;
  coverUrl?: string | null;
  trackCount?: number | null;
  playCount?: number | null;
  description?: string | null;
  tags?: readonly string[];
  createTime?: number | null;
  updateTime?: number | null;
  privacy?: number | null;
  subscribed?: boolean;
}): OnlinePlaylistSummary => ({
  id: input.id,
  name: input.name,
  userId: input.userId ?? null,
  creatorId: input.creatorId ?? null,
  creator: input.creator ?? null,
  coverUrl: input.coverUrl ?? null,
  trackCount: input.trackCount ?? null,
  playCount: input.playCount ?? null,
  description: input.description ?? null,
  tags: [...(input.tags ?? [])],
  createTime: input.createTime ?? null,
  updateTime: input.updateTime ?? null,
  privacy: input.privacy ?? null,
  subscribed: input.subscribed ?? false
});

export const playlistSummaryFromFeedCard = (item: FeedCardItem): OnlinePlaylistSummary =>
  createOnlinePlaylistSummary({
    id: item.id,
    name: item.title,
    creator: item.subtitle,
    coverUrl: item.coverUrl,
    playCount: item.playCount,
    description: item.description
  });

export const playlistSummaryFromDiscoverCard = (item: DiscoverCardItem): OnlinePlaylistSummary =>
  createOnlinePlaylistSummary({
    id: item.id,
    name: item.title,
    userId: item.userId,
    creatorId: item.creatorId,
    creator: item.subtitle,
    coverUrl: item.coverUrl,
    trackCount: item.trackCount,
    playCount: item.playCount,
    description: item.description,
    tags: item.tags,
    createTime: item.createTime,
    updateTime: item.updateTime,
    privacy: item.privacy,
    subscribed: item.subscribed
  });

export const groupUserPlaylistsByOwnership = (
  playlists: readonly OnlinePlaylistSummary[],
  userId: number
): UserPlaylistGroups => {
  const ownPlaylists = playlists.filter((playlist) => playlist.userId === userId);
  return {
    created: ownPlaylists.slice(1),
    collected: playlists.filter((playlist) => playlist.userId !== userId)
  };
};

export const loadAllNcmUserPlaylists = async (
  api: UserPlaylistApi,
  userId: number
): Promise<OnlinePlaylistSummary[]> => {
  const playlists: OnlinePlaylistSummary[] = [];
  const seenIds = new Set<number>();

  for (let page = 0; page < USER_PLAYLIST_MAX_PAGES; page += 1) {
    const offset = page * USER_PLAYLIST_PAGE_SIZE;
    const pageItems = await api.listNcmUserPlaylists({
      uid: userId,
      limit: USER_PLAYLIST_PAGE_SIZE,
      offset
    });
    const previousSize = seenIds.size;
    for (const playlist of pageItems) {
      if (seenIds.has(playlist.id)) {
        continue;
      }
      seenIds.add(playlist.id);
      playlists.push(playlist);
    }
    if (pageItems.length < USER_PLAYLIST_PAGE_SIZE || seenIds.size === previousSize) {
      break;
    }
  }

  return playlists;
};

export const loadNcmUserPlaylistGroups = async (
  api: UserPlaylistApi,
  userId: number
): Promise<UserPlaylistGroups> => groupUserPlaylistsByOwnership(
  await loadAllNcmUserPlaylists(api, userId),
  userId
);

export const loadNcmUserPlaylistsByMode = async (
  api: UserPlaylistApi,
  userId: number,
  mode: UserPlaylistMode
): Promise<OnlinePlaylistSummary[]> => {
  const groups = await loadNcmUserPlaylistGroups(api, userId);
  return mode === "created-playlists" ? groups.created : groups.collected;
};
