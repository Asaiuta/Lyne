import {
  Show,
  createContext,
  createMemo,
  createSignal,
  createUniqueId,
  onMount,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  naiveSelectionValueKey,
  resolveNaiveRadioSplitorState,
  resolveNaiveSelectionOriginalValue,
  type NaiveSelectableState,
  type NaiveSelectionValue
} from "./selection-logic";
import type { NaiveSelectionSize } from "./checkbox";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export interface NaiveRadioGroupProps {
  value?: NaiveSelectionValue | null;
  defaultValue?: NaiveSelectionValue | null;
  onUpdateValue?: (value: NaiveSelectionValue) => void;
  disabled?: boolean;
  size?: NaiveSelectionSize;
  name?: string;
  orientation?: "horizontal" | "vertical";
  class?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children?: JSX.Element;
}

export interface NaiveRadioProps {
  value?: NaiveSelectionValue;
  checked?: boolean;
  defaultChecked?: boolean;
  onUpdateChecked?: (checked: boolean) => void;
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

export type NaiveRadioButtonProps = NaiveRadioProps;

export interface NaiveRadioRenderState {
  checked: boolean;
  disabled: boolean;
  focused?: boolean;
  size?: NaiveSelectionSize;
}

export interface NaiveRadioGroupContextValue {
  valueKey: Accessor<string | undefined>;
  disabled: Accessor<boolean | undefined>;
  size: Accessor<NaiveSelectionSize | undefined>;
  name: Accessor<string>;
  registerValue: (value: NaiveSelectionValue) => void;
  resolveValue: (key: string) => NaiveSelectionValue;
  buttonGroup: Accessor<boolean>;
  registerButton: (state: Accessor<NaiveSelectableState>) => number;
  unregisterButton: (index: number) => void;
  splitorState: (index: number, current: NaiveSelectableState) => NaiveSelectableState;
}

interface NaiveRadioFamily {
  RadioGroup: (props: NaiveRadioGroupProps) => JSX.Element;
  Radio: (props: NaiveRadioProps) => JSX.Element;
  RadioButton: (props: NaiveRadioButtonProps) => JSX.Element;
}

const NaiveRadioGroupContext = createContext<NaiveRadioGroupContextValue | null>(null);

const lazyNaiveRadioFamily = createLazyNaive<NaiveRadioFamily>(() =>
  import("./NaiveRadioKobalte").then((module) => ({
    RadioGroup: module.NaiveRadioGroupKobalte,
    Radio: module.NaiveRadioKobalte,
    RadioButton: module.NaiveRadioButtonKobalte
  }))
);

export const useNaiveRadioGroup = (): NaiveRadioGroupContextValue | null =>
  useContext(NaiveRadioGroupContext);

export const naiveRadioItemValue = (props: Pick<NaiveRadioProps, "value">): NaiveSelectionValue =>
  props.value ?? "on";

export const naiveRadioHasLabel = (props: NaiveRadioProps): boolean =>
  props.label != null || props.children != null;

export const naiveRadioGroupClass = (
  props: Pick<NaiveRadioGroupProps, "class">,
  buttonGroup: boolean
): string =>
  joinClassNames(
    "n-radio-group",
    buttonGroup ? "n-radio-group--button-group" : false,
    props.class
  );

export const naiveRadioClass = (
  props: Pick<NaiveRadioProps, "class">,
  state: NaiveRadioRenderState
): string =>
  joinClassNames(
    "naive-radio",
    "n-radio",
    state.size ? `n-radio--${state.size}` : false,
    state.checked ? "n-radio--checked" : false,
    state.disabled ? "n-radio--disabled" : false,
    state.focused ? "n-radio--focus" : false,
    props.class
  );

export const naiveRadioButtonClass = (
  props: Pick<NaiveRadioButtonProps, "class">,
  state: NaiveRadioRenderState
): string =>
  joinClassNames(
    "naive-radio-button",
    "n-radio-button",
    state.size ? `n-radio-button--${state.size}` : false,
    state.checked ? "n-radio-button--checked" : false,
    state.disabled ? "n-radio-button--disabled" : false,
    state.focused ? "n-radio-button--focus" : false,
    props.class
  );

export const naiveRadioSplitorClass = (state: NaiveSelectableState): string =>
  joinClassNames(
    "n-radio-group__splitor",
    state.checked ? "n-radio-group__splitor--checked" : false,
    state.disabled ? "n-radio-group__splitor--disabled" : false
  );

export function createNaiveRadioGroupContext(props: {
  valueKey: Accessor<string | undefined>;
  disabled: Accessor<boolean | undefined>;
  size: Accessor<NaiveSelectionSize | undefined>;
  name?: string;
}): NaiveRadioGroupContextValue {
  const name = props.name ?? createUniqueId();
  const values = new Map<string, NaiveSelectionValue>();
  const buttonStates: Array<Accessor<NaiveSelectableState> | undefined> = [];
  const [buttonVersion, setButtonVersion] = createSignal<number>(0);
  const buttonGroup = createMemo(() => {
    buttonVersion();
    return buttonStates.some((state) => state != null);
  });

  return {
    valueKey: props.valueKey,
    disabled: props.disabled,
    size: props.size,
    name: () => name,
    registerValue: (value) => values.set(naiveSelectionValueKey(value), value),
    resolveValue: (key) => resolveNaiveSelectionOriginalValue(key, values),
    buttonGroup,
    registerButton: (state) => {
      buttonStates.push(state);
      setButtonVersion((version) => version + 1);
      return buttonStates.length - 1;
    },
    unregisterButton: (index) => {
      buttonStates[index] = undefined;
      setButtonVersion((version) => version + 1);
    },
    splitorState: (index, current) => {
      const previous = buttonStates[index - 1]?.();
      return previous ? resolveNaiveRadioSplitorState(previous, current) : current;
    }
  };
}

function NaiveRadioGroupFallback(props: NaiveRadioGroupProps & { onWarmup?: () => void }): JSX.Element {
  return (
    <div
      id={props.id}
      class={naiveRadioGroupClass(props, false)}
      role="radiogroup"
      aria-hidden="true"
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      {props.children}
    </div>
  );
}

function NaiveRadioFallback(props: NaiveRadioProps & { button?: boolean; onWarmup?: () => void }): JSX.Element {
  const checked = () => props.checked ?? props.defaultChecked ?? false;
  const disabled = () => props.disabled ?? false;
  const state = () => ({
    checked: checked(),
    disabled: disabled(),
    focused: false,
    size: props.size
  });

  return (
    <div
      class={props.button ? naiveRadioButtonClass(props, state()) : naiveRadioClass(props, state())}
      aria-hidden="true"
      title={props.title}
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      <Show
        when={props.button}
        fallback={
          <>
            <span class="n-radio__dot-wrapper">
              <span class={joinClassNames("n-radio__dot", checked() ? "n-radio__dot--checked" : false)}>
                <span class="n-radio__dot-background" />
              </span>
            </span>
            <Show when={naiveRadioHasLabel(props)}>
              <span class="n-radio__label">{props.label ?? props.children}</span>
            </Show>
          </>
        }
      >
        <span class="n-radio-button__state-border" />
        <Show when={naiveRadioHasLabel(props)}>
          <span class="n-radio__label">{props.label ?? props.children}</span>
        </Show>
      </Show>
    </div>
  );
}

export function NaiveRadioGroup(props: NaiveRadioGroupProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show
      when={Family()}
      fallback={<NaiveRadioGroupFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(family) => {
        const Component = family().RadioGroup;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export function NaiveRadio(props: NaiveRadioProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show when={Family()} fallback={<NaiveRadioFallback {...props} onWarmup={ensureLoaded} />}>
      {(family) => {
        const Component = family().Radio;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export function NaiveRadioButton(props: NaiveRadioButtonProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show
      when={Family()}
      fallback={<NaiveRadioFallback {...props} button onWarmup={ensureLoaded} />}
    >
      {(family) => {
        const Component = family().RadioButton;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export { NaiveRadioGroupContext };
