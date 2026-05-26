import { Checkbox as KobalteCheckbox } from "@kobalte/core/checkbox";
import { Show, createSignal, type JSX } from "solid-js";
import type { NaiveCheckboxProps } from "./checkbox";
import {
  naiveCheckboxClass,
  naiveCheckboxHasLabel,
  naiveCheckboxItemValue,
  useNaiveCheckboxGroup
} from "./checkbox";

export function NaiveCheckboxKobalte(props: NaiveCheckboxProps): JSX.Element {
  const group = useNaiveCheckboxGroup();
  const [focused, setFocused] = createSignal<boolean>(false);
  const [localChecked, setLocalChecked] = createSignal<boolean>(props.defaultChecked ?? false);

  const itemValue = () => naiveCheckboxItemValue(props);
  const checked = () =>
    group ? group.isChecked(itemValue()) : props.checked ?? localChecked();
  const disabled = () =>
    group ? group.isDisabled(itemValue(), props.disabled) : props.disabled ?? false;
  const size = () => props.size ?? group?.size() ?? "medium";
  const indeterminate = () => props.indeterminate ?? false;

  const handleChange = (nextChecked: boolean): void => {
    if (group) {
      group.toggle(itemValue(), nextChecked);
      return;
    }
    setLocalChecked(nextChecked);
    props.onUpdateChecked?.(nextChecked);
  };

  return (
    <KobalteCheckbox
      id={props.id}
      name={props.name}
      value={String(itemValue())}
      checked={checked()}
      onChange={handleChange}
      indeterminate={indeterminate()}
      disabled={disabled()}
      required={props.required}
      class={naiveCheckboxClass(props, {
        checked: checked(),
        indeterminate: indeterminate(),
        disabled: disabled(),
        focused: focused(),
        size: size()
      })}
      title={props.title}
    >
      <KobalteCheckbox.Input
        class="n-checkbox-input"
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-describedby={props.ariaDescribedBy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <span class="n-checkbox-box-wrapper" aria-hidden="true">
        <KobalteCheckbox.Control class="n-checkbox-box">
          <span class="n-checkbox-icon">
            <span class="check-icon" />
            <span class="line-icon" />
          </span>
          <span class="n-checkbox-box__border" />
        </KobalteCheckbox.Control>
      </span>
      <Show when={naiveCheckboxHasLabel(props)}>
        <KobalteCheckbox.Label class="n-checkbox__label">
          {props.label ?? props.children}
        </KobalteCheckbox.Label>
      </Show>
    </KobalteCheckbox>
  );
}
