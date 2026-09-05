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
 * Pulsing placeholder block matching the local loading rhythm
 * (1.4s pulse) and supports rect/circle/text shapes.
 */
export function Skeleton(props: SkeletonProps) {
  return <NaiveSkeleton {...props} />;
}

interface ListSkeletonProps {
  count?: number;
  rowHeight?: number;
}

/**
 * Vertical stack of row placeholders.
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
