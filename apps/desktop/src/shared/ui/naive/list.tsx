import { Show, type JSX } from "solid-js";
import { joinClassNames } from "./utils";

export interface NaiveListProps {
  children: JSX.Element;
  ariaLabel?: string;
  bordered?: boolean;
  class?: string;
  clickable?: boolean;
  hoverable?: boolean;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
}

export interface NaiveListItemProps {
  children: JSX.Element;
  class?: string;
  disabled?: boolean;
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
  title?: string;
}

export interface NaiveThingProps {
  title: JSX.Element;
  children?: JSX.Element;
  class?: string;
  description?: JSX.Element;
  descriptionClass?: string;
  titleClass?: string;
}

const stateClass = (condition: boolean | undefined, className: string): string | false =>
  condition ? className : false;

function NaiveListItemContent(props: NaiveListItemProps): JSX.Element {
  return (
    <>
      <Show when={props.prefix}>
        {(prefix) => <span class="naive-list-item-prefix">{prefix()}</span>}
      </Show>
      <span class="naive-list-item-main">{props.children}</span>
      <Show when={props.suffix}>
        {(suffix) => <span class="naive-list-item-suffix">{suffix()}</span>}
      </Show>
    </>
  );
}

export function NaiveList(props: NaiveListProps): JSX.Element {
  return (
    <div
      class={joinClassNames(
        "naive-list",
        stateClass(props.bordered, "is-bordered"),
        stateClass(props.clickable, "is-clickable"),
        stateClass(props.hoverable, "is-hoverable"),
        props.class
      )}
      role={props.role}
      aria-label={props.ariaLabel}
    >
      {props.children}
    </div>
  );
}

export function NaiveListItem(props: NaiveListItemProps): JSX.Element {
  const className = () => joinClassNames("naive-list-item", props.class);
  if (props.onClick) {
    return (
      <button
        type="button"
        class={className()}
        title={props.title}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        <NaiveListItemContent {...props} />
      </button>
    );
  }
  return (
    <div class={className()} title={props.title} aria-disabled={props.disabled}>
      <NaiveListItemContent {...props} />
    </div>
  );
}

export function NaiveThing(props: NaiveThingProps): JSX.Element {
  const hasDescription = () => props.description !== undefined && props.description !== null;
  return (
    <span class={joinClassNames("naive-thing", props.class)}>
      <span class={joinClassNames("naive-thing-title", props.titleClass)}>{props.title}</span>
      <Show when={hasDescription()}>
        <span class={joinClassNames("naive-thing-description", props.descriptionClass)}>
          {props.description}
        </span>
      </Show>
      {props.children}
    </span>
  );
}
