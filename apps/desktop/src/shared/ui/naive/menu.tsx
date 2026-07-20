import { For, Show, type JSX } from "solid-js";
import { joinClassNames } from "./utils";

export interface NaiveMenuItem<TValue extends string = string> {
  key: TValue;
  label: JSX.Element;
  textValue: string;
  icon?: JSX.Element;
  disabled?: boolean;
  class?: string;
}

export interface NaiveMenuProps<TValue extends string = string> {
  value: TValue;
  items: ReadonlyArray<NaiveMenuItem<TValue>>;
  onSelect: (value: TValue) => void;
  orientation?: "horizontal" | "vertical";
  ariaLabel?: string;
  class?: string;
  itemClass?: string;
  itemActiveClass?: string;
  itemIconClass?: string;
  itemLabelClass?: string;
}

export const findNextEnabledMenuIndex = (
  items: ReadonlyArray<Pick<NaiveMenuItem, "disabled">>,
  currentIndex: number,
  direction: 1 | -1
): number => {
  if (items.length === 0) return -1;
  let nextIndex = currentIndex;
  for (let step = 0; step < items.length; step += 1) {
    nextIndex = (nextIndex + direction + items.length) % items.length;
    if (!items[nextIndex]?.disabled) return nextIndex;
  }
  return -1;
};

export function NaiveMenu<TValue extends string>(
  props: NaiveMenuProps<TValue>
): JSX.Element {
  const itemElements: Array<HTMLButtonElement | undefined> = [];
  const orientation = () => props.orientation ?? "vertical";
  const activeIndex = () => {
    const index = props.items.findIndex((item) => item.key === props.value);
    return index >= 0 ? index : props.items.findIndex((item) => !item.disabled);
  };
  const focusIndex = (index: number): void => {
    if (index >= 0) itemElements[index]?.focus();
  };
  const focusBoundary = (fromEnd: boolean): void => {
    const items = fromEnd ? [...props.items].reverse() : props.items;
    const offset = items.findIndex((item) => !item.disabled);
    if (offset < 0) return;
    focusIndex(fromEnd ? props.items.length - 1 - offset : offset);
  };
  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    const nextKey = orientation() === "vertical" ? "ArrowDown" : "ArrowRight";
    const previousKey = orientation() === "vertical" ? "ArrowUp" : "ArrowLeft";
    if (event.key === nextKey || event.key === previousKey) {
      event.preventDefault();
      focusIndex(
        findNextEnabledMenuIndex(props.items, index, event.key === nextKey ? 1 : -1)
      );
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusBoundary(event.key === "End");
    }
  };

  return (
    <ul
      class={joinClassNames("naive-menu", "n-menu", props.class)}
      role="menu"
      aria-label={props.ariaLabel}
      aria-orientation={orientation()}
    >
      <For each={props.items}>
        {(item, index) => {
          const active = () => item.key === props.value;
          return (
            <li class="n-menu-item" role="none">
              <button
                ref={(element) => {
                  itemElements[index()] = element;
                }}
                type="button"
                role="menuitemradio"
                data-key={item.key}
                data-disabled={item.disabled ? "true" : undefined}
                aria-checked={active()}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                tabIndex={index() === activeIndex() ? 0 : -1}
                class={joinClassNames(
                  "n-menu-item-content",
                  active() ? "n-menu-item-content--selected" : false,
                  props.itemClass,
                  item.class,
                  active() ? props.itemActiveClass : undefined
                )}
                onClick={() => {
                  if (!item.disabled) props.onSelect(item.key);
                }}
                onKeyDown={(event) => handleKeyDown(index(), event)}
              >
                <Show when={item.icon != null}>
                  <span
                    class={joinClassNames(
                      "n-menu-item-content__icon",
                      props.itemIconClass
                    )}
                    aria-hidden="true"
                  >
                    {item.icon}
                  </span>
                </Show>
                <span
                  class={joinClassNames(
                    "n-menu-item-content-header",
                    props.itemLabelClass
                  )}
                >
                  {item.label}
                </span>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
