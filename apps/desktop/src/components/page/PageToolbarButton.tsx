import type { JSX } from "solid-js";
import {
  NaiveButton,
  type NaiveAriaHasPopup,
  type NaiveButtonMouseHandler,
  type NaiveButtonNativeType
} from "../../shared/ui/naive";

export type PageToolbarButtonVariant = "primary" | "secondary" | "icon";

interface PageToolbarButtonCommonProps {
  children: JSX.Element;
  active?: boolean;
  ariaExpanded?: boolean;
  ariaHasPopup?: NaiveAriaHasPopup;
  ariaPressed?: boolean;
  class?: string;
  disabled?: boolean;
  nativeType?: NaiveButtonNativeType;
  onClick?: NaiveButtonMouseHandler;
  title?: string;
}

interface PageToolbarIconButtonProps extends PageToolbarButtonCommonProps {
  variant: "icon";
  ariaLabel: string;
}

interface PageToolbarTextButtonProps extends PageToolbarButtonCommonProps {
  variant: "primary" | "secondary";
  ariaLabel?: string;
}

export type PageToolbarButtonProps =
  | PageToolbarIconButtonProps
  | PageToolbarTextButtonProps;

const toolbarButtonClass = (
  variant: PageToolbarButtonVariant,
  className: string | undefined
): string =>
  ["page-toolbar-button", `page-toolbar-button--${variant}`, className]
    .filter((value): value is string => Boolean(value))
    .join(" ");

export function PageToolbarButton(props: PageToolbarButtonProps): JSX.Element {
  return (
    <NaiveButton
      active={props.active}
      ariaExpanded={props.ariaExpanded}
      ariaHasPopup={props.ariaHasPopup}
      ariaLabel={props.ariaLabel}
      ariaPressed={props.ariaPressed}
      class={toolbarButtonClass(props.variant, props.class)}
      disabled={props.disabled}
      nativeType={props.nativeType}
      onClick={props.onClick}
      round
      secondary
      size="medium"
      strong
      title={props.title}
      variant={props.variant === "primary" ? "primary" : "default"}
    >
      {props.children}
    </NaiveButton>
  );
}
