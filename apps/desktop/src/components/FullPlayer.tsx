import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { useTranslation } from "../shared/i18n";
import type { NcmArtistSummary } from "../shared/api/ncmDomainTypes";
import { findActiveLyricIndex } from "../shared/media/lyrics";
import { SpectrumCanvas } from "./player/SpectrumCanvas";
import { FullPlayerComments } from "./player/FullPlayerComments";
import { FullPlayerBackground } from "./player/FullPlayerBackground";
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
} from "./player/fullPlayerLayout";
import { FullPlayerOverlayMenu } from "./player/FullPlayerOverlayMenu";
import {
  FullPlayerPrimaryPanel,
  type FullPlayerAlbumLink
} from "./player/FullPlayerPrimaryPanel";
import { FullPlayerMobilePanel } from "./player/FullPlayerMobilePanel";
import { CopyLyricsModal } from "./player/CopyLyricsModal";
import { stripBracketedContent } from "./player/metadata";
import { useFullPlayerComments } from "./player/useFullPlayerComments";
import { useFullPlayerLyricAutoFocus } from "./player/useFullPlayerLyricAutoFocus";
import { useFullPlayerMetaVisibility } from "./player/useFullPlayerMetaVisibility";
import { useFullPlayerModes } from "./player/useFullPlayerModes";
import { useFullPlayerProgress } from "./player/useFullPlayerProgress";
import { usePlayerBarTimeFormat } from "./player/usePlayerBarTimeFormat";
import { clamp01 } from "./player/time";
import {
  IconRepeat,
  IconRepeatOne,
  IconVolumeHigh,
  IconVolumeMute
} from "./icons";
import { useUISettings } from "../shared/state/useUISettings";
import { usePlayback } from "../app/PlaybackContext";
import { SImage } from "./SImage";
import "../shared/styles/components/full-player.css";

interface FullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToPlaylist?: () => void;
  onDownload?: () => void;
  onSelectArtist?: (artist: NcmArtistSummary) => void;
  onSelectAlbum?: (album: FullPlayerAlbumLink) => void;
  onOpenLyricSettings?: () => void;
}

const LYRIC_OFFSET_STORAGE_KEY = "ui.lyric.songOffsets";
const LYRIC_OFFSET_STEP_MS = 500;
const FULL_PLAYER_CLOSE_PRESENCE_MS = 560;
const FULL_PLAYER_MOBILE_QUERY = "(max-width: 989.98px)";

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
  const playback = usePlayback();
  const [volumePopoverOpen, setVolumePopoverOpen] = createSignal(false);
  const [lastAudibleVolume, setLastAudibleVolume] = createSignal(0.7);
  const [closePresence, setClosePresence] = createSignal<boolean>(props.isOpen);
  const [lyricOffsets, setLyricOffsets] = createSignal<Record<string, number>>(readLyricOffsetMap());
  const [isMobileFullPlayer, setIsMobileFullPlayer] = createSignal<boolean>(false);
  const [copyLyricsOpen, setCopyLyricsOpen] = createSignal<boolean>(false);
  let lyricListRef: HTMLDivElement | undefined;
  let rootRef: HTMLDivElement | undefined;
  let closePresenceTimer: number | undefined;

  const clearClosePresenceTimer = () => {
    if (closePresenceTimer === undefined) return;
    window.clearTimeout(closePresenceTimer);
    closePresenceTimer = undefined;
  };
  const renderActive = () => props.isOpen || closePresence();
  const player = () => playback.player();
  const title = () => playback.title();
  const subtitle = () => playback.subtitle();
  const artist = () => playback.artist();
  const album = () => playback.album();
  const coverUrl = () => playback.resolvedCoverUrl();
  const currentSongId = () => playback.currentSongId();
  const currentMediaId = () => playback.currentMediaId();
  const duration = () => player()?.duration ?? 0;
  const baseCurrentTime = () => playback.livePosition() ?? player()?.current_time ?? 0;
  const isPlaying = () => playback.isPlaying();
  const volume = () => player()?.volume ?? 0;
  const spectrum = () => playback.spectrum();
  const lyrics = () => playback.lyrics();
  const lyricStatus = () => playback.lyricStatus();
  const lyricError = () => playback.supplement()?.error ?? null;
  const repeatMode = () => playback.repeatMode();
  const shuffleMode = () => playback.shuffleMode();
  const albumLink = createMemo<FullPlayerAlbumLink | null>(() => {
    const supplement = playback.supplement();
    const albumId = supplement?.albumId ?? null;
    const albumTitle = album();
    if (albumId === null || !albumTitle) {
      return null;
    }
    return {
      id: albumId,
      title: albumTitle,
      subtitle: artist(),
      coverUrl: playback.currentCoverUrl()
    };
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(FULL_PLAYER_MOBILE_QUERY);
    const updateMobileState = () => setIsMobileFullPlayer(mediaQuery.matches);
    updateMobileState();
    mediaQuery.addEventListener("change", updateMobileState);
    onCleanup(() => mediaQuery.removeEventListener("change", updateMobileState));
  });

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

  const hasLyrics = () => lyrics().length > 0;
  const [uiVolume, setUiVolume] = createSignal(0);
  createEffect(() => {
    setUiVolume(clamp01(volume()));
  });
  const safeVolume = () => uiVolume();
  const previewVolume = (volume: number) => {
    const next = clamp01(volume);
    setUiVolume(next);
    void playback.previewVolume(next);
  };
  const commitVolume = (volume: number) => {
    const next = clamp01(volume);
    setUiVolume(next);
    void playback.changeVolume(next);
  };
  const RepeatIcon = () => (repeatMode() === "one" ? IconRepeatOne : IconRepeat);
  const VolumeIcon = () => (safeVolume() <= 0.001 ? IconVolumeMute : IconVolumeHigh);
  const handleToggleMute = ((event: MouseEvent) => {
    event.stopPropagation();
    const currentVolume = safeVolume();
    if (currentVolume <= 0.001) {
      commitVolume(lastAudibleVolume());
      return;
    }
    setLastAudibleVolume(currentVolume);
    commitVolume(0);
  }) as JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  const handleVolumeWheel = ((event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const delta = event.deltaY > 0 ? -0.05 : 0.05;
    commitVolume(safeVolume() + delta);
  }) as JSX.EventHandlerUnion<HTMLButtonElement, WheelEvent>;
  const repeatLabel = () => t(`player.repeat.${repeatMode()}` as const);
  const shuffleLabel = () => t(`player.shuffle.${shuffleMode()}` as const);
  const displayTitle = () =>
    uiSettings.hideBracketedContent ? stripBracketedContent(title()) : title();
  const displaySubtitle = () =>
    uiSettings.hideBracketedContent ? stripBracketedContent(subtitle()) : subtitle();
  const displayArtist = () => {
    const value = artist()?.trim() || null;
    return value && uiSettings.hideBracketedContent ? stripBracketedContent(value) : value;
  };
  const displayAlbum = () => {
    const value = album()?.trim() || null;
    return value && uiSettings.hideBracketedContent ? stripBracketedContent(value) : value;
  };
  const playPauseLabel = () => (isPlaying() ? t("player.aria.pause") : t("player.aria.play"));
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
    currentSongId: () => currentSongId(),
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
    if (!renderActive() || !uiSettings.playerBackgroundLowFreqVolume || spectrum().length === 0) return 0;
    const lows = spectrum().slice(0, Math.min(8, spectrum().length));
    const average = lows.reduce((sum, value) => sum + Math.max(0, value), 0) / lows.length;
    return clamp01(average);
  });
  const rootStyle = createMemo(() => {
    return getRootStyle(layoutSettings(), uiSettings.bgBlur);
  });
  const handlePlayPauseClick = () => {
    if (isPlaying()) {
      void playback.pause();
      return;
    }
    void playback.play();
  };
  const lyricOffsetKey = createMemo(() => {
    if (currentSongId() !== null) return `ncm:${currentSongId()}`;
    const mediaId = currentMediaId();
    if (mediaId !== null) {
      return `local:${mediaId}`;
    }
    return null;
  });
  const lyricOffsetMs = createMemo(() => {
    const key = lyricOffsetKey();
    return key ? lyricOffsets()[key] ?? 0 : 0;
  });
  const lyricOffsetSeconds = createMemo(() => lyricOffsetMs() / 1000);
  const currentTime = () => (renderActive() ? baseCurrentTime() + lyricOffsetSeconds() : 0);
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
  const showFullscreenCover = () =>
    renderActive() &&
    !isMobileFullPlayer() &&
    uiSettings.playerType === "fullscreen" &&
    !pureLyricMode() &&
    !showComment();
  const layoutClassName = createMemo(() => {
    return getLayoutClassName(layoutSettings(), pureLyricMode(), showComment(), !hasLyrics());
  });
  const commentPanelClassName = createMemo(() => {
    return getCommentPanelClassName(layoutSettings(), showComment());
  });
  const fullPlayerRootClassName = createMemo(() => {
    const rootClassName = getFullPlayerRootClassName(
      layoutSettings(),
      props.isOpen,
      showComment(),
      metaVisible()
    );
    return showFullscreenCover() ? `${rootClassName} has-fullscreen-cover` : rootClassName;
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
    currentSongId: () => currentSongId(),
    requestFailedLabel: () => t("common.error.requestFailed")
  });
  const {
    canSeek,
    progress,
    handleLyricSeek,
    handleProgressClick,
    handleProgressKeyDown
  } = useFullPlayerProgress({
    duration: () => duration(),
    currentTime: () => (renderActive() ? baseCurrentTime() : 0),
    lyrics,
    progressAdjustLyric: () => uiSettings.progressAdjustLyric,
    onSeek: playback.seek
  });
  const displayTime = () => (renderActive() ? baseCurrentTime() : 0);
  const { timeLeft, timeRight, timeToggleLabel, cycleTimeFormat } = usePlayerBarTimeFormat({
    timeFormat: () => uiSettings.timeFormat,
    duration: () => duration(),
    displayTime,
    t
  });
  useFullPlayerLyricAutoFocus({
    isOpen: () => props.isOpen,
    autoFocusLyrics: () => uiSettings.fullPlayerAutoFocusLyrics,
    showComment,
    activeLyricIndex,
    lyricsScrollOffset: () => uiSettings.lyricsScrollOffset,
    lyricListRef: () => lyricListRef
  });

  onCleanup(() => {
    clearClosePresenceTimer();
  });

  const lyricNow = () => {
    const current = compactLyric();
    if (current) return current;
    if (lyricStatus() === "loading") return t("fullPlayer.lyric.loading");
    if (lyricStatus() === "error") return lyricError() ?? t("fullPlayer.lyric.error");
    return t("fullPlayer.lyric.placeholder");
  };
  const openCopyLyrics = () => setCopyLyricsOpen(true);
  const formatLyricOffset = () => {
    const offset = lyricOffsetMs();
    if (offset === 0) return "0";
    const seconds = Number((offset / 1000).toFixed(2));
    return offset > 0 ? `+${seconds}` : `${seconds}`;
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
    comment: t("fullPlayer.comment.toggle"),
    transport: t("player.aria.transport"),
    prev: t("player.aria.prev"),
    next: t("player.aria.next"),
    seek: t("player.aria.seek"),
    queue: t("sidebar.nav.queue.label"),
    more: t("player.aria.more"),
    desktopLyric: t("fullPlayer.action.desktopLyric"),
    qualityTag: currentSongId() === null ? t("player.quality.source") : t("settings.ncm.songLevel"),
    volumeButton: t("player.aria.volumePopover"),
    volumeDialog: t("player.aria.volume")
  });
  const controlShellActions = () => ({
    showLike: uiSettings.fullPlayerShowLike,
    isLiked: Boolean(playback.isLiked()),
    showAddToPlaylist: uiSettings.fullPlayerShowAddToPlaylist,
    canAddToPlaylist: Boolean(props.onAddToPlaylist),
    showDownload: uiSettings.fullPlayerShowDownload,
    canDownload: Boolean(props.onDownload),
    showComments: canShowComments() || showComment(),
    showCommentCount: uiSettings.fullPlayerShowCommentCount,
    commentCount: commentCount(),
    commentActive: showComment(),
    commentsEnabled: canShowComments(),
    onClose: props.onClose,
    onToggleLike: playback.toggleLike,
    onAddToPlaylist: props.onAddToPlaylist,
    onDownload: props.onDownload,
    onToggleComment: toggleComment
  });
  const controlShellTransport = () => ({
    shuffleActive: shuffleMode() !== "off",
    shuffleLabel: shuffleLabel(),
    isHeartbeat: shuffleMode() === "heartbeat",
    canSkipPrev: playback.previousEntryId() !== null,
    canSkipNext: playback.nextEntryId() !== null,
    isPlaying: isPlaying(),
    playPauseLabel: playPauseLabel(),
    repeatActive: repeatMode() !== "off",
    repeatLabel: repeatLabel(),
    repeatIcon: RepeatIcon(),
    canSeek: renderActive() && canSeek(),
    duration: duration(),
    currentTime: renderActive() ? baseCurrentTime() : 0,
    progress: renderActive() ? progress() : 0,
    timeLeft: renderActive() ? timeLeft() : "0:00",
    timeRight: renderActive() ? timeRight() : "0:00",
    timeToggleLabel: timeToggleLabel(),
    onToggleShuffle: playback.toggleShuffle,
    onSkipPrev: playback.skipPrevious,
    onPlayPause: handlePlayPauseClick,
    onSkipNext: playback.skipNext,
    onCycleRepeat: playback.cycleRepeat,
    onCycleTimeFormat: cycleTimeFormat,
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
    onVolumeOpenChange: setVolumePopoverOpen,
    onToggleMute: handleToggleMute,
    onVolumePreview: previewVolume,
    onVolumeChange: commitVolume,
    onVolumeWheel: handleVolumeWheel,
    onOpenQueue: playback.openQueue
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
    isPlaying: isPlaying(),
    playerType: uiSettings.playerType,
    coverUrl: coverUrl(),
    coverAlt: title() || t("cover.alt")
  });
  const primaryPanelMeta = () => ({
    showMeta: uiSettings.showPlayMeta,
    title: displayTitle(),
    subtitle: displaySubtitle() || t("player.subtitle.empty"),
    artist: displayArtist(),
    album: displayAlbum(),
    artistFallback: t("library.group.unknownArtist"),
    albumFallback: t("library.group.unknownAlbum"),
    artistLinks: playback.supplement()?.artists ?? [],
    albumLink: albumLink(),
    onSelectArtist: props.onSelectArtist,
    onSelectAlbum: props.onSelectAlbum,
    detail: playback.detail()
  });
  const commentsSong = () => ({
    className: commentPanelClassName(),
    songClassName: `full-player-comment-song${uiSettings.hiddenCovers.player ? " is-cover-hidden" : ""}`,
    coverUrl: coverUrl(),
    title: title() || t("player.fallback.empty"),
    subtitle: subtitle() || t("player.subtitle.empty"),
    coverAlt: title() || t("cover.alt"),
    filterLabel: t("fullPlayer.comment.exclude"),
    filterUnavailableLabel: t("fullPlayer.comment.excludeUnavailable"),
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
  const lyricsMenu = () => ({
    visible: metaVisible,
    labels: {
      copyLyric: t("fullPlayer.action.copyLyric"),
      lyricOffset: t("fullPlayer.action.lyricOffset"),
      lyricOffsetTip: t("fullPlayer.action.lyricOffsetTip"),
      lyricOffsetReset: t("fullPlayer.action.lyricOffsetReset"),
      lyricSettings: t("fullPlayer.action.lyricSettings")
    },
    showCopyLyric: uiSettings.fullPlayerShowCopyLyric,
    canCopyLyric: hasLyrics(),
    showLyricOffset: uiSettings.fullPlayerShowLyricOffset,
    canAdjustLyricOffset: Boolean(lyricOffsetKey()) && hasLyrics(),
    lyricOffsetValue: formatLyricOffset(),
    lyricOffsetMilliseconds: lyricOffsetMs(),
    showLyricSettings: uiSettings.fullPlayerShowLyricSettings,
    onCopyLyric: openCopyLyrics,
    onDecreaseLyricOffset: () => changeLyricOffset(-LYRIC_OFFSET_STEP_MS),
    onIncreaseLyricOffset: () => changeLyricOffset(LYRIC_OFFSET_STEP_MS),
    onResetLyricOffset: () => setCurrentLyricOffset(0),
    onSetLyricOffset: setCurrentLyricOffset,
    onOpenLyricSettings: props.onOpenLyricSettings
  });
  const lyricsElement = () => (
    <FullPlayerLyrics
      display={lyricsDisplay()}
      settings={lyricsSettings()}
      interaction={lyricsInteraction()}
      menu={lyricsMenu()}
    />
  );
  const mobileLabels = () => ({
    close: t("fullPlayer.aria.close"),
    favorite: t("player.aria.favorite"),
    addToPlaylist: t("fullPlayer.action.addToPlaylist"),
    transport: t("player.aria.transport"),
    prev: t("player.aria.prev"),
    next: t("player.aria.next"),
    seek: t("player.aria.seek")
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
      <FullPlayerBackground
        coverUrl={coverUrl()}
        renderActive={renderActive()}
        backgroundType={uiSettings.playerBackgroundType}
        fps={uiSettings.playerBackgroundFps}
        flowSpeed={uiSettings.playerBackgroundFlowSpeed}
        renderScale={uiSettings.playerBackgroundRenderScale}
        paused={uiSettings.playerBackgroundPause && !isPlaying()}
        lowFrequencyEnergy={lowFrequencyEnergy()}
      />
      <Show when={showFullscreenCover() && coverUrl()}>
        {(coverUrl) => (
          <SImage
            src={coverUrl()}
            alt={title() || t("cover.alt")}
            class="full-player-fullscreen-cover"
            mediaClass="full-player-fullscreen-cover-media"
            observeVisibility={false}
            shape="rect"
            ariaHidden="true"
          />
        )}
      </Show>
      <div class="full-player-vignette" aria-hidden="true" />
      <Show when={renderActive() && !isMobileFullPlayer() && showInstantLyric() && instantLyric()}>
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
      <Show when={renderActive() && !isMobileFullPlayer() && showInstantLyric() && !instantLyric() && compactLyric()}>
        {(line) => (
          <div class="full-player-instant-lyric absolute top-0 h-80px flex flex-col justify-center items-center pointer-events-none">
            <span class="text-18px leading-tight">{line()}</span>
          </div>
        )}
      </Show>

      <Show
        when={renderActive() && isMobileFullPlayer()}
        fallback={
          <>
            <FullPlayerOverlayMenu
              state={overlayMenuState()}
              labels={overlayMenuLabels()}
              actions={overlayMenuActions()}
              onMouseEnter={handleControlEnter}
              onMouseLeave={handleControlLeave}
            />

            <Show when={renderActive()}>
              <div class={layoutClassName()}>
                <FullPlayerPrimaryPanel cover={primaryPanelCover()} meta={primaryPanelMeta()} />

                <Show when={showComment()}>
                  <FullPlayerComments song={commentsSong()} content={commentsContent()} />
                </Show>

                {lyricsElement()}
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
          </>
        }
      >
        <FullPlayerMobilePanel
          cover={primaryPanelCover()}
          meta={primaryPanelMeta()}
          actions={controlShellActions()}
          transport={controlShellTransport()}
          labels={mobileLabels()}
          hasLyrics={hasLyrics()}
          lyrics={lyricsElement}
        />
      </Show>

      <Show when={renderActive() && !isMobileFullPlayer() && uiSettings.showSpectrums && spectrum().length > 0}>
        <div class={`full-player-spectrum${metaVisible() ? "" : " is-visible"}`} aria-hidden="true">
          <SpectrumCanvas data={spectrum()} active={isPlaying()} />
        </div>
      </Show>
      <CopyLyricsModal
        open={copyLyricsOpen()}
        lyrics={lyrics()}
        title={title()}
        artist={artist()}
        onClose={() => setCopyLyricsOpen(false)}
      />
    </div>
  );
}
