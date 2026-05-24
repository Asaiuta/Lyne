import type { JSX } from "solid-js";
import { usePageSurfaceContext } from "./PageSurface";

interface PageStickyHeaderState {
  compact: () => boolean;
  scrollTop: () => number;
}

interface PageStickyHeaderProps {
  children: (state: PageStickyHeaderState) => JSX.Element;
  threshold?: number;
}

export function PageStickyHeader(props: PageStickyHeaderProps) {
  const surface = usePageSurfaceContext();
  const threshold = () => props.threshold ?? 10;
  const compact = () => surface.scrollTop() > threshold();

  return props.children({
    compact,
    scrollTop: surface.scrollTop
  });
}
