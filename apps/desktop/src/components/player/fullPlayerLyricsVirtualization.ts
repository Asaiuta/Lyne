export interface FullPlayerLyricWindow {
  start: number;
  end: number;
  virtualized: boolean;
}

export interface FullPlayerLyricRange {
  start: number;
  end: number;
}

interface ResolveFullPlayerLyricWindowOptions {
  totalLines: number;
  activeIndex: number;
  before?: number;
  after?: number;
  threshold?: number;
}

interface ResolveFullPlayerLyricWindowsOptions extends ResolveFullPlayerLyricWindowOptions {
  scrollTop: number;
  viewportHeight: number;
  scrollOverscan?: number;
  estimatedRowHeight?: number;
}

export const FULL_PLAYER_LYRIC_VIRTUALIZE_THRESHOLD = 96;
export const FULL_PLAYER_LYRIC_WINDOW_BEFORE = 24;
export const FULL_PLAYER_LYRIC_WINDOW_AFTER = 36;
export const FULL_PLAYER_LYRIC_SCROLL_OVERSCAN = 18;
export const FULL_PLAYER_LYRIC_ESTIMATED_ROW_HEIGHT_PX = 128;

export function resolveFullPlayerLyricWindow(
  options: ResolveFullPlayerLyricWindowOptions
): FullPlayerLyricWindow {
  const totalLines = Math.max(0, Math.trunc(options.totalLines));
  const threshold = options.threshold ?? FULL_PLAYER_LYRIC_VIRTUALIZE_THRESHOLD;
  if (totalLines <= threshold) {
    return { start: 0, end: totalLines, virtualized: false };
  }

  const before = Math.max(0, Math.trunc(options.before ?? FULL_PLAYER_LYRIC_WINDOW_BEFORE));
  const after = Math.max(0, Math.trunc(options.after ?? FULL_PLAYER_LYRIC_WINDOW_AFTER));
  const activeIndex =
    options.activeIndex >= 0 && options.activeIndex < totalLines
      ? Math.trunc(options.activeIndex)
      : 0;
  const windowSize = Math.min(totalLines, before + after + 1);
  const rawStart = Math.min(
    Math.max(0, activeIndex - before),
    Math.max(0, totalLines - windowSize)
  );

  return {
    start: rawStart,
    end: Math.min(totalLines, rawStart + windowSize),
    virtualized: true
  };
}

const mergeRanges = (ranges: readonly FullPlayerLyricRange[]): FullPlayerLyricRange[] => {
  const sorted = [...ranges]
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: FullPlayerLyricRange[] = [];
  for (const range of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
};

export function resolveFullPlayerLyricWindows(
  options: ResolveFullPlayerLyricWindowsOptions
): FullPlayerLyricRange[] {
  const activeWindow = resolveFullPlayerLyricWindow(options);
  if (!activeWindow.virtualized) {
    return [{ start: activeWindow.start, end: activeWindow.end }];
  }

  const totalLines = Math.max(0, Math.trunc(options.totalLines));
  const estimatedRowHeight = Math.max(
    1,
    options.estimatedRowHeight ?? FULL_PLAYER_LYRIC_ESTIMATED_ROW_HEIGHT_PX
  );
  const scrollOverscan = Math.max(
    0,
    Math.trunc(options.scrollOverscan ?? FULL_PLAYER_LYRIC_SCROLL_OVERSCAN)
  );
  const viewportRows =
    options.viewportHeight > 0 ? Math.ceil(options.viewportHeight / estimatedRowHeight) : 8;
  const scrollStart = Math.min(
    totalLines,
    Math.max(0, Math.floor(Math.max(0, options.scrollTop) / estimatedRowHeight) - scrollOverscan)
  );
  const scrollEnd = Math.min(totalLines, scrollStart + viewportRows + scrollOverscan * 2);

  return mergeRanges([
    { start: activeWindow.start, end: activeWindow.end },
    { start: scrollStart, end: scrollEnd }
  ]);
}
