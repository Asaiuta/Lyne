import type { JSX } from "solid-js";
import { IconChevronLeft } from "../icons";
import {
  NaiveButton,
  type NaiveButtonMouseHandler
} from "../../shared/ui/naive";

export interface PageBackButtonProps {
  ariaLabel: string;
  class?: string;
  disabled?: boolean;
  onClick: NaiveButtonMouseHandler;
  title?: string;
}

const backButtonClass = (className: string | undefined): string =>
  ["page-back-button", className]
    .filter((value): value is string => Boolean(value))
    .join(" ");

export function PageBackButton(props: PageBackButtonProps): JSX.Element {
  return (
    <NaiveButton
      ariaLabel={props.ariaLabel}
      class={backButtonClass(props.class)}
      disabled={props.disabled}
      onClick={props.onClick}
      round
      secondary
      size="large"
      title={props.title ?? props.ariaLabel}
    >
      <IconChevronLeft />
    </NaiveButton>
  );
}
