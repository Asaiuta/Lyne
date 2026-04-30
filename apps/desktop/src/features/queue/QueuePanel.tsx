import { useCallback, useEffect, useState } from "react";
import { createApiClient } from "../../shared/api/client";
import type { QueueStatus, RequestState } from "../../shared/api/types";

const api = createApiClient();

interface QueuePanelProps {
  currentTrackPath: string | null;
  preloadRequested: boolean;
  onPreloadCleared: () => void;
  onStateRefresh: () => Promise<void>;
}

interface QueueFeedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

const trimPath = (value: string) => value.trim();
const readErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed";

export function QueuePanel({
  currentTrackPath,
  preloadRequested,
  onPreloadCleared,
  onStateRefresh
}: QueuePanelProps) {
  const [loadPath, setLoadPath] = useState("");
  const [nextPath, setNextPath] = useState("");
  const [queueState, setQueueState] = useState<RequestState<QueueStatus>>({ status: "idle" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<QueueFeedback>({
    tone: "neutral",
    message: "Load a local file or HTTP/WebDAV URL, then manage the next gapless preload."
  });

  const loadQueueStatus = useCallback(async () => {
    try {
      const queue = await api.getQueueStatus();
      setQueueState({ status: "success", data: queue });
    } catch (error) {
      setQueueState({ status: "error", error: readErrorMessage(error) });
    }
  }, []);

  useEffect(() => {
    setQueueState((current) => (current.status === "idle" ? { status: "loading" } : current));
    void loadQueueStatus();
  }, [loadQueueStatus]);

  useEffect(() => {
    void loadQueueStatus();
  }, [currentTrackPath, preloadRequested, loadQueueStatus]);

  const handleLoad = async () => {
    const path = trimPath(loadPath);
    if (!path) {
      setFeedback({ tone: "error", message: "Enter a file path or URL to load." });
      return;
    }

    setIsSubmitting(true);
    setFeedback({ tone: "neutral", message: "Loading track into the engine..." });

    try {
      await api.load(path);
      await Promise.all([onStateRefresh(), loadQueueStatus()]);
      setLoadPath("");
      setFeedback({ tone: "success", message: "Track loaded. Queue state refreshed." });
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQueueNext = async () => {
    const path = trimPath(nextPath);
    if (!path) {
      setFeedback({ tone: "error", message: "Enter a next-track path before queuing." });
      return;
    }

    setIsSubmitting(true);
    setFeedback({ tone: "neutral", message: "Preparing next track for gapless playback..." });

    try {
      await api.queueNext(path);
      await loadQueueStatus();
      setFeedback({ tone: "success", message: "Next track queued for gapless playback." });
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPreload = async () => {
    setIsSubmitting(true);
    setFeedback({ tone: "neutral", message: "Canceling pending preload..." });

    try {
      await api.cancelPreload();
      onPreloadCleared();
      await loadQueueStatus();
      setNextPath("");
      setFeedback({ tone: "success", message: "Pending preload cleared." });
    } catch (error) {
      setFeedback({ tone: "error", message: readErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolvedCurrentTrack =
    queueState.status === "success" ? queueState.data.current_track_path : currentTrackPath;
  const pendingTrack =
    queueState.status === "success" ? queueState.data.pending_track_path : null;
  const canCancel =
    queueState.status === "success"
      ? queueState.data.needs_preload || queueState.data.pending_ready || queueState.data.is_preload_canceling
      : preloadRequested;

  return (
    <section className="panel panel-queue">
      <div className="panel-header">
        <h2>Queue</h2>
        <span className="panel-meta">Local + WebDAV</span>
      </div>

      <div className="settings-group">
        <label className="field-label" htmlFor="load-path">
          Load Track
        </label>
        <input
          id="load-path"
          className="text-input"
          type="text"
          value={loadPath}
          onChange={(event) => setLoadPath(event.target.value)}
          placeholder="D:\\Music\\Album\\Track.flac or https://server/audio.flac"
        />
        <button className="primary-button" type="button" onClick={handleLoad} disabled={isSubmitting}>
          Load Now
        </button>
      </div>

      <div className="settings-group">
        <label className="field-label" htmlFor="next-path">
          Queue Next
        </label>
        <input
          id="next-path"
          className="text-input"
          type="text"
          value={nextPath}
          onChange={(event) => setNextPath(event.target.value)}
          placeholder="Prepare the next gapless track"
        />
        <button className="ghost-button" type="button" onClick={handleQueueNext} disabled={isSubmitting}>
          Queue For Gapless
        </button>
        <button className="ghost-button" type="button" onClick={handleCancelPreload} disabled={isSubmitting || !canCancel}>
          Cancel Preload
        </button>
      </div>

      <div className="status-stack">
        <div className="status-line">Current {resolvedCurrentTrack ?? "No track loaded"}</div>
        <div className={feedback.tone === "error" ? "status-error" : "status-line"}>{feedback.message}</div>
        {queueState.status === "error" ? <div className="status-error">{queueState.error}</div> : null}
        {queueState.status === "success" ? (
          <>
            <div className="status-line">
              Next {pendingTrack ?? "No next track staged"}
            </div>
            <div className="status-line">
              Preload {queueState.data.pending_ready ? "ready" : queueState.data.needs_preload ? "requested" : "idle"}
            </div>
            {queueState.data.is_preload_canceling ? (
              <div className="status-line">Cancellation signal sent to the preload worker.</div>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
