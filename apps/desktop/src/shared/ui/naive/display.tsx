import { Show, type JSX } from "solid-js";
import { joinClassNames, toCssLength } from "./utils";

interface NaiveClassProps {
  class?: string;
}

export interface NaiveTextProps extends NaiveClassProps {
  children: JSX.Element;
  depth?: 1 | 2 | 3;
  title?: string;
}

export interface NaiveEllipsisProps extends NaiveClassProps {
  children: JSX.Element;
  title?: string;
}

export interface NaiveAvatarProps extends NaiveClassProps {
  alt?: string;
  ariaHidden?: boolean;
  children?: JSX.Element;
  fallback?: JSX.Element;
  lazy?: boolean;
  src?: string | null;
}

export interface NaiveBadgeProps extends NaiveClassProps {
  ariaLabel?: string;
  children: JSX.Element;
}

export type NaiveTagTone = "default" | "primary" | "info" | "warning" | "error" | "muted";

export interface NaiveTagProps extends NaiveClassProps {
  ariaLabel?: string;
  children: JSX.Element;
  icon?: boolean;
  title?: string;
  tone?: NaiveTagTone;
}

export interface NaiveSkeletonProps extends NaiveClassProps {
  shape?: "rect" | "circle" | "text";
  width?: string | number;
  height?: string | number;
}

export interface NaiveEmptyProps extends NaiveClassProps {
  children?: JSX.Element;
  description: string;
  icon?: JSX.Element;
  size?: "sm" | "md" | "lg";
}

export interface NaiveDividerProps extends NaiveClassProps {
  vertical?: boolean;
}

export type NaiveAlertType = "default" | "info" | "success" | "warning" | "error";

export interface NaiveAlertProps extends NaiveClassProps {
  children: JSX.Element;
  title?: string;
  type?: NaiveAlertType;
}

const textDepthClass = (depth: NaiveTextProps["depth"] | undefined): string =>
  depth ? ` naive-text--depth-${depth}` : "";

const emptySizeClass = (size: NaiveEmptyProps["size"] | undefined): string | false => {
  if (size === "sm") return "naive-empty--sm empty-state--sm";
  if (size === "lg") return "naive-empty--lg empty-state--lg";
  return false;
};

function NaiveEmptyIllustration(): JSX.Element {
  return (
    <svg
      class="naive-empty-illustration empty-state-illustration"
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M18 42L29 22h38l11 20" stroke-width="3" opacity="0.55" />
      <path d="M18 42v26a6 6 0 0 0 6 6h48a6 6 0 0 0 6-6V42" stroke-width="3" />
      <path
        d="M18 42h18l4 8h16l4-8h18"
        stroke-width="3"
        fill="currentColor"
        fill-opacity="0.06"
      />
      <circle cx="38" cy="34" r="2" fill="currentColor" opacity="0.45" />
      <circle cx="58" cy="34" r="2" fill="currentColor" opacity="0.45" />
    </svg>
  );
}

export function NaiveText(props: NaiveTextProps): JSX.Element {
  return (
    <span
      class={`${joinClassNames("naive-text", props.class)}${textDepthClass(props.depth)}`}
      title={props.title}
    >
      {props.children}
    </span>
  );
}

export function NaiveEllipsis(props: NaiveEllipsisProps): JSX.Element {
  return (
    <span class={joinClassNames("naive-ellipsis", props.class)} title={props.title}>
      {props.children}
    </span>
  );
}

export function NaiveAvatar(props: NaiveAvatarProps): JSX.Element {
  const fallback = () => props.fallback ?? null;
  const content = (): JSX.Element => {
    if (props.children) return props.children;
    if (props.src) {
      return (
        <img
          class="naive-avatar-image"
          src={props.src}
          alt={props.alt ?? ""}
          loading={props.lazy ? "lazy" : "eager"}
          draggable={false}
        />
      );
    }
    return fallback();
  };

  return (
    <span class={joinClassNames("naive-avatar", props.class)} aria-hidden={props.ariaHidden}>
      {content()}
    </span>
  );
}

export function NaiveBadge(props: NaiveBadgeProps): JSX.Element {
  return (
    <span class={joinClassNames("naive-badge", props.class)} aria-label={props.ariaLabel}>
      {props.children}
    </span>
  );
}

export function NaiveDivider(props: NaiveDividerProps): JSX.Element {
  return (
    <div
      class={joinClassNames(
        "naive-divider",
        props.vertical ? "naive-divider--vertical" : false,
        props.class
      )}
      role="separator"
      aria-hidden="true"
    />
  );
}

export function NaiveAlert(props: NaiveAlertProps): JSX.Element {
  const type = () => props.type ?? "default";
  return (
    <section
      class={joinClassNames("naive-alert", `naive-alert--${type()}`, props.class)}
      role="alert"
    >
      <Show when={props.title}>
        {(title) => <strong class="naive-alert-title">{title()}</strong>}
      </Show>
      <div class="naive-alert-content">{props.children}</div>
    </section>
  );
}

export function NaiveTag(props: NaiveTagProps): JSX.Element {
  const toneClass = () => (props.tone ? `naive-tag--${props.tone}` : "naive-tag--default");
  return (
    <span
      class={joinClassNames(
        "naive-tag",
        toneClass(),
        props.icon ? "naive-tag--icon" : false,
        props.class
      )}
      aria-label={props.ariaLabel}
      title={props.title}
    >
      {props.children}
    </span>
  );
}

export function NaiveSkeleton(props: NaiveSkeletonProps): JSX.Element {
  return (
    <span
      class={joinClassNames(
        "naive-skeleton",
        "skeleton",
        props.shape === "circle" ? "skeleton--circle" : false,
        props.shape === "circle" ? "naive-skeleton--circle" : false,
        props.shape === "text" ? "skeleton--text" : false,
        props.shape === "text" ? "naive-skeleton--text" : false,
        props.class
      )}
      style={{
        width: toCssLength(props.width),
        height: toCssLength(props.height)
      }}
      aria-hidden="true"
    />
  );
}

export function NaiveEmpty(props: NaiveEmptyProps): JSX.Element {
  return (
    <div
      class={joinClassNames("naive-empty", "empty-state", emptySizeClass(props.size), props.class)}
      role="status"
    >
      <Show when={props.icon} fallback={<NaiveEmptyIllustration />}>
        {(node) => (
          <div class="naive-empty-illustration-wrap empty-state-illustration-wrap">
            {node()}
          </div>
        )}
      </Show>
      <span class="naive-empty-text empty-state-text">{props.description}</span>
      {props.children}
    </div>
  );
}
