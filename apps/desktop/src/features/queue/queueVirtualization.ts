export interface QueueVisibleRange {
  start: number;
  end: number;
}

interface ResolveQueueVisibleRangeOptions {
  totalItems: number;
  scrollTop: number;
  viewportHeight: number;
  rowHeight?: number;
  overscan?: number;
}

export const QUEUE_ROW_HEIGHT_PX = 80;
export const QUEUE_OVERSCAN = 6;

export function resolveQueueVisibleRange(
  options: ResolveQueueVisibleRangeOptions
): QueueVisibleRange {
  const totalItems = Math.max(0, Math.trunc(options.totalItems));
  const rowHeight = Math.max(1, options.rowHeight ?? QUEUE_ROW_HEIGHT_PX);
  const overscan = Math.max(0, Math.trunc(options.overscan ?? QUEUE_OVERSCAN));
  const measuredHeight = options.viewportHeight > 0 ? options.viewportHeight : rowHeight * 8;
  const start = Math.min(
    totalItems,
    Math.max(0, Math.floor(Math.max(0, options.scrollTop) / rowHeight) - overscan)
  );
  const count = Math.ceil(measuredHeight / rowHeight) + overscan * 2;

  return { start, end: Math.min(totalItems, start + count) };
}
