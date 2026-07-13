import type { JSX } from "solid-js";

export interface FullPlayerLayoutSettings {
  lyricAlignRight: boolean;
  lyricsPosition: string;
  playerStyleRatio: number;
  playerBackgroundFps: number;
  playerBackgroundFlowSpeed: number;
  playerBackgroundRenderScale: number;
  playerFullscreenGradient: number;
  playerType: string;
  fullPlayerLayout: string;
  hiddenCoverPlayer: boolean;
  fullPlayerCommentMode: string;
  playerBackgroundType: string;
  playerBackgroundPause: boolean;
  playerBackgroundLowFreqVolume: boolean;
  playerExpandAnimation: string;
}

const clampPlayerStyleRatio = (value: number) => Math.min(70, Math.max(30, value));

const getLayoutRatios = (settings: FullPlayerLayoutSettings) => {
  const leftRatio = settings.playerType === "fullscreen" ? 50 : clampPlayerStyleRatio(settings.playerStyleRatio);
  return {
    leftRatio,
    rightRatio: 100 - leftRatio
  };
};

const getLayoutRatioVars = (settings: FullPlayerLayoutSettings): JSX.CSSProperties => {
  const { leftRatio, rightRatio } = getLayoutRatios(settings);
  return {
    "--full-player-left-ratio": `${leftRatio}%`,
    "--full-player-right-ratio": `${rightRatio}%`
  } as JSX.CSSProperties;
};

export const getLyricLineAlign = (settings: FullPlayerLayoutSettings): string =>
  settings.lyricAlignRight ? "flex-end" : settings.lyricsPosition;

export const getLyricTextAlign = (align: string): string => {
  if (align === "center") return "center";
  return align === "flex-end" ? "right" : "left";
};

export const getLyricTransformOrigin = (align: string): string => {
  if (align === "center") return "center";
  return align === "flex-end" ? "right center" : "left center";
};

export const getRootStyle = (
  settings: FullPlayerLayoutSettings,
  bgBlur: number
): JSX.CSSProperties => {
  const backgroundBlur = Math.min(80, Math.max(0, bgBlur));
  return {
    ...getLayoutRatioVars(settings),
    "--full-player-fullscreen-gradient": `${Math.min(100, Math.max(0, settings.playerFullscreenGradient))}%`,
    "--full-player-background-blur": `${backgroundBlur}px`,
    "--full-player-surface-blur": `${Math.round(backgroundBlur * 0.75)}px`
  };
};

export const getLayoutClassName = (
  settings: FullPlayerLayoutSettings,
  pureLyricMode: boolean,
  showComment: boolean,
  noLyrics: boolean
): string => {
  const mode = settings.fullPlayerCommentMode;
  return [
    "full-player-stage",
    "is-source-left-right",
    `is-player-type-${settings.playerType}`,
    settings.fullPlayerLayout === "lyrics" ? "is-lyrics-layout" : "is-balanced-layout",
    settings.hiddenCoverPlayer ? "is-cover-hidden" : "",
    noLyrics ? "is-no-lyric" : "",
    pureLyricMode ? "is-pure-layout" : "",
    showComment ? "is-comment-visible" : "",
    showComment
      ? `is-comment-${
          mode === "fullscreen" ? "fullscreen" : mode === "half-left" ? "half-left" : "half-right"
        }`
      : ""
  ]
    .filter(Boolean)
    .join(" ");
};

export const getCommentPanelClassName = (
  settings: FullPlayerLayoutSettings,
  showComment: boolean
): string => {
  const mode = settings.fullPlayerCommentMode;
  const modeSuffix =
    mode === "fullscreen" ? "fullscreen" : mode === "half-left" ? "half-left" : "half-right";
  return `full-player-comment-panel mode-${modeSuffix}${showComment ? " visible" : ""}`;
};

export const getFullPlayerRootClassName = (
  settings: FullPlayerLayoutSettings,
  isOpen: boolean,
  showComment: boolean,
  metaVisible: boolean
): string =>
  [
    "full-player",
    "full-player-source-aligned",
    isOpen ? "is-open" : "",
    !metaVisible && !showComment ? "is-meta-hidden" : "",
    `player-type-${settings.playerType}`,
    `background-mode-${settings.playerBackgroundType}`,
    `expand-animation-${settings.playerExpandAnimation === "flow" ? "flow" : "up"}`,
    settings.playerType === "record" ? "cover-mode-record" : "cover-mode-normal",
    showComment && settings.fullPlayerCommentMode === "fullscreen" ? "is-fullscreen-comment" : ""
  ]
    .filter(Boolean)
    .join(" ");
