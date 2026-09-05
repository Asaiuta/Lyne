import { createMemo, createSignal } from "solid-js";
import { songOrderUpdate } from "../../../../shared/api/ncm";
import { playlistDetailDynamic, playlistSubscribe } from "../../../../shared/api/ncm/playlist";
import type { OnlinePlaylistSummary } from "../../ncmPlaylistSummary";
import {
  createPlaylistDetailInfo,
  parsePlaylistDynamicInfo,
  type PlaylistDetailInfo
} from "../../playlistParsers";
import {
  readPlaylistDetailCache,
  shouldRefreshPlaylistDetailCache,
  writePlaylistDetailCache,
  type PlaylistDetailCacheSnapshot
} from "../playlistDetailCache";
import type { OnlineTrackItem } from "../types";
import type {
  DetailNavigationBaseContext,
  LoadPlaylistTracksOptions,
  PlaylistSubscribeCallbacks
} from "./types";

const PLAYLIST_TRACK_PAGE_SIZE = 500;

interface RefreshPlaylistTracksOptions {
  detailOverride?: OnlinePlaylistSummary;
  preserveExistingOnError?: boolean;
}

export const canUsePlaylistDetailCacheSnapshot = (
  snapshot: PlaylistDetailCacheSnapshot,
  limit?: number
): boolean => {
  if (limit === undefined) return true;
  if (snapshot.playlist.trackCount !== null && snapshot.playlist.trackCount <= limit) return true;
  return snapshot.tracks.length <= limit;
};

export interface PlaylistDetailNavigationContext
  extends DetailNavigationBaseContext,
    PlaylistSubscribeCallbacks {
  clearPeerDetailViews: (options?: { preserveLikedSelection?: boolean }) => void;
}

export function createPlaylistDetailNavigation(ctx: PlaylistDetailNavigationContext) {
  const [selectedPlaylist, setSelectedPlaylist] = createSignal<OnlinePlaylistSummary | null>(null);
  const [playlistDetailInfo, setPlaylistDetailInfo] = createSignal<PlaylistDetailInfo | null>(null);
  const [playlistTracksState, setPlaylistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = createSignal<boolean>(false);
  const [isLoadingPlaylistDetail, setIsLoadingPlaylistDetail] = createSignal<boolean>(false);
  const [isTogglingPlaylistSubscribe, setIsTogglingPlaylistSubscribe] = createSignal<boolean>(false);
  const [playlistDetailTab, setPlaylistDetailTab] = createSignal<"songs" | "comments">("songs");
  const [playlistFilter, setPlaylistFilter] = createSignal<string>("");

  const clearPlaylistDetail = (options: { resetUi?: boolean } = {}) => {
    setSelectedPlaylist(null);
    setPlaylistDetailInfo(null);
    setPlaylistTracksState([]);
    setIsLoadingPlaylistDetail(false);
    setIsTogglingPlaylistSubscribe(false);
    if (options.resetUi !== false) {
      setPlaylistDetailTab("songs");
      setPlaylistFilter("");
    }
    ctx.onSelectedPlaylistChange?.(null);
  };

  const applyPlaylistCacheSnapshot = (snapshot: PlaylistDetailCacheSnapshot) => {
    setSelectedPlaylist(snapshot.playlist);
    setPlaylistDetailInfo(snapshot.detailInfo);
    setPlaylistTracksState(snapshot.tracks);
  };

  const mergePlaylistDetail = (
    playlist: OnlinePlaylistSummary,
    current: PlaylistDetailInfo | null
  ): PlaylistDetailInfo | null =>
    current === null ? null : createPlaylistDetailInfo(playlist, current);

  const loadPlaylistDynamicInfo = async (
    playlist: OnlinePlaylistSummary,
    options: { showLoading: boolean }
  ) => {
    if (options.showLoading) {
      setIsLoadingPlaylistDetail(true);
    }
    try {
      const payload = await playlistDetailDynamic(playlist.id);
      if (selectedPlaylist()?.id !== playlist.id) return;
      setPlaylistDetailInfo(createPlaylistDetailInfo(
        selectedPlaylist() ?? playlist,
        parsePlaylistDynamicInfo(payload)
      ));
    } catch {
      if (selectedPlaylist()?.id !== playlist.id) return;
      setPlaylistDetailInfo((current) => current ?? createPlaylistDetailInfo(selectedPlaylist() ?? playlist, null));
    } finally {
      if (options.showLoading && selectedPlaylist()?.id === playlist.id) {
        setIsLoadingPlaylistDetail(false);
      }
    }
  };

  const refreshPlaylistTracksFromSource = async (
    playlist: OnlinePlaylistSummary,
    loadOptions: LoadPlaylistTracksOptions,
    refreshOptions: RefreshPlaylistTracksOptions = {}
  ): Promise<boolean> => {
    setIsLoadingPlaylistTracks(true);
    try {
      const detail = refreshOptions.detailOverride ?? await ctx.api.getNcmPlaylistDetail(playlist.id);
      if (selectedPlaylist()?.id !== playlist.id) return false;
      setSelectedPlaylist(detail);
      setPlaylistDetailInfo((current) => mergePlaylistDetail(detail, current));

      const maxTracks = loadOptions.limit ?? detail.trackCount ?? PLAYLIST_TRACK_PAGE_SIZE;
      const pageSize = Math.min(PLAYLIST_TRACK_PAGE_SIZE, Math.max(maxTracks, 1));
      const tracks: OnlineTrackItem[] = [];
      for (let offset = 0; offset < Math.max(maxTracks, 1); offset += pageSize) {
        const page = await ctx.api.listNcmPlaylistTracks({
          id: playlist.id,
          limit: pageSize,
          offset
        });
        if (selectedPlaylist()?.id !== playlist.id) return false;
        if (page.length === 0) {
          break;
        }
        tracks.push(...page);
        setPlaylistTracksState([...tracks]);
        if (page.length < pageSize || tracks.length >= maxTracks) {
          break;
        }
      }

      if (selectedPlaylist()?.id !== playlist.id) return false;
      setPlaylistTracksState(tracks);
      const dynamicInfo = playlistDetailInfo();
      writePlaylistDetailCache({
        playlist: detail,
        detailInfo: dynamicInfo?.id === detail.id ? dynamicInfo : null,
        tracks
      });
      return true;
    } catch (error) {
      if (selectedPlaylist()?.id === playlist.id) {
        if (refreshOptions.preserveExistingOnError !== true) {
          setPlaylistTracksState([]);
        }
        ctx.setFeedback("error", ctx.readErrorMessage(error));
      }
      return false;
    } finally {
      if (selectedPlaylist()?.id === playlist.id) {
        setIsLoadingPlaylistTracks(false);
      }
    }
  };

  const refreshCachedPlaylistIfNeeded = async (
    playlist: OnlinePlaylistSummary,
    cached: PlaylistDetailCacheSnapshot,
    options: LoadPlaylistTracksOptions
  ) => {
    try {
      const detail = await ctx.api.getNcmPlaylistDetail(playlist.id);
      if (selectedPlaylist()?.id !== playlist.id) return;
      setSelectedPlaylist(detail);
      setPlaylistDetailInfo((current) => mergePlaylistDetail(detail, current));
      if (shouldRefreshPlaylistDetailCache(cached, detail)) {
        await refreshPlaylistTracksFromSource(playlist, options, {
          detailOverride: detail,
          preserveExistingOnError: true
        });
        return;
      }
      writePlaylistDetailCache({
        playlist: detail,
        detailInfo: playlistDetailInfo(),
        tracks: cached.tracks
      });
    } catch (error) {
      console.warn("[playlistDetailNavigation] playlist cache background check failed", error);
    }
  };

  const loadPlaylistTracks = async (
    playlist: OnlinePlaylistSummary,
    options: LoadPlaylistTracksOptions = {}
  ) => {
    const cached = options.forceRefresh === true
      ? null
      : readPlaylistDetailCache(playlist.id);

    ctx.clearPeerDetailViews({ preserveLikedSelection: options.preserveLikedSelection === true });
    setSelectedPlaylist(playlist);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    ctx.onSelectedPlaylistChange?.(playlist.id);

    if (cached && canUsePlaylistDetailCacheSnapshot(cached, options.limit)) {
      applyPlaylistCacheSnapshot(cached);
      setIsLoadingPlaylistTracks(false);
      setIsLoadingPlaylistDetail(false);
      void loadPlaylistDynamicInfo(cached.playlist, { showLoading: false });
      void refreshCachedPlaylistIfNeeded(cached.playlist, cached, options);
      return;
    }

    setPlaylistDetailInfo(null);
    setPlaylistTracksState([]);
    void loadPlaylistDynamicInfo(playlist, { showLoading: true });
    await refreshPlaylistTracksFromSource(playlist, options);
  };

  const filteredPlaylistTracks = createMemo<OnlineTrackItem[]>(() => {
    const query = playlistFilter().trim().toLowerCase();
    if (!query) return playlistTracksState();
    return playlistTracksState().filter((item) =>
      [item.title, item.artist, item.album]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query))
    );
  });

  const playlistTrackCount = createMemo<number>(() =>
    selectedPlaylist()?.trackCount ?? playlistTracksState().length
  );

  const playlistMetaText = () => {
    const playlist = selectedPlaylist();
    return ctx.t("ncm.playlist.meta", {
      count: playlistTrackCount(),
      creator: playlist?.creator ?? ctx.t("ncm.playlist.creatorUnknown")
    });
  };

  const playAllPlaylistTracks = async () => {
    await ctx.playback.playAll(filteredPlaylistTracks());
  };

  const removePlaylistTracks = async (songIds: readonly number[]) => {
    const playlist = selectedPlaylist();
    if (!playlist || songIds.length === 0) return;
    try {
      await ctx.api.updateNcmPlaylistTracks({
        playlistId: playlist.id,
        songIds: [...songIds],
        op: "del"
      });
      const removed = new Set(songIds);
      setPlaylistTracksState((current) => current.filter((item) => !removed.has(item.songId)));
      setSelectedPlaylist((current) =>
        current && current.trackCount !== null
          ? { ...current, trackCount: Math.max(0, current.trackCount - songIds.length) }
          : current
      );
      ctx.setFeedback("success", ctx.t("ncm.playlist.removedSelected", { count: songIds.length }));
    } catch (error) {
      ctx.setFeedback("error", ctx.readErrorMessage(error));
    }
  };

  const removePlaylistTracksLocally = (songIds: readonly number[]) => {
    if (songIds.length === 0) return;
    const removed = new Set(songIds);
    setPlaylistTracksState((current) => current.filter((item) => !removed.has(item.songId)));
    setSelectedPlaylist((current) =>
      current && current.trackCount !== null
        ? { ...current, trackCount: Math.max(0, current.trackCount - songIds.length) }
        : current
    );
  };

  const updateSelectedPlaylist = (playlist: OnlinePlaylistSummary) => {
    setSelectedPlaylist(playlist);
    setPlaylistDetailInfo((current) => (
      current === null ? null : createPlaylistDetailInfo(playlist, current)
    ));
  };

  const reorderPlaylistTracks = async (fromIndex: number, toIndex: number) => {
    const playlist = selectedPlaylist();
    const current = playlistTracksState();
    if (!playlist || fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= current.length || toIndex >= current.length) return;
    const next = [...current];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    setPlaylistTracksState(next);
    try {
      await songOrderUpdate(playlist.id, next.map((item) => item.songId));
      ctx.setFeedback("success", ctx.t("ncm.playlist.reorderSaved"));
    } catch (error) {
      setPlaylistTracksState(current);
      ctx.setFeedback("error", ctx.readErrorMessage(error));
    }
  };

  const togglePlaylistSubscribe = async () => {
    const playlist = selectedPlaylist();
    if (!playlist || isTogglingPlaylistSubscribe()) return;
    if (ctx.loginProfile() === null) {
      ctx.setFeedback("error", ctx.t("ncm.playlist.loginRequired"));
      return;
    }
    const detail = playlistDetailInfo();
    const nextSubscribed = !(detail?.subscribed ?? playlist.subscribed);
    setIsTogglingPlaylistSubscribe(true);
    try {
      await playlistSubscribe(playlist.id, nextSubscribed);
      if (selectedPlaylist()?.id !== playlist.id) return;
      setSelectedPlaylist((current) =>
        current === null ? current : { ...current, subscribed: nextSubscribed }
      );
      setPlaylistDetailInfo((current) => ({
        ...(current ?? createPlaylistDetailInfo(playlist, null)),
        subscribed: nextSubscribed
      }));
      const current = selectedPlaylist() ?? playlist;
      ctx.onPlaylistSubscribeChange?.({ ...current, subscribed: nextSubscribed }, nextSubscribed);
      ctx.setFeedback(
        "success",
        nextSubscribed ? ctx.t("ncm.playlist.subscribeSuccess") : ctx.t("ncm.playlist.unsubscribeSuccess")
      );
    } catch (error) {
      if (selectedPlaylist()?.id === playlist.id) {
        ctx.setFeedback("error", ctx.readErrorMessage(error));
      }
    } finally {
      if (selectedPlaylist()?.id === playlist.id) {
        setIsTogglingPlaylistSubscribe(false);
      }
    }
  };

  return {
    selectedPlaylist,
    playlistDetailInfo,
    playlistTracksState,
    isLoadingPlaylistTracks,
    isLoadingPlaylistDetail,
    isTogglingPlaylistSubscribe,
    playlistDetailTab,
    playlistFilter,
    setSelectedPlaylist,
    updateSelectedPlaylist,
    setPlaylistTracksState,
    setPlaylistDetailTab,
    setPlaylistFilter,
    loadPlaylistTracks,
    togglePlaylistSubscribe,
    removePlaylistTracks,
    removePlaylistTracksLocally,
    reorderPlaylistTracks,
    handleBackToPlaylists: clearPlaylistDetail,
    clearPlaylistDetail,
    filteredPlaylistTracks,
    playlistTrackCount,
    playlistMetaText,
    playAllPlaylistTracks
  };
}
