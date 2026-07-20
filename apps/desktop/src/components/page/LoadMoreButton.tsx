import { Show, type JSX } from "solid-js";
import {
  NaiveButton,
  NaiveSpin,
  type NaiveButtonMouseHandler
} from "../../shared/ui/naive";

export interface LoadMoreButtonProps {
  class?: string;
  disabled?: boolean;
  label: string;
  loading: boolean;
  loadingLabel: string;
  onClick: NaiveButtonMouseHandler;
}

const loadMoreButtonClass = (className: string | undefined): string =>
  ["load-more-button", className]
    .filter((value): value is string => Boolean(value))
    .join(" ");

export function LoadMoreButton(props: LoadMoreButtonProps): JSX.Element {
  return (
    <NaiveButton
      class={loadMoreButtonClass(props.class)}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
      round
      secondary
      size="large"
      strong
    >
      <Show when={props.loading}>
        <NaiveSpin class="load-more-button-spinner" size={14} ariaHidden />
      </Show>
      <span>{props.loading ? props.loadingLabel : props.label}</span>
    </NaiveButton>
  );
}
