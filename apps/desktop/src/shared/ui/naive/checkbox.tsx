import {
  Show,
  createMemo,
  createSignal,
  onMount,
  type JSX
} from "solid-js";
import {
  isNaiveCheckboxDisabledByQuota,
  naiveSelectionValueKey,
  toggleNaiveCheckboxValues,
  type NaiveSelectionValue
} from "./selection-logic";
import {
  NaiveCheckboxGroupContext,
  naiveCheckboxClass,
  naiveCheckboxHasLabel,
  type NaiveCheckboxComponent,
  type NaiveCheckboxGroupContextValue,
  type NaiveCheckboxGroupProps,
  type NaiveCheckboxProps
} from "./checkbox.shared";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export * from "./checkbox.shared";

const lazyNaiveCheckbox = createLazyNaive<NaiveCheckboxComponent>(() =>
  import("./NaiveCheckboxKobalte").then(
    (module) => module.NaiveCheckboxKobalte as NaiveCheckboxComponent
  )
);

export function NaiveCheckboxGroup(props: NaiveCheckboxGroupProps): JSX.Element {
  const [localValues, setLocalValues] = createSignal<readonly NaiveSelectionValue[]>(
    props.defaultValue ?? []
  );
  const values = () => props.value ?? localValues();
  const valueKeys = createMemo(() => new Set(values().map(naiveSelectionValueKey)));
  const isChecked = (value: NaiveSelectionValue): boolean =>
    valueKeys().has(naiveSelectionValueKey(value));

  const context: NaiveCheckboxGroupContextValue = {
    values,
    valueKeys,
    disabled: () => props.disabled,
    size: () => props.size,
    min: () => props.min,
    max: () => props.max,
    isChecked,
    isDisabled: (value, ownDisabled) =>
      isNaiveCheckboxDisabledByQuota(
        values(),
        value,
        isChecked(value),
        ownDisabled,
        props.disabled,
        { min: props.min, max: props.max }
      ),
    toggle: (value, checked) => {
      const result = toggleNaiveCheckboxValues(values(), value, checked, {
        min: props.min,
        max: props.max
      });
      if (!result.changed) return;
      setLocalValues(result.values);
      props.onUpdateValue?.(result.values, { actionType: result.actionType, value });
    }
  };

  return (
    <NaiveCheckboxGroupContext.Provider value={context}>
      <div
        id={props.id}
        class={joinClassNames("n-checkbox-group", props.class)}
        role="group"
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
      >
        {props.children}
      </div>
    </NaiveCheckboxGroupContext.Provider>
  );
}

function NaiveCheckboxFallback(props: NaiveCheckboxProps & { onWarmup?: () => void }): JSX.Element {
  const state = () => ({
    checked: props.checked ?? props.defaultChecked ?? false,
    indeterminate: props.indeterminate ?? false,
    disabled: props.disabled ?? false,
    focused: false,
    size: props.size
  });

  return (
    <div
      class={naiveCheckboxClass(props, state())}
      title={props.title}
      aria-hidden="true"
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      <span class="n-checkbox-box-wrapper">
        <span class="n-checkbox-box">
          <span class="n-checkbox-icon">
            <span class="check-icon" />
            <span class="line-icon" />
          </span>
          <span class="n-checkbox-box__border" />
        </span>
      </span>
      <Show when={naiveCheckboxHasLabel(props)}>
        <span class="n-checkbox__label">{props.label ?? props.children}</span>
      </Show>
    </div>
  );
}

export function NaiveCheckbox(props: NaiveCheckboxProps): JSX.Element {
  const [LoadedCheckbox, setLoadedCheckbox] =
    createSignal<NaiveCheckboxComponent | null>(lazyNaiveCheckbox.getLoaded());

  const ensureLoaded = (): void => {
    void lazyNaiveCheckbox.load().then((component) => setLoadedCheckbox(() => component));
  };

  onMount(ensureLoaded);

  return (
    <Show
      when={LoadedCheckbox()}
      fallback={<NaiveCheckboxFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
