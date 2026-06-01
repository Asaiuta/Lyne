import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { resolveNearestScrollRoot } from "../../shared/ui/scrollRoot";
import {
  GRID_OVERSCAN_ROWS,
  GRID_VIRTUALIZE_THRESHOLD,
  type GridVisibleRange,
  resolveGridVisibleRange
} from "./gridVirtualization";

interface VirtualizedGridProps<T> {
  items: readonly T[];
  class: string;
  renderItem: (item: T, index: () => number) => JSX.Element;
  estimatedRowHeight?: number;
  overscan?: number;
  virtualizeThreshold?: number;
  scrollRootSelector?: string;
}

interface VirtualizedGridEntry<T> {
  item: T;
  index: number;
}

const DEFAULT_GRID_ROW_HEIGHT_PX = 220;

const parseCssPixelValue = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const countGridColumns = (gridTemplateColumns: string): number => {
  const value = gridTemplateColumns.trim();
  if (!value || value === "none") return 1;
  return Math.max(1, value.split(/\s+/).filter(Boolean).length);
};

const findFirstGridItem = (element: HTMLElement): HTMLElement | null => {
  for (const child of Array.from(element.children)) {
    if (child instanceof HTMLElement && !child.classList.contains("virtualized-grid-spacer")) {
      return child;
    }
  }
  return null;
};

export function VirtualizedGrid<T>(props: VirtualizedGridProps<T>) {
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  const [columns, setColumns] = createSignal<number>(1);
  const [rowHeight, setRowHeight] = createSignal<number>(
    props.estimatedRowHeight ?? DEFAULT_GRID_ROW_HEIGHT_PX
  );
  const [rowGap, setRowGap] = createSignal<number>(0);
  let gridRef: HTMLDivElement | undefined;
  let scrollRoot: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | undefined;
  let scrollFrame = 0;

  const commitMeasure = () => {
    scrollFrame = 0;
    if (!gridRef || typeof window === "undefined") return;

    const computed = window.getComputedStyle(gridRef);
    const nextRowGap = parseCssPixelValue(computed.rowGap);
    const firstItem = findFirstGridItem(gridRef);
    const measuredItemHeight = firstItem?.getBoundingClientRect().height ?? 0;
    const fallbackRowHeight = props.estimatedRowHeight ?? DEFAULT_GRID_ROW_HEIGHT_PX;
    const nextRowHeight =
      measuredItemHeight > 0 ? measuredItemHeight + nextRowGap : fallbackRowHeight;
    const rootRect = scrollRoot?.getBoundingClientRect() ?? null;
    const gridRect = gridRef.getBoundingClientRect();

    setColumns(countGridColumns(computed.gridTemplateColumns));
    setRowGap(nextRowGap);
    setRowHeight(Math.max(1, nextRowHeight));
    setViewportHeight(scrollRoot?.clientHeight ?? window.innerHeight);
    setScrollTop(Math.max(0, (rootRect?.top ?? 0) - gridRect.top));
  };

  const scheduleMeasure = () => {
    if (scrollFrame !== 0) return;
    if (typeof window === "undefined") {
      commitMeasure();
      return;
    }
    scrollFrame = window.requestAnimationFrame(commitMeasure);
  };

  const bindScrollRoot = () => {
    if (!gridRef || typeof window === "undefined") return;
    scrollRoot = resolveNearestScrollRoot(gridRef, props.scrollRootSelector);
    const scrollTarget: HTMLElement | Window = scrollRoot ?? window;
    scrollTarget.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(gridRef);
      if (scrollRoot) {
        resizeObserver.observe(scrollRoot);
      }
    }
    scheduleMeasure();

    onCleanup(() => {
      scrollTarget.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      resizeObserver?.disconnect();
      resizeObserver = undefined;
      scrollRoot = null;
    });
  };

  onMount(bindScrollRoot);

  onCleanup(() => {
    if (scrollFrame !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(scrollFrame);
    }
  });

  createEffect(() => {
    props.items.length;
    scheduleMeasure();
  });

  const visibleRange = createMemo<GridVisibleRange>((previous) => {
    const next = resolveGridVisibleRange({
      totalItems: props.items.length,
      columns: columns(),
      rowHeight: rowHeight(),
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight(),
      overscan: props.overscan ?? GRID_OVERSCAN_ROWS,
      virtualizeThreshold: props.virtualizeThreshold ?? GRID_VIRTUALIZE_THRESHOLD
    });
    return previous.start === next.start &&
      previous.end === next.end &&
      previous.padTop === next.padTop &&
      previous.padBottom === next.padBottom &&
      previous.virtualized === next.virtualized
      ? previous
      : next;
  }, resolveGridVisibleRange({
    totalItems: 0,
    columns: 1,
    rowHeight: props.estimatedRowHeight ?? DEFAULT_GRID_ROW_HEIGHT_PX,
    scrollTop: 0,
    viewportHeight: 0
  }));

  const visibleEntries = createMemo<VirtualizedGridEntry<T>[]>(() => {
    const range = visibleRange();
    return props.items.slice(range.start, range.end).map((item, offset) => ({
      item,
      index: range.start + offset
    }));
  });

  const spacerHeight = (height: number): number =>
    height > 0 ? Math.max(0, height - rowGap()) : 0;

  return (
    <div
      ref={gridRef}
      class={props.class}
      data-virtualized={visibleRange().virtualized ? "true" : undefined}
    >
      <Show when={visibleRange().virtualized && visibleRange().padTop > 0}>
        <div
          class="virtualized-grid-spacer"
          style={{ height: `${spacerHeight(visibleRange().padTop)}px` }}
          aria-hidden="true"
        />
      </Show>
      <For each={visibleEntries()}>
        {(entry) => props.renderItem(entry.item, () => entry.index)}
      </For>
      <Show when={visibleRange().virtualized && visibleRange().padBottom > 0}>
        <div
          class="virtualized-grid-spacer"
          style={{ height: `${spacerHeight(visibleRange().padBottom)}px` }}
          aria-hidden="true"
        />
      </Show>
    </div>
  );
}
