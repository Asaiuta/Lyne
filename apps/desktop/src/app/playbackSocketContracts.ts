import type { Setter } from "solid-js";
import type { RequestState, PlayerState } from "../shared/api/types";
import type { PlayerStatePatch } from "./playbackState";

export type WsStatus = "connected" | "connecting" | "disconnected";

export interface PlaybackSocketDeps {
  state: () => RequestState<PlayerState>;
  patchPlayerState: (patch: PlayerStatePatch) => void;
  applyPlayerState: (next: PlayerState) => void;
  setSpectrum: Setter<number[]>;
  setLoadingProgress: Setter<number | null>;
  setWsStatus: Setter<WsStatus>;
  setPreloadRequested: Setter<boolean>;
  setLivePosition: Setter<number | null>;
  shouldAcceptSpectrum: () => boolean;
  shouldSuppressRemotePosition: () => boolean;
  noteSocketActivity: () => void;
  scheduleRefresh: (expectedPath?: string | null) => void;
  refreshQueueForCurrentSurface: () => void;
  notifyPlaybackHistoryChanged: () => void;
  reportSocketProtocolError?: (reason: string, preview: string) => void;
}
