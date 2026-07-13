import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { LyricLine, LyricWord } from "../../shared/api/lyrics";
import { findActiveLyricIndex } from "../../shared/media/lyrics";
import {
  IconClose,
  IconMusic,
  IconPause,
  IconPlay,
  IconSettings,
  IconSkipNext,
  IconSkipPrev
} from "../../components/icons";
import {
  closeDesktopLyricWindow,
  emitDesktopLyricControl,
  emitDesktopLyricReady,
  fitDesktopLyricHeight,
  onDesktopLyricTick,
  onDesktopLyricTrack,
  restoreDesktopLyricBounds,
  setDesktopLyricLocked,
  startDesktopLyricDrag,
  watchDesktopLyricBounds
} from "./desktopLyricBridge";
import {
  DEFAULT_DESKTOP_LYRIC_CONFIG,
  type DesktopLyricConfig,
  type DesktopLyricTrackPayload
} from "./types";
import "./desktop-lyric.css";

/** Seconds of look-ahead so karaoke fill lands slightly ahead of audio. */
const LOOKAHEAD = 0.3;
/** Re-anchor only when the incoming tick drifts past this (seconds). */
const DRIFT_THRESHOLD = 0.3;
/** Hide the hover chrome this long after the pointer goes still (ms). */
const HOVER_IDLE_MS = 1200;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

interface RenderLine {
  /** Absolute lyric index (-1 for placeholder). Used as the stable key. */
  index: number;
  /** Position relative to the active line: 0 = current, +n below, -n above. */
  offset: number;
  line: LyricLine;
  key: string;
  active: boolean;
  /** Render this line as plain text (e.g. placeholder) even if it has words. */
  plain?: boolean;
  /** Translation shown beneath the active line. */
  translation?: string | null;
}

function LockIcon(props: { locked: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect
        x="4.5"
        y="9"
        width="11"
        height="7.5"
        rx="1.6"
        stroke="currentColor"
        stroke-width="1.6"
      />
      <Show
        when={props.locked}
        fallback={
          <path
            d="M7 9V6.5a3 3 0 0 1 5.7-1.3"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            fill="none"
          />
        }
      >
        <path
          d="M7 9V6.5a3 3 0 0 1 6 0V9"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          fill="none"
        />
      </Show>
    </svg>
  );
}

export function DesktopLyricApp() {
  const [track, setTrack] = createSignal<DesktopLyricTrackPayload | null>(null);
  const [config, setConfig] = createSignal<DesktopLyricConfig>(DEFAULT_DESKTOP_LYRIC_CONFIG);
  const [playing, setPlaying] = createSignal(false);
  const [seek, setSeek] = createSignal(0);
  const [hovered, setHovered] = createSignal(false);
  const [scrollX, setScrollX] = createSignal(0);
  /** Marquee overflow of the active line (px); measured outside the rAF path. */
  const [overflowPx, setOverflowPx] = createSignal(0);

  // Playback-position interpolation anchor.
  let anchorPos = 0;
  let anchorTick = 0;
  let raf = 0;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let stageEl: HTMLDivElement | undefined;
  let prevFontSize = -1;
  let prevDoubleLine = true;

  /** Fraction of the line elapsed before the marquee starts scrolling. */
  const SCROLL_START = 0.3;

  const lines = createMemo<readonly LyricLine[]>(() => track()?.lines ?? []);

  const hasLyrics = createMemo(() => lines().length > 0);

  const currentIndex = createMemo(() => findActiveLyricIndex(lines(), seek() + LOOKAHEAD));

  /** Lines to keep mounted around the active line. Keeping a leaving line (-1)
   *  and look-ahead lines (+1/+2) lets CSS transitions tween the slide as the
   *  active index advances — kept (index-keyed) nodes animate; dropped ones are
   *  already faded to opacity 0 before removal. */
  const AHEAD = 2;

  const stageLines = createMemo<RenderLine[]>(() => {
    const all = lines();
    const cfg = config();
    const data = track();
    const placeholder = (text: string): RenderLine[] => [
      { index: -1, offset: 0, line: emptyLine(text), key: "placeholder", active: true, plain: true }
    ];
    if (all.length === 0) {
      return placeholder(
        data?.title ? `${data.title}${data.artist ? ` - ${data.artist}` : ""}` : "Lyne Desktop Lyric"
      );
    }
    const idx = currentIndex();
    if (idx < 0) {
      return placeholder(data?.title ? `${data.title}${data.artist ? ` - ${data.artist}` : ""}` : "♪");
    }
    const start = Math.max(0, idx - 1);
    const end = Math.min(all.length - 1, idx + AHEAD);
    const out: RenderLine[] = [];
    for (let i = start; i <= end; i++) {
      out.push({
        index: i,
        offset: i - idx,
        line: all[i],
        key: String(i),
        active: i === idx,
        translation: i === idx && cfg.showTranslation ? all[i].translatedText ?? null : null
      });
    }
    return out;
  });

  /** Vertical slide + fade per line, driven by its offset from the active line. */
  const lineStyle = (item: RenderLine): Record<string, string> => {
    const cfg = config();
    const gap = cfg.fontSize * 1.5;
    const offsetY = item.offset * gap;
    let opacity = 1;
    if (item.offset < 0) {
      opacity = 0;
    } else if (item.offset > 0) {
      opacity = cfg.doubleLine ? (item.offset === 1 ? 0.7 : 0.32) : 0;
    }
    return {
      transform: `translateY(calc(-50% + ${offsetY}px))`,
      opacity: String(opacity)
    };
  };

  /** Whether the seek-interpolation loop has work to do. Reading these inside
   *  the rAF step is untracked; the effect below restarts the loop when the
   *  transition back to true happens. */
  const shouldAnimate = () => playing() && hasLyrics() && !document.hidden;

  const step = () => {
    if (!shouldAnimate()) {
      // Park the loop; the paused position is already exact because the tick
      // handler re-anchors (setSeek) on every play/pause transition.
      raf = 0;
      return;
    }
    setSeek(anchorPos + (performance.now() - anchorTick) / 1000);
    raf = requestAnimationFrame(step);
  };

  const startAnimation = () => {
    if (raf !== 0) return;
    raf = requestAnimationFrame(step);
  };

  const reanchor = (position: number) => {
    anchorPos = position;
    anchorTick = performance.now();
    setSeek(position);
  };

  const wordStyle = (word: LyricWord, lineActive: boolean): Record<string, string> => {
    const cfg = config();
    const now = seek() + LOOKAHEAD;
    const fill = `linear-gradient(to right, ${cfg.playedColor} 50%, ${cfg.unplayedColor} 50%)`;
    if (!lineActive) {
      const played = now >= word.endTime;
      return { "background-image": fill, "background-position-x": played ? "0%" : "100%" };
    }
    const duration = Math.max(word.endTime - word.startTime, 0.001);
    const progress = clamp01((now - word.startTime) / duration);
    return {
      "background-image": fill,
      "background-position-x": `${100 - progress * 100}%`
    };
  };

  const activeLine = createMemo(() => stageLines().find((item) => item.active) ?? null);

  /** Measure how far the active line's content overflows its container.
   *  All marquee DOM reads (scrollWidth/clientWidth → forced layout) live
   *  here, triggered by stage-content changes and resizes — never per frame. */
  const measureOverflow = () => {
    const container = stageEl?.querySelector<HTMLElement>(".dl-line.active");
    const content = container?.querySelector<HTMLElement>(".dl-line-content");
    setOverflowPx(
      container && content ? Math.max(0, content.scrollWidth - container.clientWidth) : 0
    );
  };

  // Re-measure when the rendered stage changes (new active line, new track
  // payload, config affecting layout). Effects run post-render, so the DOM
  // already reflects the stage content read here.
  createEffect(() => {
    stageLines();
    setScrollX(0);
    measureOverflow();
  });

  // Drive the seek interpolation only while there is something to animate;
  // the loop parks itself otherwise and this restarts it on transitions.
  createEffect(() => {
    if (playing() && hasLyrics()) startAnimation();
  });

  // Marquee: translate the active line as playback progresses. Pure math —
  // measurement is hoisted above, so this never touches the DOM. While there
  // is no overflow it early-returns before reading seek(), so it does not
  // even subscribe to per-frame position updates.
  createEffect(() => {
    const overflow = overflowPx();
    const active = activeLine();
    if (!active || overflow <= 0) {
      setScrollX(0);
      return;
    }
    const now = seek();
    const start = active.line.time;
    const rawEnd = active.line.endTime;
    const end = rawEnd != null && rawEnd > start ? rawEnd : start + 4;
    const progress = clamp01((now - start) / Math.max(end - start, 0.001));
    if (progress <= SCROLL_START) {
      setScrollX(0);
      return;
    }
    const ratio = (progress - SCROLL_START) / (1 - SCROLL_START);
    setScrollX(-Math.round(overflow * ratio));
  });

  const onPointerMove = () => {
    setHovered(true);
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => setHovered(false), HOVER_IDLE_MS);
  };

  const onBodyPointerDown = (event: PointerEvent) => {
    if (config().locked) return;
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest(".dl-btn")) return;
    void startDesktopLyricDrag();
  };

  const toggleLock = () => {
    const next = !config().locked;
    setConfig((prev) => ({ ...prev, locked: next }));
    void setDesktopLyricLocked(next);
    void emitDesktopLyricControl("toggleLock", next);
  };

  onMount(() => {
    const syncVisibility = () => {
      if (document.hidden) {
        if (raf !== 0) cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      if (playing() && hasLyrics()) startAnimation();
    };
    document.addEventListener("visibilitychange", syncVisibility);
    const unlistens: Array<Promise<() => void>> = [];

    unlistens.push(
      onDesktopLyricTrack((payload) => {
        setTrack(payload);
        const incoming = payload.config;
        setConfig((prev) => {
          if (incoming.locked !== prev.locked) {
            void setDesktopLyricLocked(incoming.locked);
          }
          return incoming;
        });
        // Auto-fit window height to the configured font / line count.
        if (incoming.fontSize !== prevFontSize || incoming.doubleLine !== prevDoubleLine) {
          prevFontSize = incoming.fontSize;
          prevDoubleLine = incoming.doubleLine;
          void fitDesktopLyricHeight(incoming.fontSize, incoming.doubleLine);
        }
      })
    );

    unlistens.push(
      onDesktopLyricTick((payload) => {
        const wasPlaying = playing();
        setPlaying(payload.playing);
        if (Math.abs(payload.position - seek()) > DRIFT_THRESHOLD || payload.playing !== wasPlaying) {
          reanchor(payload.position);
        }
      })
    );

    // Re-measure the marquee overflow when the overlay is resized; the rAF
    // path itself never reads layout.
    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && stageEl) {
      resizeObserver = new ResizeObserver(() => measureOverflow());
      resizeObserver.observe(stageEl);
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerdown", onBodyPointerDown);
    void restoreDesktopLyricBounds();
    const boundsWatcher = watchDesktopLyricBounds();
    void emitDesktopLyricReady();

    onCleanup(() => {
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      resizeObserver?.disconnect();
      if (hoverTimer) clearTimeout(hoverTimer);
      document.removeEventListener("visibilitychange", syncVisibility);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onBodyPointerDown);
      void boundsWatcher.then((off) => off());
      for (const pending of unlistens) {
        void pending.then((off) => off());
      }
    });
  });

  const rootStyle = createMemo(() => ({
    "--dl-font-size": `${config().fontSize}px`,
    "--dl-played": config().playedColor,
    "--dl-unplayed": config().unplayedColor,
    "--dl-shadow": config().shadowColor
  }));

  return (
    <div
      class="desktop-lyric"
      classList={{ hovered: hovered(), locked: config().locked }}
      style={rootStyle()}
    >
      <header class="dl-header">
        <div class="dl-header-left">
          <button
            type="button"
            class="dl-btn"
            title="打开主窗口"
            onClick={() => void emitDesktopLyricControl("openMain")}
          >
            <IconMusic />
          </button>
          <span class="dl-song">
            {track()?.title ?? "Lyne"}
            <Show when={track()?.artist}>{(artist) => <small> · {artist()}</small>}</Show>
          </span>
        </div>
        <div class="dl-header-center">
          <button
            type="button"
            class="dl-btn"
            title="上一首"
            onClick={() => void emitDesktopLyricControl("prev")}
          >
            <IconSkipPrev />
          </button>
          <button
            type="button"
            class="dl-btn"
            title={playing() ? "暂停" : "播放"}
            onClick={() => void emitDesktopLyricControl(playing() ? "pause" : "play")}
          >
            {playing() ? <IconPause /> : <IconPlay />}
          </button>
          <button
            type="button"
            class="dl-btn"
            title="下一首"
            onClick={() => void emitDesktopLyricControl("next")}
          >
            <IconSkipNext />
          </button>
        </div>
        <div class="dl-header-right">
          <button
            type="button"
            class="dl-btn"
            title="歌词设置"
            onClick={() => void emitDesktopLyricControl("openSettings")}
          >
            <IconSettings />
          </button>
          <button
            type="button"
            class="dl-btn dl-lock"
            title={config().locked ? "解锁" : "锁定"}
            onClick={toggleLock}
          >
            <LockIcon locked={config().locked} />
          </button>
          <button
            type="button"
            class="dl-btn"
            title="关闭桌面歌词"
            onClick={() => {
              // Let the main window clean up its bridge state, but also close
              // ourselves directly so the button still works when the main
              // window is already gone (the emit would have no listener).
              void emitDesktopLyricControl("close");
              void closeDesktopLyricWindow();
            }}
          >
            <IconClose />
          </button>
        </div>
      </header>

      <Show when={config().showPlayInfo && !hovered() && track()}>
        <div class="dl-play-title" classList={{ [`align-${config().position}`]: true }}>
          <span class="dl-play-name">{track()?.title}</span>
          <Show when={track()?.artist}>
            {(artist) => <span class="dl-play-artist">{artist()}</span>}
          </Show>
        </div>
      </Show>

      <div
        class="dl-body"
        classList={{ [`align-${config().position}`]: true }}
        ref={(el) => (stageEl = el)}
      >
        <For each={stageLines()}>
          {(item) => (
            <div
              class="dl-line"
              classList={{
                active: item.active,
                "dl-line-start": config().position === "both" && item.active,
                "dl-line-end": config().position === "both" && !item.active
              }}
              style={lineStyle(item)}
            >
              <span
                class="dl-line-content"
                style={item.active ? { transform: `translateX(${scrollX()}px)` } : undefined}
              >
                <Show
                  when={
                    !item.plain &&
                    config().showWordLyrics &&
                    (item.line.words?.length ?? 0) > 0
                  }
                  fallback={<span class="dl-text">{item.line.text}</span>}
                >
                  <span class="dl-words">
                    <For each={item.line.words}>
                      {(word) => (
                        <span class="dl-word" style={wordStyle(word, item.active)}>
                          {word.text}
                        </span>
                      )}
                    </For>
                  </span>
                </Show>
              </span>
              <Show when={item.translation}>
                {(tran) => <span class="dl-line-tran">{tran()}</span>}
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function emptyLine(text: string): LyricLine {
  return { time: 0, endTime: null, text };
}
