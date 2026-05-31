export interface MediaListVisibleRange {
  start: number;
  end: number;
}

export interface ResolveMediaListVisibleRangeOptions {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
  virtualizeThreshold?: number;
}

export const MEDIA_LIST_VIRTUALIZE_THRESHOLD = 120;
export const MEDIA_LIST_ROW_HEIGHT_PX = 90;
export const MEDIA_LIST_OVERSCAN = 5;

const FALLBACK_VISIBLE_ROWS = 8;

export const shouldVirtualizeMediaList = (
  totalItems: number,
  threshold = MEDIA_LIST_VIRTUALIZE_THRESHOLD
): boolean => totalItems > threshold;

export function resolveMediaListVisibleRange(
  options: ResolveMediaListVisibleRangeOptions
): MediaListVisibleRange {
  const totalItems = Math.max(0, Math.trunc(options.totalItems));
  const virtualizeThreshold = options.virtualizeThreshold ?? MEDIA_LIST_VIRTUALIZE_THRESHOLD;
  if (!shouldVirtualizeMediaList(totalItems, virtualizeThreshold)) {
    return { start: 0, end: totalItems };
  }

  const rowHeight = Math.max(1, options.rowHeight ?? MEDIA_LIST_ROW_HEIGHT_PX);
  const overscan = Math.max(0, Math.trunc(options.overscan ?? MEDIA_LIST_OVERSCAN));
  const measuredHeight =
    options.viewportHeight > 0 ? options.viewportHeight : rowHeight * FALLBACK_VISIBLE_ROWS;
  const scrollTop = Math.max(0, options.scrollTop);
  const count = Math.ceil(measuredHeight / rowHeight) + overscan * 2;
  const maxStart = Math.max(0, totalItems - count);
  const start = Math.min(maxStart, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));

  return { start, end: Math.min(totalItems, start + count) };
}
