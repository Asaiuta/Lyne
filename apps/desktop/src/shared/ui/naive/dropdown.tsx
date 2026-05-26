import { lazy, type JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveDropdownPlacement =
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

export type NaiveDropdownTriggerMode = "click" | "hover" | "manual";

/**
 * Option descriptor for `NaiveDropdown`. Mirrors NaiveUI 2.43.2's `DropdownOption`
 * shape, but reduced to the subset PR2 supports.
 *
 * Cascade `children` (submenus) is intentionally not modeled here yet — see the
 * runtime warning in `NaiveDropdownKobalte.tsx`.
 */
export interface NaiveDropdownOption {
  key: string;
  label?: string;
  icon?: JSX.Element;
  suffix?: JSX.Element;
  disabled?: boolean;
  /**
   * When `'divider'`, the option renders as a NaiveUI `n-dropdown-divider`
   * row with no body slots. `label`, `icon`, `disabled`, etc. are ignored.
   */
  type?: "divider";
  /** Per-option select handler. Receives the option for ergonomics. */
  onSelect?: (option: NaiveDropdownOption) => void;
  /**
   * Cascade `children` (submenus). Deferred in PR2 — supplying this triggers a
   * `console.warn` and is skipped at render time.
   */
  children?: NaiveDropdownOption[];
}

export interface NaiveDropdownProps {
  /**
   * Trigger element rendered inline. Receives Kobalte's button semantics
   * (`aria-haspopup`, `aria-expanded`, focus management).
   */
  children?: JSX.Element;
  /** Option list. */
  options: ReadonlyArray<NaiveDropdownOption>;
  /** Initial placement. Defaults to `"bottom-start"` (Naive default). */
  placement?: NaiveDropdownPlacement;
  /** Distance between anchor and dropdown menu. */
  gutter?: number;
  /** Disable the dropdown entirely. */
  disabled?: boolean;
  /** Interaction model. Defaults to `"click"`. */
  triggerMode?: NaiveDropdownTriggerMode;
  /** Controlled open state. Required for `triggerMode="manual"`. */
  open?: boolean;
  /** Controlled open-state change callback. */
  onOpenChange?: (open: boolean) => void;
  /** Default open state for uncontrolled usage. */
  defaultOpen?: boolean;
  /** Selection handler. Fires before close. */
  onSelect?: (option: NaiveDropdownOption) => void;
  /**
   * Teleport target element for the menu portal. Defaults to `document.body`,
   * matching SPlayer's `to` prop.
   */
  to?: HTMLElement;
  /** Optional class slot on the menu surface. */
  class?: string;
  /** Optional class slot on the trigger anchor element. */
  triggerClass?: string;
  /** Accessible label forwarded to the menu surface. */
  ariaLabel?: string;
}

export type NaiveDropdownComponent = (props: NaiveDropdownProps) => JSX.Element;

/**
 * Class-helper for the dropdown menu surface. Keeps NaiveUI 2.43.2 class hooks
 * (`n-dropdown`, `n-dropdown-menu`) intact so CSS/tokens own visual parity.
 */
export const naiveDropdownMenuClass = (
  props: Pick<NaiveDropdownProps, "class">
): string => joinClassNames("n-dropdown", "n-dropdown-menu", props.class);

/**
 * Class-helper for a dropdown option row. Mirrors NaiveUI's
 * `n-dropdown-option` + `n-dropdown-option-body` with pending/active/disabled
 * modifiers driven by Kobalte's `data-*` attributes.
 */
export const naiveDropdownOptionClass = (params: {
  disabled?: boolean;
  className?: string;
}): string =>
  joinClassNames(
    "n-dropdown-option",
    "n-dropdown-option-body",
    params.disabled ? "n-dropdown-option-body--disabled" : false,
    params.disabled ? "n-dropdown--disabled" : false,
    params.className
  );

/**
 * Class-helper for the prefix slot of an option body.
 */
export const naiveDropdownOptionPrefixClass = (params: {
  hasIcon: boolean;
}): string =>
  joinClassNames(
    "n-dropdown-option-body__prefix",
    params.hasIcon ? "n-dropdown-option-body__prefix--show-icon" : false
  );

/**
 * Class-helper for the label slot of an option body.
 */
export const naiveDropdownOptionLabelClass = (): string =>
  "n-dropdown-option-body__label";

/**
 * Class-helper for the suffix slot of an option body.
 */
export const naiveDropdownOptionSuffixClass = (): string =>
  "n-dropdown-option-body__suffix";

/**
 * Class-helper for the divider row.
 */
export const naiveDropdownDividerClass = (): string => "n-dropdown-divider";

/**
 * Public lazy proxy. The Kobalte implementation lives in
 * `NaiveDropdownKobalte.tsx` and is loaded on first mount via `lazy()`.
 *
 * This module must NOT top-level import `@kobalte/core`; the lazy proxy keeps
 * startup chunks free of the dropdown-menu primitive.
 */
const LazyNaiveDropdown = lazy(async () => {
  const module = await import("./NaiveDropdownKobalte");
  return { default: module.NaiveDropdownKobalte as NaiveDropdownComponent };
});

export function NaiveDropdown(props: NaiveDropdownProps): JSX.Element {
  return <LazyNaiveDropdown {...props} />;
}
