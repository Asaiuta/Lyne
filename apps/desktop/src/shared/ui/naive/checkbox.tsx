import {
  Show,
  createContext,
  createMemo,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  isNaiveCheckboxDisabledByQuota,
  naiveSelectionValueKey,
  toggleNaiveCheckboxValues,
  type NaiveSelectionValue
} from "./selection-logic";
import { joinClassNames } from "./utils";

export type { NaiveSelectionValue };

export type NaiveSelectionSize = "small" | "medium" | "large";

export interface NaiveCheckboxGroupUpdateMeta {
  readonly actionType: "check" | "uncheck";
  readonly value: NaiveSelectionValue;
}

export interface NaiveCheckboxGroupProps {
  value?: readonly NaiveSelectionValue[];
  defaultValue?: readonly NaiveSelectionValue[];
  onUpdateValue?: (
    value: readonly NaiveSelectionValue[],
    meta: NaiveCheckboxGroupUpdateMeta
  ) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  size?: NaiveSelectionSize;
  class?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children?: JSX.Element;
}

export interface NaiveCheckboxProps {
  value?: NaiveSelectionValue;
  checked?: boolean;
  defaultChecked?: boolean;
  onUpdateChecked?: (checked: boolean) => void;
  indeterminate?: boolean;
  disabled?: boolean;
  label?: JSX.Element;
  size?: NaiveSelectionSize;
  class?: string;
  title?: string;
  id?: string;
  name?: string;
  required?: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  children?: JSX.Element;
}

export interface NaiveCheckboxRenderState {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  focused?: boolean;
  size?: NaiveSelectionSize;
}

export interface NaiveCheckboxGroupContextValue {
  values: Accessor<readonly NaiveSelectionValue[]>;
  valueKeys: Accessor<ReadonlySet<string>>;
  disabled: Accessor<boolean | undefined>;
  size: Accessor<NaiveSelectionSize | undefined>;
  min: Accessor<number | undefined>;
  max: Accessor<number | undefined>;
  isChecked: (value: NaiveSelectionValue) => boolean;
  isDisabled: (value: NaiveSelectionValue, ownDisabled: boolean | undefined) => boolean;
  toggle: (value: NaiveSelectionValue, checked: boolean) => void;
}

export type NaiveCheckboxComponent = (props: NaiveCheckboxProps) => JSX.Element;

const NaiveCheckboxGroupContext = createContext<NaiveCheckboxGroupContextValue | null>(null);

let loadedNaiveCheckbox: NaiveCheckboxComponent | null = null;
let naiveCheckboxImport: Promise<NaiveCheckboxComponent> | null = null;

const loadNaiveCheckbox = async (): Promise<NaiveCheckboxComponent> => {
  if (loadedNaiveCheckbox) return loadedNaiveCheckbox;
  naiveCheckboxImport ??= import("./NaiveCheckboxKobalte").then(
    (module) => module.NaiveCheckboxKobalte as NaiveCheckboxComponent
  );
  loadedNaiveCheckbox = await naiveCheckboxImport;
  return loadedNaiveCheckbox;
};

export const useNaiveCheckboxGroup = (): NaiveCheckboxGroupContextValue | null =>
  useContext(NaiveCheckboxGroupContext);

export const naiveCheckboxItemValue = (props: Pick<NaiveCheckboxProps, "value">): NaiveSelectionValue =>
  props.value ?? "on";

export const naiveCheckboxClass = (
  props: Pick<NaiveCheckboxProps, "class">,
  state: NaiveCheckboxRenderState
): string =>
  joinClassNames(
    "naive-checkbox",
    "n-checkbox",
    state.size ? `n-checkbox--${state.size}` : false,
    state.checked ? "n-checkbox--checked" : false,
    state.indeterminate ? "n-checkbox--indeterminate" : false,
    state.disabled ? "n-checkbox--disabled" : false,
    state.focused ? "n-checkbox--focus" : false,
    props.class
  );

export const naiveCheckboxHasLabel = (props: NaiveCheckboxProps): boolean =>
  props.label != null || props.children != null;

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
    createSignal<NaiveCheckboxComponent | null>(loadedNaiveCheckbox);

  const ensureLoaded = (): void => {
    void loadNaiveCheckbox().then((component) => setLoadedCheckbox(() => component));
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
