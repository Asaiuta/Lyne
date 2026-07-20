import type { Accessor, Setter } from "solid-js";
import type { ApiClient } from "../shared/api/client";
import type { PlayerState, RepeatMode, ShuffleMode } from "../shared/api/types";
import {
  createAudioSettingsPreviewSessionId,
  type AudioSettingsStore
} from "../shared/state/audioSettingsStore";
import { readErrorMessage } from "./controllerHelpers";

const REPEAT_CYCLE: ReadonlyArray<RepeatMode> = ["off", "all", "one"];
const TRACK_STATE_POLL_INTERVAL_MS = 120;
const SEEK_REMOTE_SUPPRESS_MS = 900;
const VOLUME_STEP_COMMIT_DELAY_MS = 160;

const nextRepeatMode = (current: RepeatMode): RepeatMode => {
  const index = REPEAT_CYCLE.indexOf(current);
  return REPEAT_CYCLE[(index + 1) % REPEAT_CYCLE.length] ?? "off";
};

interface PlaybackCommandsDeps {
  api: ApiClient;
  audioSettings: AudioSettingsStore;
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
  handleVolumeStep: (volume: number) => Promise<void>;
  handleCycleRepeat: () => Promise<void>;
  handleToggleShuffle: () => Promise<void>;
}

interface VolumePreviewSession {
  readonly id: string;
  baseRevision: number | undefined;
  nextSeq: number;
  started: boolean;
}

export function usePlaybackCommands(deps: PlaybackCommandsDeps): PlaybackCommands {
  let seekCommandId = 0;
  let volumeCommandId = 0;
  let volumeRequestInFlight = false;
  let volumeSession: VolumePreviewSession | null = null;
  let queuedVolumeRequests: Array<
    | {
        kind: "preview";
        target: number;
        commandId: number;
        session: VolumePreviewSession;
        seq: number;
      }
    | {
        kind: "commit";
        target: number;
        commandId: number;
        session: VolumePreviewSession | undefined;
      }
  > = [];
  let volumeStepTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  let suppressRemotePositionUntil = 0;

  const runPlayerCommand = async (
    command: () => Promise<PlayerState>,
    options: { syncPosition?: boolean } = {}
  ) => {
    deps.setCommandError(null);
    try {
      const next = await command();
      deps.applyPlayerState(next);
      if (options.syncPosition) {
        deps.setLivePosition(next.current_time);
      }
      window.setTimeout(() => {
        void deps.refreshState();
      }, TRACK_STATE_POLL_INTERVAL_MS);
    } catch (error) {
      deps.setCommandError(readErrorMessage(error));
    }
  };

  const handlePlay = () => runPlayerCommand(() => deps.api.play(), { syncPosition: true });
  const handlePause = () => runPlayerCommand(() => deps.api.pause(), { syncPosition: true });

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
    if (volumeRequestInFlight || queuedVolumeRequests.length === 0) {
      return;
    }

    const request = queuedVolumeRequests.shift();
    if (!request) return;
    volumeRequestInFlight = true;

    let operation: Promise<unknown>;
    if (request.kind === "preview") {
      if (!request.session.started) {
        request.session.started = true;
        request.session.baseRevision = deps.audioSettings.snapshot()?.revision;
      }
      operation = deps.audioSettings
        .preview(request.session.id, request.seq, { volume: request.target })
        .then((result) => {
          request.session.baseRevision ??= result.snapshot.revision;
          return result;
        });
    } else {
      operation = deps.audioSettings.commit(
        { volume: request.target },
        {
          baseRevision:
            request.session?.baseRevision ?? deps.audioSettings.snapshot()?.revision,
          previewSessionId: request.session?.id
        }
      );
    }

    void operation
      .catch(async (error) => {
        if (request.kind === "commit" && request.session) {
          await deps.audioSettings.cancelPreview(request.session.id).catch(() => undefined);
        }
        if (request.commandId !== volumeCommandId) {
          return;
        }
        deps.setCommandError(readErrorMessage(error));
      })
      .finally(() => {
        volumeRequestInFlight = false;
        flushQueuedVolumeRequest();
      });
  };

  const ensureVolumeSession = () => {
    if (!volumeSession) {
      volumeSession = {
        id: createAudioSettingsPreviewSessionId("player-volume"),
        baseRevision: undefined,
        nextSeq: 0,
        started: false
      };
    }
    return volumeSession;
  };

  const queueVolumePreview = (volume: number): void => {
    const commandId = ++volumeCommandId;
    const target = Math.max(0, Math.min(1, volume));
    const session = ensureVolumeSession();
    session.nextSeq += 1;
    deps.setCommandError(null);
    const request = {
      kind: "preview" as const,
      target,
      commandId,
      session,
      seq: session.nextSeq
    };
    deps.audioSettings.reservePreview(session.id, session.nextSeq);
    const lastRequest = queuedVolumeRequests[queuedVolumeRequests.length - 1];
    if (lastRequest?.kind === "preview" && lastRequest.session.id === session.id) {
      queuedVolumeRequests[queuedVolumeRequests.length - 1] = request;
    } else {
      queuedVolumeRequests.push(request);
    }
    flushQueuedVolumeRequest();
  };

  const queueVolumeCommit = (volume: number): void => {
    const commandId = ++volumeCommandId;
    const target = Math.max(0, Math.min(1, volume));
    const session = volumeSession;
    volumeSession = null;
    deps.setCommandError(null);
    if (session) {
      queuedVolumeRequests = queuedVolumeRequests.filter(
        (request) => request.kind !== "preview" || request.session.id !== session.id
      );
    }
    queuedVolumeRequests.push({
      kind: "commit",
      target,
      commandId,
      session: session ?? undefined
    });
    flushQueuedVolumeRequest();
  };

  const clearVolumeStepTimer = (): void => {
    if (volumeStepTimer !== null) {
      globalThis.clearTimeout(volumeStepTimer);
      volumeStepTimer = null;
    }
  };

  const handleVolumeChange = async (volume: number) => {
    clearVolumeStepTimer();
    queueVolumeCommit(volume);
  };

  const handleVolumePreview = async (volume: number) => {
    clearVolumeStepTimer();
    queueVolumePreview(volume);
  };

  const handleVolumeStep = async (volume: number) => {
    const target = Math.max(0, Math.min(1, volume));
    queueVolumePreview(target);
    clearVolumeStepTimer();
    volumeStepTimer = globalThis.setTimeout(() => {
      volumeStepTimer = null;
      queueVolumeCommit(target);
    }, VOLUME_STEP_COMMIT_DELAY_MS);
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
    handleVolumeStep,
    handleCycleRepeat,
    handleToggleShuffle
  };
}
