import type { Accessor, Setter } from "solid-js";
import type { ApiClient } from "../shared/api/client";
import type { PlayerState, RepeatMode, ShuffleMode } from "../shared/api/types";
import { readErrorMessage } from "./controllerHelpers";

const REPEAT_CYCLE: ReadonlyArray<RepeatMode> = ["off", "all", "one"];
const TRACK_STATE_POLL_INTERVAL_MS = 120;
const SEEK_REMOTE_SUPPRESS_MS = 900;

const nextRepeatMode = (current: RepeatMode): RepeatMode => {
  const index = REPEAT_CYCLE.indexOf(current);
  return REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? "off";
};

interface PlaybackCommandsDeps {
  api: ApiClient;
  repeatMode: Accessor<RepeatMode>;
  shuffleMode: Accessor<ShuffleMode>;
  applyPlayerState: (next: PlayerState) => void;
  patchPlayerState: (patch: Partial<PlayerState>) => void;
  refreshState: (expectedPath?: string | null) => Promise<void>;
  setCommandError: Setter<string | null>;
  setLivePosition: Setter<number | null>;
}

export interface PlaybackCommands {
  shouldSuppressRemotePosition: () => boolean;
  handlePlay: () => Promise<void>;
  handlePause: () => Promise<void>;
  handleSeek: (position: number) => Promise<void>;
  handleVolumePreview: (volume: number) => Promise<void>;
  handleVolumeChange: (volume: number) => Promise<void>;
  handleCycleRepeat: () => Promise<void>;
  handleToggleShuffle: () => Promise<void>;
}

export function usePlaybackCommands(deps: PlaybackCommandsDeps): PlaybackCommands {
  let seekCommandId = 0;
  let volumeCommandId = 0;
  let volumeRequestInFlight = false;
  let queuedVolumeRequest:
    | { target: number; commandId: number; commit: boolean }
    | null = null;
  let suppressRemotePositionUntil = 0;

  const runPlayerCommand = async (command: () => Promise<PlayerState>) => {
    deps.setCommandError(null);
    try {
      const next = await command();
      deps.applyPlayerState(next);
      window.setTimeout(() => {
        void deps.refreshState();
      }, TRACK_STATE_POLL_INTERVAL_MS);
    } catch (error) {
      deps.setCommandError(readErrorMessage(error));
    }
  };

  const handlePlay = () => runPlayerCommand(() => deps.api.play());
  const handlePause = () => runPlayerCommand(() => deps.api.pause());

  const handleSeek = async (position: number) => {
    const commandId = ++seekCommandId;
    const target = Math.max(0, position);
    suppressRemotePositionUntil = Date.now() + SEEK_REMOTE_SUPPRESS_MS;
    deps.setCommandError(null);
    deps.patchPlayerState({ current_time: target });
    deps.setLivePosition(target);

    try {
      const next = await deps.api.seek(target);
      if (commandId !== seekCommandId) {
        return;
      }
      deps.applyPlayerState({
        ...next,
        current_time: target
      });
      deps.setLivePosition(target);
      suppressRemotePositionUntil = 0;
      window.setTimeout(() => {
        if (commandId === seekCommandId) {
          void deps.refreshState();
        }
      }, TRACK_STATE_POLL_INTERVAL_MS);
    } catch (error) {
      if (commandId !== seekCommandId) {
        return;
      }
      suppressRemotePositionUntil = 0;
      deps.setCommandError(readErrorMessage(error));
      void deps.refreshState();
    }
  };

  const flushQueuedVolumeRequest = (): void => {
    if (volumeRequestInFlight || queuedVolumeRequest === null) {
      return;
    }

    const request = queuedVolumeRequest;
    queuedVolumeRequest = null;
    volumeRequestInFlight = true;

    void deps.api
      .setVolume(request.target)
      .catch((error) => {
        if (request.commandId !== volumeCommandId) {
          return;
        }
        deps.setCommandError(readErrorMessage(error));
        if (request.commit) {
          void deps.refreshState();
        }
      })
      .finally(() => {
        volumeRequestInFlight = false;
        flushQueuedVolumeRequest();
      });
  };

  const queueVolumeRequest = (volume: number, commit: boolean): void => {
    const commandId = ++volumeCommandId;
    const target = Math.max(0, Math.min(1, volume));
    deps.setCommandError(null);
    if (commit) {
      deps.patchPlayerState({ volume: target });
    }
    queuedVolumeRequest = { target, commandId, commit };
    flushQueuedVolumeRequest();
  };

  const handleVolumeChange = async (volume: number) => {
    queueVolumeRequest(volume, true);
  };

  const handleVolumePreview = async (volume: number) => {
    queueVolumeRequest(volume, false);
  };

  const handleCycleRepeat = () => {
    const target = nextRepeatMode(deps.repeatMode());
    return runPlayerCommand(() => deps.api.setRepeatMode(target));
  };

  const handleToggleShuffle = () => {
    const target: ShuffleMode = deps.shuffleMode() === "off" ? "on" : "off";
    return runPlayerCommand(() => deps.api.setShuffleMode(target));
  };

  return {
    shouldSuppressRemotePosition: () => Date.now() < suppressRemotePositionUntil,
    handlePlay,
    handlePause,
    handleSeek,
    handleVolumePreview,
    handleVolumeChange,
    handleCycleRepeat,
    handleToggleShuffle
  };
}
