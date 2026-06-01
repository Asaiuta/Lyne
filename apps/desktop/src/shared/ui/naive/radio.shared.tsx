import {
  createContext,
  createMemo,
  createSignal,
  createUniqueId,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  naiveSelectionValueKey,
  resolveNaiveRadioSplitorState,
  resolveNaiveSelectionOriginalValue,
  type NaiveSelectableState,
  type NaiveSelectionSize,
  type NaiveSelectionValue
} from "./selection-logic";
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

export interface NaiveRadioFamily {
  RadioGroup: (props: NaiveRadioGroupProps) => JSX.Element;
  Radio: (props: NaiveRadioProps) => JSX.Element;
  RadioButton: (props: NaiveRadioButtonProps) => JSX.Element;
}

export const NaiveRadioGroupContext =
  createContext<NaiveRadioGroupContextValue | null>(null);

export const useNaiveRadioGroup = (): NaiveRadioGroupContextValue | null =>
  useContext(NaiveRadioGroupContext);

export const naiveRadioItemValue = (
  props: Pick<NaiveRadioProps, "value">
): NaiveSelectionValue => props.value ?? "on";

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
