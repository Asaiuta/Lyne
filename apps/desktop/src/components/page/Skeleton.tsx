import { For, createMemo } from "solid-js";
import { NaiveSkeleton } from "../../shared/ui/naive";

interface SkeletonProps {
  shape?: "rect" | "circle" | "text";
  width?: string | number;
  height?: string | number;
  class?: string;
}

const buildIndexes = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

/**
 * Pulsing placeholder block. Matches SPlayer's `n-skeleton` visual rhythm
 * (1.4s pulse) and supports rect/circle/text shapes.
 */
export function Skeleton(props: SkeletonProps) {
  return <NaiveSkeleton {...props} />;
}

interface CoverGridSkeletonProps {
  count?: number;
  shape?: "square" | "round";
}

/**
 * Grid of 50 (configurable) card placeholders. Matches SPlayer's CoverList
 * loading state where the `cover-grid` is filled with `n-skeleton` rows.
 */
export function CoverGridSkeleton(props: CoverGridSkeletonProps) {
  const total = () => props.count ?? 50;
  const isRound = () => props.shape === "round";
  const indexes = createMemo(() => buildIndexes(total()));
  return (
    <div class="album-grid skeleton-grid" aria-hidden="true">
      <For each={indexes()}>
        {() => (
          <div class={`album-card skeleton-card${isRound() ? " album-card--round" : ""}`}>
            <NaiveSkeleton
              class="album-card-art"
              shape={isRound() ? "circle" : "rect"}
            />
            <NaiveSkeleton class="skeleton-line skeleton-line--title" shape="text" />
            <NaiveSkeleton class="skeleton-line" shape="text" />
          </div>
        )}
      </For>
    </div>
  );
}

interface ListSkeletonProps {
  count?: number;
  rowHeight?: number;
}

/**
 * Vertical stack of row placeholders. Matches SPlayer's SongList loading
 * (10 rows, 72px tall, 12px radius).
 */
export function ListSkeleton(props: ListSkeletonProps) {
  const total = () => props.count ?? 10;
  const height = () => props.rowHeight ?? 72;
  const indexes = createMemo(() => buildIndexes(total()));
  return (
    <div class="skeleton-list" aria-hidden="true">
      <For each={indexes()}>
        {() => <NaiveSkeleton class="skeleton-row" height={height()} />}
      </For>
    </div>
  );
}
