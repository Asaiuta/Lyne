import { For, createMemo } from "solid-js";
import { NaiveSkeleton } from "../../shared/ui/naive";
import "../../shared/styles/components/content-cards.css";
import "../../shared/styles/pages/album-grid.css";

interface CoverGridSkeletonProps {
  count?: number;
  shape?: "square" | "round";
}

const buildIndexes = (count: number): number[] =>
  Array.from({ length: count }, (_, index) => index);

export function CoverGridSkeleton(props: CoverGridSkeletonProps) {
  const total = () => props.count ?? 50;
  const isRound = () => props.shape === "round";
  const indexes = createMemo(() => buildIndexes(total()));

  return (
    <div class="album-grid cover-list-grid skeleton-grid" aria-hidden="true">
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
