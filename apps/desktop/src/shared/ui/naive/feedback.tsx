import { Show, type JSX } from "solid-js";
import { joinClassNames, toCssLength } from "./utils";

export type NaiveResultStatus = "info" | "success" | "warning" | "error" | "403" | "404" | "500";
export type NaiveProgressStatus = "default" | "success" | "warning" | "error";

interface NaiveClassProps {
  class?: string;
}

export interface NaiveAnchorProps extends NaiveClassProps {
  children: JSX.Element;
  href?: string;
  target?: JSX.AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  rel?: string;
  title?: string;
  onClick?: JSX.EventHandlerUnion<HTMLAnchorElement, MouseEvent>;
}

export interface NaiveSpinProps extends NaiveClassProps {
  ariaHidden?: boolean;
  children?: JSX.Element;
  description?: JSX.Element;
  show?: boolean;
  size?: string | number;
}

export interface NaiveProgressProps extends NaiveClassProps {
  children?: JSX.Element;
  percentage: number;
  showIndicator?: boolean;
  status?: NaiveProgressStatus;
}

export interface NaiveResultProps extends NaiveClassProps {
  description?: JSX.Element;
  footer?: JSX.Element;
  status?: NaiveResultStatus;
  title: JSX.Element;
}

const clampPercentage = (value: number): number => Math.min(100, Math.max(0, value));

const defaultRel = (
  target: JSX.AnchorHTMLAttributes<HTMLAnchorElement>["target"],
  rel: string | undefined
): string | undefined => {
  if (rel) return rel;
  return target === "_blank" ? "noopener noreferrer" : undefined;
};

export function NaiveAnchor(props: NaiveAnchorProps): JSX.Element {
  return (
    <a
      class={joinClassNames("naive-anchor", props.class)}
      href={props.href}
      target={props.target}
      rel={defaultRel(props.target, props.rel)}
      title={props.title}
      onClick={props.onClick}
    >
      {props.children}
    </a>
  );
}

export function NaiveSpin(props: NaiveSpinProps): JSX.Element {
  const show = () => props.show ?? true;
  return (
    <span
      class={joinClassNames("naive-spin", props.class)}
      aria-busy={props.ariaHidden ? undefined : show()}
      aria-hidden={props.ariaHidden}
    >
      <Show when={show()}>
        <span
          class="naive-spin-indicator"
          style={{ width: toCssLength(props.size), height: toCssLength(props.size) }}
          aria-hidden="true"
        />
      </Show>
      <Show when={props.description}>
        {(description) => <span class="naive-spin-description">{description()}</span>}
      </Show>
      {props.children}
    </span>
  );
}

export function NaiveProgress(props: NaiveProgressProps): JSX.Element {
  const value = () => clampPercentage(props.percentage);
  const showIndicator = () => props.showIndicator ?? true;
  const status = () => props.status ?? "default";
  return (
    <span
      class={joinClassNames("naive-progress", `naive-progress--${status()}`, props.class)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value())}
    >
      <span class="naive-progress-rail" aria-hidden="true">
        <span class="naive-progress-fill" style={{ width: `${value()}%` }} />
      </span>
      <Show when={showIndicator()}>
        <span class="naive-progress-indicator">{props.children ?? `${Math.round(value())}%`}</span>
      </Show>
    </span>
  );
}

export function NaiveResult(props: NaiveResultProps): JSX.Element {
  const status = () => props.status ?? "info";
  return (
    <section class={joinClassNames("naive-result", `naive-result--${status()}`, props.class)}>
      <div class="naive-result-icon" aria-hidden="true">
        {status()}
      </div>
      <strong class="naive-result-title">{props.title}</strong>
      <Show when={props.description}>
        {(description) => <span class="naive-result-description">{description()}</span>}
      </Show>
      <Show when={props.footer}>
        {(footer) => <div class="naive-result-footer">{footer()}</div>}
      </Show>
    </section>
  );
}
