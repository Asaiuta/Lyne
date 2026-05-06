import { Match, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { AppShell } from "../components/AppShell";
import { BackgroundLayer } from "../components/BackgroundLayer";
import { FullPlayer } from "../components/FullPlayer";
import { PlayerBar } from "../components/PlayerBar";
import { Sidebar } from "../components/Sidebar";
import type { ActivePage } from "../components/Sidebar";
import { TopNav } from "../components/TopNav";
import { WindowControls } from "../components/WindowControls";
import { HistoryPage } from "../features/history/HistoryPage";
import { LibraryPage } from "../features/library/LibraryPage";
import { NeteasePage } from "../features/online/NeteasePage";
import {
  mergeNcmTrackReference,
  readLyricLines,
  readSongDetailSupplement,
  type NcmTrackReference,
  type NcmTrackSupplement
} from "../features/online/ncmPlayback";
import { useNcmScrobbleEffect } from "../features/online/useNcmScrobbleEffect";
import { QueuePage } from "../features/queue/QueuePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { createApiClient } from "../shared/api/client";
import { lyricNew, songDetail } from "../shared/api/ncm/search";
import type {
  PlayerState,
  QueueEntry,
  RepeatMode,
  RequestState,
  ShuffleMode
} from "../shared/api/types";
import { useEngineSocket } from "../shared/api/useEngineSocket";
import { useTranslation } from "../shared/i18n";
import { NcmAccountProvider } from "../shared/state/NcmAccountContext";
import { UISearchProvider } from "../shared/state/UISearchContext";
import { useUISettings } from "../shared/state/useUISettings";

const api = createApiClient();

type WsStatus = "connected" | "connecting" | "disconnected";

const REPEAT_CYCLE: ReadonlyArray<RepeatMode> = ["off", "all", "one"];

const readErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

const nextRepeatMode = (current: RepeatMode): RepeatMode => {
  const index = REPEAT_CYCLE.indexOf(current);
  return REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? "off";
};

/**
 * Bridge component that lives inside `<NcmAccountProvider>` so it can read
 * `useNcmAccount()` for the login-status check while still receiving the
 * playback accessors from the App-level state. Renders nothing — pure
 * side-effect carrier for the scrobble accumulator.
 */
function NcmScrobbleBridge(props: {
  currentTrackRef: Accessor<NcmTrackReference | undefined>;
  isPlaying: Accessor<boolean>;
}) {
  useNcmScrobbleEffect({
    currentTrackRef: props.currentTrackRef,
    isPlaying: props.isPlaying
  });
  return null;
}

export function App() {
  const [state, setState] = createSignal<RequestState<PlayerState>>({ status: "idle" });
  const [spectrum, setSpectrum] = createSignal<number[]>([]);
  const [loadingProgress, setLoadingProgress] = createSignal<number | null>(null);
  const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
  const [preloadRequested, setPreloadRequested] = createSignal(false);
  const [commandError, setCommandError] = createSignal<string | null>(null);
  const [activePage, setActivePage] = createSignal<ActivePage>("recommend");
  const [queueEntries, setQueueEntries] = createSignal<QueueEntry[]>([]);
  const [livePosition, setLivePosition] = createSignal<number | null>(null);
  const [fullPlayerOpen, setFullPlayerOpen] = createSignal(false);
  const [ncmTrackRefs, setNcmTrackRefs] = createSignal<Record<string, NcmTrackReference>>({});
  const [currentNcmSupplement, setCurrentNcmSupplement] =
    createSignal<NcmTrackSupplement | null>(null);
  let lastRefreshAt = 0;
  const uiSettings = useUISettings();
  const { td } = useTranslation();

  const refreshState = async () => {
    setState({ status: "loading" });
    try {
      const next = await api.getState();
      setState({ status: "success", data: next });
    } catch (error) {
      setState({ status: "error", error: readErrorMessage(error) });
    }
  };

  const refreshQueue = async () => {
    try {
      const entries = await api.getPersistentQueue();
      setQueueEntries(entries);
    } catch {
      // Skip controls degrade gracefully when the queue endpoint is unreachable.
      setQueueEntries([]);
    }
  };

  onMount(() => {
    void refreshState();
    void refreshQueue();
  });

  const scheduleRefresh = () => {
    const now = Date.now();
    if (now - lastRefreshAt < 300) {
      return;
    }
    lastRefreshAt = now;
    void refreshState();
  };

  useEngineSocket({
    onOpen: () => {
      setWsStatus("connected");
      void refreshState();
      void refreshQueue();
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
        case "load_error":
          setLoadingProgress(null);
          setPreloadRequested(false);
          scheduleRefresh();
          break;
        case "track_changed":
          setPreloadRequested(false);
          setLivePosition(0);
          scheduleRefresh();
          void refreshQueue();
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
          void refreshQueue();
          break;
        case "play":
        case "pause":
        case "stop":
        case "seek":
          setLivePosition(event.position);
          scheduleRefresh();
          break;
        case "position":
          setLivePosition(event.position);
          break;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    }
  });

  const runPlayerCommand = async (command: () => Promise<unknown>) => {
    setCommandError(null);
    try {
      await command();
      await refreshState();
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  };

  const handlePlay = () => runPlayerCommand(() => api.play());
  const handlePause = () => runPlayerCommand(() => api.pause());
  const handleStop = () => runPlayerCommand(() => api.stop());
  const handleSeek = (position: number) => runPlayerCommand(() => api.seek(position));
  const handleVolumeChange = (volume: number) => runPlayerCommand(() => api.setVolume(volume));

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

  const queueNeighbors = createMemo(() => {
    const path = currentTrackPath();
    const entries = queueEntries();
    if (!path || entries.length === 0) {
      return { prevEntryId: null as number | null, nextEntryId: null as number | null };
    }

    const index = entries.findIndex((entry) => entry.source_path === path);
    if (index < 0) {
      return { prevEntryId: null, nextEntryId: null };
    }

    return {
      prevEntryId: index > 0 ? entries[index - 1].entry_id : null,
      nextEntryId: index < entries.length - 1 ? entries[index + 1].entry_id : null
    };
  });

  const prevEntryId = () => queueNeighbors().prevEntryId;
  const nextEntryId = () => queueNeighbors().nextEntryId;

  const handleSkipPrev = () => {
    const entryId = prevEntryId();
    if (entryId === null) return;
    return runPlayerCommand(() => api.playFromQueue(entryId));
  };

  const handleSkipNext = () => {
    const entryId = nextEntryId();
    if (entryId === null) return;
    return runPlayerCommand(() => api.playFromQueue(entryId));
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

  const currentTrackRef = createMemo(() => {
    const path = player()?.file_path;
    return path ? ncmTrackRefs()[path] : undefined;
  });
  const currentNcmSongId = createMemo(() => currentTrackRef()?.songId ?? null);
  const currentNcmCoverUrl = createMemo(
    () => currentNcmSupplement()?.coverUrl ?? currentTrackRef()?.coverUrl ?? null
  );
  const resolvedCoverUrl = createMemo(() => currentNcmCoverUrl() ?? coverUrl());
  const currentLyricLine = createMemo(() => currentNcmSupplement()?.lyrics ?? []);
  const fullPlayerTitle = createMemo(
    () =>
      currentNcmSupplement()?.title ??
      currentTrackRef()?.title ??
      player()?.title ??
      player()?.file_path ??
      ""
  );
  const fullPlayerSubtitle = createMemo(() =>
    [
      currentNcmSupplement()?.artist ?? currentTrackRef()?.artist ?? player()?.artist,
      currentNcmSupplement()?.album ?? currentTrackRef()?.album ?? player()?.album
    ]
      .filter(Boolean)
      .join(" · ")
  );
  const fullPlayerDetail = createMemo(() =>
    currentTrackRef() && currentNcmSongId() !== null ? `NCM · ID ${currentNcmSongId()}` : null
  );
  const lyricStatus = createMemo(() => {
    const supplement = currentNcmSupplement();
    if (supplement === null) return "idle";
    if (supplement.status === "loading") return "loading";
    if (supplement.status === "error") return "error";
    return "ready";
  });

  const registerNcmPlayback = (track: NcmTrackReference) => {
    setNcmTrackRefs((current) => ({
      ...current,
      [track.streamUrl]: mergeNcmTrackReference(current[track.streamUrl], track)
    }));
  };

  createEffect(() => {
    const trackRef = currentTrackRef();
    if (!trackRef) {
      setCurrentNcmSupplement(null);
      return;
    }

    let cancelled = false;
    setCurrentNcmSupplement({
      status: "loading",
      title: trackRef.title,
      artist: trackRef.artist,
      album: trackRef.album,
      coverUrl: trackRef.coverUrl,
      lyrics: [],
      error: null
    });

    void Promise.allSettled([songDetail(trackRef.songId), lyricNew(trackRef.songId)]).then(
      ([detailResult, lyricResult]) => {
        if (cancelled) {
          return;
        }

        const detailPayload =
          detailResult.status === "fulfilled"
            ? readSongDetailSupplement(detailResult.value, trackRef.songId)
            : null;
        const lyrics =
          lyricResult.status === "fulfilled" ? readLyricLines(lyricResult.value) : [];
        const error =
          detailResult.status === "rejected"
            ? readErrorMessage(detailResult.reason)
            : lyricResult.status === "rejected"
              ? readErrorMessage(lyricResult.reason)
              : null;

        setCurrentNcmSupplement({
          status: error && !detailPayload && lyrics.length === 0 ? "error" : "success",
          title: detailPayload?.title ?? trackRef.title,
          artist: detailPayload?.artist ?? trackRef.artist,
          album: detailPayload?.album ?? trackRef.album,
          coverUrl: detailPayload?.coverUrl ?? trackRef.coverUrl,
          lyrics,
          error
        });
      }
    );

    onCleanup(() => {
      cancelled = true;
    });
  });

  return (
    <NcmAccountProvider>
      <NcmScrobbleBridge
        currentTrackRef={currentTrackRef}
        isPlaying={() => Boolean(player()?.is_playing)}
      />
      <UISearchProvider activePage={activePage}>
        <AppShell
          sidebar={
            <Sidebar
              activePage={activePage()}
              onChange={setActivePage}
              onRefresh={() => void refreshState()}
            />
          }
          topNav={
            <TopNav
              activePage={activePage()}
              onOpenSettings={() => setActivePage("settings")}
              windowControls={<WindowControls visible={uiSettings.customChrome} />}
            />
          }
          backgroundLayer={
            <BackgroundLayer
              coverUrl={resolvedCoverUrl()}
              enabled={uiSettings.bgEnabled}
              blur={uiSettings.bgBlur}
              maskOpacity={uiSettings.bgMask / 100}
            />
          }
          playerBar={
            <PlayerBar
              request={state()}
              loadingProgress={loadingProgress()}
              wsStatus={wsStatus()}
              commandError={commandError()}
              coverUrl={resolvedCoverUrl()}
              canSkipPrev={prevEntryId() !== null}
              canSkipNext={nextEntryId() !== null}
              livePosition={livePosition()}
              repeatMode={repeatMode()}
              shuffleMode={shuffleMode()}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onSeek={handleSeek}
              onVolumeChange={handleVolumeChange}
              onSkipPrev={handleSkipPrev}
              onSkipNext={handleSkipNext}
              onCycleRepeat={handleCycleRepeat}
              onToggleShuffle={handleToggleShuffle}
              onCoverClick={() => setFullPlayerOpen(true)}
            />
          }
        >
          <Switch>
            <Match when={activePage() === "queue"}>
              <QueuePage
                currentTrackPath={currentTrackPath()}
                preloadRequested={preloadRequested()}
                onPreloadCleared={() => setPreloadRequested(false)}
                onStateRefresh={refreshState}
              />
            </Match>
            <Match when={activePage() === "library"}>
              <LibraryPage
                onStateRefresh={refreshState}
                currentTrackPath={currentTrackPath()}
                isPlaying={Boolean(player()?.is_playing)}
              />
            </Match>
            <Match
              when={
                activePage() === "recommend" ||
                activePage() === "discover" ||
                activePage() === "created-playlists" ||
                activePage() === "collected-playlists"
              }
            >
              <NeteasePage
                mode={
                  activePage() as "recommend" | "discover" | "created-playlists" | "collected-playlists"
                }
                onStateRefresh={refreshState}
                currentTrackPath={currentTrackPath()}
                currentSongId={currentNcmSongId()}
                isPlaying={Boolean(player()?.is_playing)}
                onRegisterPlayback={registerNcmPlayback}
              />
            </Match>
            <Match when={activePage() === "recent"}>
              <HistoryPage onStateRefresh={refreshState} />
            </Match>
            <Match when={activePage() === "settings"}>
              <SettingsPage onStateRefresh={refreshState} />
            </Match>
            <Match when={activePage() === "liked" || activePage() === "cloud"}>
              <div class="panel panel-placeholder">
                <div class="panel-header">
                  <h2>{td(`sidebar.nav.${activePage()}.label`)}</h2>
                </div>
                <p class="panel-note">
                  {activePage() === "liked" && "喜欢的音乐 — 收藏同步功能开发中"}
                  {activePage() === "cloud" && "我的云盘 — 云盘功能开发中"}
                </p>
              </div>
            </Match>
          </Switch>
        </AppShell>

        <FullPlayer
          isOpen={fullPlayerOpen()}
          onClose={() => setFullPlayerOpen(false)}
          coverUrl={resolvedCoverUrl()}
          title={fullPlayerTitle()}
          subtitle={fullPlayerSubtitle()}
          detail={fullPlayerDetail()}
          duration={player()?.duration ?? 0}
          currentTime={livePosition() ?? player()?.current_time ?? 0}
          isPlaying={Boolean(player()?.is_playing)}
          spectrum={spectrum()}
          lyrics={currentLyricLine()}
          lyricStatus={lyricStatus()}
          lyricError={currentNcmSupplement()?.error ?? null}
          repeatMode={repeatMode()}
          shuffleMode={shuffleMode()}
          canSkipPrev={prevEntryId() !== null}
          canSkipNext={nextEntryId() !== null}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeek={handleSeek}
          onSkipPrev={handleSkipPrev}
          onSkipNext={handleSkipNext}
          onCycleRepeat={handleCycleRepeat}
          onToggleShuffle={handleToggleShuffle}
        />
      </UISearchProvider>
    </NcmAccountProvider>
  );
}

export default App;
