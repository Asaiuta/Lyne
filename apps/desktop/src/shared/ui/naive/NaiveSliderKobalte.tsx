import { Slider as KobalteSlider } from "@kobalte/core/slider";
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { NaiveSliderProps } from "./slider.shared";
import {
  createNaiveSliderMarkModels,
  formatNaiveSliderTooltip,
  hasNaiveSliderMarks,
  naiveSliderClass,
  naiveSliderHandleClass,
  naiveSliderPercentStyle,
  naiveSliderRailClass,
  resolveNaiveSliderValues
} from "./slider.shared";
import { isNaiveSliderStepKey } from "./slider-logic";
import { joinClassNames } from "./utils";

const firstSliderValue = (values: readonly number[], fallback: number): number => {
  const [value] = values;
  return Number.isFinite(value) ? value : fallback;
};

export function NaiveSliderKobalte(props: NaiveSliderProps): JSX.Element {
  const [hovered, setHovered] = createSignal<boolean>(false);
  const [dragging, setDragging] = createSignal<boolean>(false);
  let rootEl: HTMLElement | undefined;
  let dragStarted = false;

  const values = () => resolveNaiveSliderValues(props);
  const hasMarks = () => hasNaiveSliderMarks(props);
  const marks = () => createNaiveSliderMarkModels(props);
  const currentValue = () => values().value;
  const showIndicator = () => props.tooltip !== false && (props.showTooltip || hovered() || dragging());
  const rootClass = () =>
    joinClassNames(naiveSliderClass(props, values(), hasMarks()), dragging() ? "is-dragging" : false);
  const thumbStyle = (): JSX.CSSProperties | undefined =>
    values().orientation === "vertical"
      ? {
          left: "50%",
          transform: "translate(-50%, 50%)"
        }
      : undefined;

  const handleChange = (nextValues: number[]): void => {
    props.onUpdateValue?.(firstSliderValue(nextValues, currentValue()));
  };
  const handleChangeEnd = (nextValues: number[]): void => {
    const nextValue = firstSliderValue(nextValues, currentValue());
    setDragging(false);
    dragStarted = false;
    props.onUpdateValueEnd?.(nextValue);
    props.onDragEnd?.();
  };
  const handlePointerDown = (): void => {
    if (props.disabled) return;
    setDragging(true);
    if (!dragStarted) {
      dragStarted = true;
      props.onDragStart?.();
    }
  };
  const blockKeyboard = (event: KeyboardEvent): void => {
    if (props.keyboard !== false || !isNaiveSliderStepKey(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  onMount(() => {
    if (!rootEl) return;
    rootEl.addEventListener("keydown", blockKeyboard, { capture: true });
    onCleanup(() => rootEl?.removeEventListener("keydown", blockKeyboard, { capture: true }));
  });

  return (
    <KobalteSlider
      ref={(el: HTMLElement) => {
        rootEl = el;
      }}
        id={props.id}
        name={props.name}
        required={props.required}
        disabled={props.disabled}
        value={props.value == null ? undefined : [props.value]}
        defaultValue={props.defaultValue == null ? undefined : [props.defaultValue]}
        minValue={values().min}
        maxValue={values().max}
        step={values().step}
        orientation={values().orientation}
        onChange={handleChange}
        onChangeEnd={handleChangeEnd}
        getValueLabel={({ values: nextValues }) =>
          formatNaiveSliderTooltip(firstSliderValue(nextValues, currentValue()), props.formatTooltip)
        }
        class={rootClass()}
        style={{ ...naiveSliderPercentStyle(currentValue(), values()), ...props.style }}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-describedby={props.ariaDescribedBy}
      >
        <KobalteSlider.ValueLabel class="naive-slider-value-label">
          {formatNaiveSliderTooltip(currentValue(), props.formatTooltip)}
        </KobalteSlider.ValueLabel>
        <KobalteSlider.Track
          class={naiveSliderRailClass()}
          onPointerDown={handlePointerDown}
        >
          <KobalteSlider.Fill class="n-slider-rail__fill" />
          <Show when={hasMarks()}>
            <div class="n-slider-dots" aria-hidden="true">
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
            <KobalteSlider.Thumb
              class="n-slider-handle-wrapper"
              style={thumbStyle()}
              tabIndex={props.keyboard === false ? -1 : undefined}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              onPointerDown={handlePointerDown}
            >
              <span class={naiveSliderHandleClass()} />
              <Show when={showIndicator()}>
                <span
                  class={joinClassNames(
                    "n-slider-handle-indicator",
                    values().orientation === "vertical"
                      ? "n-slider-handle-indicator--right"
                      : "n-slider-handle-indicator--top"
                  )}
                >
                  {formatNaiveSliderTooltip(currentValue(), props.formatTooltip)}
                </span>
              </Show>
              <KobalteSlider.Input />
            </KobalteSlider.Thumb>
          </div>
        </KobalteSlider.Track>
        <Show when={hasMarks()}>
          <div class="n-slider-marks" aria-hidden="true">
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
    </KobalteSlider>
  );
}
