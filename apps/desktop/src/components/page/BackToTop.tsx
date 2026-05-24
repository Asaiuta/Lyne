import { IconChevronUp } from "../icons";
import { usePageSurfaceContext } from "./PageSurface";

interface BackToTopProps {
  class?: string;
  label?: string;
  threshold?: number;
}

export function BackToTop(props: BackToTopProps) {
  const surface = usePageSurfaceContext();
  const label = () => props.label ?? "Back to top";
  const visible = () => surface.scrollTop() >= (props.threshold ?? 600);

  return (
    <button
      type="button"
      class={`page-back-to-top${props.class ? ` ${props.class}` : ""}`}
      classList={{ "is-visible": visible() }}
      onClick={surface.scrollToTop}
      aria-label={label()}
      aria-hidden={!visible()}
      tabIndex={visible() ? 0 : -1}
      title={label()}
    >
      <IconChevronUp />
    </button>
  );
}
