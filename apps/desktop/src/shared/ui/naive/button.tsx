import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveButtonVariant = "default" | "primary" | "tertiary";
export type NaiveButtonSize = "tiny" | "small" | "medium" | "large";
export type NaiveButtonNativeType = "button" | "submit" | "reset";
export type NaiveButtonMouseHandler = JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
export type NaiveButtonPointerHandler = JSX.EventHandlerUnion<HTMLButtonElement, PointerEvent>;
export type NaiveAriaHasPopup = boolean | "menu" | "listbox" | "tree" | "grid" | "dialog";

export interface NaiveButtonProps {
  children: JSX.Element;
  active?: boolean;
  ariaChecked?: boolean;
  ariaCurrent?: "page" | "step" | "location" | "date" | "time" | boolean;
  ariaExpanded?: boolean;
  ariaHasPopup?: NaiveAriaHasPopup;
  ariaHidden?: boolean;
  ariaLabel?: string;
  ariaPressed?: boolean;
  block?: boolean;
  circle?: boolean;
  class?: string;
  dataNoDrag?: boolean;
  dataNaivePopselectTrigger?: boolean;
  dataPerfRouteKey?: string;
  disabled?: boolean;
  nativeType?: NaiveButtonNativeType;
  onClick?: NaiveButtonMouseHandler;
  onPointerDown?: NaiveButtonPointerHandler;
  role?: JSX.HTMLAttributes<HTMLButtonElement>["role"];
  round?: boolean;
  secondary?: boolean;
  size?: NaiveButtonSize;
  strong?: boolean;
  style?: JSX.CSSProperties;
  tabIndex?: number;
  tertiary?: boolean;
  title?: string;
  variant?: NaiveButtonVariant;
}

const stateClass = (condition: boolean | undefined, className: string): string | false =>
  condition ? className : false;

export type NaiveButtonClassProps = Pick<
  NaiveButtonProps,
  | "active"
  | "block"
  | "circle"
  | "class"
  | "round"
  | "secondary"
  | "size"
  | "strong"
  | "tertiary"
  | "variant"
>;

export const naiveButtonClassNames = (props: NaiveButtonClassProps): string =>
  joinClassNames(
    "naive-button",
    props.variant ? `naive-button--${props.variant}` : false,
    props.size ? `naive-button--${props.size}` : false,
    stateClass(props.active, "is-active"),
    stateClass(props.block, "is-block"),
    stateClass(props.circle, "is-circle"),
    stateClass(props.round, "is-round"),
    stateClass(props.secondary, "is-secondary"),
    stateClass(props.strong, "is-strong"),
    stateClass(props.tertiary, "is-tertiary"),
    props.class
  );

export function NaiveButton(props: NaiveButtonProps): JSX.Element {
  const className = () => naiveButtonClassNames(props);

  return (
    <button
      type={props.nativeType ?? "button"}
      class={className()}
      role={props.role}
      data-no-drag={props.dataNoDrag ? "" : undefined}
      data-naive-popselect-trigger={props.dataNaivePopselectTrigger ? "" : undefined}
      data-perf-route-key={props.dataPerfRouteKey}
      aria-checked={props.ariaChecked}
      aria-current={props.ariaCurrent}
      aria-expanded={props.ariaExpanded}
      aria-haspopup={props.ariaHasPopup}
      aria-hidden={props.ariaHidden}
      aria-label={props.ariaLabel}
      aria-pressed={props.ariaPressed}
      style={props.style}
      tabIndex={props.tabIndex}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      onPointerDown={props.onPointerDown}
    >
      {props.children}
    </button>
  );
}
