import type { LyricLine } from "../../shared/api/lyrics";

/** Tauri event channel names shared between the main window and the overlay. */
export const DESKTOP_LYRIC_EVENT = {
  /** main → overlay: full track + lyric lines + config (sent on change). */
  track: "desktop-lyric:track",
  /** main → overlay: lightweight playback position/state tick (~500ms). */
  tick: "desktop-lyric:tick",
  /** overlay → main: control request (play/pause/next/prev/etc.). */
  control: "desktop-lyric:control",
  /** overlay → main: overlay finished mounting and is ready to receive data. */
  ready: "desktop-lyric:ready"
} as const;

export type DesktopLyricLineAlign = "left" | "center" | "right" | "both";

/** Visual/behaviour config pushed from the main window (mirrors UI settings). */
export interface DesktopLyricConfig {
  fontSize: number;
  showWordLyrics: boolean;
  showTranslation: boolean;
  doubleLine: boolean;
  position: DesktopLyricLineAlign;
  playedColor: string;
  unplayedColor: string;
  shadowColor: string;
  showPlayInfo: boolean;
  locked: boolean;
}

export const DEFAULT_DESKTOP_LYRIC_CONFIG: DesktopLyricConfig = {
  fontSize: 34,
  showWordLyrics: true,
  showTranslation: true,
  doubleLine: true,
  position: "center",
  playedColor: "#ffffff",
  unplayedColor: "rgba(255, 255, 255, 0.45)",
  shadowColor: "rgba(0, 0, 0, 0.85)",
  showPlayInfo: false,
  locked: false
};

/** Track payload: metadata + the full lyric line list + render config. */
export interface DesktopLyricTrackPayload {
  title: string;
  artist: string | null;
  songId: number | null;
  /** Lyric times are in SECONDS, matching playback position. */
  lines: LyricLine[];
  config: DesktopLyricConfig;
}

/** Playback tick payload: position (seconds) + playing flag. */
export interface DesktopLyricTickPayload {
  /** Playback position in SECONDS. */
  position: number;
  playing: boolean;
}

export type DesktopLyricControlAction =
  | "play"
  | "pause"
  | "next"
  | "prev"
  | "openMain"
  | "openSettings"
  | "close"
  | "toggleLock";

export interface DesktopLyricControlPayload {
  action: DesktopLyricControlAction;
  /** For toggleLock: the requested lock state. */
  locked?: boolean;
}
