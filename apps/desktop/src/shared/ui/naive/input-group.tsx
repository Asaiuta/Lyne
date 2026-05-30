import { type JSX } from "solid-js";
import {
  naiveInputGroupClass,
  naiveInputGroupLabelClass,
  naiveInputGroupLabelStyle,
  type NaiveInputGroupSize
} from "./input-group-logic";

export type { NaiveInputGroupSize };

export interface NaiveInputGroupProps {
  children: JSX.Element;
  ariaLabel?: string;
  class?: string;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  style?: JSX.CSSProperties;
}

export interface NaiveInputGroupLabelProps {
  children: JSX.Element;
  bordered?: boolean;
  class?: string;
  size?: NaiveInputGroupSize;
  style?: JSX.CSSProperties;
}

export function NaiveInputGroup(props: NaiveInputGroupProps): JSX.Element {
  return (
    <div
      class={naiveInputGroupClass(props.class)}
      role={props.role}
      aria-label={props.ariaLabel}
      style={props.style}
    >
      {props.children}
    </div>
  );
}

export function NaiveInputGroupLabel(props: NaiveInputGroupLabelProps): JSX.Element {
  return (
    <div
      class={naiveInputGroupLabelClass(props.class)}
      style={naiveInputGroupLabelStyle(props.size, props.style)}
    >
      {props.children}
      {(props.bordered ?? true) ? <div class="n-input-group-label__border" /> : null}
    </div>
  );
}
