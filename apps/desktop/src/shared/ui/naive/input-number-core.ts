import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveInputNumberSize = "tiny" | "small" | "medium" | "large";
export type NaiveInputNumberStatus = "warning" | "error";

export interface NaiveInputNumberRenderState {
  focused: boolean;
  hovered: boolean;
}

export const DEFAULT_NAIVE_INPUT_NUMBER_STEP = 1;

export const isFiniteNumber = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseNaiveInputNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export const clampNaiveInputNumber = (
  value: number,
  min: number | undefined,
  max: number | undefined
): number => {
  let next = value;
  if (isFiniteNumber(min)) next = Math.max(min, next);
  if (isFiniteNumber(max)) next = Math.min(max, next);
  return next;
};

export const formatNaiveInputNumber = (
  value: number | null | undefined,
  precision: number | undefined
): string => {
  if (!isFiniteNumber(value)) return "";
  if (precision == null) return String(value);
  return value.toFixed(Math.max(0, precision));
};

export const resolveNaiveInputNumberStep = (step: number | undefined): number =>
  isFiniteNumber(step) && step > 0 ? step : DEFAULT_NAIVE_INPUT_NUMBER_STEP;

export const naiveInputNumberClass = (className: string | undefined): string =>
  joinClassNames("naive-input-number", "n-input-number", className);

export const naiveInputNumberInputClass = (
  size: NaiveInputNumberSize | undefined,
  status: NaiveInputNumberStatus | undefined,
  state: NaiveInputNumberRenderState,
  disabled: boolean | undefined,
  readonly: boolean | undefined
): string =>
  joinClassNames(
    "naive-input-number-input",
    "naive-input",
    "n-input",
    status ? `n-input--${status}-status` : false,
    size ? `naive-input--${size}` : false,
    disabled ? "n-input--disabled" : false,
    readonly ? "n-input--readonly" : false,
    state.focused ? "n-input--focus" : false,
    "n-input--stateful"
  );

export const nativeInputNumberStyle = (width: string | number | undefined): JSX.CSSProperties =>
  width == null ? {} : { width: typeof width === "number" ? `${width}px` : width };
