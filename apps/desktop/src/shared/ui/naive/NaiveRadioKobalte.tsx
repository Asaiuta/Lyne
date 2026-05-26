import { RadioGroup as KobalteRadioGroup } from "@kobalte/core/radio-group";
import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import type { NaiveRadioButtonProps, NaiveRadioGroupProps, NaiveRadioProps } from "./radio";
import {
  NaiveRadioGroupContext,
  createNaiveRadioGroupContext,
  naiveRadioButtonClass,
  naiveRadioClass,
  naiveRadioGroupClass,
  naiveRadioHasLabel,
  naiveRadioItemValue,
  naiveRadioSplitorClass,
  useNaiveRadioGroup
} from "./radio";
import { naiveSelectionValueKey } from "./selection-logic";
import { joinClassNames } from "./utils";

export function NaiveRadioGroupKobalte(props: NaiveRadioGroupProps): JSX.Element {
  const [localValue, setLocalValue] = createSignal<string | undefined>(
    props.defaultValue == null ? undefined : naiveSelectionValueKey(props.defaultValue)
  );
  const valueKey = () =>
    props.value == null ? localValue() : naiveSelectionValueKey(props.value);
  const context = createNaiveRadioGroupContext({
    valueKey,
    disabled: () => props.disabled,
    size: () => props.size,
    name: props.name
  });

  const handleChange = (key: string): void => {
    setLocalValue(key);
    props.onUpdateValue?.(context.resolveValue(key));
  };

  return (
    <NaiveRadioGroupContext.Provider value={context}>
      <KobalteRadioGroup
        id={props.id}
        class={naiveRadioGroupClass(props, context.buttonGroup())}
        value={valueKey()}
        onChange={handleChange}
        name={context.name()}
        disabled={props.disabled}
        orientation={props.orientation}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
      >
        {props.children}
      </KobalteRadioGroup>
    </NaiveRadioGroupContext.Provider>
  );
}

function NaiveStandaloneRadio(props: NaiveRadioProps): JSX.Element {
  const [checked, setChecked] = createSignal<boolean>(props.defaultChecked ?? false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const currentChecked = () => props.checked ?? checked();
  const disabled = () => props.disabled ?? false;

  const handleChange = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement) || !target.checked) return;
    setChecked(true);
    props.onUpdateChecked?.(true);
  };

  return (
    <label
      class={naiveRadioClass(props, {
        checked: currentChecked(),
        disabled: disabled(),
        focused: focused(),
        size: props.size ?? "medium"
      })}
      title={props.title}
    >
      <span class="n-radio__dot-wrapper" aria-hidden="true">
        <span class={joinClassNames("n-radio__dot", currentChecked() ? "n-radio__dot--checked" : false)}>
          <span class="n-radio__dot-background" />
        </span>
      </span>
      <input
        id={props.id}
        class="n-radio-input"
        type="radio"
        value={String(naiveRadioItemValue(props))}
        name={props.name}
        checked={currentChecked()}
        disabled={disabled()}
        required={props.required}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-describedby={props.ariaDescribedBy}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Show when={naiveRadioHasLabel(props)}>
        <span class="n-radio__label">{props.label ?? props.children}</span>
      </Show>
    </label>
  );
}

export function NaiveRadioKobalte(props: NaiveRadioProps): JSX.Element {
  const group = useNaiveRadioGroup();
  const [focused, setFocused] = createSignal<boolean>(false);

  if (!group) return <NaiveStandaloneRadio {...props} />;

  const itemValue = () => naiveRadioItemValue(props);
  const key = () => naiveSelectionValueKey(itemValue());
  const checked = () => group.valueKey() === key();
  const disabled = () => props.disabled ?? group.disabled() ?? false;
  const size = () => props.size ?? group.size() ?? "medium";

  createEffect(() => group.registerValue(itemValue()));

  return (
    <KobalteRadioGroup.Item
      id={props.id}
      value={key()}
      disabled={disabled()}
      class={naiveRadioClass(props, {
        checked: checked(),
        disabled: disabled(),
        focused: focused(),
        size: size()
      })}
      title={props.title}
    >
      <span class="n-radio__dot-wrapper" aria-hidden="true">
        <KobalteRadioGroup.ItemControl
          class={joinClassNames("n-radio__dot", checked() ? "n-radio__dot--checked" : false)}
        >
          <KobalteRadioGroup.ItemIndicator class="n-radio__dot-background" />
        </KobalteRadioGroup.ItemControl>
        <KobalteRadioGroup.ItemInput
          class="n-radio-input"
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledBy}
          aria-describedby={props.ariaDescribedBy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </span>
      <Show when={naiveRadioHasLabel(props)}>
        <KobalteRadioGroup.ItemLabel class="n-radio__label">
          {props.label ?? props.children}
        </KobalteRadioGroup.ItemLabel>
      </Show>
    </KobalteRadioGroup.Item>
  );
}

export function NaiveRadioButtonKobalte(props: NaiveRadioButtonProps): JSX.Element {
  const group = useNaiveRadioGroup();
  const [focused, setFocused] = createSignal<boolean>(false);

  if (!group) return <NaiveStandaloneRadio {...props} />;

  const itemValue = () => naiveRadioItemValue(props);
  const key = () => naiveSelectionValueKey(itemValue());
  const checked = () => group.valueKey() === key();
  const disabled = () => props.disabled ?? group.disabled() ?? false;
  const size = () => props.size ?? group.size() ?? "medium";
  const state = createMemo(() => ({ checked: checked(), disabled: disabled() }));
  const buttonIndex = group.registerButton(state);
  onCleanup(() => group.unregisterButton(buttonIndex));
  createEffect(() => group.registerValue(itemValue()));

  return (
    <>
      <Show when={buttonIndex > 0}>
        <span class={naiveRadioSplitorClass(group.splitorState(buttonIndex, state()))} />
      </Show>
      <KobalteRadioGroup.Item
        id={props.id}
        value={key()}
        disabled={disabled()}
        class={naiveRadioButtonClass(props, {
          checked: checked(),
          disabled: disabled(),
          focused: focused(),
          size: size()
        })}
        title={props.title}
      >
        <KobalteRadioGroup.ItemInput
          class="n-radio-input"
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledBy}
          aria-describedby={props.ariaDescribedBy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <span class="n-radio-button__state-border" aria-hidden="true" />
        <Show when={naiveRadioHasLabel(props)}>
          <KobalteRadioGroup.ItemLabel class="n-radio__label">
            {props.label ?? props.children}
          </KobalteRadioGroup.ItemLabel>
        </Show>
      </KobalteRadioGroup.Item>
    </>
  );
}
