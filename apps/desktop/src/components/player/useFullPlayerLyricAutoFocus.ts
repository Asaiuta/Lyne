import { createEffect } from "solid-js";
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

interface UseFullPlayerLyricAutoFocusOptions {
  isOpen: Accessor<boolean>;
  autoFocusLyrics: Accessor<boolean>;
  showComment: Accessor<boolean>;
  activeLyricIndex: Accessor<number>;
  lyricsScrollOffset: Accessor<number>;
  lyricListRef: Accessor<HTMLDivElement | undefined>;
}

export function useFullPlayerLyricAutoFocus(options: UseFullPlayerLyricAutoFocusOptions) {
  createEffect(() => {
    if (!options.isOpen() || !options.autoFocusLyrics() || options.showComment()) {
      return;
    }

    const activeIndex = options.activeLyricIndex();
    const container = options.lyricListRef();
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
    const offset = resolveFullPlayerLyricScrollTarget({
      containerScrollTop: container.scrollTop,
      containerHeight: container.clientHeight,
      lineOffsetFromViewportTop: lineRect.top - containerRect.top,
      lineHeight: activeLine.clientHeight,
      scrollOffset: options.lyricsScrollOffset()
    });

    container.scrollTo({
      top: offset,
      behavior: "smooth"
    });
  });
}
