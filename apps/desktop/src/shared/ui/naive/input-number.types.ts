import type { JSX } from "solid-js";
import type { NaiveInputNumberSize, NaiveInputNumberStatus } from "./input-number-core";

export interface NaiveInputNumberProps {
  value?: number | null;
  defaultValue?: number | null;
  onUpdateValue?: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  clearable?: boolean;
  showButton?: boolean;
  updateValueOnInput?: boolean;
  passivelyActivated?: boolean;
  status?: NaiveInputNumberStatus;
  size?: NaiveInputNumberSize;
  name?: string;
  id?: string;
  required?: boolean;
  autofocus?: boolean;
  inputProps?: Record<string, string | number | boolean | undefined>;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  class?: string;
  style?: JSX.CSSProperties;
  width?: string | number;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
}

export type NaiveInputNumberComponent = (props: NaiveInputNumberProps) => JSX.Element;
