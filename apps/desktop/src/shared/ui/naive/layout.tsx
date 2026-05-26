import { Show, type JSX } from "solid-js";
import { joinClassNames, toCssLength } from "./utils";

export type NaiveFlexAlign = "start" | "center" | "end" | "stretch" | "baseline";
export type NaiveFlexJustify = "start" | "center" | "end" | "between" | "around" | "evenly";

export interface NaiveFlexProps {
  children: JSX.Element;
  align?: NaiveFlexAlign;
  ariaHidden?: boolean;
  class?: string;
  gap?: string | number;
  justify?: NaiveFlexJustify;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  vertical?: boolean;
  wrap?: boolean;
}

export interface NaiveCardProps {
  children: JSX.Element;
  ariaLabel?: string;
  bordered?: boolean;
  class?: string;
  embedded?: boolean;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  title?: JSX.Element;
}

const stateClass = (condition: boolean | undefined, className: string): string | false =>
  condition ? className : false;

export function NaiveFlex(props: NaiveFlexProps): JSX.Element {
  return (
    <div
      class={joinClassNames(
        "naive-flex",
        stateClass(props.vertical, "naive-flex--vertical"),
        stateClass(props.wrap, "naive-flex--wrap"),
        props.align ? `naive-flex--align-${props.align}` : false,
        props.justify ? `naive-flex--justify-${props.justify}` : false,
        props.class
      )}
      style={{ gap: toCssLength(props.gap) }}
      role={props.role}
      aria-hidden={props.ariaHidden}
    >
      {props.children}
    </div>
  );
}

export function NaiveCard(props: NaiveCardProps): JSX.Element {
  return (
    <div
      class={joinClassNames(
        "naive-card",
        stateClass(props.bordered, "is-bordered"),
        stateClass(props.embedded, "is-embedded"),
        props.class
      )}
      role={props.role}
      aria-label={props.ariaLabel}
    >
      <Show when={props.title}>
        {(title) => <div class="naive-card-header">{title()}</div>}
      </Show>
      <div class="naive-card-content">{props.children}</div>
    </div>
  );
}
