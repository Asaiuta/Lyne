import { useCallback, useEffect, useRef, useState } from "react";
import { createApiClient } from "../shared/api/client";
import type { PlayerState, RequestState } from "../shared/api/types";
import { useEngineSocket } from "../shared/api/useEngineSocket";
import { PlaybackPanel } from "../features/playback/PlaybackPanel";
import { QueuePanel } from "../features/queue/QueuePanel";
import { SettingsPanel } from "../features/settings/SettingsPanel";

const api = createApiClient();
type WsStatus = "connected" | "connecting" | "disconnected";
const readErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

export function App() {
  const [state, setState] = useState<RequestState<PlayerState>>({ status: "idle" });
  const [spectrum, setSpectrum] = useState<number[]>([]);
  const [loadingProgress, setLoadingProgress] = useState<number | null>(null);
  const [wsStatus, setWsStatus] = useState<WsStatus>("connecting");
  const [preloadRequested, setPreloadRequested] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const lastRefreshRef = useRef(0);

  const refreshState = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const next = await api.getState();
      setState({ status: "success", data: next });
    } catch (error) {
      const message = readErrorMessage(error);
      setState({ status: "error", error: message });
    }
  }, []);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const scheduleRefresh = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshRef.current < 300) {
      return;
    }
    lastRefreshRef.current = now;
    void refreshState();
  }, [refreshState]);

  useEngineSocket({
    onOpen: () => {
      setWsStatus("connected");
      void refreshState();
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
          scheduleRefresh();
          break;
        case "playback_ended":
          setPreloadRequested(false);
          scheduleRefresh();
          break;
        case "needs_preload":
          setPreloadRequested(true);
          break;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    }
  });

  const runPlayerCommand = useCallback(async (command: () => Promise<unknown>) => {
    setCommandError(null);
    try {
      await command();
      await refreshState();
    } catch (error) {
      setCommandError(readErrorMessage(error));
    }
  }, [refreshState]);

  const handlePlay = useCallback(async () => {
    await runPlayerCommand(() => api.play());
  }, [runPlayerCommand]);

  const handlePause = useCallback(async () => {
    await runPlayerCommand(() => api.pause());
  }, [runPlayerCommand]);

  const handleStop = useCallback(async () => {
    await runPlayerCommand(() => api.stop());
  }, [runPlayerCommand]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <div className="app-eyebrow">High-Fidelity Engine</div>
          <h1 className="app-title">Minimal Listening Console</h1>
          <p className="app-subtitle">Local playback, WebDAV library, and streaming control.</p>
        </div>
        <button className="ghost-button" type="button" onClick={refreshState}>
          Refresh
        </button>
      </header>

      <main className="app-grid">
        <QueuePanel
          currentTrackPath={state.status === "success" ? state.data.file_path : null}
          preloadRequested={preloadRequested}
          onPreloadCleared={() => setPreloadRequested(false)}
          onStateRefresh={refreshState}
        />
        <PlaybackPanel
          request={state}
          spectrum={spectrum}
          loadingProgress={loadingProgress}
          wsStatus={wsStatus}
          commandError={commandError}
          onPlay={handlePlay}
          onPause={handlePause}
          onStop={handleStop}
        />
        <SettingsPanel onStateRefresh={refreshState} />
      </main>
    </div>
  );
}
