import { Show, type JSX } from "solid-js";
import type {
  NaiveSelectOption,
  NaiveSelectProps,
  NaiveSelectRenderState,
  NaiveSelectValue
} from "./select";
import { joinClassNames } from "./utils";

export const naiveSelectSelectedOption = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): NaiveSelectOption<TValue> | null =>
  props.options.find((option) => option.value === props.value) ?? null;

export const naiveSelectDisplayLabel = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): string => {
  const selected = naiveSelectSelectedOption(props);
  if (selected) return selected.label;
  return props.value == null ? props.placeholder ?? "" : String(props.value);
};

export const naiveSelectRootClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): string => joinClassNames("naive-select-root", props.rootClass);

export const naiveSelectClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): string =>
  joinClassNames(
    "naive-select",
    "n-select",
    props.size ? `naive-select--${props.size}` : false,
    props.class
  );

export const naiveBaseSelectionClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>,
  state: NaiveSelectRenderState
): string =>
  joinClassNames(
    "n-base-selection",
    props.status ? `n-base-selection--${props.status}-status` : false,
    state.open ? "n-base-selection--active" : false,
    state.focused ? "n-base-selection--focus" : false,
    props.disabled ? "n-base-selection--disabled" : false,
    props.value != null || state.open ? "n-base-selection--selected" : false
  );

export const naiveSelectMenuClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): string =>
  joinClassNames(
    "naive-select-menu",
    "n-select-menu",
    "n-base-select-menu",
    props.size ? `naive-select-menu--${props.size}` : false,
    props.menuClass
  );

export const naiveSelectOptionClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>,
  option: NaiveSelectOption<TValue>,
  selected: boolean
): string =>
  joinClassNames(
    "n-base-select-option",
    option.disabled ? "n-base-select-option--disabled" : false,
    selected ? "n-base-select-option--selected" : false,
    "n-base-select-option--show-checkmark",
    props.optionClass,
    option.class
  );

export function NaiveSelectShell<TValue extends NaiveSelectValue>(props: {
  selectProps: NaiveSelectProps<TValue>;
  state: NaiveSelectRenderState;
  children: JSX.Element;
}): JSX.Element {
  const selectProps = () => props.selectProps;
  const isBordered = () => selectProps().bordered ?? true;

  return (
    <div class={naiveSelectClass(selectProps())}>
      <div class={naiveBaseSelectionClass(selectProps(), props.state)}>
        {props.children}
        <Show when={isBordered()}>
          <div class="n-base-selection__border" />
          <div class="n-base-selection__state-border" />
        </Show>
      </div>
    </div>
  );
}
