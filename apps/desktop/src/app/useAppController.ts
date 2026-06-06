import { createEffect, createSignal, onCleanup } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { getNcmLikedPlaylistCached } from "../features/online/ncmPlaylistSummaryCache";
import type { NcmSongLevel } from "../shared/state/uiSettingsModel";
import {
  persistUISettingField,
  readUISettingField
} from "../shared/state/uiSettingsStorage";
import { useUISettings } from "../shared/state/useUISettings";
import { useNcmAccount } from "../shared/state/NcmAccountContext";
import { useTranslation } from "../shared/i18n";
import { isPlaceholderPage } from "../shared/ui/navigation";
import { paletteEngine } from "../shared/theme/paletteEngine";
import {
  applyPlayerCoverAccentColor,
  applyThemePaletteForSettings,
  applyUserAppearanceSettings
} from "../shared/styles/customAppearance";
import type {
  ApiClient,
  NcmTrackSummary,
  ResolveNcmTrackInput
} from "../shared/api/client";
import { readErrorMessage } from "./controllerHelpers";
import {
  useNavigationController,
  type NavigationController
} from "./useNavigationController";
import {
  useNcmTrackEnrichment,
  type NcmTrackEnrichment
} from "./useNcmTrackEnrichment";
import {
  usePlaybackController,
  type PlaybackController
} from "./usePlaybackController";
import { useQueueController, type QueueController } from "./useQueueController";
import type { PlaybackContextValue } from "./PlaybackContext";

export interface AppController {
  playback: PlaybackContextValue;
  queue: QueueController;
  navigation: NavigationController;
  ncm: NcmTrackEnrichment;
  ui: AppUiController;
  refreshPlayback: (expectedPath?: string | null) => Promise<void>;
}

export interface AppUiController {
  fullPlayerOpen: Accessor<boolean>;
  settingsOpen: Accessor<boolean>;
  playbackHistoryVersion: Accessor<number>;
  notifyPlaybackHistoryChanged: () => void;
  uiSettings: ReturnType<typeof useUISettings>;
  setFullPlayerOpen: Setter<boolean>;
  setSettingsOpen: Setter<boolean>;
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
    displayPosition: playback.displayPosition,
    coverUrl: playback.coverUrl,
    dynamicCoverEnabled: () => fullPlayerOpen() && uiSettings.dynamicCover,
    localLyricDirectories: () => uiSettings.localLyricDirectories,
    lyricPriority: () => uiSettings.lyricPriority
  });

  const handleChangeCurrentNcmQuality = async (level: NcmSongLevel) => {
    if (level === uiSettings.ncmSongLevel) {
      return;
    }

    const trackRef = ncm.currentTrackRef();
    if (!trackRef) {
      return;
    }

    const current = playback.player();
    const resumePosition = playback.displayPosition() ?? current?.current_time ?? 0;
    const wasPlaying = Boolean(current?.is_playing);
    playback.setCommandError(null);
    persistUISettingField("ncmSongLevel", level);

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

  const readNcmSongLevel = (): NcmSongLevel => readUISettingField("ncmSongLevel");

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
      const likedPlaylist = await getNcmLikedPlaylistCached(api, account.userId);
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
    const playerFollowCoverColor = uiSettings.playerFollowCoverColor;
    const themeFollowCover = uiSettings.themeFollowCover;
    if (!playerFollowCoverColor && !themeFollowCover) {
      applyPlayerCoverAccentColor(null);
      applyUserAppearanceSettings(uiSettings);
      return;
    }
    const url = ncm.currentNcmCoverUrl() ?? playback.coverUrl();
    let cancelled = false;
    if (!url) {
      applyPlayerCoverAccentColor(null);
      applyUserAppearanceSettings(uiSettings);
      return;
    }
    void paletteEngine.extractPaletteSource(url).then((paletteSource) => {
      if (cancelled) return;
      if (paletteSource === null) {
        applyPlayerCoverAccentColor(null);
        applyUserAppearanceSettings(uiSettings);
        return;
      }
      const scheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
      const palette = paletteEngine.createPaletteFromExtractedSource(paletteSource, scheme);
      applyPlayerCoverAccentColor(
        playerFollowCoverColor ? palette.theme.main : null,
        playerFollowCoverColor ? palette.theme.mainRgb : null
      );
      if (!themeFollowCover) {
        applyUserAppearanceSettings(uiSettings);
        return;
      }
      applyThemePaletteForSettings(uiSettings, palette);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  const playbackContext: PlaybackContextValue = {
    state: playback.state,
    spectrum: playback.spectrum,
    loadingProgress: playback.loadingProgress,
    wsStatus: playback.wsStatus,
    commandError: playback.commandError,
    livePosition: playback.livePosition,
    displayPosition: playback.displayPosition,
    player: playback.player,
    isPlaying: () => Boolean(playback.player()?.is_playing),
    currentTrackPath: playback.currentTrackPath,
    currentMediaId: playback.currentMediaId,
    currentSongId: ncm.currentNcmSongId,
    currentCoverUrl: ncm.currentNcmCoverUrl,
    resolvedCoverUrl: ncm.resolvedCoverUrl,
    lyrics: ncm.currentLyricLines,
    inlineLyric: ncm.currentInlineLyric,
    title: ncm.fullPlayerTitle,
    artist: ncm.fullPlayerArtist,
    album: ncm.fullPlayerAlbum,
    subtitle: ncm.fullPlayerSubtitle,
    detail: ncm.fullPlayerDetail,
    lyricStatus: ncm.lyricStatus,
    supplement: ncm.currentNcmSupplement,
    isLiked: ncm.currentIsLiked,
    repeatMode: playback.repeatMode,
    shuffleMode: playback.shuffleMode,
    queueEntries: queue.queueEntries,
    previousEntryId: queue.prevEntryId,
    nextEntryId: queue.nextEntryId,
    refreshState: playback.refreshState,
    applyPlayerState: playback.applyPlayerState,
    play: playback.handlePlay,
    pause: playback.handlePause,
    seek: playback.handleSeek,
    previewVolume: playback.handleVolumePreview,
    changeVolume: playback.handleVolumeChange,
    skipPrevious: queue.handleSkipPrev,
    skipNext: queue.handleSkipNext,
    cycleRepeat: playback.handleCycleRepeat,
    toggleShuffle: playback.handleToggleShuffle,
    toggleLike: ncm.handleToggleLike,
    openQueue: queue.handleOpenQueueFromFullPlayer,
    registerNcmPlayback: ncm.registerNcmPlayback,
    changeCurrentNcmQuality: handleChangeCurrentNcmQuality
  };

  const refreshPlayback = async (expectedPath?: string | null) => {
    await Promise.all([
      playback.refreshState(expectedPath),
      queue.refreshQueue()
    ]);
  };

  return {
    playback: playbackContext,
    queue,
    navigation,
    ncm,
    refreshPlayback,
    ui: {
      fullPlayerOpen,
      settingsOpen,
      playbackHistoryVersion,
      notifyPlaybackHistoryChanged,
      uiSettings,
      setFullPlayerOpen,
      setSettingsOpen,
      isPlaceholderPage,
      personalFmReloadTick,
      requestPersonalFmRefresh,
      requestHeartbeatMode
    }
  };
}
