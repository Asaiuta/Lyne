import { createSignal, onCleanup, untrack, type Accessor } from "solid-js";

/**
 * Geometry of one row participating in a drag-sort interaction. Only the
 * vertical span is needed because drag-sort lives inside a vertical list.
 */
export interface DragSortRowGeometry {
  /** Row index in the source list (after any virtualization offset). */
  index: number;
  /** Absolute top offset in the same coordinate space as the pointer event. */
  top: number;
  /** Absolute bottom offset; `top + height`. */
  bottom: number;
}

/**
 * Result of resolving a pointer position against the list geometry.
 *
 * `targetIndex` is the row the indicator should point at; `position` is
 * whether the drop line should sit above or below that row.
 */
export interface DropResolution {
  targetIndex: number;
  position: "before" | "after";
}

export interface ResolveDropPositionOptions {
  rows: readonly DragSortRowGeometry[];
  pointerY: number;
}

/**
 * Pure helper: given the row geometries and the pointer Y, decide which
 * row receives the drop indicator and whether the indicator sits above or
 * below that row. Returns `null` for empty lists.
 */
export function resolveDropPosition(
  options: ResolveDropPositionOptions
): DropResolution | null {
  const { rows, pointerY } = options;
  if (rows.length === 0) return null;

  const first = rows[0];
  if (pointerY <= first.top) {
    return { targetIndex: first.index, position: "before" };
  }
  const last = rows[rows.length - 1];
  if (pointerY >= last.bottom) {
    return { targetIndex: last.index, position: "after" };
  }

  for (const row of rows) {
    if (pointerY < row.top || pointerY > row.bottom) continue;
    const midpoint = (row.top + row.bottom) / 2;
    return {
      targetIndex: row.index,
      position: pointerY < midpoint ? "before" : "after"
    };
  }

  // Pointer is between rows (gap); attach to the nearest row by distance.
  let bestRow = first;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const distance = Math.min(
      Math.abs(pointerY - row.top),
      Math.abs(pointerY - row.bottom)
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRow = row;
    }
  }
  const midpoint = (bestRow.top + bestRow.bottom) / 2;
  return {
    targetIndex: bestRow.index,
    position: pointerY < midpoint ? "before" : "after"
  };
}

export interface ResolveReorderOptions {
  fromIndex: number;
  targetIndex: number;
  position: "before" | "after";
  totalItems: number;
}

/**
 * Compute the final destination index for a drag-and-drop reorder. Returns
 * `null` when the move would be a no-op (drag to same position).
 */
export function resolveReorderIndex(options: ResolveReorderOptions): number | null {
  const { fromIndex, targetIndex, position, totalItems } = options;
  if (totalItems <= 1) return null;
  if (fromIndex < 0 || fromIndex >= totalItems) return null;
  if (targetIndex < 0 || targetIndex >= totalItems) return null;

  const insertionIndex = position === "before" ? targetIndex : targetIndex + 1;
  // Removing the source first shifts insertion points after `fromIndex`.
  const adjusted = insertionIndex > fromIndex ? insertionIndex - 1 : insertionIndex;
  const clamped = Math.max(0, Math.min(totalItems - 1, adjusted));
  if (clamped === fromIndex) return null;
  return clamped;
}

/**
 * Re-order an array immutably by moving `fromIndex` to `toIndex`. Returns
 * the original reference if the move would be a no-op so Solid memos can
 * preserve referential equality.
 */
export function reorderItems<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items.slice();
  if (fromIndex < 0 || fromIndex >= items.length) return items.slice();
  if (toIndex < 0 || toIndex >= items.length) return items.slice();
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export interface DragSortState {
  fromIndex: number;
  pointerX: number;
  pointerY: number;
  drop: DropResolution | null;
}

export interface UseDragSortOptions {
  /**
   * Returns the current row geometries. The hook calls this on each
   * `pointermove` so virtualization can refresh as the user scrolls. The
   * geometries must be in document coordinates (i.e. `clientY` + scrollY
   * is NOT applied — pass `clientY` and the row's `getBoundingClientRect`).
   */
  getRows: () => readonly DragSortRowGeometry[];
  /**
   * Total number of items in the list, used to validate the resolved
   * destination index.
   */
  getTotalItems: () => number;
  /** Reorder commit; called once on a valid drop. */
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export interface DragSortApi {
  /** Active drag state, or `null` when no drag is in progress. */
  state: Accessor<DragSortState | null>;
  /**
   * Attach to the `pointerdown` of the row's drag handle. `fromIndex`
   * identifies the source row.
   */
  beginDrag: (fromIndex: number, event: PointerEvent) => void;
  /** Imperatively cancel the current drag (no reorder). */
  cancel: () => void;
}

/**
 * Pointer-driven drag-sort primitive. Solid-friendly: drag state is
 * exposed through an accessor so consumers can render their drop indicator
 * and floating label reactively, while per-frame pointer updates are
 * batched inside `untrack` to avoid spurious store writes.
 *
 * Cancel triggers:
 * - ESC keypress
 * - Pointer leaves the window (`pointerleave` on documentElement)
 * - Window blur or visibility change
 * - Explicit `cancel()`
 */
export function useDragSort(options: UseDragSortOptions): DragSortApi {
  const [state, setState] = createSignal<DragSortState | null>(null);

  let pointerId: number | null = null;
  let detach: (() => void) | null = null;

  const teardown = () => {
    if (detach) {
      detach();
      detach = null;
    }
    pointerId = null;
  };

  const cancel = () => {
    if (state() === null) return;
    teardown();
    setState(null);
  };

  const commitMove = (pointerY: number) => {
    const current = untrack(state);
    if (!current) return;
    const drop = resolveDropPosition({ rows: options.getRows(), pointerY });
    if (
      current.drop?.targetIndex === drop?.targetIndex &&
      current.drop?.position === drop?.position &&
      current.pointerY === pointerY
    ) {
      return;
    }
    setState({ ...current, pointerY, drop });
  };

  const beginDrag = (fromIndex: number, event: PointerEvent) => {
    if (state() !== null) return;
    if (event.button !== 0 && event.button !== undefined) return;
    if (typeof window === "undefined") return;

    pointerId = event.pointerId;
    const initialDrop = resolveDropPosition({
      rows: options.getRows(),
      pointerY: event.clientY
    });
    setState({
      fromIndex,
      pointerX: event.clientX,
      pointerY: event.clientY,
      drop: initialDrop
    });

    const handleMove = (ev: PointerEvent) => {
      if (pointerId !== null && ev.pointerId !== pointerId) return;
      // High-frequency updates: keep state writes coalesced and untracked.
      untrack(() => {
        const current = state();
        if (!current) return;
        const drop = resolveDropPosition({
          rows: options.getRows(),
          pointerY: ev.clientY
        });
        setState({
          fromIndex: current.fromIndex,
          pointerX: ev.clientX,
          pointerY: ev.clientY,
          drop
        });
      });
    };

    const handleUp = (ev: PointerEvent) => {
      if (pointerId !== null && ev.pointerId !== pointerId) return;
      commitMove(ev.clientY);
      const current = untrack(state);
      teardown();
      setState(null);
      if (!current) return;
      const drop = current.drop;
      if (!drop) return;
      const toIndex = resolveReorderIndex({
        fromIndex: current.fromIndex,
        targetIndex: drop.targetIndex,
        position: drop.position,
        totalItems: options.getTotalItems()
      });
      if (toIndex === null) return;
      options.onReorder(current.fromIndex, toIndex);
    };

    const handleCancel = () => cancel();
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") cancel();
    };
    const handleLeave = (ev: PointerEvent) => {
      // pointerleave on the documentElement fires when the pointer exits
      // the viewport; treat that as a cancel to mirror SPlayer behavior.
      if (ev.target === document.documentElement || ev.relatedTarget === null) {
        cancel();
      }
    };
    const handleBlur = () => cancel();
    const handleVisibility = () => {
      if (document.hidden) cancel();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("visibilitychange", handleVisibility);
    document.documentElement.addEventListener("pointerleave", handleLeave);

    detach = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("visibilitychange", handleVisibility);
      document.documentElement.removeEventListener("pointerleave", handleLeave);
    };
  };

  onCleanup(() => {
    teardown();
  });

  return { state, beginDrag, cancel };
}
