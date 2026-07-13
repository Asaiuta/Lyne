import type { ApiClient } from "../../shared/api/client";
import {
  groupUserPlaylistsByOwnership,
  loadAllNcmUserPlaylists,
  type OnlinePlaylistSummary,
  type UserPlaylistGroups,
  type UserPlaylistMode
} from "./ncmPlaylistSummary";

type UserPlaylistApi = Pick<ApiClient, "listNcmUserPlaylists">;
type UserPlaylistListener = (groups: UserPlaylistGroups) => void;

interface UserPlaylistCacheEntry {
  groups: UserPlaylistGroups | null;
  likedPlaylist: OnlinePlaylistSummary | null;
  inFlight: Promise<UserPlaylistGroups> | null;
  listeners: Set<UserPlaylistListener>;
}

const emptyGroups = (): UserPlaylistGroups => ({
  created: [],
  collected: []
});

export interface NcmUserPlaylistSummaryCache {
  load: (api: UserPlaylistApi, userId: number) => Promise<UserPlaylistGroups>;
  refresh: (api: UserPlaylistApi, userId: number) => Promise<UserPlaylistGroups>;
  peek: (userId: number) => UserPlaylistGroups | null;
  peekLikedPlaylist: (userId: number) => OnlinePlaylistSummary | null;
  subscribe: (userId: number, listener: UserPlaylistListener) => () => void;
  update: (
    userId: number,
    updater: (current: UserPlaylistGroups) => UserPlaylistGroups
  ) => UserPlaylistGroups | null;
  clear: (userId?: number) => void;
}

export const createNcmUserPlaylistSummaryCache = (): NcmUserPlaylistSummaryCache => {
  const entries = new Map<number, UserPlaylistCacheEntry>();

  const entryFor = (userId: number): UserPlaylistCacheEntry => {
    const existing = entries.get(userId);
    if (existing) return existing;
    const next: UserPlaylistCacheEntry = {
      groups: null,
      likedPlaylist: null,
      inFlight: null,
      listeners: new Set()
    };
    entries.set(userId, next);
    return next;
  };

  const notify = (entry: UserPlaylistCacheEntry) => {
    if (!entry.groups) return;
    for (const listener of entry.listeners) {
      listener(entry.groups);
    }
  };

  const fetchGroups = (api: UserPlaylistApi, userId: number, entry: UserPlaylistCacheEntry) => {
    const request = loadAllNcmUserPlaylists(api, userId)
      .then((playlists) => {
        entry.likedPlaylist =
          playlists.find((playlist) => playlist.userId === userId) ?? playlists[0] ?? null;
        return groupUserPlaylistsByOwnership(playlists, userId);
      })
      .then((groups) => {
        entry.groups = groups;
        notify(entry);
        return groups;
      })
      .finally(() => {
        if (entry.inFlight === request) {
          entry.inFlight = null;
        }
      });
    entry.inFlight = request;
    return request;
  };

  return {
    load: (api, userId) => {
      const entry = entryFor(userId);
      if (entry.groups) return Promise.resolve(entry.groups);
      if (entry.inFlight) return entry.inFlight;
      return fetchGroups(api, userId, entry);
    },
    refresh: (api, userId) => {
      const entry = entryFor(userId);
      if (entry.inFlight) return entry.inFlight;
      return fetchGroups(api, userId, entry);
    },
    peek: (userId) => entryFor(userId).groups,
    peekLikedPlaylist: (userId) => entryFor(userId).likedPlaylist,
    subscribe: (userId, listener) => {
      const entry = entryFor(userId);
      entry.listeners.add(listener);
      if (entry.groups) {
        listener(entry.groups);
      }
      return () => {
        entry.listeners.delete(listener);
      };
    },
    update: (userId, updater) => {
      const entry = entryFor(userId);
      const current = entry.groups;
      if (!current) return null;
      entry.groups = updater(current);
      notify(entry);
      return entry.groups;
    },
    clear: (userId) => {
      if (userId === undefined) {
        entries.clear();
        return;
      }
      const entry = entries.get(userId);
      if (!entry) return;
      entry.groups = null;
      entry.likedPlaylist = null;
      entry.inFlight = null;
      notify(entry);
    }
  };
};

const defaultNcmUserPlaylistSummaryCache = createNcmUserPlaylistSummaryCache();

export const loadNcmUserPlaylistGroupsCached = (api: UserPlaylistApi, userId: number) =>
  defaultNcmUserPlaylistSummaryCache.load(api, userId);

export const refreshNcmUserPlaylistGroupsCache = (api: UserPlaylistApi, userId: number) =>
  defaultNcmUserPlaylistSummaryCache.refresh(api, userId);

export const subscribeNcmUserPlaylistGroups = (
  userId: number,
  listener: UserPlaylistListener
) => defaultNcmUserPlaylistSummaryCache.subscribe(userId, listener);

export const loadNcmUserPlaylistsByModeCached = async (
  api: UserPlaylistApi,
  userId: number,
  mode: UserPlaylistMode
): Promise<OnlinePlaylistSummary[]> => {
  const groups = await loadNcmUserPlaylistGroupsCached(api, userId);
  return mode === "created-playlists" ? groups.created : groups.collected;
};

export const getNcmLikedPlaylistCached = async (
  api: UserPlaylistApi,
  userId: number
): Promise<OnlinePlaylistSummary | null> => {
  await loadNcmUserPlaylistGroupsCached(api, userId);
  return defaultNcmUserPlaylistSummaryCache.peekLikedPlaylist(userId);
};

export const updateNcmUserPlaylistSummaryCache = (
  userId: number,
  playlist: OnlinePlaylistSummary
) => defaultNcmUserPlaylistSummaryCache.update(userId, (current) => ({
  created: current.created.map((item) => (item.id === playlist.id ? playlist : item)),
  collected: current.collected.map((item) => (item.id === playlist.id ? playlist : item))
}));

export const applyNcmPlaylistSubscribeCacheUpdate = (
  userId: number,
  playlist: OnlinePlaylistSummary,
  subscribed: boolean
) => defaultNcmUserPlaylistSummaryCache.update(userId, (current) => {
  const withoutPlaylist = current.collected.filter((item) => item.id !== playlist.id);
  return {
    created: current.created.map((item) => (item.id === playlist.id ? playlist : item)),
    collected: subscribed ? [playlist, ...withoutPlaylist] : withoutPlaylist
  };
});

export const clearNcmUserPlaylistSummaryCache = (userId?: number) => {
  defaultNcmUserPlaylistSummaryCache.clear(userId);
};

export const emptyUserPlaylistGroups = emptyGroups;
