import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  NcmLyricLine,
  NcmTrackReference,
  NcmTrackSupplement
} from "../features/online/ncmPlayback";
import type { UserPlaylistMode } from "../features/online/ncmPlaylistSummary";
import type {
  PlayerState,
  QueueEntry,
  RepeatMode,
  RequestState,
  ShuffleMode
} from "../shared/api/types";
import { useEngineSocket } from "../shared/api/useEngineSocket";
import { useUISettings } from "../shared/state/useUISettings";
import { isPlaceholderPage, type ActivePage } from "../shared/ui/navigation";
import { applyDynamicAccent, extractAccent } from "../shared/styles/dynamicAccent";
import type { ApiClient, QueueAdjacent } from "../shared/api/client";
import {
  firstNonEmpty,
  readErrorMessage,
  sameMediaPath
} from "./controllerHelpers";
import { useNavigationController } from "./useNavigationController";
import { useNcmTrackEnrichment } from "./useNcmTrackEnrichment";

type WsStatus = "connected" | "connecting" | "disconnected";

const REPEAT_CYCLE: ReadonlyArray<RepeatMode> = ["off", "all", "one"];
const TRACK_STATE_SETTLE_TIMEOUT_MS = 2500;
const TRACK_STATE_POLL_INTERVAL_MS = 120;
const PLAYER_STATE_POLL_MS = 1500;
const SEEK_REMOTE_SUPPRESS_MS = 900;

const nextRepeatMode = (current: RepeatMode): RepeatMode => {
  const index = REPEAT_CYCLE.indexOf(current);
  return REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? "off";
};

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
  discoverTabRequest: Accessor<{ tab: string; version: number }>;
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
  uiSettings: ReturnType<typeof useUISettings>;
  refreshState: (expectedPath?: string | null) => Promise<void>;
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
  handleOpenQueueFromFullPlayer: () => void;
  handlePlayQueueEntry: (entryId: number) => Promise<void>;
  handleRemoveQueueEntry: (entryId: number) => Promise<void>;
  handleClearQueue: () => Promise<void>;
  handleSidebarPlaylistSelect: (page: UserPlaylistMode, playlistId: number) => void;
  handleSelectedPlaylistChange: (playlistId: number | null) => void;
  handleNavigateToDiscover: (tab: string) => void;
  handleGoBack: () => void;
  handleGoForward: () => void;
  registerNcmPlayback: (track: NcmTrackReference) => void;
  setFullPlayerOpen: (value: boolean) => void;
  setQueueDrawerOpen: (value: boolean) => void;
  setSettingsOpen: (value: boolean) => void;
  setPreloadRequested: (value: boolean) => void;
  isPlaceholderPage: typeof isPlaceholderPage;
}

export function useAppController(api: ApiClient): AppController {
  const uiSettings = useUISettings();
  const navigation = useNavigationController();

  const [state, setState] = createSignal<RequestState<PlayerState>>({ status: "idle" });
  const [spectrum, setSpectrum] = createSignal<number[]>([]);
  const [loadingProgress, setLoadingProgress] = createSignal<number | null>(null);
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [preloadRequested, setPreloadRequested] = createSignal(false);
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [queueEntries, setQueueEntries] = createSignal<QueueEntry[]>([]);
  const [queueAdjacent, setQueueAdjacent] = createSignal<QueueAdjacent>({
    previousEntryId: null,
    nextEntryId: null
  });
  const [queueDrawerOpen, setQueueDrawerOpen] = createSignal(false);
  const [livePosition, setLivePosition] = createSignal<number | null>(null);
  const [fullPlayerOpen, setFullPlayerOpen] = createSignal(false);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [playbackHistoryVersion, setPlaybackHistoryVersion] = createSignal<number>(0);
  let lastRefreshAt = 0;
  let seekCommandId = 0;
  let volumeCommandId = 0;
  let suppressRemotePositionUntil = 0;

  const notifyPlaybackHistoryChanged = () => {
    setPlaybackHistoryVersion((version) => version + 1);
  };

  const applyPlayerState = (next: PlayerState) => {
    const current = state();
    if (
      current.status === "success" &&
      sameMediaPath(current.data.file_path, next.file_path)
    ) {
      setState({
        status: "success",
        data: {
          ...next,
          media_id: next.media_id ?? current.data.media_id,
          ncm_song_id: next.ncm_song_id ?? current.data.ncm_song_id,
          ncm_source_page_url: firstNonEmpty(
            next.ncm_source_page_url,
            current.data.ncm_source_page_url
          ),
          title: firstNonEmpty(next.title, current.data.title),
          artist: firstNonEmpty(next.artist, current.data.artist),
          album: firstNonEmpty(next.album, current.data.album),
          has_cover_art: next.has_cover_art || current.data.has_cover_art,
          external_artwork_url: firstNonEmpty(
            next.external_artwork_url,
            current.data.external_artwork_url
          )
        }
      });
      return;
    }

    setState({ status: "success", data: next });
  };

  const patchPlayerState = (
    patch:
      | Partial<PlayerState>
      | ((current: PlayerState) => Partial<PlayerState> | PlayerState | null)
  ) => {
    const current = state();
    if (current.status !== "success") {
      return;
    }

    const nextPatch = typeof patch === "function" ? patch(current.data) : patch;
    if (!nextPatch) {
      return;
    }

    applyPlayerState({
      ...current.data,
      ...nextPatch
    });
  };

  const refreshState = async (expectedPath?: string | null) => {
    const current = state();
    if (current.status !== "success") {
      setState({ status: "loading" });
    }

    const normalizedExpectedPath = expectedPath?.trim() ? expectedPath : null;
    const deadline = normalizedExpectedPath
      ? Date.now() + TRACK_STATE_SETTLE_TIMEOUT_MS
      : 0;
    let latestState: PlayerState | null = null;

    while (true) {
      try {
        const next = await api.getState();
        latestState = next;

        if (!normalizedExpectedPath || sameMediaPath(next.file_path, normalizedExpectedPath)) {
          applyPlayerState(next);
          return;
        }

        if (Date.now() >= deadline) {
          const latestRequest = state();
          if (
            latestRequest.status === "success" &&
            sameMediaPath(latestRequest.data.file_path, normalizedExpectedPath)
          ) {
            return;
          }
          applyPlayerState(next);
          return;
        }
      } catch (error) {
        if (!normalizedExpectedPath || Date.now() >= deadline) {
          setState({ status: "error", error: readErrorMessage(error) });
          return;
        }
      }

      await new Promise<void>((resolve) =>
        window.setTimeout(resolve, TRACK_STATE_POLL_INTERVAL_MS)
      );
      if (latestState && sameMediaPath(latestState.file_path, normalizedExpectedPath)) {
        applyPlayerState(latestState);
        return;
      }
    }
  };

  const refreshQueue = async () => {
    try {
      const entries = await api.getPersistentQueue();
      setQueueEntries(entries);
      try {
        setQueueAdjacent(await api.getQueueAdjacent());
      } catch {
        setQueueAdjacent({ previousEntryId: null, nextEntryId: null });
      }
    } catch {
      setQueueEntries([]);
      setQueueAdjacent({ previousEntryId: null, nextEntryId: null });
    }
  };

  const refreshQueueAdjacent = async () => {
    try {
      setQueueAdjacent(await api.getQueueAdjacent());
    } catch {
      setQueueAdjacent({ previousEntryId: null, nextEntryId: null });
    }
  };

  const refreshQueueForCurrentSurface = () => {
    if (queueDrawerOpen()) {
      void refreshQueue();
      return;
    }
    void refreshQueueAdjacent();
  };

  onMount(() => {
    void refreshState();
    refreshQueueForCurrentSurface();
  });

  const scheduleRefresh = (expectedPath?: string | null) => {
    const now = Date.now();
    if (now - lastRefreshAt < 300) {
      return;
    }
    lastRefreshAt = now;
    void refreshState(expectedPath);
  };

  useEngineSocket({
    onOpen: () => {
      setWsStatus("connected");
      void refreshState();
      refreshQueueForCurrentSurface();
    },
    onClose: () => setWsStatus("disconnected"),
    onError: () => setWsStatus("disconnected"),
    onReconnect: () => setWsStatus("connecting"),
    onEvent: (event) => {
      switch (event.type) {
        case "loading_progress":
          setLoadingProgress(event.progress);
          break;
        case "spectrum_data":
          setSpectrum(event.data);
          break;
        case "load_complete":
          patchPlayerState((currentPlayer) => ({
            file_path: event.file_path ?? currentPlayer.file_path,
            duration: event.duration,
            current_time: 0,
            is_loading: false
          }));
          setLoadingProgress(null);
          setPreloadRequested(false);
          scheduleRefresh();
          break;
        case "load_error":
          patchPlayerState({
            is_loading: false
          });
          setLoadingProgress(null);
          setPreloadRequested(false);
          scheduleRefresh();
          break;
        case "track_changed":
          {
            const currentRequest = state();
            const base =
              currentRequest.status === "success" ? currentRequest.data : null;
            if (!base) {
              scheduleRefresh(event.file_path);
              break;
            }
            applyPlayerState({
              ...base,
              file_path: event.file_path,
              duration: event.duration,
              media_id: event.media_id,
              ncm_song_id: event.ncm_song_id,
              ncm_source_page_url: event.ncm_source_page_url,
              title: event.title,
              artist: event.artist,
              album: event.album,
              has_cover_art: event.has_cover_art,
              external_artwork_url: event.external_artwork_url,
              current_time: 0,
              is_loading: false
            });
          }
          setPreloadRequested(false);
          setLivePosition(0);
          scheduleRefresh(event.file_path);
          refreshQueueForCurrentSurface();
          break;
        case "playback_ended":
          setPreloadRequested(false);
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "needs_preload":
          setPreloadRequested(true);
          break;
        case "queue_updated":
          refreshQueueForCurrentSurface();
          break;
        case "play":
          patchPlayerState({
            is_playing: true,
            is_paused: false,
            current_time: event.position
          });
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "pause":
          patchPlayerState({
            is_playing: false,
            is_paused: true,
            current_time: event.position
          });
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "stop":
          patchPlayerState({
            is_playing: false,
            is_paused: false,
            current_time: event.position
          });
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "seek":
          if (Date.now() < suppressRemotePositionUntil) {
            break;
          }
          patchPlayerState({
            current_time: event.position
          });
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "position":
          if (Date.now() < suppressRemotePositionUntil) {
            break;
          }
          patchPlayerState({
            current_time: event.position
          });
          setLivePosition(event.position);
          break;
        case "playback_history_updated":
          notifyPlaybackHistoryChanged();
          break;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    }
  });

  const runPlayerCommand = async (command: () => Promise<PlayerState>) => {
    setCommandError(null);
    try {
      const next = await command();
      applyPlayerState(next);
      window.setTimeout(() => {
        void refreshState();
      }, TRACK_STATE_POLL_INTERVAL_MS);
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };

  const handlePlay = () => runPlayerCommand(() => api.play());
  const handlePause = () => runPlayerCommand(() => api.pause());
  const handleSeek = async (position: number) => {
    const commandId = ++seekCommandId;
    const target = Math.max(0, position);
    suppressRemotePositionUntil = Date.now() + SEEK_REMOTE_SUPPRESS_MS;
    setCommandError(null);
    patchPlayerState({ current_time: target });
    setLivePosition(target);

    try {
      const next = await api.seek(target);
      if (commandId !== seekCommandId) {
        return;
      }
      applyPlayerState({
        ...next,
        current_time: target
      });
      setLivePosition(target);
      suppressRemotePositionUntil = 0;
      window.setTimeout(() => {
        if (commandId === seekCommandId) {
          void refreshState();
        }
      }, TRACK_STATE_POLL_INTERVAL_MS);
    } catch (error) {
      if (commandId !== seekCommandId) {
        return;
      }
      suppressRemotePositionUntil = 0;
      setCommandError(readErrorMessage(error));
      void refreshState();
    }
  };
  const handleVolumeChange = async (volume: number) => {
    const commandId = ++volumeCommandId;
    const target = Math.max(0, Math.min(1, volume));
    setCommandError(null);
    patchPlayerState({ volume: target });

    try {
      const next = await api.setVolume(target);
      if (commandId !== volumeCommandId) {
        return;
      }
      applyPlayerState({
        ...next,
        volume: target
      });
    } catch (error) {
      if (commandId !== volumeCommandId) {
        return;
      }
      setCommandError(readErrorMessage(error));
      void refreshState();
    }
  };

  createEffect(() => {
    const shouldPoll = Boolean(player()?.is_playing || player()?.is_loading);
    if (!shouldPoll) {
      return;
    }

    const timer = window.setInterval(() => {
      void refreshState();
    }, PLAYER_STATE_POLL_MS);

    onCleanup(() => {
      window.clearInterval(timer);
    });
  });

  const player = createMemo(() => {
    const request = state();
    return request.status === "success" ? request.data : null;
  });
  const currentTrackPath = createMemo(() => player()?.file_path ?? null);
  const currentMediaId = createMemo(() => player()?.media_id ?? null);
  const hasCoverArt = createMemo(() => Boolean(player()?.has_cover_art));
  const coverUrl = createMemo(() => {
    const mediaId = currentMediaId();
    return mediaId && hasCoverArt() ? api.getCoverArtUrl(mediaId) : null;
  });
  const playQueueEntry = async (entryId: number, options?: { rethrow?: boolean }) => {
    const entry = queueEntries().find((item) => item.entry_id === entryId);
    setCommandError(null);
    try {
      const next = await api.playFromQueue({ entryId, sourcePath: entry?.source_path });
      applyPlayerState(next);
      await Promise.all([refreshState(entry?.source_path ?? null), refreshQueue()]);
    } catch (error) {
      setCommandError(readErrorMessage(error));
      if (options?.rethrow) {
        throw error;
      }
    }
  };

  const prevEntryId = createMemo(() => queueAdjacent().previousEntryId);
  const nextEntryId = createMemo(() => queueAdjacent().nextEntryId);
  const handleSkipPrev = async () => {
    setCommandError(null);
    try {
      const next = await api.playPreviousQueueEntry();
      applyPlayerState(next);
      await Promise.all([refreshState(next.file_path), refreshQueue()]);
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };
  const handleSkipNext = async () => {
    setCommandError(null);
    try {
      const next = await api.playNextQueueEntry();
      applyPlayerState(next);
      await Promise.all([refreshState(next.file_path), refreshQueue()]);
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };
  const handlePlayQueueEntry = (entryId: number) => playQueueEntry(entryId, { rethrow: true });
  const handleRemoveQueueEntry = async (entryId: number) => {
    setCommandError(null);
    try {
      const entries = await api.removeQueueEntry(entryId);
      setQueueEntries(entries);
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };
  const handleClearQueue = async () => {
    if (queueEntries().length === 0) return;
    setCommandError(null);
    try {
      await api.clearPersistentQueue();
      setQueueEntries([]);
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };
  const repeatMode = createMemo<RepeatMode>(() => player()?.repeat_mode ?? "off");
  const shuffleMode = createMemo<ShuffleMode>(() => player()?.shuffle_mode ?? "off");
  const handleCycleRepeat = () => {
    const target = nextRepeatMode(repeatMode());
    return runPlayerCommand(() => api.setRepeatMode(target));
  };
  const handleToggleShuffle = () => {
    const target: ShuffleMode = shuffleMode() === "on" ? "off" : "on";
    return runPlayerCommand(() => api.setShuffleMode(target));
  };

  const handleOpenQueue = () => {
    setQueueDrawerOpen(true);
    window.setTimeout(() => {
      void refreshQueue();
    }, 0);
  };

  const handleOpenQueueFromFullPlayer = () => {
    handleOpenQueue();
  };

  const ncm = useNcmTrackEnrichment({
    api,
    player,
    livePosition,
    coverUrl
  });

  createEffect(() => {
    const url = ncm.resolvedCoverUrl();
    let cancelled = false;
    if (!url) {
      applyDynamicAccent(null);
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
    state,
    spectrum,
    loadingProgress,
    wsStatus,
    preloadRequested,
    commandError,
    activePage: navigation.activePage,
    queueEntries,
    queueDrawerOpen,
    livePosition,
    fullPlayerOpen,
    settingsOpen,
    selectedPlaylistId: navigation.selectedPlaylistId,
    discoverTabRequest: navigation.discoverTabRequest,
    player,
    currentTrackPath,
    currentMediaId,
    hasCoverArt,
    coverUrl,
    prevEntryId,
    nextEntryId,
    repeatMode,
    shuffleMode,
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
    uiSettings,
    refreshState,
    refreshQueue,
    handlePlay,
    handlePause,
    handleSeek,
    handleVolumeChange,
    handleSkipPrev,
    handleSkipNext,
    handleCycleRepeat,
    handleToggleShuffle,
    handleToggleLike: ncm.handleToggleLike,
    handleActivePageChange: navigation.handleActivePageChange,
    handleOpenQueue,
    handleOpenQueueFromFullPlayer,
    handlePlayQueueEntry,
    handleRemoveQueueEntry,
    handleClearQueue,
    handleSidebarPlaylistSelect: navigation.handleSidebarPlaylistSelect,
    handleSelectedPlaylistChange: navigation.handleSelectedPlaylistChange,
    handleNavigateToDiscover: navigation.handleNavigateToDiscover,
    handleGoBack: navigation.handleGoBack,
    handleGoForward: navigation.handleGoForward,
    registerNcmPlayback: ncm.registerNcmPlayback,
    setFullPlayerOpen,
    setQueueDrawerOpen,
    setSettingsOpen,
    setPreloadRequested,
    isPlaceholderPage
  };
}
