import { createContext, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type {
  NcmLyricLine,
  NcmTrackReference,
  NcmTrackSupplement
} from "../features/online/ncmPlayback";
import type { NcmSongLevel } from "../shared/state/uiSettingsModel";
import type {
  PlayerState,
  QueueEntry,
  RepeatMode,
  RequestState,
  ShuffleMode
} from "../shared/api/types";
import type { WsStatus } from "./playbackSocketContracts";

export interface PlaybackContextValue {
  state: Accessor<RequestState<PlayerState>>;
  spectrum: Accessor<number[]>;
  loadingProgress: Accessor<number | null>;
  wsStatus: Accessor<WsStatus>;
  commandError: Accessor<string | null>;
  livePosition: Accessor<number | null>;
  player: Accessor<PlayerState | null>;
  isPlaying: Accessor<boolean>;
  currentTrackPath: Accessor<string | null>;
  currentMediaId: Accessor<string | null>;
  currentSongId: Accessor<number | null>;
  currentCoverUrl: Accessor<string | null>;
  resolvedCoverUrl: Accessor<string | null>;
  lyrics: Accessor<readonly NcmLyricLine[]>;
  inlineLyric: Accessor<string | null>;
  title: Accessor<string>;
  artist: Accessor<string | null>;
  album: Accessor<string | null>;
  subtitle: Accessor<string>;
  detail: Accessor<string | null>;
  lyricStatus: Accessor<"idle" | "loading" | "ready" | "error">;
  supplement: Accessor<NcmTrackSupplement | null>;
  isLiked: Accessor<boolean>;
  repeatMode: Accessor<RepeatMode>;
  shuffleMode: Accessor<ShuffleMode>;
  queueEntries: Accessor<QueueEntry[]>;
  previousEntryId: Accessor<number | null>;
  nextEntryId: Accessor<number | null>;
  refreshState: (expectedPath?: string | null) => Promise<void>;
  applyPlayerState: (next: PlayerState) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  previewVolume: (volume: number) => Promise<void>;
  changeVolume: (volume: number) => Promise<void>;
  skipPrevious: () => Promise<void>;
  skipNext: () => Promise<void>;
  cycleRepeat: () => Promise<void>;
  toggleShuffle: () => Promise<void>;
  toggleLike: () => Promise<void>;
  openQueue: () => void;
  registerNcmPlayback: (track: NcmTrackReference) => void;
  changeCurrentNcmQuality: (level: NcmSongLevel) => Promise<void>;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

export function PlaybackProvider(props: {
  value: PlaybackContextValue;
  children: JSX.Element;
}) {
  return (
    <PlaybackContext.Provider value={props.value}>
      {props.children}
    </PlaybackContext.Provider>
  );
}

export function usePlayback(): PlaybackContextValue {
  const context = useContext(PlaybackContext);
  if (!context) {
    throw new Error("usePlayback must be used within PlaybackProvider");
  }
  return context;
}
