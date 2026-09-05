import { createEffect, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

const clampLyricScrollOffset = (value: number) => Math.min(0.9, Math.max(0.1, value));

interface FullPlayerLyricScrollTargetInput {
  containerScrollTop: number;
  containerHeight: number;
  lineOffsetFromViewportTop: number;
  lineHeight: number;
  scrollOffset: number;
}

export function resolveFullPlayerLyricScrollTarget(
  input: FullPlayerLyricScrollTargetInput
): number {
  const targetLineOffset = Math.max(
    0,
    input.containerHeight * clampLyricScrollOffset(input.scrollOffset) -
      input.lineHeight / 2
  );
  return Math.max(
    0,
    input.containerScrollTop + input.lineOffsetFromViewportTop - targetLineOffset
  );
}

export interface LatestAnimationFrameScheduler {
  readonly schedule: (task: () => void) => void;
  readonly cancel: () => void;
}

export function createLatestAnimationFrameScheduler(
  requestFrame: (callback: () => void) => number,
  cancelFrame: (handle: number) => void
): LatestAnimationFrameScheduler {
  let pendingFrame: number | undefined;
  let latestTask: (() => void) | undefined;

  const schedule = (task: () => void) => {
    latestTask = task;
    if (pendingFrame !== undefined) return;
    pendingFrame = requestFrame(() => {
      pendingFrame = undefined;
      const nextTask = latestTask;
      latestTask = undefined;
      nextTask?.();
    });
  };

  const cancel = () => {
    if (pendingFrame !== undefined) cancelFrame(pendingFrame);
    pendingFrame = undefined;
    latestTask = undefined;
  };

  return { schedule, cancel };
}

interface UseFullPlayerLyricAutoFocusOptions {
  isOpen: Accessor<boolean>;
  autoFocusLyrics: Accessor<boolean>;
  showComment: Accessor<boolean>;
  activeLyricIndex: Accessor<number>;
  lyricsScrollOffset: Accessor<number>;
  lyricListRef: Accessor<HTMLDivElement | undefined>;
}

/**
 * Layout-space offset chain: sums `offsetTop` over the element and every
 * offsetParent up to the root. Returns `null` when the chain ends before
 * reaching the root (element detached).
 *
 * Unlike `getBoundingClientRect`, offset* values live in layout space and are
 * immune to ancestor transforms. The full player open/close animation
 * (`expand-animation-flow` / `expand-animation-up`) scales the whole player
 * for ~500ms; a visual rect read inside that window yields a scroll target
 * computed against the animated (shrunk) geometry, and the smooth scroll
 * never re-measures — pinning the active lyric line off-center until the
 * next track change. Layout offsets provide a stable target every frame.
 */
const resolveLayoutOffsetTopToRoot = (el: HTMLElement): number | null => {
  let total = 0;
  let node: HTMLElement | null = el;
  while (node && node.isConnected) {
    total += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return node === null ? total : null;
};

/**
 * Layout offset (px) of `child` above `container`. Both chains are rooted at
 * their nearest positioned ancestor; a `static` container is skipped by the
 * child's offsetParent chain, so the diff of the two root-ward sums captures
 * the same relative distance a visual `rect.top` diff would, minus any
 * ancestor-transform distortion. Returns `null` when either chain is broken.
 */
const resolveLayoutOffsetTop = (
  child: HTMLElement,
  container: HTMLElement
): number | null => {
  const childTotal = resolveLayoutOffsetTopToRoot(child);
  const containerTotal = resolveLayoutOffsetTopToRoot(container);
  if (childTotal === null || containerTotal === null) return null;
  return childTotal - containerTotal;
};

export function useFullPlayerLyricAutoFocus(options: UseFullPlayerLyricAutoFocusOptions) {
  const frameScheduler = createLatestAnimationFrameScheduler(
    (callback) => window.requestAnimationFrame(callback),
    (handle) => window.cancelAnimationFrame(handle)
  );

  createEffect(() => {
    const isOpen = options.isOpen();
    const autoFocusLyrics = options.autoFocusLyrics();
    const showComment = options.showComment();
    const activeIndex = options.activeLyricIndex();
    const container = options.lyricListRef();
    const scrollOffset = options.lyricsScrollOffset();

    if (!isOpen || !autoFocusLyrics || showComment) {
      frameScheduler.cancel();
      return;
    }

    if (!container || activeIndex < 0) {
      frameScheduler.cancel();
      return;
    }

    frameScheduler.schedule(() => {
      const activeLine = container.querySelector<HTMLElement>(
        `[data-lyric-index="${String(activeIndex)}"]`
      );
      if (!activeLine) return;

      // Prefer the layout-space offset (transform-immune). Fall back to the
      // previous visual measurement only if an offset chain is broken.
      const layoutOffsetTop = resolveLayoutOffsetTop(activeLine, container);
      const lineOffsetFromViewportTop =
        layoutOffsetTop !== null
          ? layoutOffsetTop - container.scrollTop
          : (() => {
              const containerRect = container.getBoundingClientRect();
              const lineRect = activeLine.getBoundingClientRect();
              return lineRect.top - containerRect.top;
            })();

      const offset = resolveFullPlayerLyricScrollTarget({
        containerScrollTop: container.scrollTop,
        containerHeight: container.clientHeight,
        lineOffsetFromViewportTop,
        lineHeight: activeLine.clientHeight,
        scrollOffset
      });

      container.scrollTo({
        top: offset,
        behavior: "smooth"
      });
    });
  });

  onCleanup(frameScheduler.cancel);
}