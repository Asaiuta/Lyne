import {
  createContext,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import type { NaiveSelectionSize, NaiveSelectionValue } from "./selection-logic";
import { joinClassNames } from "./utils";

export type { NaiveSelectionSize, NaiveSelectionValue };

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

export const NaiveCheckboxGroupContext =
  createContext<NaiveCheckboxGroupContextValue | null>(null);

export const useNaiveCheckboxGroup = (): NaiveCheckboxGroupContextValue | null =>
  useContext(NaiveCheckboxGroupContext);

export const naiveCheckboxItemValue = (
  props: Pick<NaiveCheckboxProps, "value">
): NaiveSelectionValue => props.value ?? "on";

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
