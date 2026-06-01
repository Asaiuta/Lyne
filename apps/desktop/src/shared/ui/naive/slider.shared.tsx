import { For, Show, type JSX } from "solid-js";
import {
  DEFAULT_NAIVE_SLIDER_MAX,
  DEFAULT_NAIVE_SLIDER_MIN,
  DEFAULT_NAIVE_SLIDER_STEP,
  getNaiveSliderPercent,
  normalizeNaiveSliderNumber,
  normalizeNaiveSliderValue,
  resolveNaiveSliderMarks,
  type NaiveSliderOrientation
} from "./slider-logic";
import { joinClassNames } from "./utils";

export type { NaiveSliderOrientation };

export type NaiveSliderMarks = Readonly<Record<number, JSX.Element | string>>;

export interface NaiveSliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  orientation?: NaiveSliderOrientation;
  disabled?: boolean;
  tooltip?: boolean;
  showTooltip?: boolean;
  formatTooltip?: (value: number) => string;
  marks?: NaiveSliderMarks;
  keyboard?: boolean;
  onUpdateValue?: (value: number) => void;
  onUpdateValueEnd?: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  class?: string;
  style?: JSX.CSSProperties;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  id?: string;
  name?: string;
  required?: boolean;
}

export type NaiveSliderComponent = (props: NaiveSliderProps) => JSX.Element;

export interface NaiveSliderResolvedValues {
  min: number;
  max: number;
  step: number;
  value: number;
  orientation: NaiveSliderOrientation;
}

export const resolveNaiveSliderValues = (
  props: Pick<NaiveSliderProps, "value" | "defaultValue" | "min" | "max" | "step" | "orientation">
): NaiveSliderResolvedValues => {
  const min = normalizeNaiveSliderNumber(props.min, DEFAULT_NAIVE_SLIDER_MIN);
  const max = normalizeNaiveSliderNumber(props.max, DEFAULT_NAIVE_SLIDER_MAX);
  return {
    min,
    max,
    step: normalizeNaiveSliderNumber(props.step, DEFAULT_NAIVE_SLIDER_STEP),
    value: normalizeNaiveSliderValue(props.value, props.defaultValue, min),
    orientation: props.orientation ?? "horizontal"
  };
};

export const naiveSliderMarkEntries = (
  marks: NaiveSliderMarks | undefined
): ReadonlyArray<{ value: number; label: JSX.Element | string }> =>
  Object.entries(marks ?? {}).map(([rawValue, label]) => ({
    value: Number.parseFloat(rawValue),
    label
  }));

export const hasNaiveSliderMarks = (props: NaiveSliderProps): boolean =>
  naiveSliderMarkEntries(props.marks).some((mark) => Number.isFinite(mark.value));

export const naiveSliderClass = (
  props: NaiveSliderProps,
  values: NaiveSliderResolvedValues,
  hasMarks: boolean
): string =>
  joinClassNames(
    "naive-slider",
    "n-slider",
    values.orientation === "vertical" ? "n-slider--vertical" : false,
    props.disabled ? "n-slider--disabled" : false,
    hasMarks ? "n-slider--with-mark" : false,
    props.class
  );

export const naiveSliderRailClass = (): string => "n-slider-rail";
export const naiveSliderHandleClass = (): string => "n-slider-handle";

export const formatNaiveSliderTooltip = (
  value: number,
  formatTooltip: ((value: number) => string) | undefined
): string => formatTooltip?.(value) ?? String(value);

export const naiveSliderPercentStyle = (
  value: number,
  values: NaiveSliderResolvedValues
): JSX.CSSProperties => ({
  "--naive-slider-percent": `${getNaiveSliderPercent(value, values.min, values.max)}%`
});

export const createNaiveSliderMarkModels = (props: NaiveSliderProps) => {
  const values = resolveNaiveSliderValues(props);
  return resolveNaiveSliderMarks(
    naiveSliderMarkEntries(props.marks),
    values.value,
    values.min,
    values.max
  );
};

interface NaiveSliderFallbackProps extends NaiveSliderProps {
  onWarmup?: () => void;
}

export function NaiveSliderFallback(props: NaiveSliderFallbackProps): JSX.Element {
  const values = () => resolveNaiveSliderValues(props);
  const marks = () => createNaiveSliderMarkModels(props);
  const hasMarks = () => marks().length > 0;
  const percentStyle = () => naiveSliderPercentStyle(values().value, values());

  return (
    <div
      class={naiveSliderClass(props, values(), hasMarks())}
      style={{ ...percentStyle(), ...props.style }}
      aria-hidden="true"
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      <div class={naiveSliderRailClass()}>
        <div class="n-slider-rail__fill" />
        <Show when={hasMarks()}>
          <div class="n-slider-dots">
            <For each={marks()}>
              {(mark) => (
                <span
                  class={joinClassNames(
                    "n-slider-dot",
                    mark.active ? "n-slider-dot--active" : false
                  )}
                  style={{ "--naive-slider-mark-percent": `${mark.percent}%` }}
                />
              )}
            </For>
          </div>
        </Show>
        <div class="n-slider-handles">
          <span class="n-slider-handle-wrapper">
            <span class={naiveSliderHandleClass()} />
          </span>
        </div>
      </div>
      <Show when={hasMarks()}>
        <div class="n-slider-marks">
          <For each={marks()}>
            {(mark) => (
              <span
                class="n-slider-mark"
                style={{ "--naive-slider-mark-percent": `${mark.percent}%` }}
              >
                {mark.label}
              </span>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
