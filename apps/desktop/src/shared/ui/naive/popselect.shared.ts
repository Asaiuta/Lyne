import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export interface NaivePopselectOption<TValue extends string> {
  value: TValue;
  label: string;
}

export type NaivePopselectPlacement =
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "top"
  | "top-start"
  | "top-end"
  | "left"
  | "right";

export interface NaivePopselectProps<TValue extends string> {
  label: string;
  open: boolean;
  value: TValue;
  options: ReadonlyArray<NaivePopselectOption<TValue>>;
  triggerContent: JSX.Element;
  class?: string;
  triggerClass?: string;
  triggerOpenClass?: string;
  popoverClass?: string;
  optionClass?: string;
  optionActiveClass?: string;
  optionContentClass?: string;
  optionCheckClass?: string;
  placement?: NaivePopselectPlacement;
  gutter?: number;
  fallbackPopoverWidth?: number;
  stopTriggerPropagation?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: TValue) => void;
  renderCheck?: (option: NaivePopselectOption<TValue>) => JSX.Element;
}

export type NaivePopselectComponent = <TValue extends string>(
  props: NaivePopselectProps<TValue>
) => JSX.Element;

export const fallbackClass = (className: string | undefined, fallback: string): string =>
  className ?? fallback;

export const activeClass = (active: boolean, className: string | undefined): string | false =>
  active ? className ?? "is-active" : false;

export const naivePopselectRootClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "class">
): string => fallbackClass(props.class, "naive-popselect");

export const naivePopselectTriggerClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "triggerClass" | "triggerOpenClass">,
  open: boolean
): string =>
  joinClassNames(
    fallbackClass(props.triggerClass, "naive-popselect-trigger"),
    open ? props.triggerOpenClass ?? "is-open" : false
  );

export const naivePopselectPopoverClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "popoverClass">,
  open: boolean
): string =>
  joinClassNames(
    "n-popselect-menu",
    "n-base-select-menu",
    fallbackClass(props.popoverClass, "naive-popselect-popover"),
    open ? "is-open" : "is-closing",
    "is-naive-popselect-transition"
  );

export const naivePopselectOptionClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "optionClass" | "optionActiveClass">,
  active: boolean
): string =>
  joinClassNames(
    "n-base-select-option",
    "n-base-select-option--show-checkmark",
    fallbackClass(props.optionClass, "naive-popselect-option"),
    activeClass(active, "n-base-select-option--selected"),
    activeClass(active, props.optionActiveClass)
  );

export const naivePopselectOptionContentClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "optionContentClass">
): string => fallbackClass(props.optionContentClass, "naive-popselect-option-content");

export const naivePopselectOptionCheckClass = <TValue extends string>(
  props: Pick<NaivePopselectProps<TValue>, "optionCheckClass">
): string => fallbackClass(props.optionCheckClass, "naive-popselect-option-check");
