export type NaiveSliderOrientation = "horizontal" | "vertical";

export interface NaiveSliderThumbStyle {
  readonly transform: string;
  readonly left?: string;
}

export interface NaiveSliderMarkInput<TLabel = unknown> {
  readonly value: number;
  readonly label: TLabel;
}

export interface NaiveSliderResolvedMark<TLabel = unknown>
  extends NaiveSliderMarkInput<TLabel> {
  readonly percent: number;
  readonly active: boolean;
}

export const DEFAULT_NAIVE_SLIDER_MIN = 0;
export const DEFAULT_NAIVE_SLIDER_MAX = 100;
export const DEFAULT_NAIVE_SLIDER_STEP = 1;

export const normalizeNaiveSliderNumber = (
  value: number | undefined,
  fallback: number
): number => (value == null || !Number.isFinite(value) ? fallback : value);

export const normalizeNaiveSliderValue = (
  value: number | undefined,
  defaultValue: number | undefined,
  min: number
): number => normalizeNaiveSliderNumber(value, normalizeNaiveSliderNumber(defaultValue, min));

export const getNaiveSliderPercent = (
  value: number,
  min: number,
  max: number
): number => {
  if (max <= min) return 0;
  const percent = ((value - min) / (max - min)) * 100;
  return Math.min(100, Math.max(0, percent));
};

export const isNaiveSliderStepKey = (key: string): boolean =>
  key === "ArrowLeft" ||
  key === "ArrowRight" ||
  key === "ArrowUp" ||
  key === "ArrowDown" ||
  key === "Home" ||
  key === "End" ||
  key === "PageUp" ||
  key === "PageDown";

export const resolveNaiveSliderThumbStyle = (
  orientation: NaiveSliderOrientation
): NaiveSliderThumbStyle =>
  // Kobalte writes thumb placement as inline styles, so centering transforms must live
  // in the inline style contract instead of only in CSS.
  orientation === "vertical"
    ? {
        left: "50%",
        transform: "translate(-50%, 50%)"
      }
    : {
        transform: "translate(-50%, -50%)"
      };

export const resolveNaiveSliderMarks = <TLabel>(
  marks: ReadonlyArray<NaiveSliderMarkInput<TLabel>>,
  value: number,
  min: number,
  max: number
): ReadonlyArray<NaiveSliderResolvedMark<TLabel>> =>
  marks
    .filter((mark) => Number.isFinite(mark.value))
    .sort((a, b) => a.value - b.value)
    .map((mark) => ({
      ...mark,
      percent: getNaiveSliderPercent(mark.value, min, max),
      active: mark.value <= value
    }));
