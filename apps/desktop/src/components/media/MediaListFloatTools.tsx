import { Show } from "solid-js";
import { IconChevronUp, IconLocation } from "../icons";

interface MediaListFloatToolsProps {
  canLocateCurrent: boolean;
  scrollTop: number;
  showTop: boolean;
  currentLabel: string;
  topLabel: string;
  onScrollToCurrent: () => void;
  onScrollToTop: () => void;
}

export function MediaListFloatTools(props: MediaListFloatToolsProps) {
  return (
    <div class="media-list-float-tools">
      <Show when={props.canLocateCurrent}>
        <button
          type="button"
          class="media-list-float-button"
          onClick={props.onScrollToCurrent}
          aria-label={props.currentLabel}
          title={props.currentLabel}
        >
          <IconLocation />
        </button>
      </Show>
      <Show when={props.showTop}>
        <button
          type="button"
          class="media-list-float-button"
          classList={{ "is-hidden": props.scrollTop <= 100 }}
          onClick={props.onScrollToTop}
          aria-label={props.topLabel}
          title={props.topLabel}
        >
          <IconChevronUp />
        </button>
      </Show>
    </div>
  );
}
