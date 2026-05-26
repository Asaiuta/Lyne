export type NaiveGridResponsive = "self" | "screen";
export type NaiveGridResponsiveValue = string | number;

export interface NaiveGridRegisteredItem {
  id: string;
  offset: NaiveGridResponsiveValue;
  span: NaiveGridResponsiveValue;
  suffix: boolean;
}

export interface NaiveGridItemState {
  colStart?: number;
  offset: number;
  overflow: boolean;
  show: boolean;
  span: number;
}

export interface NaiveGridResolveOptions {
  collapsed: boolean;
  collapsedRows: number;
  cols: number;
  items: ReadonlyArray<NaiveGridRegisteredItem>;
  query?: number;
}

export const NAIVE_GRID_DEFAULT_COLS = 24;
export const NAIVE_GRID_DEFAULT_SPAN = 1;

const defaultBreakpoints = {
  xs: 0,
  s: 640,
  m: 1024,
  l: 1280,
  xl: 1536,
  xxl: 1920
} as const;

const isNumericToken = (value: string): boolean => /^\d+(?:\.\d+)?$/.test(value.trim());

const breakpointValue = (token: string): number | null => {
  const known = defaultBreakpoints[token as keyof typeof defaultBreakpoints];
  if (known != null) return known;
  return isNumericToken(token) ? Number(token) : null;
};

export const parseNaiveGridResponsiveValue = (
  value: NaiveGridResponsiveValue | undefined,
  query: number | undefined,
  fallback: number
): number => {
  if (value == null) return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

  const source = value.trim();
  if (source.length === 0) return fallback;
  if (isNumericToken(source)) return Number(source);

  let resolved: number | undefined;
  let resolvedBreakpoint = Number.NEGATIVE_INFINITY;
  for (const token of source.split(/\s+/)) {
    const [prefix, rawTokenValue] = token.includes(":")
      ? (token.split(":") as [string, string])
      : ["", token];
    const numericValue = Number(rawTokenValue);
    if (!Number.isFinite(numericValue)) continue;

    if (prefix.length === 0) {
      resolved = numericValue;
      continue;
    }

    const threshold = breakpointValue(prefix);
    if (threshold == null) continue;
    if (query != null && query >= threshold && threshold >= resolvedBreakpoint) {
      resolved = numericValue;
      resolvedBreakpoint = threshold;
    }
  }

  return resolved ?? fallback;
};

export const resolveNaiveGridItemStates = (
  options: NaiveGridResolveOptions
): Record<string, NaiveGridItemState> => {
  const cols = Math.max(1, Math.floor(options.cols || NAIVE_GRID_DEFAULT_COLS));
  const collapsedRows = Math.max(1, Math.floor(options.collapsedRows || 1));
  const suffixItem =
    options.items.length > 0 && options.items[options.items.length - 1]?.suffix
      ? options.items[options.items.length - 1]
      : undefined;
  const suffixSpan = suffixItem
    ? Math.max(
        0,
        Math.floor(
          parseNaiveGridResponsiveValue(
            suffixItem.span,
            options.query,
            NAIVE_GRID_DEFAULT_SPAN
          )
        )
      )
    : 0;

  const states: Record<string, NaiveGridItemState> = {};
  let spanCounter = 0;
  let collapsedDone = false;
  let overflow = false;

  for (const item of options.items) {
    const rawSpan = Math.max(
      0,
      Math.floor(
        parseNaiveGridResponsiveValue(item.span, options.query, NAIVE_GRID_DEFAULT_SPAN)
      )
    );
    const offset = Math.max(
      0,
      Math.floor(parseNaiveGridResponsiveValue(item.offset, options.query, 0))
    );
    const span = Math.min(Math.max(0, rawSpan + offset), cols);
    const isSuffix = item.id === suffixItem?.id;
    let show = rawSpan > 0;

    if (!isSuffix && rawSpan > 0 && options.collapsed) {
      if (collapsedDone) {
        show = false;
        overflow = true;
      } else {
        const remainder = spanCounter % cols;
        if (span + remainder > cols) spanCounter += cols - remainder;
        if (span + spanCounter + suffixSpan > collapsedRows * cols) {
          collapsedDone = true;
          show = false;
          overflow = true;
        } else {
          spanCounter += span;
        }
      }
    }

    states[item.id] = {
      colStart: isSuffix && suffixSpan > 0 ? cols + 1 - suffixSpan : undefined,
      offset,
      overflow,
      show: isSuffix ? true : show,
      span: isSuffix && suffixSpan > 0 ? suffixSpan : span
    };
  }

  return states;
};
