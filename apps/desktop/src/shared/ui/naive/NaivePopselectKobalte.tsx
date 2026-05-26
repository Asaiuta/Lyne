import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { NaivePopselectOption, NaivePopselectProps } from "./popselect";
import { joinClassNames } from "./utils";

const fallbackClass = (className: string | undefined, fallback: string): string =>
  className ?? fallback;

const activeClass = (active: boolean, className: string | undefined): string | false =>
  active ? className ?? "is-active" : false;

interface NaivePopselectOptionProps<TValue extends string> {
  option: NaivePopselectOption<TValue>;
  active: boolean;
  optionClass?: string;
  optionActiveClass?: string;
  optionContentClass?: string;
  optionCheckClass?: string;
  renderCheck?: (option: NaivePopselectOption<TValue>) => JSX.Element;
}

function NaivePopselectRadioOption<TValue extends string>(
  props: NaivePopselectOptionProps<TValue>
): JSX.Element {
  const optionClass = () =>
    joinClassNames(
      fallbackClass(props.optionClass, "naive-popselect-option"),
      activeClass(props.active, props.optionActiveClass)
    );
  const optionContentClass = () =>
    fallbackClass(props.optionContentClass, "naive-popselect-option-content");
  const optionCheckClass = () =>
    fallbackClass(props.optionCheckClass, "naive-popselect-option-check");

  return (
    <DropdownMenu.RadioItem
      value={props.option.value}
      closeOnSelect
      textValue={props.option.label}
      class={optionClass()}
    >
      <span class={optionContentClass()}>{props.option.label}</span>
      <Show when={props.active && props.renderCheck}>
        <span class={optionCheckClass()} aria-hidden="true">
          {props.renderCheck?.(props.option)}
        </span>
      </Show>
    </DropdownMenu.RadioItem>
  );
}

export function NaivePopselectKobalte<TValue extends string>(
  props: NaivePopselectProps<TValue>
): JSX.Element {
  const rootClass = () => fallbackClass(props.class, "naive-popselect");
  const triggerClass = () =>
    joinClassNames(
      fallbackClass(props.triggerClass, "naive-popselect-trigger"),
      props.open ? props.triggerOpenClass ?? "is-open" : false
    );
  const popoverClass = () => fallbackClass(props.popoverClass, "naive-popselect-popover");
  const stopPropagationIfNeeded = (event: Event): void => {
    if (props.stopTriggerPropagation) event.stopPropagation();
  };

  return (
    <DropdownMenu
      open={props.open}
      onOpenChange={props.onOpenChange}
      placement={props.placement ?? "bottom"}
      gutter={props.gutter ?? 10}
      modal={false}
      preventScroll={false}
    >
      <div class={rootClass()}>
        <DropdownMenu.Trigger
          type="button"
          class={triggerClass()}
          aria-label={props.label}
          title={props.label}
          data-naive-popselect-trigger
          onPointerDown={stopPropagationIfNeeded}
          onClick={stopPropagationIfNeeded}
        >
          {props.triggerContent}
        </DropdownMenu.Trigger>
      </div>
      <Show when={props.open && typeof document !== "undefined"}>
        <DropdownMenu.Portal mount={document.body}>
          <DropdownMenu.Content class={popoverClass()} aria-label={props.label}>
            <DropdownMenu.RadioGroup
              value={props.value}
              onChange={(value) => props.onChange(value as TValue)}
            >
              <For each={props.options}>
                {(option) => (
                  <NaivePopselectRadioOption
                    option={option}
                    active={props.value === option.value}
                    optionClass={props.optionClass}
                    optionActiveClass={props.optionActiveClass}
                    optionContentClass={props.optionContentClass}
                    optionCheckClass={props.optionCheckClass}
                    renderCheck={props.renderCheck}
                  />
                )}
              </For>
            </DropdownMenu.RadioGroup>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </Show>
    </DropdownMenu>
  );
}
