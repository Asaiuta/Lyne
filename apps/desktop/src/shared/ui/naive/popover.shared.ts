import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaivePopoverTrigger = "click" | "hover" | "focus" | "manual";

export type NaivePopoverPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

export interface NaivePopoverAnchorRect {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface NaivePopoverProps {
  /** Popover body content. */
  children: JSX.Element;
  /** Trigger element rendered inline. May be omitted when `getAnchorRect` is provided. */
  trigger?: JSX.Element;
  /** Interaction model. Defaults to `"hover"` (Naive default). */
  triggerMode?: NaivePopoverTrigger;
  /** Initial placement. Defaults to `"top"` (Naive default). */
  placement?: NaivePopoverPlacement;
  /** Distance between anchor and popover content. */
  gutter?: number;
  /** Whether to render the floating arrow. Defaults to `true` (Naive default). */
  showArrow?: boolean;
  /** When true, suppresses the content padding wrapper (Naive `raw` mode). */
  raw?: boolean;
  /** Disable the popover entirely. */
  disabled?: boolean;
  /** Controlled open state. Required for `triggerMode="manual"`. */
  open?: boolean;
  /** Controlled open-state change callback. */
  onOpenChange?: (open: boolean) => void;
  /** Default open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /**
   * Teleport target element for the popover portal.
   * Defaults to `document.body`, matching SPlayer's `to` prop.
   */
  to?: HTMLElement;
  /**
   * Virtual anchor rect supplier. When provided, the popover is positioned
   * against the returned rect instead of the rendered trigger element.
   */
  getAnchorRect?: () => NaivePopoverAnchorRect;
  /** Optional class slot on the popover Content shell. */
  class?: string;
  /** Optional class slot on the popover root (anchor) element. */
  rootClass?: string;
  /** Optional style slot on the popover root (anchor) element. */
  rootStyle?: JSX.CSSProperties;
  /** Optional class slot on the rendered arrow. */
  arrowClass?: string;
  /** Accessible label forwarded to the content surface. */
  ariaLabel?: string;
  /** Optional dialog role override. Defaults to `"dialog". */
  role?: string;
}

export type NaivePopoverComponent = (props: NaivePopoverProps) => JSX.Element;

/**
 * Class-helper for the popover content shell. Keeps NaiveUI 2.43.2 class hooks
 * (`n-popover`, `n-popover-shared`, `n-popover__content`, `--raw`, `--show-arrow`)
 * intact so CSS/tokens own visual parity.
 */
export const naivePopoverContentClass = (
  props: Pick<NaivePopoverProps, "class" | "raw" | "showArrow">
): string => {
  const arrow = props.showArrow ?? true;
  const raw = props.raw ?? false;
  return joinClassNames(
    "n-popover",
    "n-popover-shared",
    "n-popover__content",
    raw ? "n-popover-shared--raw" : false,
    arrow ? "n-popover-shared--show-arrow" : false,
    props.class
  );
};

/**
 * Class-helper for the popover arrow. Matches NaiveUI `n-popover__arrow`.
 */
export const naivePopoverArrowClass = (
  props: Pick<NaivePopoverProps, "arrowClass">
): string => joinClassNames("n-popover__arrow", props.arrowClass);
