import { createEffect, createMemo, createSignal, on } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient } from "../../../shared/api/client";
import type { TranslationKey, TranslationParams } from "../../../shared/i18n";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaybackController } from "./playback";
import type { Feedback, FeedCardItem, NcmProfile, OnlineTrackItem } from "./types";

type Translator = (key: TranslationKey, params?: TranslationParams) => string;

const PLAYLIST_TRACK_LIMIT = 200;
const LIKED_SONGS_DETAIL_LIMIT = 100;
const api = createApiClient();

interface LoadPlaylistTracksOptions {
  limit?: number;
}

export interface DetailNavigationContext {
  t: Translator;
  loginProfile: Accessor<NcmProfile | null>;
  playback: PlaybackController;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
  onSelectedPlaylistChange?: (id: number | null) => void;
}

export function useDetailNavigation(ctx: DetailNavigationContext) {
  const { t, loginProfile, playback, setFeedback, onSelectedPlaylistChange } = ctx;

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const [selectedPlaylist, setSelectedPlaylist] = createSignal<OnlinePlaylistSummary | null>(null);
  const [playlistTracksState, setPlaylistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = createSignal(false);
  const [playlistDetailTab, setPlaylistDetailTab] = createSignal<"songs" | "comments">("songs");
  const [playlistFilter, setPlaylistFilter] = createSignal<string>("");
  const [isPlaylistDetailScrolled, setIsPlaylistDetailScrolled] = createSignal(false);

  const [selectedDailySongs, setSelectedDailySongs] = createSignal(false);
  const [dailySongsState, setDailySongsState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingDailySongs, setIsLoadingDailySongs] = createSignal(false);

  const [selectedLikedSongs, setSelectedLikedSongs] = createSignal(false);
  const [likedSongsState, setLikedSongsState] = createSignal<OnlineTrackItem[]>([]);
  const [likedSongsTotal, setLikedSongsTotal] = createSignal(0);
  const [isLoadingLikedSongs, setIsLoadingLikedSongs] = createSignal(false);

  const [selectedAlbum, setSelectedAlbum] = createSignal<FeedCardItem | null>(null);
  const [albumTracksState, setAlbumTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingAlbumTracks, setIsLoadingAlbumTracks] = createSignal(false);

  const [selectedArtist, setSelectedArtist] = createSignal<FeedCardItem | null>(null);
  const [artistTracksState, setArtistTracksState] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingArtistTracks, setIsLoadingArtistTracks] = createSignal(false);

  const clearAllDetailViews = () => {
    setSelectedPlaylist(null);
    setPlaylistTracksState([]);
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    setSelectedAlbum(null);
    setAlbumTracksState([]);
    setSelectedArtist(null);
    setArtistTracksState([]);
    onSelectedPlaylistChange?.(null);
  };

  const loadPlaylistTracks = async (
    playlist: OnlinePlaylistSummary,
    options: LoadPlaylistTracksOptions = {}
  ) => {
    setSelectedDailySongs(false);
    setSelectedLikedSongs(false);
    setSelectedAlbum(null);
    setAlbumTracksState([]);
    setSelectedArtist(null);
    setArtistTracksState([]);
    setSelectedPlaylist(playlist);
    setPlaylistDetailTab("songs");
    setPlaylistFilter("");
    setIsPlaylistDetailScrolled(false);
    onSelectedPlaylistChange?.(playlist.id);
    setIsLoadingPlaylistTracks(true);
    try {
      const tracks = await api.listNcmPlaylistTracks({
        id: playlist.id,
        limit: options.limit ?? PLAYLIST_TRACK_LIMIT
      });
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
    setPlaylistTracksState([]);
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

  const handlePlaylistTrackScroll = (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    setIsPlaylistDetailScrolled(target.scrollTop > 10);
  };

  const loadDailySongsList = async () => {
    setIsLoadingDailySongs(true);
    try {
      setDailySongsState(await api.listNcmDailySongTracks());
    } catch (error) {
      setDailySongsState([]);
      setFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingDailySongs(false);
    }
  };

  const enterDailySongs = () => {
    clearAllDetailViews();
    setSelectedDailySongs(true);
    void loadDailySongsList();
  };

  const exitDailySongs = () => {
    setSelectedDailySongs(false);
  };

  const loadLikedSongsList = async () => {
    const profile = loginProfile();
    if (!profile) return;
    setIsLoadingLikedSongs(true);
    try {
      const ids = await api.getNcmLikelistIds(profile.userId);
      setLikedSongsTotal(ids.length);
      if (ids.length === 0) {
        setLikedSongsState([]);
        return;
      }
      setLikedSongsState(await api.listNcmSongDetailTracks(ids.slice(0, LIKED_SONGS_DETAIL_LIMIT)));
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
  };

  const loadAlbumTracks = async (albumItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedAlbum(albumItem);
    setIsLoadingAlbumTracks(true);
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
    setAlbumTracksState([]);
  };

  const loadArtistTracks = async (artistItem: FeedCardItem) => {
    clearAllDetailViews();
    setSelectedArtist(artistItem);
    setIsLoadingArtistTracks(true);
    try {
      setArtistTracksState(await api.listNcmArtistTracks(artistItem.id));
    } catch (error) {
      setArtistTracksState([]);
      setFeedback("error", readErrorMessage(error));
    } finally {
      setIsLoadingArtistTracks(false);
    }
  };

  const exitArtist = () => {
    setSelectedArtist(null);
    setArtistTracksState([]);
  };

  createEffect(on(loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      clearAllDetailViews();
    }
  }, { defer: true }));

  return {
    selectedPlaylist,
    playlistTracksState,
    isLoadingPlaylistTracks,
    playlistDetailTab,
    playlistFilter,
    isPlaylistDetailScrolled,
    selectedDailySongs,
    dailySongsState,
    isLoadingDailySongs,
    selectedLikedSongs,
    likedSongsState,
    likedSongsTotal,
    isLoadingLikedSongs,
    selectedAlbum,
    albumTracksState,
    isLoadingAlbumTracks,
    selectedArtist,
    artistTracksState,
    isLoadingArtistTracks,

    setSelectedPlaylist,
    setPlaylistTracksState,
    setPlaylistDetailTab,
    setPlaylistFilter,

    loadPlaylistTracks,
    loadAlbumTracks,
    loadArtistTracks,

    enterDailySongs,
    enterLikedSongs,
    exitDailySongs,
    exitLikedSongs,
    exitAlbum,
    exitArtist,
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
