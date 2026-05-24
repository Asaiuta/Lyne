import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { RepeatMode, ShuffleMode } from "../shared/api/types";
import { useDismissibleOverlay } from "../shared/ui/useDismissibleOverlay";
import { useTranslation } from "../shared/i18n";
import { findActiveLyricIndex, type NcmLyricLine } from "../features/online/ncmPlayback";
import { SpectrumCanvas } from "../features/playback/SpectrumCanvas";
import { FullPlayerComments } from "./player/FullPlayerComments";
import { FullPlayerControlShell } from "./player/FullPlayerControlShell";
import { FullPlayerLyrics } from "./player/FullPlayerLyrics";
import {
  getCommentPanelClassName,
  getFullPlayerRootClassName,
  getLayoutClassName,
  getLyricLineAlign,
  getLyricTextAlign,
  getLyricTransformOrigin,
  getRootStyle,
  getStageStyle
} from "./player/fullPlayerLayout";
import { FullPlayerOverlayMenu } from "./player/FullPlayerOverlayMenu";
import { FullPlayerPrimaryPanel } from "./player/FullPlayerPrimaryPanel";
import { stripBracketedContent } from "./player/metadata";
import { useFullPlayerComments } from "./player/useFullPlayerComments";
import { useFullPlayerLyricAutoFocus } from "./player/useFullPlayerLyricAutoFocus";
import { useFullPlayerMetaVisibility } from "./player/useFullPlayerMetaVisibility";
import { useFullPlayerModes } from "./player/useFullPlayerModes";
import { useFullPlayerProgress } from "./player/useFullPlayerProgress";
import { clamp01 } from "./player/time";
import {
  IconRepeat,
  IconRepeatOne,
  IconVolumeHigh,
  IconVolumeMute
} from "./icons";
import { useUISettings } from "../shared/state/useUISettings";
import { SImage } from "./SImage";
import "../shared/styles/components/full-player.css";

interface FullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  coverUrl: string | null;
  title: string;
  subtitle: string;
  detail?: string | null;
  currentSongId: number | null;
  currentMediaId?: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  spectrum: number[];
  lyrics?: readonly NcmLyricLine[];
  lyricStatus?: "idle" | "loading" | "ready" | "error";
  lyricError?: string | null;
  repeatMode: RepeatMode;
  shuffleMode: ShuffleMode;
  canSkipPrev: boolean;
  canSkipNext: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (position: number) => void;
  onVolumeChange: (volume: number) => void;
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
  onOpenQueue: () => void;
  bgBlur: number;
  isLiked?: boolean;
  onToggleLike?: () => void;
  onOpenLyricSettings?: () => void;
}

const LYRIC_OFFSET_STORAGE_KEY = "ui.lyric.songOffsets";
const LYRIC_OFFSET_STEP_MS = 500;
const FULL_PLAYER_CLOSE_PRESENCE_MS = 560;

function readLyricOffsetMap(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LYRIC_OFFSET_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number")
        .filter(([, value]) => Number.isFinite(value) && value !== 0)
        .map(([key, value]) => [key, Math.trunc(value)])
    );
  } catch (error) {
    console.warn("[FullPlayer] failed to read lyric offsets", error);
    return {};
  }
}

function writeLyricOffsetMap(offsets: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(offsets).filter(([, value]) => value !== 0);
    if (entries.length === 0) {
      window.localStorage.removeItem(LYRIC_OFFSET_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(LYRIC_OFFSET_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch (error) {
    console.warn("[FullPlayer] failed to persist lyric offsets", error);
  }
}

export function FullPlayer(props: FullPlayerProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [volumePopoverOpen, setVolumePopoverOpen] = createSignal(false);
  const [closePresence, setClosePresence] = createSignal<boolean>(props.isOpen);
  const [backgroundLayers, setBackgroundLayers] = createSignal<readonly string[]>([]);
  const [lyricOffsets, setLyricOffsets] = createSignal<Record<string, number>>(readLyricOffsetMap());
  let lyricListRef: HTMLDivElement | undefined;
  let rootRef: HTMLDivElement | undefined;
  let fullVolumeRef: HTMLDivElement | undefined;
  let backgroundTimer: number | undefined;
  let closePresenceTimer: number | undefined;

  const clearBackgroundTimer = () => {
    if (backgroundTimer === undefined) return;
    window.clearTimeout(backgroundTimer);
    backgroundTimer = undefined;
  };
  const clearClosePresenceTimer = () => {
    if (closePresenceTimer === undefined) return;
    window.clearTimeout(closePresenceTimer);
    closePresenceTimer = undefined;
  };
  const renderActive = () => props.isOpen || closePresence();

  createEffect(() => {
    clearClosePresenceTimer();
    if (props.isOpen) {
      setClosePresence(true);
      return;
    }
    if (!closePresence()) {
      return;
    }
    closePresenceTimer = window.setTimeout(() => {
      lyricListRef = undefined;
      closePresenceTimer = undefined;
      setClosePresence(false);
    }, FULL_PLAYER_CLOSE_PRESENCE_MS);
  });

  const {
    metaVisible,
    isFullscreen,
    revealMeta,
    handleSurfaceMove,
    handleSurfaceLeave,
    handleControlEnter,
    handleControlLeave,
    toggleFullscreen
  } = useFullPlayerMetaVisibility({
    isOpen: () => props.isOpen,
    autoHidePlayerMeta: () => uiSettings.autoHidePlayerMeta,
    rootRef: () => rootRef,
    volumePopoverOpen,
    setVolumePopoverOpen,
    onClose: props.onClose
  });

  useDismissibleOverlay(volumePopoverOpen, {
    isInside: (target) => !!fullVolumeRef && fullVolumeRef.contains(target),
    onDismiss: () => setVolumePopoverOpen(false),
    escape: false
  });

  const lyrics = () => props.lyrics ?? [];
  const lyricStatus = () => props.lyricStatus ?? "idle";
  const lyricError = () => props.lyricError ?? null;
  const hasLyrics = () => lyrics().length > 0;
  const safeVolume = () => clamp01(props.volume);
  const RepeatIcon = () => (props.repeatMode === "one" ? IconRepeatOne : IconRepeat);
  const VolumeIcon = () => (safeVolume() <= 0.001 ? IconVolumeMute : IconVolumeHigh);
  const repeatLabel = () => t(`player.repeat.${props.repeatMode}` as const);
  const shuffleLabel = () => t(`player.shuffle.${props.shuffleMode}` as const);
  const displayTitle = () =>
    uiSettings.hideBracketedContent ? stripBracketedContent(props.title) : props.title;
  const displaySubtitle = () =>
    uiSettings.hideBracketedContent ? stripBracketedContent(props.subtitle) : props.subtitle;
  const playPauseLabel = () => (props.isPlaying ? t("player.aria.pause") : t("player.aria.play"));
  const {
    pureLyricMode,
    showComment,
    canShowPureLyrics,
    canShowComments,
    closeComment,
    togglePureLyricMode,
    toggleComment
  } = useFullPlayerModes({
    isOpen: () => props.isOpen,
    hasLyrics,
    commentsEnabled: () => uiSettings.fullPlayerShowComments,
    currentSongId: () => props.currentSongId,
    revealMeta
  });
  const layoutSettings = () => ({
    lyricAlignRight: uiSettings.lyricAlignRight,
    lyricsPosition: uiSettings.lyricsPosition,
    playerStyleRatio: uiSettings.playerStyleRatio,
    playerBackgroundFps: uiSettings.playerBackgroundFps,
    playerBackgroundFlowSpeed: uiSettings.playerBackgroundFlowSpeed,
    playerBackgroundRenderScale: uiSettings.playerBackgroundRenderScale,
    playerFullscreenGradient: uiSettings.playerFullscreenGradient,
    playerType: uiSettings.playerType,
    fullPlayerLayout: uiSettings.fullPlayerLayout,
    hiddenCoverPlayer: uiSettings.hiddenCovers.player,
    fullPlayerCommentMode: uiSettings.fullPlayerCommentMode,
    playerBackgroundType: uiSettings.playerBackgroundType,
    playerBackgroundPause: uiSettings.playerBackgroundPause,
    playerBackgroundLowFreqVolume: uiSettings.playerBackgroundLowFreqVolume,
    playerExpandAnimation: uiSettings.playerExpandAnimation
  });
  const lyricLineAlign = () => getLyricLineAlign(layoutSettings());
  const lyricTextAlign = () => {
    return getLyricTextAlign(lyricLineAlign());
  };
  const lyricTransformOrigin = () => {
    return getLyricTransformOrigin(lyricLineAlign());
  };
  const lowFrequencyEnergy = createMemo(() => {
    if (!renderActive() || !uiSettings.playerBackgroundLowFreqVolume || props.spectrum.length === 0) return 0;
    const lows = props.spectrum.slice(0, Math.min(8, props.spectrum.length));
    const average = lows.reduce((sum, value) => sum + Math.max(0, value), 0) / lows.length;
    return clamp01(average);
  });
  const rootStyle = createMemo(() => {
    return getRootStyle(layoutSettings(), props.bgBlur, lowFrequencyEnergy());
  });
  const stageStyle = createMemo(() => {
    return getStageStyle(layoutSettings(), pureLyricMode(), showComment());
  });
  const handlePlayPauseClick = () => {
    if (props.isPlaying) {
      props.onPause();
      return;
    }
    props.onPlay();
  };
  const lyricOffsetKey = createMemo(() => {
    if (props.currentSongId !== null) return `ncm:${props.currentSongId}`;
    if (props.currentMediaId !== null && props.currentMediaId !== undefined) {
      return `local:${props.currentMediaId}`;
    }
    return null;
  });
  const lyricOffsetMs = createMemo(() => {
    const key = lyricOffsetKey();
    return key ? lyricOffsets()[key] ?? 0 : 0;
  });
  const lyricOffsetSeconds = createMemo(() => lyricOffsetMs() / 1000);
  const currentTime = () => (renderActive() ? props.currentTime + lyricOffsetSeconds() : 0);
  const activeLyricIndex = createMemo(() => {
    if (!renderActive()) return -1;
    return findActiveLyricIndex(lyrics(), currentTime());
  });
  const compactLyric = createMemo(() => {
    if (!renderActive()) return null;
    const index = activeLyricIndex();
    return index >= 0 ? lyrics()[index]?.text ?? null : null;
  });
  const instantLyric = createMemo(() => {
    if (!renderActive()) return null;
    const index = activeLyricIndex();
    if (index < 0) {
      return null;
    }
    const line = lyrics()[index];
    if (!line) {
      return null;
    }
    return {
      text: line.text,
      translation: uiSettings.showLyricTranslation ? line.translatedText ?? null : null
    };
  });
  const layoutClassName = createMemo(() => {
    return getLayoutClassName(layoutSettings(), pureLyricMode(), showComment(), !hasLyrics());
  });
  const commentPanelClassName = createMemo(() => {
    return getCommentPanelClassName(layoutSettings(), showComment());
  });
  const fullPlayerRootClassName = createMemo(() => {
    return getFullPlayerRootClassName(
      layoutSettings(),
      props.isOpen,
      props.isPlaying,
      showComment(),
      metaVisible()
    );
  });
  const fullscreenLabel = () =>
    isFullscreen() ? t("fullPlayer.action.fullscreenExit") : t("fullPlayer.action.fullscreenEnter");
  const pureLyricLabel = () =>
    pureLyricMode() ? t("fullPlayer.action.pureLyricExit") : t("fullPlayer.action.pureLyricEnter");
  const showInstantLyric = () =>
    showComment() &&
    (uiSettings.fullPlayerCommentMode === "fullscreen" ||
      uiSettings.fullPlayerCommentMode === "half-right");
  const {
    commentsState,
    visibleComments,
    visibleHotComments,
    commentCount,
    commentsError
  } = useFullPlayerComments({
    isOpen: () => props.isOpen,
    showComment,
    currentSongId: () => props.currentSongId,
    requestFailedLabel: () => t("common.error.requestFailed")
  });
  const {
    canSeek,
    progress,
    timeLeft,
    timeRight,
    handleLyricSeek,
    handleProgressClick,
    handleProgressKeyDown
  } = useFullPlayerProgress({
    duration: () => props.duration,
    currentTime: () => (renderActive() ? props.currentTime : 0),
    lyrics,
    timeFormat: () => uiSettings.timeFormat,
    progressAdjustLyric: () => uiSettings.progressAdjustLyric,
    onSeek: props.onSeek
  });
  useFullPlayerLyricAutoFocus({
    isOpen: () => props.isOpen,
    autoFocusLyrics: () => uiSettings.fullPlayerAutoFocusLyrics,
    showComment,
    activeLyricIndex,
    lyricsScrollOffset: () => uiSettings.lyricsScrollOffset,
    lyricListRef: () => lyricListRef
  });

  createEffect(() => {
    if (!renderActive()) {
      setBackgroundLayers([]);
      clearBackgroundTimer();
      return;
    }

    const nextCoverUrl = props.coverUrl;
    if (!nextCoverUrl) {
      setBackgroundLayers([]);
      clearBackgroundTimer();
      return;
    }

    setBackgroundLayers((layers) => {
      if (layers[0] === nextCoverUrl) return layers;
      return [nextCoverUrl, ...layers.slice(0, 1)];
    });

    clearBackgroundTimer();
    backgroundTimer = window.setTimeout(() => {
      setBackgroundLayers((layers) => layers.slice(0, 1));
      backgroundTimer = undefined;
    }, 540);
  });

  onCleanup(() => {
    clearBackgroundTimer();
    clearClosePresenceTimer();
  });

  const lyricNow = () => {
    const current = compactLyric();
    if (current) return current;
    if (lyricStatus() === "loading") return t("fullPlayer.lyric.loading");
    if (lyricStatus() === "error") return lyricError() ?? t("fullPlayer.lyric.error");
    return t("fullPlayer.lyric.placeholder");
  };
  const copyCurrentLyric = () => {
    const current = compactLyric()?.trim();
    if (!current || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(current).catch((error) => {
      console.warn("[FullPlayer] clipboard writeText failed", error);
    });
  };
  const formatLyricOffset = () => {
    const offset = lyricOffsetMs();
    if (offset === 0) return "0s";
    const seconds = Number((offset / 1000).toFixed(2));
    return offset > 0 ? `+${seconds}s` : `${seconds}s`;
  };
  const setCurrentLyricOffset = (nextOffset: number) => {
    const key = lyricOffsetKey();
    if (!key) return;
    const normalized = Math.trunc(nextOffset);
    setLyricOffsets((current) => {
      const next = { ...current };
      if (normalized === 0) {
        delete next[key];
      } else {
        next[key] = normalized;
      }
      writeLyricOffsetMap(next);
      return next;
    });
  };
  const changeLyricOffset = (deltaMs: number) => {
    setCurrentLyricOffset(lyricOffsetMs() + deltaMs);
  };
  const controlShellLabels = () => ({
    close: t("fullPlayer.aria.close"),
    favorite: t("player.aria.favorite"),
    addToPlaylist: t("fullPlayer.action.addToPlaylist"),
    download: t("fullPlayer.action.download"),
    copyLyric: t("fullPlayer.action.copyLyric"),
    lyricOffset: t("fullPlayer.action.lyricOffset"),
    lyricSettings: t("fullPlayer.action.lyricSettings"),
    comment: t("fullPlayer.comment.toggle"),
    transport: t("player.aria.transport"),
    prev: t("player.aria.prev"),
    next: t("player.aria.next"),
    seek: t("player.aria.seek"),
    queue: t("sidebar.nav.queue.label"),
    more: t("player.aria.more"),
    desktopLyric: t("fullPlayer.action.desktopLyric"),
    qualityTag: props.currentSongId === null ? t("player.quality.source") : t("settings.ncm.songLevel"),
    volumeButton: t("player.aria.volumePopover"),
    volumeDialog: t("player.aria.volume")
  });
  const controlShellActions = () => ({
    showLike: uiSettings.fullPlayerShowLike,
    isLiked: Boolean(props.isLiked),
    showAddToPlaylist: uiSettings.fullPlayerShowAddToPlaylist,
    showDownload: uiSettings.fullPlayerShowDownload,
    showCopyLyric: uiSettings.fullPlayerShowCopyLyric,
    canCopyLyric: Boolean(compactLyric()?.trim()),
    showLyricOffset: uiSettings.fullPlayerShowLyricOffset,
    canAdjustLyricOffset: Boolean(lyricOffsetKey()) && hasLyrics(),
    lyricOffsetValue: formatLyricOffset(),
    showLyricSettings: uiSettings.fullPlayerShowLyricSettings,
    showComments: canShowComments() || showComment(),
    showCommentCount: uiSettings.fullPlayerShowCommentCount,
    commentCount: commentCount(),
    commentActive: showComment(),
    commentsEnabled: canShowComments(),
    onClose: props.onClose,
    onToggleLike: props.onToggleLike,
    onCopyLyric: copyCurrentLyric,
    onDecreaseLyricOffset: () => changeLyricOffset(-LYRIC_OFFSET_STEP_MS),
    onIncreaseLyricOffset: () => changeLyricOffset(LYRIC_OFFSET_STEP_MS),
    onResetLyricOffset: () => setCurrentLyricOffset(0),
    onOpenLyricSettings: props.onOpenLyricSettings,
    onToggleComment: toggleComment
  });
  const controlShellTransport = () => ({
    shuffleActive: props.shuffleMode !== "off",
    shuffleLabel: shuffleLabel(),
    isHeartbeat: props.shuffleMode === "heartbeat",
    canSkipPrev: props.canSkipPrev,
    canSkipNext: props.canSkipNext,
    isPlaying: props.isPlaying,
    playPauseLabel: playPauseLabel(),
    repeatActive: props.repeatMode !== "off",
    repeatLabel: repeatLabel(),
    repeatIcon: RepeatIcon(),
    canSeek: renderActive() && canSeek(),
    duration: props.duration,
    currentTime: renderActive() ? props.currentTime : 0,
    progress: renderActive() ? progress() : 0,
    timeLeft: renderActive() ? timeLeft() : "0:00",
    timeRight: renderActive() ? timeRight() : "0:00",
    onToggleShuffle: props.onToggleShuffle,
    onSkipPrev: props.onSkipPrev,
    onPlayPause: handlePlayPauseClick,
    onSkipNext: props.onSkipNext,
    onCycleRepeat: props.onCycleRepeat,
    onProgressClick: handleProgressClick,
    onProgressKeyDown: handleProgressKeyDown
  });
  const controlShellUtility = () => ({
    showPlayerQuality: uiSettings.showPlayerQuality,
    showDesktopLyric: uiSettings.fullPlayerShowDesktopLyric,
    showMoreSettings: uiSettings.fullPlayerShowMoreSettings,
    volumeOpen: volumePopoverOpen(),
    volumeValue: safeVolume(),
    volumeIcon: VolumeIcon(),
    onToggleVolume: () => setVolumePopoverOpen((open) => !open),
    onVolumeChange: (value: number) => props.onVolumeChange(clamp01(value)),
    onOpenQueue: props.onOpenQueue,
    volumeContainerRef: (element: HTMLDivElement) => {
      fullVolumeRef = element;
    }
  });
  const overlayMenuState = () => ({
    visible: metaVisible(),
    canShowPureLyrics: canShowPureLyrics(),
    pureLyricMode: pureLyricMode(),
    isFullscreen: isFullscreen()
  });
  const overlayMenuLabels = () => ({
    pureLyric: pureLyricLabel(),
    fullscreen: fullscreenLabel(),
    close: t("fullPlayer.aria.close")
  });
  const overlayMenuActions = () => ({
    onTogglePureLyricMode: togglePureLyricMode,
    onToggleFullscreen: () => void toggleFullscreen(),
    onClose: props.onClose
  });
  const primaryPanelCover = () => ({
    showCover: !uiSettings.hiddenCovers.player,
    isPlaying: props.isPlaying,
    playerType: uiSettings.playerType,
    coverUrl: props.coverUrl,
    coverAlt: props.title || t("cover.alt")
  });
  const primaryPanelMeta = () => ({
    showMeta: uiSettings.showPlayMeta,
    title: displayTitle(),
    subtitle: displaySubtitle() || t("player.subtitle.empty"),
    detail: props.detail
  });
  const commentsSong = () => ({
    className: commentPanelClassName(),
    songClassName: `full-player-comment-song${uiSettings.hiddenCovers.player ? " is-cover-hidden" : ""}`,
    coverUrl: props.coverUrl,
    title: props.title || t("player.fallback.empty"),
    subtitle: props.subtitle || t("player.subtitle.empty"),
    coverAlt: props.title || t("cover.alt"),
    backLabel: t("fullPlayer.comment.backToMusic"),
    showCover: () => !uiSettings.hiddenCovers.player,
    onClose: closeComment
  });
  const commentsContent = () => ({
    loadingLabel: t("fullPlayer.comment.loading"),
    emptyLabel: t("fullPlayer.comment.empty"),
    errorLabel: commentsError(),
    hotLabel: t("fullPlayer.comment.hot"),
    allLabel: t("fullPlayer.comment.all"),
    commentsStatus: commentsState().status,
    commentCount: commentCount(),
    hotComments: visibleHotComments(),
    comments: visibleComments()
  });
  const lyricsDisplay = () => ({
    lyrics: lyrics(),
    lyricNow: lyricNow(),
    activeLyricIndex,
    currentTime
  });
  const lyricsSettings = () => ({
    lyricsBlur: () => uiSettings.lyricsBlur,
    showWordLyrics: () => uiSettings.showWordLyrics,
    showTranslation: () => uiSettings.showLyricTranslation,
    showRomanization: () => uiSettings.showLyricRomanization,
    swapTranslationRomanization: () => uiSettings.swapLyricTranslationRomanization
  });
  const lyricsInteraction = () => ({
    onSeek: handleLyricSeek,
    lyricListRef: (element: HTMLDivElement) => {
      lyricListRef = element;
    },
    ariaLabel: t("fullPlayer.lyric.aria"),
    style: {
      "--lyric-font-size": `${uiSettings.lyricFontSize}px`,
      "--lyric-font-weight": String(uiSettings.lyricFontWeight),
      "--lyric-translation-font-size": `${uiSettings.lyricTranslationFontSize}px`,
      "--lyric-romanization-font-size": `${uiSettings.lyricRomanizationFontSize}px`,
      "--lyric-line-align": lyricLineAlign(),
      "--lyric-text-align": lyricTextAlign(),
      "--lyric-transform-origin": lyricTransformOrigin(),
      "--lyric-horizontal-offset": `${uiSettings.lyricHorizontalOffset}px`,
      "--lyric-blend-mode": uiSettings.lyricsBlendMode
    }
  });

  return (
    <div
      ref={rootRef}
      class={fullPlayerRootClassName()}
      style={rootStyle()}
      role="dialog"
      aria-label={t("fullPlayer.aria.dialog")}
      aria-modal="true"
      onMouseMove={handleSurfaceMove}
      onClick={handleSurfaceMove}
      onMouseLeave={handleSurfaceLeave}
    >
      <Show when={renderActive() && backgroundLayers().length > 0}>
        <div class="full-player-background" aria-hidden="true">
          <For each={backgroundLayers()}>
            {(url, index) => (
              <SImage
                src={url}
                alt=""
                class={`full-player-fluid${index() === 0 ? " is-current" : " is-previous"}`}
                mediaClass="full-player-fluid-media"
                observeVisibility={false}
                shape="rect"
                ariaHidden="true"
              />
            )}
          </For>
        </div>
      </Show>
      <div class="full-player-vignette" aria-hidden="true" />
      <Show when={renderActive() && showInstantLyric() && instantLyric()}>
        {(line) => (
          <div class="full-player-instant-lyric absolute top-0 h-80px flex flex-col justify-center items-center pointer-events-none">
            <span class="text-18px leading-tight">{line().text}</span>
            <Show when={line().translation}>
              {(translation) => (
                <span class="text-14px leading-tight opacity-60 mt-1">{translation()}</span>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={renderActive() && showInstantLyric() && !instantLyric() && compactLyric()}>
        {(line) => (
          <div class="full-player-instant-lyric absolute top-0 h-80px flex flex-col justify-center items-center pointer-events-none">
            <span class="text-18px leading-tight">{line()}</span>
          </div>
        )}
      </Show>

      <FullPlayerOverlayMenu
        state={overlayMenuState()}
        labels={overlayMenuLabels()}
        actions={overlayMenuActions()}
        onMouseEnter={handleControlEnter}
        onMouseLeave={handleControlLeave}
      />

      <Show when={renderActive()}>
        <div class={layoutClassName()} style={stageStyle()}>
          <FullPlayerPrimaryPanel cover={primaryPanelCover()} meta={primaryPanelMeta()} />

          <Show when={showComment()}>
            <FullPlayerComments song={commentsSong()} content={commentsContent()} />
          </Show>

          <FullPlayerLyrics
            display={lyricsDisplay()}
            settings={lyricsSettings()}
            interaction={lyricsInteraction()}
          />
        </div>
      </Show>

      <FullPlayerControlShell
        visible={metaVisible()}
        labels={controlShellLabels()}
        actions={controlShellActions()}
        transport={controlShellTransport()}
        utility={controlShellUtility()}
        onMouseEnter={handleControlEnter}
        onMouseLeave={handleControlLeave}
      />

      <Show when={renderActive() && uiSettings.showSpectrums && props.spectrum.length > 0}>
        <div class={`full-player-spectrum${metaVisible() ? "" : " is-visible"}`} aria-hidden="true">
          <SpectrumCanvas data={props.spectrum} active={props.isPlaying} />
        </div>
      </Show>
    </div>
  );
}
