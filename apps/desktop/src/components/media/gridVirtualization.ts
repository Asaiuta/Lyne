export interface GridVisibleRange {
  start: number;
  end: number;
  startRow: number;
  endRow: number;
  padTop: number;
  padBottom: number;
  virtualized: boolean;
}

export interface ResolveGridVisibleRangeOptions {
  totalItems: number;
  columns: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  virtualizeThreshold?: number;
}

export const GRID_VIRTUALIZE_THRESHOLD = 120;
export const GRID_OVERSCAN_ROWS = 2;

const FALLBACK_VISIBLE_ROWS = 4;

export const shouldVirtualizeGrid = (
  totalItems: number,
  threshold = GRID_VIRTUALIZE_THRESHOLD
): boolean => totalItems > threshold;

export function resolveGridVisibleRange(
  options: ResolveGridVisibleRangeOptions
): GridVisibleRange {
  const totalItems = Math.max(0, Math.trunc(options.totalItems));
  const virtualizeThreshold = options.virtualizeThreshold ?? GRID_VIRTUALIZE_THRESHOLD;
  const columns = Math.max(1, Math.trunc(options.columns));
  const totalRows = Math.ceil(totalItems / columns);
  const rowHeight = Math.max(1, options.rowHeight);

  if (!shouldVirtualizeGrid(totalItems, virtualizeThreshold)) {
    return {
      start: 0,
      end: totalItems,
      startRow: 0,
      endRow: totalRows,
      padTop: 0,
      padBottom: 0,
      virtualized: false
    };
  }

  const overscan = Math.max(0, Math.trunc(options.overscan ?? GRID_OVERSCAN_ROWS));
  const measuredHeight =
    options.viewportHeight > 0 ? options.viewportHeight : rowHeight * FALLBACK_VISIBLE_ROWS;
  const visibleRows = Math.ceil(measuredHeight / rowHeight);
  const rowCount = visibleRows + overscan * 2;
  const scrollTop = Math.max(0, options.scrollTop);
  const maxStartRow = Math.max(0, totalRows - rowCount);
  const startRow = Math.min(
    maxStartRow,
    Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  );
  const endRow = Math.min(totalRows, startRow + rowCount);
  const start = Math.min(totalItems, startRow * columns);
  const end = Math.min(totalItems, endRow * columns);

  return {
    start,
    end,
    startRow,
    endRow,
    padTop: startRow * rowHeight,
    padBottom: Math.max(0, totalRows - endRow) * rowHeight,
    virtualized: true
  };
}
