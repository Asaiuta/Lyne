import { createEffect, createMemo, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { usePageSurfaceContext } from "./PageSurface";

export type PageHeroSize = "sm" | "md" | "lg";

const HERO_OFFSETS: Record<PageHeroSize, number> = {
  sm: 120,
  md: 180,
  lg: 240
};

const HERO_COMPACT_OFFSETS: Record<PageHeroSize, number> = {
  sm: 100,
  md: 120,
  lg: 120
};

interface PageHeroProps {
  children: JSX.Element;
  class?: string;
  size?: PageHeroSize;
  compact?: boolean;
  compactOffset?: number;
  offset?: number;
}

export function PageHero(props: PageHeroProps) {
  const surface = usePageSurfaceContext();
  const size = () => props.size ?? "lg";
  const compact = () => props.compact === true;
  const heroOffset = createMemo<number>(() =>
    compact()
      ? props.compactOffset ?? HERO_COMPACT_OFFSETS[size()]
      : props.offset ?? HERO_OFFSETS[size()]
  );

  createEffect(() => {
    surface.setHeroOffset(heroOffset());
  });

  onCleanup(() => {
    surface.setHeroOffset(0);
  });

  return (
    <div
      class={`page-hero page-hero--${size()}${compact() ? " is-compact is-small" : ""}${props.class ? ` ${props.class}` : ""}`}
      data-page-hero
      data-page-hero-size={size()}
      data-page-hero-compact={compact() ? "true" : undefined}
    >
      {props.children}
    </div>
  );
}
