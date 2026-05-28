import { useEngineSocket } from "../shared/api/useEngineSocket";
import type { WsEvent } from "../shared/api/wsTypes";
import type { EngineSocketProtocolError } from "../shared/api/useEngineSocket";
import type { PlaybackSocketDeps } from "./playbackSocketContracts";

export const applyPlaybackSocketEvent = (event: WsEvent, deps: PlaybackSocketDeps) => {
  switch (event.type) {
    case "loading_progress":
      deps.setLoadingProgress(event.progress);
      break;
    case "spectrum_data":
      if (deps.shouldAcceptSpectrum()) {
        deps.setSpectrum(event.data);
      }
      break;
    case "load_complete":
      deps.patchPlayerState((currentPlayer) => ({
        file_path: event.file_path ?? currentPlayer.file_path,
        duration: event.duration,
        current_time: 0,
        is_loading: false
      }));
      deps.setLoadingProgress(null);
      deps.setPreloadRequested(false);
      deps.scheduleRefresh(event.file_path);
      break;
    case "load_error":
      deps.patchPlayerState({
        is_loading: false
      });
      deps.setLoadingProgress(null);
      deps.setPreloadRequested(false);
      deps.scheduleRefresh();
      break;
    case "track_changed":
      {
        const currentRequest = deps.state();
        const base = currentRequest.status === "success" ? currentRequest.data : null;
        if (!base) {
          deps.scheduleRefresh(event.file_path);
          break;
        }
        deps.applyPlayerState({
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
      deps.setPreloadRequested(false);
      deps.setLivePosition(0);
      deps.scheduleRefresh(event.file_path);
      deps.refreshQueueForCurrentSurface();
      break;
    case "playback_ended":
      deps.setPreloadRequested(false);
      deps.setLivePosition(event.position);
      deps.scheduleRefresh();
      break;
    case "needs_preload":
      deps.setPreloadRequested(true);
      break;
    case "queue_updated":
      deps.refreshQueueForCurrentSurface();
      break;
    case "play":
      deps.patchPlayerState({
        is_playing: true,
        is_paused: false,
        current_time: event.position
      });
      deps.setLivePosition(event.position);
      deps.scheduleRefresh();
      break;
    case "pause":
      deps.patchPlayerState({
        is_playing: false,
        is_paused: true,
        current_time: event.position
      });
      deps.setLivePosition(event.position);
      deps.scheduleRefresh();
      break;
    case "stop":
      deps.patchPlayerState({
        is_playing: false,
        is_paused: false,
        current_time: event.position
      });
      deps.setLivePosition(event.position);
      deps.scheduleRefresh();
      break;
    case "seek":
      if (deps.shouldSuppressRemotePosition()) {
        break;
      }
      deps.patchPlayerState({
        current_time: event.position
      });
      deps.setLivePosition(event.position);
      deps.scheduleRefresh();
      break;
    case "position":
      if (deps.shouldSuppressRemotePosition()) {
        break;
      }
      deps.setLivePosition(event.position);
      break;
    case "playback_history_updated":
      deps.notifyPlaybackHistoryChanged();
      break;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

export const usePlaybackSocket = (deps: PlaybackSocketDeps) => {
  const handleProtocolError = (error: EngineSocketProtocolError) => {
    deps.reportSocketProtocolError?.(error.reason, error.preview);
  };

  useEngineSocket({
    onOpen: () => {
      deps.noteSocketActivity();
      deps.setWsStatus("connected");
      deps.scheduleRefresh();
      deps.refreshQueueForCurrentSurface();
    },
    onClose: () => deps.setWsStatus("disconnected"),
    onError: () => deps.setWsStatus("disconnected"),
    onReconnect: () => deps.setWsStatus("connecting"),
    onEvent: (event) => {
      deps.noteSocketActivity();
      applyPlaybackSocketEvent(event, deps);
    },
    onProtocolError: handleProtocolError
  });
};
