import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { RepeatMode, ShuffleMode } from "../shared/api/types";
import { useTranslation } from "../shared/i18n";
import {
  findActiveLyricIndex,
  findCurrentLyricLine,
  type NcmLyricLine,
  type NcmLyricWord
} from "../features/online/ncmPlayback";
import { CoverArt } from "./CoverArt";
import {
  IconChevronDown,
  IconMaximize,
  IconPause,
  IconPlay,
  IconRepeat,
  IconRepeatOne,
  IconRestore,
  IconShuffle,
  IconSkipNext,
  IconSkipPrev
} from "./icons";
import { useUISettings } from "../shared/state/useUISettings";

interface FullPlayerProps {
  isOpen: boolean;
  onClose: () => void;
  coverUrl: string | null;
  title: string;
  subtitle: string;
  detail?: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
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
  onSkipPrev: () => void;
  onSkipNext: () => void;
  onCycleRepeat: () => void;
  onToggleShuffle: () => void;
}

const formatTime = (value: number) => {
  if (!Number.isFinite(value)) return "0:00";
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const META_HIDE_DELAY_MS = 3000;
const LYRIC_SCROLL_OFFSET_RATIO = 0.25;

export function FullPlayer(props: FullPlayerProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [metaVisible, setMetaVisible] = createSignal(true);
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  let lyricListRef: HTMLDivElement | undefined;
  let rootRef: HTMLDivElement | undefined;
  let hideTimer: number | undefined;

  const clearHideTimer = () => {
    if (hideTimer !== undefined) {
      window.clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const scheduleMetaHide = () => {
    clearHideTimer();
    if (!props.isOpen) return;
    hideTimer = window.setTimeout(() => {
      setMetaVisible(false);
    }, META_HIDE_DELAY_MS);
  };

  const revealMeta = () => {
    setMetaVisible(true);
    scheduleMetaHide();
  };

  createEffect(() => {
    if (!props.isOpen) {
      clearHideTimer();
      setMetaVisible(true);
      return;
    }

    revealMeta();
    setIsFullscreen(typeof document !== "undefined" && Boolean(document.fullscreenElement));

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (typeof document !== "undefined" && document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        props.onClose();
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        void toggleFullscreen();
      }
    };
    const handleFullscreenChange = () => {
      setIsFullscreen(typeof document !== "undefined" && Boolean(document.fullscreenElement));
      revealMeta();
    };

    window.addEventListener("keydown", handleKey);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
    onCleanup(() => document.removeEventListener("fullscreenchange", handleFullscreenChange));
    onCleanup(() => clearHideTimer());
  });

  const lyrics = () => props.lyrics ?? [];
  const lyricStatus = () => props.lyricStatus ?? "idle";
  const lyricError = () => props.lyricError ?? null;
  const progress = () => (props.duration > 0 ? clamp01(props.currentTime / props.duration) : 0);
  const canSeek = () => props.duration > 0;
  const RepeatIcon = () => (props.repeatMode === "one" ? IconRepeatOne : IconRepeat);
  const repeatLabel = () => t(`player.repeat.${props.repeatMode}` as const);
  const shuffleLabel = () =>
    props.shuffleMode === "on" ? t("player.shuffle.on") : t("player.shuffle.off");
  const playPauseLabel = () => (props.isPlaying ? t("player.aria.pause") : t("player.aria.play"));
  const activeLyricIndex = () => findActiveLyricIndex(lyrics(), props.currentTime);
  const compactLyric = () => findCurrentLyricLine(lyrics(), props.currentTime);
  const layoutClassName = createMemo(() =>
    uiSettings.fullPlayerLayout === "lyrics"
      ? "full-player-stage is-lyrics-layout"
      : "full-player-stage is-balanced-layout"
  );
  const coverBackgroundStyle = createMemo(() =>
    props.coverUrl
      ? {
          "background-image": `url("${props.coverUrl}")`
        }
      : undefined
  );
  const wordProgress = (word: NcmLyricWord) => {
    const duration = word.endTime - word.startTime;
    if (duration <= 0) {
      return props.currentTime >= word.startTime ? 1 : 0;
    }
    return clamp01((props.currentTime - word.startTime) / duration);
  };
  const lineProgress = (line: NcmLyricLine) => {
    if (line.endTime === null || line.endTime <= line.time) {
      return props.currentTime >= line.time ? 1 : 0;
    }
    return clamp01((props.currentTime - line.time) / (line.endTime - line.time));
  };
  const lineDistance = (index: number) => {
    const activeIndex = activeLyricIndex();
    if (activeIndex < 0) return 0;
    return Math.abs(activeIndex - index);
  };
  const lineVisualStyle = (index: number, line: NcmLyricLine) => {
    const isActive = index === activeLyricIndex();
    const distance = lineDistance(index);
    const opacity = isActive ? 1 : Math.max(0.12, 0.34 - distance * 0.045);
    const blur = isActive ? 0 : Math.min(distance * 1.6, 8);

    return {
      "--line-progress": `${lineProgress(line) * 100}%`,
      opacity: String(opacity),
      filter: `blur(${String(blur)}px)`
    };
  };
  const timedWords = (line: NcmLyricLine) =>
    line.words && line.words.length > 0 ? line.words : null;
  const fullscreenLabel = () =>
    isFullscreen() ? t("fullPlayer.action.fullscreenExit") : t("fullPlayer.action.fullscreenEnter");

  const seekFromClientX = (clientX: number, rect: DOMRect) => {
    if (!canSeek()) return;
    const ratio = clamp01((clientX - rect.left) / rect.width);
    props.onSeek(ratio * props.duration);
  };

  const handleProgressClick = (event: MouseEvent) => {
    const target = event.currentTarget;
    if (target instanceof HTMLDivElement) {
      seekFromClientX(event.clientX, target.getBoundingClientRect());
    }
  };

  const handleProgressKeyDown = (event: KeyboardEvent) => {
    if (!canSeek()) return;
    const STEP = 5;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      props.onSeek(Math.max(0, props.currentTime - STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      props.onSeek(Math.min(props.duration, props.currentTime + STEP));
    }
  };

  const lyricNow = () => {
    const current = compactLyric();
    if (current) return current;
    if (lyricStatus() === "loading") return t("fullPlayer.lyric.loading");
    if (lyricStatus() === "error") return lyricError() ?? t("fullPlayer.lyric.error");
    return t("fullPlayer.lyric.placeholder");
  };

  const handleSurfaceMove = () => {
    revealMeta();
  };

  const handleSurfaceLeave = () => {
    clearHideTimer();
    setMetaVisible(false);
  };

  const toggleFullscreen = async () => {
    if (typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      await rootRef?.requestFullscreen?.();
    } catch {
      // ignore unsupported fullscreen transitions
    }
  };

  createEffect(() => {
    if (!props.isOpen || !uiSettings.fullPlayerAutoFocusLyrics) {
      return;
    }

    const activeIndex = activeLyricIndex();
    const container = lyricListRef;
    if (!container || activeIndex < 0) {
      return;
    }

    const activeLine = container.querySelector<HTMLElement>(
      `[data-lyric-index="${String(activeIndex)}"]`
    );
    if (!activeLine) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const lineRect = activeLine.getBoundingClientRect();
    const offset =
      activeLine.offsetTop -
      Math.max(
        0,
        container.clientHeight * LYRIC_SCROLL_OFFSET_RATIO - activeLine.clientHeight / 2
      ) +
      (lineRect.top - containerRect.top - activeLine.offsetTop);

    container.scrollTo({
      top: Math.max(0, offset),
      behavior: "smooth"
    });
  });

  return (
    <div
      ref={rootRef}
      class={`full-player${props.isOpen ? " is-open" : ""}`}
      role="dialog"
      aria-label={t("fullPlayer.aria.dialog")}
      aria-modal="true"
      aria-hidden={!props.isOpen}
      onMouseMove={handleSurfaceMove}
      onClick={handleSurfaceMove}
      onMouseLeave={handleSurfaceLeave}
    >
      <Show when={props.coverUrl}>
        <div class="full-player-fluid" style={coverBackgroundStyle()} aria-hidden="true" />
      </Show>
      <div class="full-player-vignette" aria-hidden="true" />

      <div class={`full-player-overlay-menu${metaVisible() ? " is-visible" : ""}`}>
        <div class="full-player-overlay-side" />
        <div class="full-player-overlay-drag" aria-hidden="true" />
        <div class="full-player-overlay-side is-right">
          <button
            type="button"
            class="full-player-menu-icon"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreenLabel()}
            title={fullscreenLabel()}
          >
            <Show when={isFullscreen()} fallback={<IconMaximize />}>
              <IconRestore />
            </Show>
          </button>
          <button
            type="button"
            class="full-player-menu-icon"
            onClick={props.onClose}
            aria-label={t("fullPlayer.aria.close")}
            title={t("fullPlayer.aria.close")}
          >
            <IconChevronDown />
          </button>
        </div>
      </div>

      <div class={layoutClassName()}>
        <div class="full-player-primary">
          <div class="full-player-cover">
            <CoverArt coverUrl={props.coverUrl} alt={props.title || t("cover.alt")} />
          </div>

          <div class="full-player-meta">
            <div class="full-player-title">{props.title}</div>
            <div class="full-player-subtitle">{props.subtitle || t("player.subtitle.empty")}</div>
            <Show when={props.detail}>
              {(detail) => <div class="full-player-detail">{detail()}</div>}
            </Show>
          </div>
        </div>

        <div class="full-player-lyric-panel" style={{ "--lyric-font-size": `${uiSettings.lyricFontSize}px` }}>
          <div class="full-player-lyric-now">{lyricNow()}</div>
          <div
            ref={lyricListRef}
            class="full-player-lyric-list"
            aria-label={t("fullPlayer.lyric.aria")}
          >
            <Show
              when={lyrics().length > 0}
              fallback={
                <div class="full-player-lyric-line is-active is-placeholder">
                  <span class="full-player-lyric-text">{lyricNow()}</span>
                </div>
              }
            >
              <For each={lyrics()}>
                {(line, index) => (
                  <div
                    data-lyric-index={String(index())}
                    class={`full-player-lyric-line${
                      index() === activeLyricIndex() ? " is-active" : ""
                    }`}
                    style={lineVisualStyle(index(), line)}
                  >
                    <Show
                      when={uiSettings.showWordLyrics && timedWords(line)}
                      fallback={<span class="full-player-lyric-text">{line.text}</span>}
                    >
                      {(words) => (
                        <span class="full-player-lyric-words">
                          <For each={words()}>
                            {(word) => (
                              <span
                                class="full-player-lyric-word"
                                style={{
                                  "--word-progress": `${wordProgress(word) * 100}%`
                                }}
                              >
                                {word.text}
                              </span>
                            )}
                          </For>
                        </span>
                      )}
                    </Show>
                    <Show when={uiSettings.showLyricTranslation && line.translatedText}>
                      {(translatedText) => (
                        <span class="full-player-lyric-translation">{translatedText()}</span>
                      )}
                    </Show>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </div>

      <div class={`full-player-control-shell${metaVisible() ? " is-visible" : ""}`}>
        <div class="full-player-control-side" />

        <div class="full-player-control-center">
          <div class="full-player-transport" role="group" aria-label={t("player.aria.transport")}>
            <button
              type="button"
              class={`transport-button mode-button${props.shuffleMode === "on" ? " is-active" : ""}`}
              onClick={props.onToggleShuffle}
              aria-label={shuffleLabel()}
              aria-pressed={props.shuffleMode === "on"}
              title={shuffleLabel()}
            >
              <IconShuffle />
            </button>
            <button
              type="button"
              class="transport-button"
              onClick={props.onSkipPrev}
              disabled={!props.canSkipPrev}
              aria-label={t("player.aria.prev")}
              title={t("player.aria.prev")}
            >
              <IconSkipPrev />
            </button>
            <button
              type="button"
              class="transport-button transport-primary"
              onClick={props.isPlaying ? props.onPause : props.onPlay}
              aria-label={playPauseLabel()}
              title={playPauseLabel()}
            >
              <Show when={props.isPlaying} fallback={<IconPlay />}>
                <IconPause />
              </Show>
            </button>
            <button
              type="button"
              class="transport-button"
              onClick={props.onSkipNext}
              disabled={!props.canSkipNext}
              aria-label={t("player.aria.next")}
              title={t("player.aria.next")}
            >
              <IconSkipNext />
            </button>
            <button
              type="button"
              class={`transport-button mode-button${props.repeatMode !== "off" ? " is-active" : ""}`}
              onClick={props.onCycleRepeat}
              aria-label={repeatLabel()}
              aria-pressed={props.repeatMode !== "off"}
              title={repeatLabel()}
            >
              {(() => {
                const Icon = RepeatIcon();
                return <Icon />;
              })()}
            </button>
          </div>

          <div class="full-player-progress-wrap">
            <span class="full-player-time">{formatTime(props.currentTime)}</span>
            <div
              class={`full-player-progress${canSeek() ? " is-interactive" : ""}`}
              role={canSeek() ? "slider" : "presentation"}
              aria-label={canSeek() ? t("player.aria.seek") : undefined}
              aria-valuemin={canSeek() ? 0 : undefined}
              aria-valuemax={canSeek() ? Math.round(props.duration) : undefined}
              aria-valuenow={canSeek() ? Math.round(props.currentTime) : undefined}
              tabIndex={canSeek() ? 0 : -1}
              onClick={handleProgressClick}
              onKeyDown={handleProgressKeyDown}
            >
              <div class="full-player-progress-fill" style={{ width: `${progress() * 100}%` }} />
            </div>
            <span class="full-player-time">{formatTime(props.duration)}</span>
          </div>
        </div>

        <div class="full-player-control-side is-right" />
      </div>
    </div>
  );
}
