import { lazy, type JSX } from "solid-js";

export type NaiveSelectValue = string | number;
export type NaiveSelectSize = "tiny" | "small" | "medium" | "large";
export type NaiveSelectStatus = "warning" | "error";
export type NaiveSelectPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

export interface NaiveSelectOption<TValue extends NaiveSelectValue = string> {
  value: TValue;
  label: string;
  disabled?: boolean;
  class?: string;
}

export interface NaiveSelectProps<TValue extends NaiveSelectValue = string> {
  value: TValue | null;
  options: ReadonlyArray<NaiveSelectOption<TValue>>;
  onUpdateValue?: (
    value: TValue | null,
    option: NaiveSelectOption<TValue> | null
  ) => void;
  onChange?: (value: TValue | null, option: NaiveSelectOption<TValue> | null) => void;
  onClear?: () => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onOpenChange?: (open: boolean) => void;
  onSearch?: (value: string) => void;
  open?: boolean;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  clearable?: boolean;
  filterable?: boolean;
  bordered?: boolean;
  loading?: boolean;
  showArrow?: boolean;
  size?: NaiveSelectSize;
  status?: NaiveSelectStatus;
  placement?: NaiveSelectPlacement;
  name?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  class?: string;
  rootClass?: string;
  menuClass?: string;
  optionClass?: string;
  renderLabel?: (option: NaiveSelectOption<TValue>, selected: boolean) => JSX.Element;
  renderOption?: (option: NaiveSelectOption<TValue>, selected: boolean) => JSX.Element;
}

export interface NaiveSelectRenderState {
  open: boolean;
  focused: boolean;
}

export type NaiveSelectComponent = <TValue extends NaiveSelectValue = string>(
  props: NaiveSelectProps<TValue>
) => JSX.Element;

const LazyNaiveSelect = lazy(async () => {
  const module = await import("./NaiveSelectKobalte");
  return { default: module.NaiveSelectKobalte as NaiveSelectComponent };
});

export function NaiveSelect<TValue extends NaiveSelectValue = string>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  return <LazyNaiveSelect {...props} />;
}
