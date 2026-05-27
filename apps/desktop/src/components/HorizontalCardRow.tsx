import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { NaiveH2 } from "../shared/ui/naive";
import { IconChevronRight } from "./icons";

interface HorizontalCardRowProps {
  title: string;
  subtitle?: string | null;
  action?: JSX.Element;
  children: JSX.Element;
  class?: string;
  onTitleClick?: () => void;
}

export function HorizontalCardRow(props: HorizontalCardRowProps) {
  return (
    <section class={`card-row${props.class ? ` ${props.class}` : ""}`}>
      <header class="card-row-head">
        <div
          class={`card-row-copy${props.onTitleClick ? " card-row-copy--clickable" : ""}`}
          onClick={() => props.onTitleClick?.()}
          role={props.onTitleClick ? "button" : undefined}
          tabIndex={props.onTitleClick ? 0 : undefined}
          onKeyDown={(e) => {
            if (props.onTitleClick && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              props.onTitleClick();
            }
          }}
        >
          <NaiveH2 class="card-row-title">{props.title}</NaiveH2>
          <Show when={props.onTitleClick}>
            <IconChevronRight class="card-row-title-arrow" />
          </Show>
          <Show when={props.subtitle}>
            <span class="card-row-subtitle">{props.subtitle}</span>
          </Show>
        </div>
        <Show when={props.action}>
          <div class="card-row-action">{props.action}</div>
        </Show>
      </header>
      <div class="card-row-grid" role="list">
        {props.children}
      </div>
    </section>
  );
}
