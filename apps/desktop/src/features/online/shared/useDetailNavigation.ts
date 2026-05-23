import { createEffect, createMemo, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient } from "../../../shared/api/client";
import { songOrderUpdate } from "../../../shared/api/ncm";
import { playlistDetailDynamic, playlistSubscribe } from "../../../shared/api/ncm/playlist";
import {
  albumDetailDynamic,
  albumSub,
  artistAlbum,
  artistDetail,
  artistMv,
  artistSub
} from "../../../shared/api/ncm/search";
import { createAlbumDetailInfo, parseAlbumDynamicInfo, type AlbumDetailInfo } from "../albumParsers";
import { parseArtistDetailInfo, type ArtistDetailInfo } from "../artistParsers";
import { parseNcmArtistAlbums, parseNcmArtistVideos } from "../searchParsers";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import {
  createPlaylistDetailInfo,
  parsePlaylistDynamicInfo,
  type PlaylistDetailInfo
} from "../playlistParsers";
import {
  createErrorMessageReader,
  type FeedbackSetter,
  type Translator
} from "./feedback";
import type { PlaybackController } from "./playback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "./types";
import type { NcmArtistTrackOrder } from "../../../shared/api/ncmDomainTypes";

const PLAYLIST_TRACK_PAGE_SIZE = 500;
const ARTIST_RESOURCE_PAGE_SIZE = 50;
const ARTIST_TRACK_PAGE_SIZE = 50;
const api = createApiClient();

const isDailySongsCacheFresh = (timestamp: number | null, tracks: readonly OnlineTrackItem[]): boolean => {
  if (timestamp === null || tracks.length === 0) {
    return false;
  }
  const sixAM = new Date();
  sixAM.setHours(6, 0, 0, 0);
  return timestamp >= sixAM.getTime();
};

interface LoadPlaylistTracksOptions {
  limit?: number;
  preserveLikedSelection?: boolean;
}

export interface DetailNavigationContext {
  t: Translator;
  loginProfile: Accessor<NcmProfile | null>;
  playback: PlaybackController;
  setFeedback: FeedbackSetter;
  onSelectedPlaylistChange?: (id: number | null) => void;
  onPlaylistSubscribeChange?: (playlist: OnlinePlaylistSummary, subscribed: boolean) => void;
  onAlbumSubscribeChange?: (album: FeedCardItem, subscribed: boolean) => void;
  onArtistSubscribeChange?: (artist: FeedCardItem, followed: boolean) => void;
}

export function useDetailNavigation(ctx: DetailNavigationContext) {
  const {
    t,
    loginProfile,
    playback,
    setFeedback,
    onSelectedPlaylistChange,
    onPlaylistSubscribeChange,
    onAlbumSubscribeChange,
    onArtistSubscribeChange
  } = ctx;

  const readErrorMessage = createErrorMessageReader(t);

  const [selectedPlaylist, setSelectedPlaylist] = createSignal<OnlinePlaylistSummary | null>(null);
  const [playlistDetailInfo, setPlaylistDetailInfo] = createSignal<PlaylistDetailInfo | null>(null);
  const [playlistTracksState, setPlaylistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = createSignal(false);
  const [isLoadingPlaylistDetail, setIsLoadingPlaylistDetail] = createSignal<boolean>(false);
  const [isTogglingPlaylistSubscribe, setIsTogglingPlaylistSubscribe] = createSignal<boolean>(false);
  const [playlistDetailTab, setPlaylistDetailTab] = createSignal<"songs" | "comments">("songs");
  const [playlistFilter, setPlaylistFilter] = createSignal<string>("");
  const [isPlaylistDetailScrolled, setIsPlaylistDetailScrolled] = createSignal(false);

  const [selectedDailySongs, setSelectedDailySongs] = createSignal(false);
  const [dailySongsState, setDailySongsState] = createSignal<OnlineTrackItem[]>([]);
  const [dailySongsUpdatedAt, setDailySongsUpdatedAt] = createSignal<number | null>(null);
  const [isLoadingDailySongs, setIsLoadingDailySongs] = createSignal(false);

  const [selectedLikedSongs, setSelectedLikedSongs] = createSignal(false);
  const [likedSongsState, setLikedSongsState] = createSignal<OnlineTrackItem[]>([]);
  const [likedSongsTotal, setLikedSongsTotal] = createSignal(0);
  const [isLoadingLikedSongs, setIsLoadingLikedSongs] = createSignal(false);

  const [selectedAlbum, setSelectedAlbum] = createSignal<FeedCardItem | null>(null);
  const [albumDetailInfo, setAlbumDetailInfo] = createSignal<AlbumDetailInfo | null>(null);
  const [albumTracksState, setAlbumTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingAlbumTracks, setIsLoadingAlbumTracks] = createSignal(false);
  const [isLoadingAlbumDetail, setIsLoadingAlbumDetail] = createSignal<boolean>(false);
  const [isTogglingAlbumSubscribe, setIsTogglingAlbumSubscribe] = createSignal<boolean>(false);

  const [selectedArtist, setSelectedArtist] = createSignal<FeedCardItem | null>(null);
  const [artistDetailInfo, setArtistDetailInfo] = createSignal<ArtistDetailInfo | null>(null);
  const [artistTracksState, setArtistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingArtistTracks, setIsLoadingArtistTracks] = createSignal(false);
  const [isLoadingArtistDetail, setIsLoadingArtistDetail] = createSignal<boolean>(false);
  const [isTogglingArtistSubscribe, setIsTogglingArtistSubscribe] = createSignal<boolean>(false);
  const [artistTrackOrder, setArtistTrackOrder] = createSignal<NcmArtistTrackOrder>("hot");
  const [artistTracksHasMore, setArtistTracksHasMore] = createSignal(false);
  const [artistAlbumsState, setArtistAlbumsState] = createSignal<FeedCardItem[]>([]);
  const [artistVideosState, setArtistVideosState] = createSignal<FeedCardItem[]>([]);
  const [isLoadingArtistAlbums, setIsLoadingArtistAlbums] = createSignal(false);
  const [isLoadingArtistVideos, setIsLoadingArtistVideos] = createSignal(false);
  const [artistAlbumsHasMore, setArtistAlbumsHasMore] = createSignal(false);
  const [artistVideosHasMore, setArtistVideosHasMore] = createSignal(false);
  const [selectedVideo, setSelectedVideo] = createSignal<FeedCardItem | null>(null);

  const clearAllDetailViews = () => {
    setSelectedPlaylist(null);
    setPlaylistDetailInfo(null);
    setPlaylistTracksState([]);
    setIsLoadingPlaylistDetail(false);
    setIsTogglingPlaylistSubscribe(false);
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    setSelectedAlbum(null);
    setAlbumDetailInfo(null);
    setAlbumTracksState([]);
    setIsLoadingAlbumDetail(false);
    setIsTogglingAlbumSubscribe(false);
    setSelectedArtist(null);
    setArtistDetailInfo(null);
    setArtistTracksState([]);
    setArtistTrackOrder("hot");
    setArtistTracksHasMore(false);
    setIsLoadingArtistDetail(false);
    setIsTogglingArtistSubscribe(false);
    setArtistAlbumsState([]);
    setArtistVideosState([]);
    setIsLoadingArtistAlbums(false);
    setIsLoadingArtistVideos(false);
    setArtistAlbumsHasMore(false);
    setArtistVideosHasMore(false);
    setSelectedVideo(null);
    onSelectedPlaylistChange?.(null);
  };

  const loadPlaylistTracks = async (
    playlist: OnlinePlaylistSummary,
    options: LoadPlaylistTracksOptions = {}
  ) => {
    setSelectedDailySongs(false);
    if (options.preserveLikedSelection !== true) {
      setSelectedLikedSongs(false);
    }
    setSelectedAlbum(null);
    setAlbumDetailInfo(null);
    setAlbumTracksState([]);
    setIsLoadingAlbumDetail(false);
    setIsTogglingAlbumSubscribe(false);
    setSelectedArtist(null);
    setArtistDetailInfo(null);
    setArtistTracksState([]);
    setArtistTrackOrder("hot");
    setArtistTracksHasMore(false);
    setIsLoadingArtistDetail(false);
    setIsTogglingArtistSubscribe(false);
    setArtistAlbumsState([]);
    setArtistVideosState([]);
    setIsLoadingArtistAlbums(false);
    setIsLoadingArtistVideos(false);
    setArtistAlbumsHasMore(false);
    setArtistVideosHasMore(false);
    setSelectedPlaylist(playlist);
    setPlaylistDetailInfo(null);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    onSelectedPlaylistChange?.(playlist.id);
    setIsLoadingPlaylistDetail(true);
    setIsLoadingPlaylistTracks(true);
    void playlistDetailDynamic(playlist.id)
      .then((payload) => {
        if (selectedPlaylist()?.id !== playlist.id) return;
        setPlaylistDetailInfo(createPlaylistDetailInfo(selectedPlaylist() ?? playlist, parsePlaylistDynamicInfo(payload)));
      })
      .catch(() => {
        if (selectedPlaylist()?.id !== playlist.id) return;
        setPlaylistDetailInfo(createPlaylistDetailInfo(selectedPlaylist() ?? playlist, null));
      })
      .finally(() => {
        if (selectedPlaylist()?.id === playlist.id) {
          setIsLoadingPlaylistDetail(false);
        }
      });
    try {
      const detail = await api.getNcmPlaylistDetail(playlist.id);
      setSelectedPlaylist(detail);
      setPlaylistDetailInfo((current) => (
        current === null ? null : createPlaylistDetailInfo(detail, current)
      ));
      const maxTracks = options.limit ?? detail.trackCount ?? PLAYLIST_TRACK_PAGE_SIZE;
      const pageSize = Math.min(PLAYLIST_TRACK_PAGE_SIZE, Math.max(maxTracks, 1));
      const tracks: OnlineTrackItem[] = [];
      for (let offset = 0; offset < Math.max(maxTracks, 1); offset += pageSize) {
        const page = await api.listNcmPlaylistTracks({
          id: playlist.id,
          limit: pageSize,
          offset
        });
        if (page.length === 0) {
          break;
        }
        tracks.push(...page);
        setPlaylistTracksState([...tracks]);
        if (page.length < pageSize || tracks.length >= maxTracks) {
          break;
        }
      }
      setPlaylistTracksState(tracks);
    } catch (error) {
      setPlaylistTracksState([]);
      setFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  };

  const handleBackToPlaylists = () => {
    setSelectedPlaylist(null);
    setPlaylistDetailInfo(null);
    setPlaylistTracksState([]);
    setIsLoadingPlaylistDetail(false);
    setIsTogglingPlaylistSubscribe(false);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    onSelectedPlaylistChange?.(null);
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
    return t("ncm.playlist.meta", {
      count: playlistTrackCount(),
      creator: playlist?.creator ?? t("ncm.playlist.creatorUnknown")
    });
  };

  const playAllPlaylistTracks = async () => {
    const [first, ...rest] = filteredPlaylistTracks();
    if (!first) return;
    await playback.playOnlineTrack(first);
    for (const item of rest) {
      await playback.enqueueOnlineTrack(item);
    }
  };

  const removePlaylistTracks = async (songIds: readonly number[]) => {
    const playlist = selectedPlaylist();
    if (!playlist || songIds.length === 0) return;
    try {
      await api.updateNcmPlaylistTracks({
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
      setFeedback("success", t("ncm.playlist.removedSelected", { count: songIds.length }));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
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
      setFeedback("success", t("ncm.playlist.reorderSaved"));
    } catch (error) {
      setPlaylistTracksState(current);
      setFeedback("error", readErrorMessage(error));
    }
  };

  const togglePlaylistSubscribe = async () => {
    const playlist = selectedPlaylist();
    if (!playlist || isTogglingPlaylistSubscribe()) return;
    if (loginProfile() === null) {
      setFeedback("error", t("ncm.playlist.loginRequired"));
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
      onPlaylistSubscribeChange?.({ ...current, subscribed: nextSubscribed }, nextSubscribed);
      setFeedback(
        "success",
        nextSubscribed ? t("ncm.playlist.subscribeSuccess") : t("ncm.playlist.unsubscribeSuccess")
      );
    } catch (error) {
      if (selectedPlaylist()?.id === playlist.id) {
        setFeedback("error", readErrorMessage(error));
      }
    } finally {
      if (selectedPlaylist()?.id === playlist.id) {
        setIsTogglingPlaylistSubscribe(false);
      }
    }
  };

  const handlePlaylistTrackScroll = (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    setIsPlaylistDetailScrolled(target.scrollTop > 10);
  };

  const loadDailySongsList = async (options: { force?: boolean } = {}): Promise<boolean> => {
    if (!options.force && isDailySongsCacheFresh(dailySongsUpdatedAt(), dailySongsState())) {
      return true;
    }
    setIsLoadingDailySongs(true);
    try {
      const result = await api.getNcmDailySongs();
      setDailySongsState(result.tracks);
      setDailySongsUpdatedAt(result.timestamp);
      return true;
    } catch (error) {
      setDailySongsState([]);
      setDailySongsUpdatedAt(null);
      setFeedback("error", readErrorMessage(error));
      return false;
    } finally {
      setIsLoadingDailySongs(false);
    }
  };

  const enterDailySongs = () => {
    clearAllDetailViews();
    setSelectedDailySongs(true);
    void loadDailySongsList();
  };

  const refreshDailySongs = async () => {
    const ok = await loadDailySongsList({ force: true });
    if (ok) {
      setFeedback("success", t("ncm.daily.refreshSuccess"));
    }
  };

  const playAllDailySongs = async () => {
    const [first, ...rest] = dailySongsState();
    if (!first) return;
    await playback.playOnlineTrack(first);
    for (const item of rest) {
      await playback.enqueueOnlineTrack(item);
    }
  };

  const dislikeDailySong = async (item: OnlineTrackItem) => {
    try {
      const result = await api.dislikeNcmDailySong(item.songId);
      setDailySongsState((current) => {
        const index = current.findIndex((candidate) => candidate.songId === item.songId);
        if (index < 0) {
          return current;
        }
        if (result.track) {
          return [
            ...current.slice(0, index),
            result.track,
            ...current.slice(index + 1)
          ];
        }
        return current.filter((candidate) => candidate.songId !== item.songId);
      });
      setDailySongsUpdatedAt(Date.now());
      setFeedback("success", t("ncm.daily.dislikeSuccess"));
    } catch (error) {
      setFeedback("error", readErrorMessage(error));
    }
  };

  const exitDailySongs = () => {
    setSelectedDailySongs(false);
  };

  const loadLikedSongsList = async () => {
    const profile = loginProfile();
    if (!profile) return;
    setIsLoadingLikedSongs(true);
    try {
      const playlists = await api.listNcmUserPlaylists({
        uid: profile.userId,
        limit: 1
      });
      const likedPlaylist = playlists[0] ?? null;
      if (likedPlaylist === null) {
        setLikedSongsTotal(0);
        setLikedSongsState([]);
        return;
      }
      setLikedSongsTotal(likedPlaylist.trackCount ?? 0);
      await loadPlaylistTracks(likedPlaylist, {
        limit: likedPlaylist.trackCount ?? undefined,
        preserveLikedSelection: true
      });
    } catch (error) {
      setLikedSongsState([]);
      setLikedSongsTotal(0);
      setFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingLikedSongs(false);
    }
  };

  const enterLikedSongs = () => {
    clearAllDetailViews();
    setSelectedLikedSongs(true);
    void loadLikedSongsList();
  };

  const exitLikedSongs = () => {
    setSelectedLikedSongs(false);
    setSelectedPlaylist(null);
    setPlaylistDetailInfo(null);
    setPlaylistTracksState([]);
    setIsLoadingPlaylistDetail(false);
    setIsTogglingPlaylistSubscribe(false);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    onSelectedPlaylistChange?.(null);
  };

  const loadAlbumTracks = async (albumItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedAlbum(albumItem);
    setAlbumDetailInfo(null);
    setIsLoadingAlbumDetail(true);
    setIsLoadingAlbumTracks(true);
    void albumDetailDynamic(albumItem.id)
      .then((payload) => {
        if (selectedAlbum()?.id !== albumItem.id) return;
        setAlbumDetailInfo(createAlbumDetailInfo(albumItem, parseAlbumDynamicInfo(payload)));
      })
      .catch(() => {
        if (selectedAlbum()?.id !== albumItem.id) return;
        setAlbumDetailInfo(createAlbumDetailInfo(albumItem, null));
      })
      .finally(() => {
        if (selectedAlbum()?.id === albumItem.id) {
          setIsLoadingAlbumDetail(false);
        }
      });
    try {
      setAlbumTracksState(await api.listNcmAlbumTracks(albumItem.id));
    } catch (error) {
      setAlbumTracksState([]);
      setFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingAlbumTracks(false);
    }
  };

  const exitAlbum = () => {
    setSelectedAlbum(null);
    setAlbumDetailInfo(null);
    setAlbumTracksState([]);
    setIsLoadingAlbumDetail(false);
    setIsTogglingAlbumSubscribe(false);
  };

  const toggleAlbumSubscribe = async () => {
    const albumItem = selectedAlbum();
    if (!albumItem || isTogglingAlbumSubscribe()) return;
    if (loginProfile() === null) {
      setFeedback("error", t("ncm.album.loginRequired"));
      return;
    }
    const detail = albumDetailInfo();
    const nextSubscribed = !(detail?.subscribed ?? false);
    setIsTogglingAlbumSubscribe(true);
    try {
      await albumSub(albumItem.id, nextSubscribed);
      if (selectedAlbum()?.id !== albumItem.id) return;
      setAlbumDetailInfo((current) => ({
        ...(current ?? createAlbumDetailInfo(albumItem, null)),
        subscribed: nextSubscribed
      }));
      const currentDetail = albumDetailInfo();
      onAlbumSubscribeChange?.(
        {
          id: currentDetail?.id ?? albumItem.id,
          title: currentDetail?.title ?? albumItem.title,
          subtitle: currentDetail?.subtitle ?? albumItem.subtitle,
          coverUrl: currentDetail?.coverUrl ?? albumItem.coverUrl,
          playCount: currentDetail?.playCount ?? albumItem.playCount,
          description: currentDetail?.description ?? albumItem.description
        },
        nextSubscribed
      );
      setFeedback(
        "success",
        nextSubscribed ? t("ncm.album.subscribeSuccess") : t("ncm.album.unsubscribeSuccess")
      );
    } catch (error) {
      if (selectedAlbum()?.id === albumItem.id) {
        setFeedback("error", readErrorMessage(error));
      }
    } finally {
      if (selectedAlbum()?.id === albumItem.id) {
        setIsTogglingAlbumSubscribe(false);
      }
    }
  };

  const loadArtistTrackPage = async (options: { append?: boolean; order?: NcmArtistTrackOrder } = {}) => {
    const artist = selectedArtist();
    if (!artist || isLoadingArtistTracks()) return;
    const append = options.append === true;
    const order = options.order ?? artistTrackOrder();
    try {
      setIsLoadingArtistTracks(true);
      const page = await api.listNcmArtistTracks({
        id: artist.id,
        limit: ARTIST_TRACK_PAGE_SIZE,
        offset: append ? artistTracksState().length : 0,
        order
      });
      if (selectedArtist()?.id !== artist.id) return;
      setArtistTrackOrder(order);
      setArtistTracksState((current) => append ? [...current, ...page.tracks] : page.tracks);
      setArtistTracksHasMore(page.hasMore);
    } catch (error) {
      if (selectedArtist()?.id !== artist?.id) return;
      if (!append) {
        setArtistTracksState([]);
        setArtistTracksHasMore(false);
      }
      setFeedback("error", readErrorMessage(error));
    } finally {
      if (selectedArtist()?.id === artist?.id) {
        setIsLoadingArtistTracks(false);
      }
    }
  };

  const loadArtistTracks = async (artistItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedArtist(artistItem);
    setArtistDetailInfo(null);
    setArtistTrackOrder("hot");
    setArtistTracksHasMore(false);
    setArtistAlbumsState([]);
    setArtistVideosState([]);
    setArtistAlbumsHasMore(false);
    setArtistVideosHasMore(false);
    setIsLoadingArtistDetail(true);
    void artistDetail(artistItem.id)
      .then((payload) => {
        if (selectedArtist()?.id !== artistItem.id) return;
        setArtistDetailInfo(parseArtistDetailInfo(payload, artistItem));
      })
      .catch((error) => {
        if (selectedArtist()?.id !== artistItem.id) return;
        setArtistDetailInfo(null);
        setFeedback("error", readErrorMessage(error));
      })
      .finally(() => {
        if (selectedArtist()?.id === artistItem.id) {
          setIsLoadingArtistDetail(false);
        }
      });
    await loadArtistTrackPage({ order: "hot" });
  };

  const changeArtistTrackOrder = async (order: NcmArtistTrackOrder) => {
    if (order === artistTrackOrder() && artistTracksState().length > 0) return;
    setArtistTracksState([]);
    setArtistTracksHasMore(false);
    await loadArtistTrackPage({ order });
  };

  const loadArtistAlbums = async (options: { append?: boolean } = {}) => {
    const artist = selectedArtist();
    if (!artist || isLoadingArtistAlbums()) return;
    const append = options.append === true;
    setIsLoadingArtistAlbums(true);
    try {
      const payload = parseNcmArtistAlbums(await artistAlbum({
        id: artist.id,
        limit: ARTIST_RESOURCE_PAGE_SIZE,
        offset: append ? artistAlbumsState().length : 0
      }));
      if (selectedArtist()?.id !== artist.id) return;
      setArtistAlbumsState((current) => append ? [...current, ...payload.items] : payload.items);
      setArtistAlbumsHasMore(payload.hasMore);
    } catch (error) {
      if (selectedArtist()?.id !== artist.id) return;
      if (!append) {
        setArtistAlbumsState([]);
        setArtistAlbumsHasMore(false);
      }
      setFeedback("error", readErrorMessage(error));
    } finally {
      if (selectedArtist()?.id === artist.id) {
        setIsLoadingArtistAlbums(false);
      }
    }
  };

  const loadArtistVideos = async (options: { append?: boolean } = {}) => {
    const artist = selectedArtist();
    if (!artist || isLoadingArtistVideos()) return;
    const append = options.append === true;
    setIsLoadingArtistVideos(true);
    try {
      const payload = parseNcmArtistVideos(await artistMv({
        id: artist.id,
        limit: ARTIST_RESOURCE_PAGE_SIZE,
        offset: append ? artistVideosState().length : 0
      }));
      if (selectedArtist()?.id !== artist.id) return;
      setArtistVideosState((current) => append ? [...current, ...payload.items] : payload.items);
      setArtistVideosHasMore(payload.hasMore);
    } catch (error) {
      if (selectedArtist()?.id !== artist.id) return;
      if (!append) {
        setArtistVideosState([]);
        setArtistVideosHasMore(false);
      }
      setFeedback("error", readErrorMessage(error));
    } finally {
      if (selectedArtist()?.id === artist.id) {
        setIsLoadingArtistVideos(false);
      }
    }
  };

  const exitArtist = () => {
    setSelectedArtist(null);
    setArtistDetailInfo(null);
    setArtistTracksState([]);
    setArtistTrackOrder("hot");
    setArtistTracksHasMore(false);
    setIsLoadingArtistDetail(false);
    setIsTogglingArtistSubscribe(false);
    setArtistAlbumsState([]);
    setArtistVideosState([]);
    setIsLoadingArtistAlbums(false);
    setIsLoadingArtistVideos(false);
    setArtistAlbumsHasMore(false);
    setArtistVideosHasMore(false);
  };

  const toggleArtistSubscribe = async () => {
    const artist = selectedArtist();
    if (!artist || isTogglingArtistSubscribe()) return;
    if (loginProfile() === null) {
      setFeedback("error", t("ncm.artist.loginRequired"));
      return;
    }
    const detail = artistDetailInfo();
    const nextFollowed = !(detail?.followed ?? false);
    setIsTogglingArtistSubscribe(true);
    try {
      await artistSub(artist.id, nextFollowed);
      if (selectedArtist()?.id !== artist.id) return;
      setArtistDetailInfo((current) => ({
        ...(current ?? parseArtistDetailInfo({}, artist)),
        followed: nextFollowed
      }));
      const currentDetail = artistDetailInfo();
      onArtistSubscribeChange?.(
        {
          id: currentDetail?.id ?? artist.id,
          title: currentDetail?.title ?? artist.title,
          subtitle: currentDetail?.subtitle ?? artist.subtitle,
          coverUrl: currentDetail?.coverUrl ?? artist.coverUrl,
          playCount: currentDetail?.playCount ?? artist.playCount,
          description: currentDetail?.description ?? artist.description
        },
        nextFollowed
      );
      setFeedback(
        "success",
        nextFollowed ? t("ncm.artist.subscribeSuccess") : t("ncm.artist.unsubscribeSuccess")
      );
    } catch (error) {
      if (selectedArtist()?.id === artist.id) {
        setFeedback("error", readErrorMessage(error));
      }
    } finally {
      if (selectedArtist()?.id === artist.id) {
        setIsTogglingArtistSubscribe(false);
      }
    }
  };

  const enterVideo = (videoItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedVideo(videoItem);
  };

  const exitVideo = () => {
    setSelectedVideo(null);
  };

  createEffect(on(loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      clearAllDetailViews();
    }
  }, { defer: true }));

  return {
    selectedPlaylist,
    playlistDetailInfo,
    playlistTracksState,
    isLoadingPlaylistTracks,
    isLoadingPlaylistDetail,
    isTogglingPlaylistSubscribe,
    playlistDetailTab,
    playlistFilter,
    isPlaylistDetailScrolled,
    selectedDailySongs,
    dailySongsState,
    dailySongsUpdatedAt,
    isLoadingDailySongs,
    selectedLikedSongs,
    likedSongsState,
    likedSongsTotal,
    isLoadingLikedSongs,
    selectedAlbum,
    albumDetailInfo,
    albumTracksState,
    isLoadingAlbumTracks,
    isLoadingAlbumDetail,
    isTogglingAlbumSubscribe,
    selectedArtist,
    artistDetailInfo,
    artistTracksState,
    isLoadingArtistTracks,
    isLoadingArtistDetail,
    isTogglingArtistSubscribe,
    artistTrackOrder,
    artistTracksHasMore,
    artistAlbumsState,
    artistVideosState,
    isLoadingArtistAlbums,
    isLoadingArtistVideos,
    artistAlbumsHasMore,
    artistVideosHasMore,
    selectedVideo,

    setSelectedPlaylist,
    updateSelectedPlaylist,
    setPlaylistTracksState,
    setPlaylistDetailTab,
    setPlaylistFilter,

    loadPlaylistTracks,
    togglePlaylistSubscribe,
    loadAlbumTracks,
    toggleAlbumSubscribe,
    loadArtistTracks,
    loadArtistTrackPage,
    changeArtistTrackOrder,
    loadArtistAlbums,
    loadArtistVideos,
    toggleArtistSubscribe,
    enterVideo,

    enterDailySongs,
    refreshDailySongs,
    playAllDailySongs,
    dislikeDailySong,
    removePlaylistTracks,
    removePlaylistTracksLocally,
    reorderPlaylistTracks,
    enterLikedSongs,
    exitDailySongs,
    exitLikedSongs,
    exitAlbum,
    exitArtist,
    exitVideo,
    handleBackToPlaylists,
    clearAllDetailViews,
    handlePlaylistTrackScroll,

    filteredPlaylistTracks,
    playlistTrackCount,
    playlistMetaText,
    playAllPlaylistTracks
  };
}

export type DetailNavigation = ReturnType<typeof useDetailNavigation>;
