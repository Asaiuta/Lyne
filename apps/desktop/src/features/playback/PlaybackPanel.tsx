import type { RequestState, PlayerState } from "../../shared/api/types";
import { SpectrumCanvas } from "./SpectrumCanvas";

type WsStatus = "connected" | "connecting" | "disconnected";

interface PlaybackPanelProps {
  request: RequestState<PlayerState>;
  spectrum: number[];
  loadingProgress: number | null;
  wsStatus: WsStatus;
  commandError: string | null;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
}

const formatTime = (value: number) => {
  if (!Number.isFinite(value)) {
    return "0:00";
  }
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function PlaybackPanel({
  request,
  spectrum,
  loadingProgress,
  wsStatus,
  commandError,
  onPlay,
  onPause,
  onStop
}: PlaybackPanelProps) {
  const player = request.status === "success" ? request.data : null;
  const title = player?.title ?? player?.file_path ?? "No track loaded";
  const artist = player?.artist ?? "";
  const duration = player?.duration ?? 0;
  const currentTime = player?.current_time ?? 0;
  const progress = duration > 0 ? clamp01(currentTime / duration) : 0;

  const content = (() => {
    switch (request.status) {
      case "idle":
        return "Waiting for engine";
      case "loading":
        return "Loading state";
      case "error":
        return request.error;
      case "success":
        return title;
      default: {
        const _exhaustive: never = request;
        return _exhaustive;
      }
    }
  })();

  return (
    <section className="panel panel-playback">
      <div className="panel-header">
        <h2>Playback</h2>
        <div className="status-row">
          <span className={`status-chip status-${wsStatus}`}>
            Realtime {wsStatus}
          </span>
          <span className="panel-meta">Output locked to device</span>
        </div>
      </div>
      <div className="playback-title">{content}</div>
      {artist ? <div className="playback-artist">{artist}</div> : null}
      <div className="progress-track" role="presentation">
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="playback-time">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      {loadingProgress !== null && (
        <div className="loading-block">
          <div className="loading-row">
            <span>Loading</span>
            <span>{Math.round(loadingProgress)}%</span>
          </div>
          <div className="loading-bar" role="presentation">
            <div className="loading-fill" style={{ width: `${loadingProgress}%` }} />
          </div>
        </div>
      )}
      <SpectrumCanvas data={spectrum} active={Boolean(player?.is_playing || player?.is_loading)} />
      <div className="button-row">
        <button className="primary-button" type="button" onClick={onPlay}>
          Play
        </button>
        <button className="ghost-button" type="button" onClick={onPause}>
          Pause
        </button>
        <button className="ghost-button" type="button" onClick={onStop}>
          Stop
        </button>
      </div>
      {commandError ? <div className="status-error">{commandError}</div> : null}
      {request.status === "success" && (
        <div className="status-line">
          {request.data.is_playing ? "Playing" : "Idle"} · Volume {request.data.volume.toFixed(2)}
        </div>
      )}
    </section>
  );
}
