import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  NcmLyricLine,
  NcmTrackReference,
  NcmTrackSupplement
} from "../features/online/ncmPlayback";
import type { UserPlaylistMode } from "../features/online/ncmPlaylistSummary";
import type { FeedCardItem, OnlineTrackItem, RadioSubscribeEvent } from "../features/online/shared/types";
import type {
  PlayerState,
  QueueEntry,
  RepeatMode,
  RequestState,
  ShuffleMode
} from "../shared/api/types";
import {
  persistUISetting,
  STORAGE_KEYS,
  useUISettings
} from "../shared/state/useUISettings";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useTranslation } from "../shared/i18n";
import { isPlaceholderPage, type ActivePage } from "../shared/ui/navigation";
import { applyDynamicAccent, extractAccent } from "../shared/styles/dynamicAccent";
import { applyUserAppearanceSettings } from "../shared/styles/customAppearance";
import type {
  ApiClient,
  NcmTrackSummary,
  ResolveNcmTrackInput
} from "../shared/api/client";
import { readErrorMessage } from "./controllerHelpers";
import { useNavigationController } from "./useNavigationController";
import { useNcmTrackEnrichment } from "./useNcmTrackEnrichment";
import type { WsStatus } from "./playbackSocketContracts";
import {
  usePlaybackController,
  type PlaybackController
} from "./usePlaybackController";
import { useQueueController } from "./useQueueController";

export interface AppController {
  state: Accessor<RequestState<PlayerState>>;
  spectrum: Accessor<number[]>;
  loadingProgress: Accessor<number | null>;
  wsStatus: Accessor<WsStatus>;
  preloadRequested: Accessor<boolean>;
  commandError: Accessor<string | null>;
  activePage: Accessor<ActivePage>;
  queueEntries: Accessor<QueueEntry[]>;
  queueDrawerOpen: Accessor<boolean>;
  livePosition: Accessor<number | null>;
  fullPlayerOpen: Accessor<boolean>;
  settingsOpen: Accessor<boolean>;
  selectedPlaylistId: Accessor<number | null>;
  localPlaylistRequest: Accessor<{ playlistId: string | null; version: number }>;
  discoverTabRequest: Accessor<{ tab: string; version: number }>;
  artistDetailRequest: Accessor<{ artist: FeedCardItem | null; version: number }>;
  albumDetailRequest: Accessor<{ album: FeedCardItem | null; version: number }>;
  radioDetailRequest: Accessor<{ radio: FeedCardItem | null; version: number }>;
  songWikiRequest: Accessor<{ track: OnlineTrackItem | null; version: number }>;
  radioSubscribeEvent: Accessor<RadioSubscribeEvent | null>;
  likedCollectionTabRequest: Accessor<{ tab: "playlists" | "albums" | "artists"; version: number }>;
  player: Accessor<PlayerState | null>;
  currentTrackPath: Accessor<string | null>;
  currentMediaId: Accessor<string | null>;
  hasCoverArt: Accessor<boolean>;
  coverUrl: Accessor<string | null>;
  prevEntryId: Accessor<number | null>;
  nextEntryId: Accessor<number | null>;
  repeatMode: Accessor<RepeatMode>;
  shuffleMode: Accessor<ShuffleMode>;
  canGoBack: Accessor<boolean>;
  canGoForward: Accessor<boolean>;
  currentTrackRef: Accessor<NcmTrackReference | undefined>;
  currentNcmSongId: Accessor<number | null>;
  currentNcmCoverUrl: Accessor<string | null>;
  resolvedCoverUrl: Accessor<string | null>;
  currentLyricLines: Accessor<readonly NcmLyricLine[]>;
  currentInlineLyric: Accessor<string | null>;
  fullPlayerTitle: Accessor<string>;
  fullPlayerSubtitle: Accessor<string>;
  fullPlayerDetail: Accessor<string | null>;
  lyricStatus: Accessor<"idle" | "loading" | "ready" | "error">;
  currentNcmSupplement: Accessor<NcmTrackSupplement | null>;
  currentIsLiked: Accessor<boolean>;
  playbackHistoryVersion: Accessor<number>;
  notifyPlaybackHistoryChanged: () => void;
  uiSettings: ReturnType<typeof useUISettings>;
  refreshState: (expectedPath?: string | null) => Promise<void>;
  applyPlayerState: (next: PlayerState) => void;
  refreshQueue: () => Promise<void>;
  handlePlay: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleSeek: (position: number) => Promise<void>;
  handleVolumeChange: (volume: number) => Promise<void>;
  handleSkipPrev: () => Promise<void> | undefined;
  handleSkipNext: () => Promise<void> | undefined;
  handleCycleRepeat: () => Promise<void>;
  handleToggleShuffle: () => Promise<void>;
  handleToggleLike: () => Promise<void>;
  handleActivePageChange: (page: ActivePage) => void;
  handleOpenQueue: () => void;
  handleToggleQueue: () => void;
  handleOpenQueueFromFullPlayer: () => void;
  handlePlayQueueEntry: (entryId: number) => Promise<void>;
  handleRemoveQueueEntry: (entryId: number) => Promise<void>;
  handleClearQueue: () => Promise<void>;
  handleSidebarPlaylistSelect: (page: UserPlaylistMode, playlistId: number) => void;
  handleSidebarLocalPlaylistSelect: (playlistId: string) => void;
  handleSelectedPlaylistChange: (playlistId: number | null) => void;
  handleNavigateToDiscover: (tab: string) => void;
  handleNavigateToArtistDetail: (artist: FeedCardItem) => void;
  handleNavigateToAlbumDetail: (album: FeedCardItem) => void;
  handleNavigateToRadioDetail: (radio: FeedCardItem) => void;
  handleNavigateToSongWiki: (track: OnlineTrackItem) => void;
  handleRadioSubscribeChange: (radio: FeedCardItem, subscribed: boolean) => void;
  handleNavigateToLikedCollectionTab: (tab: "playlists" | "albums" | "artists") => void;
  handleChangeCurrentNcmQuality: (level: string) => Promise<void>;
  handleGoBack: () => void;
  handleGoForward: () => void;
  registerNcmPlayback: (track: NcmTrackReference) => void;
  setFullPlayerOpen: (value: boolean) => void;
  setQueueDrawerOpen: (value: boolean) => void;
  setSettingsOpen: (value: boolean) => void;
  setPreloadRequested: (value: boolean) => void;
  isPlaceholderPage: typeof isPlaceholderPage;
  personalFmReloadTick: Accessor<number>;
  requestPersonalFmRefresh: () => void;
  requestHeartbeatMode: () => Promise<void>;
}

export function useAppController(api: ApiClient): AppController {
  const uiSettings = useUISettings();
  const navigation = useNavigationController();
  const accountStore = useNcmAccount();
  const { t } = useTranslation();

  const [fullPlayerOpen, setFullPlayerOpen] = createSignal<boolean>(false);
  const [settingsOpen, setSettingsOpen] = createSignal<boolean>(false);
  const [playbackHistoryVersion, setPlaybackHistoryVersion] = createSignal<number>(0);
  const [personalFmReloadTick, setPersonalFmReloadTick] = createSignal<number>(0);
  let playbackBridge: PlaybackController | null = null;

  const notifyPlaybackHistoryChanged = () => {
    setPlaybackHistoryVersion((version) => version + 1);
  };

  const requestPersonalFmRefresh = () => {
    if (navigation.activePage() !== "personal-fm") {
      navigation.handleActivePageChange("personal-fm");
    }
    setPersonalFmReloadTick((tick) => tick + 1);
  };

  const queue = useQueueController(api, () => playbackBridge);

  const playback = usePlaybackController({
    api,
    isSpectrumVisible: () => fullPlayerOpen() && uiSettings.showSpectrums,
    notifyPlaybackHistoryChanged,
    refreshQueueForCurrentSurface: queue.refreshQueueForCurrentSurface
  });
  playbackBridge = playback;

  const ncm = useNcmTrackEnrichment({
    api,
    player: playback.player,
    livePosition: playback.livePosition,
    coverUrl: playback.coverUrl,
    dynamicCoverEnabled: () => fullPlayerOpen() && uiSettings.dynamicCover
  });

  const handleChangeCurrentNcmQuality = async (level: string) => {
    if (level === uiSettings.ncmSongLevel) {
      return;
    }

    const trackRef = ncm.currentTrackRef();
    if (!trackRef) {
      return;
    }

    const current = playback.player();
    const resumePosition = current?.current_time ?? 0;
    const wasPlaying = Boolean(current?.is_playing);
    playback.setCommandError(null);
    persistUISetting(STORAGE_KEYS.ncmSongLevel, level);

    try {
      const result = await api.playNcmTrack({
        songId: trackRef.songId,
        level,
        sourcePageUrl: trackRef.sourcePageUrl,
        title: trackRef.title,
        artist: trackRef.artist,
        album: trackRef.album,
        artworkUrl: trackRef.coverUrl,
        durationSecs: trackRef.durationSecs
      });
      ncm.registerNcmPlayback(result.track);
      playback.applyPlayerState(result.state);
      await playback.refreshState(result.track.streamUrl);
      if (resumePosition > 0) {
        await playback.handleSeek(resumePosition);
      }
      if (!wasPlaying) {
        await playback.handlePause();
      }
    } catch (error) {
      playback.setCommandError(readErrorMessage(error));
    }
  };

  const readNcmSongLevel = (): string => {
    try {
      return localStorage.getItem(STORAGE_KEYS.ncmSongLevel) ?? "exhigh";
    } catch {
      return "exhigh";
    }
  };

  const buildHeartbeatResolveInput = (item: NcmTrackSummary): ResolveNcmTrackInput => ({
    songId: item.songId,
    level: readNcmSongLevel(),
    sourcePageUrl: item.source_path,
    title: item.title,
    artist: item.artist,
    album: item.album,
    artworkUrl: item.artworkUrl,
    durationSecs: item.duration_secs
  });

  const requestHeartbeatMode = async () => {
    playback.setCommandError(null);
    const account = accountStore.activeAccount();
    if (!account || !account.hasCookie) {
      playback.setCommandError(t("player.heartbeat.requiresLogin"));
      return;
    }
    const triggerSongId = ncm.currentNcmSongId();
    if (triggerSongId === null) {
      playback.setCommandError(t("player.heartbeat.requiresSong"));
      return;
    }

    try {
      const playlists = await api.listNcmUserPlaylists({ uid: account.userId, limit: 1 });
      const likedPlaylist = playlists.find((entry) => entry.userId === account.userId) ?? playlists[0];
      if (!likedPlaylist) {
        playback.setCommandError(t("player.heartbeat.failed"));
        return;
      }

      const tracks = await api.listNcmHeartbeatTracks({
        songId: triggerSongId,
        playlistId: likedPlaylist.id,
        count: 20
      });
      if (tracks.length === 0) {
        playback.setCommandError(t("player.heartbeat.failed"));
        return;
      }

      const [first, ...rest] = tracks;
      await api.clearPersistentQueue();
      const firstResult = await api.playNcmTrack(buildHeartbeatResolveInput(first));
      ncm.registerNcmPlayback(firstResult.track);
      playback.applyPlayerState(firstResult.state);
      await playback.refreshState(firstResult.track.streamUrl);

      for (const item of rest) {
        const enqueued = await api.enqueueNcmTrack(buildHeartbeatResolveInput(item));
        ncm.registerNcmPlayback(enqueued.track);
      }

      const finalState = await api.setShuffleMode("heartbeat");
      playback.applyPlayerState(finalState);
      await queue.refreshQueue();
    } catch (error) {
      playback.setCommandError(readErrorMessage(error));
    }
  };

  createEffect(() => {
    applyUserAppearanceSettings(uiSettings);
  });

  createEffect(() => {
    const themeMode = uiSettings.themeMode;
    void themeMode;
    if (!uiSettings.playerFollowCoverColor) {
      applyDynamicAccent(null);
      applyUserAppearanceSettings(uiSettings);
      return;
    }
    const url = ncm.currentNcmCoverUrl() ?? playback.coverUrl();
    let cancelled = false;
    if (!url) {
      applyDynamicAccent(null);
      applyUserAppearanceSettings(uiSettings);
      return;
    }
    void extractAccent(url).then((color) => {
      if (cancelled) return;
      applyDynamicAccent(color);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  return {
    state: playback.state,
    spectrum: playback.spectrum,
    loadingProgress: playback.loadingProgress,
    wsStatus: playback.wsStatus,
    preloadRequested: playback.preloadRequested,
    commandError: playback.commandError,
    activePage: navigation.activePage,
    queueEntries: queue.queueEntries,
    queueDrawerOpen: queue.queueDrawerOpen,
    livePosition: playback.livePosition,
    fullPlayerOpen,
    settingsOpen,
    selectedPlaylistId: navigation.selectedPlaylistId,
    localPlaylistRequest: navigation.localPlaylistRequest,
    discoverTabRequest: navigation.discoverTabRequest,
    artistDetailRequest: navigation.artistDetailRequest,
    albumDetailRequest: navigation.albumDetailRequest,
    radioDetailRequest: navigation.radioDetailRequest,
    songWikiRequest: navigation.songWikiRequest,
    radioSubscribeEvent: navigation.radioSubscribeEvent,
    likedCollectionTabRequest: navigation.likedCollectionTabRequest,
    player: playback.player,
    currentTrackPath: playback.currentTrackPath,
    currentMediaId: playback.currentMediaId,
    hasCoverArt: playback.hasCoverArt,
    coverUrl: playback.coverUrl,
    prevEntryId: queue.prevEntryId,
    nextEntryId: queue.nextEntryId,
    repeatMode: playback.repeatMode,
    shuffleMode: playback.shuffleMode,
    canGoBack: navigation.canGoBack,
    canGoForward: navigation.canGoForward,
    currentTrackRef: ncm.currentTrackRef,
    currentNcmSongId: ncm.currentNcmSongId,
    currentNcmCoverUrl: ncm.currentNcmCoverUrl,
    resolvedCoverUrl: ncm.resolvedCoverUrl,
    currentLyricLines: ncm.currentLyricLines,
    currentInlineLyric: ncm.currentInlineLyric,
    fullPlayerTitle: ncm.fullPlayerTitle,
    fullPlayerSubtitle: ncm.fullPlayerSubtitle,
    fullPlayerDetail: ncm.fullPlayerDetail,
    lyricStatus: ncm.lyricStatus,
    currentNcmSupplement: ncm.currentNcmSupplement,
    currentIsLiked: ncm.currentIsLiked,
    playbackHistoryVersion,
    notifyPlaybackHistoryChanged,
    uiSettings,
    refreshState: playback.refreshState,
    applyPlayerState: playback.applyPlayerState,
    refreshQueue: queue.refreshQueue,
    handlePlay: playback.handlePlay,
    handlePause: playback.handlePause,
    handleSeek: playback.handleSeek,
    handleVolumeChange: playback.handleVolumeChange,
    handleSkipPrev: queue.handleSkipPrev,
    handleSkipNext: queue.handleSkipNext,
    handleCycleRepeat: playback.handleCycleRepeat,
    handleToggleShuffle: playback.handleToggleShuffle,
    handleToggleLike: ncm.handleToggleLike,
    handleActivePageChange: navigation.handleActivePageChange,
    handleOpenQueue: queue.handleOpenQueue,
    handleToggleQueue: queue.handleToggleQueue,
    handleOpenQueueFromFullPlayer: queue.handleOpenQueueFromFullPlayer,
    handlePlayQueueEntry: queue.handlePlayQueueEntry,
    handleRemoveQueueEntry: queue.handleRemoveQueueEntry,
    handleClearQueue: queue.handleClearQueue,
    handleSidebarPlaylistSelect: navigation.handleSidebarPlaylistSelect,
    handleSidebarLocalPlaylistSelect: navigation.handleSidebarLocalPlaylistSelect,
    handleSelectedPlaylistChange: navigation.handleSelectedPlaylistChange,
    handleNavigateToDiscover: navigation.handleNavigateToDiscover,
    handleNavigateToArtistDetail: navigation.handleNavigateToArtistDetail,
    handleNavigateToAlbumDetail: navigation.handleNavigateToAlbumDetail,
    handleNavigateToRadioDetail: navigation.handleNavigateToRadioDetail,
    handleNavigateToSongWiki: navigation.handleNavigateToSongWiki,
    handleRadioSubscribeChange: navigation.handleRadioSubscribeChange,
    handleNavigateToLikedCollectionTab: navigation.handleNavigateToLikedCollectionTab,
    handleChangeCurrentNcmQuality,
    handleGoBack: navigation.handleGoBack,
    handleGoForward: navigation.handleGoForward,
    registerNcmPlayback: ncm.registerNcmPlayback,
    setFullPlayerOpen,
    setQueueDrawerOpen: queue.setQueueDrawerOpen,
    setSettingsOpen,
    setPreloadRequested: playback.setPreloadRequested,
    isPlaceholderPage,
    personalFmReloadTick,
    requestPersonalFmRefresh,
    requestHeartbeatMode
  };
}
