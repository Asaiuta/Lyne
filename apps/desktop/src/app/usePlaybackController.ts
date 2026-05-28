import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import type {
  PlayerState,
  RepeatMode,
  RequestState,
  ShuffleMode
} from "../shared/api/types";
import type { ApiClient } from "../shared/api/client";
import { readErrorMessage, sameMediaPath } from "./controllerHelpers";
import { DEFAULT_COVER_ART_URL, resolveArtworkUrl } from "../shared/ui/artwork";
import type { WsStatus } from "./playbackSocketContracts";
import {
  mergePlayerState,
  patchMergedPlayerState,
  type PlayerStatePatch
} from "./playbackState";
import { usePlaybackCommands } from "./usePlaybackCommands";
import { usePlaybackSocket } from "./usePlaybackSocket";

const TRACK_STATE_SETTLE_TIMEOUT_MS = 2500;
const TRACK_STATE_POLL_INTERVAL_MS = 120;
const PLAYER_STATE_POLL_MS = 1500;
const SOCKET_STALE_FALLBACK_MS = 5000;

type PlaybackPollMode =
  | { kind: "off" }
  | { kind: "wait-for-stale"; delayMs: number }
  | { kind: "interval" };

interface PlaybackPollingInput {
  isPlaying: boolean;
  isLoading: boolean;
  wsStatus: WsStatus;
  lastSocketActivityAt: number;
  now: number;
}

export const getPlaybackPollingMode = (input: PlaybackPollingInput): PlaybackPollMode => {
  if (!input.isPlaying && !input.isLoading) {
    return { kind: "off" };
  }

  if (input.wsStatus !== "connected") {
    return { kind: "interval" };
  }

  const staleAt = input.lastSocketActivityAt + SOCKET_STALE_FALLBACK_MS;
  if (input.now >= staleAt) {
    return { kind: "interval" };
  }

  return { kind: "wait-for-stale", delayMs: staleAt - input.now };
};

export interface PlaybackController {
  state: Accessor<RequestState<PlayerState>>;
  spectrum: Accessor<number[]>;
  loadingProgress: Accessor<number | null>;
  wsStatus: Accessor<WsStatus>;
  preloadRequested: Accessor<boolean>;
  commandError: Accessor<string | null>;
  livePosition: Accessor<number | null>;
  player: Accessor<PlayerState | null>;
  currentTrackPath: Accessor<string | null>;
  currentMediaId: Accessor<string | null>;
  hasCoverArt: Accessor<boolean>;
  coverUrl: Accessor<string | null>;
  repeatMode: Accessor<RepeatMode>;
  shuffleMode: Accessor<ShuffleMode>;
  setPreloadRequested: Setter<boolean>;
  setCommandError: Setter<string | null>;
  setLivePosition: Setter<number | null>;
  applyPlayerState: (next: PlayerState) => void;
  patchPlayerState: (patch: PlayerStatePatch) => void;
  refreshState: (expectedPath?: string | null) => Promise<void>;
  handlePlay: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleSeek: (position: number) => Promise<void>;
  handleVolumePreview: (volume: number) => Promise<void>;
  handleVolumeChange: (volume: number) => Promise<void>;
  handleCycleRepeat: () => Promise<void>;
  handleToggleShuffle: () => Promise<void>;
}

interface PlaybackControllerDeps {
  api: ApiClient;
  isSpectrumVisible: Accessor<boolean>;
  refreshQueueForCurrentSurface: () => void;
  notifyPlaybackHistoryChanged: () => void;
}

export function usePlaybackController(deps: PlaybackControllerDeps): PlaybackController {
  const { api, notifyPlaybackHistoryChanged, refreshQueueForCurrentSurface } = deps;

  const [state, setState] = createSignal<RequestState<PlayerState>>({ status: "idle" });
  const [spectrum, setSpectrum] = createSignal<number[]>([]);
  const [loadingProgress, setLoadingProgress] = createSignal<number | null>(null);
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [preloadRequested, setPreloadRequested] = createSignal<boolean>(false);
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [livePosition, setLivePosition] = createSignal<number | null>(null);
  const [lastSocketActivityAt, setLastSocketActivityAt] = createSignal<number>(Date.now());
  const [pollClock, setPollClock] = createSignal<number>(0);
  let lastRefreshAt = 0;

  const applyPlayerState = (next: PlayerState) => {
    setState((current) => mergePlayerState(current, next));
  };

  const patchPlayerState: PlaybackController["patchPlayerState"] = (patch) => {
    setState((current) => patchMergedPlayerState(current, patch));
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

  const player = createMemo(() => {
    const request = state();
    return request.status === "success" ? request.data : null;
  });
  const currentTrackPath = createMemo(() => player()?.file_path ?? null);
  const currentMediaId = createMemo(() => player()?.media_id ?? null);
  const hasCoverArt = createMemo(() => Boolean(player()?.has_cover_art));
  const coverUrl = createMemo(() => {
    const current = player();
    return resolveArtworkUrl({
      externalArtworkUrl: current?.external_artwork_url,
      mediaId: current?.media_id,
      hasCoverArt: current?.has_cover_art,
      urls: api,
      fallbackUrl: DEFAULT_COVER_ART_URL
    })
  });
  const repeatMode = createMemo<RepeatMode>(() => player()?.repeat_mode ?? "off");
  const shuffleMode = createMemo<ShuffleMode>(() => player()?.shuffle_mode ?? "off");

  const commands = usePlaybackCommands({
    api,
    repeatMode,
    shuffleMode,
    applyPlayerState,
    patchPlayerState,
    refreshState,
    setCommandError,
    setLivePosition
  });

  usePlaybackSocket({
    state,
    patchPlayerState,
    applyPlayerState,
    setSpectrum,
    setLoadingProgress,
    setWsStatus,
    setPreloadRequested,
    setLivePosition,
    shouldAcceptSpectrum: deps.isSpectrumVisible,
    shouldSuppressRemotePosition: commands.shouldSuppressRemotePosition,
    noteSocketActivity: () => setLastSocketActivityAt(Date.now()),
    scheduleRefresh,
    refreshQueueForCurrentSurface,
    notifyPlaybackHistoryChanged,
    reportSocketProtocolError: (reason, preview) => {
      console.warn("[audio] socket protocol error", { reason, preview });
    }
  });

  createEffect(() => {
    if (deps.isSpectrumVisible()) {
      return;
    }
    setSpectrum((current) => (current.length === 0 ? current : []));
  });

  createEffect(() => {
    pollClock();
    const currentPlayer = player();
    const pollMode = getPlaybackPollingMode({
      isPlaying: Boolean(currentPlayer?.is_playing),
      isLoading: Boolean(currentPlayer?.is_loading),
      wsStatus: wsStatus(),
      lastSocketActivityAt: lastSocketActivityAt(),
      now: Date.now()
    });

    if (pollMode.kind === "off") {
      return;
    }

    if (pollMode.kind === "wait-for-stale") {
      const timer = window.setTimeout(() => {
        setPollClock((clock) => clock + 1);
      }, pollMode.delayMs);

      onCleanup(() => {
        window.clearTimeout(timer);
      });
      return;
    }

    const timer = window.setInterval(() => {
      void refreshState();
    }, PLAYER_STATE_POLL_MS);

    onCleanup(() => {
      window.clearInterval(timer);
    });
  });

  return {
    state,
    spectrum,
    loadingProgress,
    wsStatus,
    preloadRequested,
    commandError,
    livePosition,
    player,
    currentTrackPath,
    currentMediaId,
    hasCoverArt,
    coverUrl,
    repeatMode,
    shuffleMode,
    setPreloadRequested,
    setCommandError,
    setLivePosition,
    applyPlayerState,
    patchPlayerState,
    refreshState,
    handlePlay: commands.handlePlay,
    handlePause: commands.handlePause,
    handleSeek: commands.handleSeek,
    handleVolumePreview: commands.handleVolumePreview,
    handleVolumeChange: commands.handleVolumeChange,
    handleCycleRepeat: commands.handleCycleRepeat,
    handleToggleShuffle: commands.handleToggleShuffle
  };
}
