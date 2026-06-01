import { NumberField as KobalteNumberField } from "@kobalte/core/number-field";
import { Show, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import type { NaiveInputNumberProps } from "./input-number.types";
import {
  clampNaiveInputNumber,
  formatNaiveInputNumber,
  isFiniteNumber,
  nativeInputNumberStyle,
  naiveInputNumberClass,
  naiveInputNumberInputClass,
  parseNaiveInputNumber,
  resolveNaiveInputNumberStep
} from "./input-number-core";

const HOLD_DELAY_MS = 800;
const HOLD_INTERVAL_MS = 100;

export function NaiveInputNumberKobalte(props: NaiveInputNumberProps): JSX.Element {
  let inputEl: HTMLInputElement | undefined;
  let holdDelay = 0;
  let holdInterval = 0;
  const [focused, setFocused] = createSignal<boolean>(false);
  const [hovered, setHovered] = createSignal<boolean>(false);
  const [localValue, setLocalValue] = createSignal<number | null>(
    props.value ?? props.defaultValue ?? null
  );

  const value = createMemo<number | null>(() => props.value ?? localValue());
  const displayValue = createMemo<string>(() => formatNaiveInputNumber(value(), props.precision));
  const step = (): number => resolveNaiveInputNumberStep(props.step);
  const disabled = (): boolean => props.disabled === true || props.readonly === true;
  const showButton = (): boolean => props.showButton ?? true;

  const emitValue = (nextValue: number | null): void => {
    const normalized = isFiniteNumber(nextValue)
      ? clampNaiveInputNumber(nextValue, props.min, props.max)
      : null;
    setLocalValue(normalized);
    props.onUpdateValue?.(normalized);
  };
  const commitRawString = (raw: string): void => {
    emitValue(parseNaiveInputNumber(raw));
  };
  const varyValue = (direction: 1 | -1): void => {
    if (disabled()) return;
    const base = value() ?? 0;
    emitValue(base + step() * direction);
  };
  const clearHold = (): void => {
    if (holdDelay !== 0) window.clearTimeout(holdDelay);
    if (holdInterval !== 0) window.clearInterval(holdInterval);
    holdDelay = 0;
    holdInterval = 0;
  };
  const startHold = (direction: 1 | -1): void => {
    clearHold();
    if (disabled()) return;
    varyValue(direction);
    holdDelay = window.setTimeout(() => {
      holdDelay = 0;
      holdInterval = window.setInterval(() => varyValue(direction), HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };
  const handleClear = (): void => {
    emitValue(null);
    inputEl?.focus();
  };

  onCleanup(clearHold);

  return (
    <KobalteNumberField
      class={naiveInputNumberClass(props.class)}
      style={{ ...nativeInputNumberStyle(props.width), ...props.style }}
      value={displayValue()}
      rawValue={value() ?? undefined}
      onChange={(next: string) => {
        if (props.updateValueOnInput ?? true) commitRawString(next);
      }}
      minValue={props.min}
      maxValue={props.max}
      step={step()}
      format
      formatOptions={{
        useGrouping: false,
        maximumFractionDigits: props.precision ?? 20,
        minimumFractionDigits: props.precision ?? 0
      }}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      name={props.name}
      id={props.id}
      validationState={props.status === "error" ? "invalid" : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <div
        class={naiveInputNumberInputClass(
          props.size,
          props.status,
          { focused: focused(), hovered: hovered() },
          props.disabled,
          props.readonly
        )}
      >
        <div class="n-input-wrapper">
          <Show when={props.prefix}>
            {(prefix) => <span class="n-input-number-prefix">{prefix()}</span>}
          </Show>
          <div class="n-input__input">
            <KobalteNumberField.Input
              {...props.inputProps}
              ref={(el: HTMLInputElement) => {
                inputEl = el;
              }}
              class="n-input__input-el"
              inputMode="decimal"
              autocomplete={String(props.inputProps?.autocomplete ?? "off")}
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledBy}
              aria-describedby={props.ariaDescribedBy}
              placeholder={props.placeholder}
              autofocus={props.autofocus}
              onInput={(event) => {
                if (props.updateValueOnInput ?? true) commitRawString(event.currentTarget.value);
              }}
              onChange={(event) => commitRawString(event.currentTarget.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
            <Show when={props.placeholder && displayValue().length === 0}>
              <div class="n-input__placeholder">
                <span>{props.placeholder}</span>
              </div>
            </Show>
          </div>
          <Show when={props.clearable && value() != null && !disabled()}>
            <button
              type="button"
              class="n-base-clear n-input-number-clear"
              aria-label="Clear"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleClear}
            >
              <span class="n-base-icon" aria-hidden="true" />
            </button>
          </Show>
          <Show when={props.suffix}>
            {(suffix) => <span class="n-input-number-suffix">{suffix()}</span>}
          </Show>
          <Show when={showButton()}>
            <span class="n-input-number-button-group">
              <button
                type="button"
                class="n-input-number-button n-input-number-button--plus"
                disabled={disabled()}
                onPointerDown={(event) => {
                  event.preventDefault();
                  startHold(1);
                }}
                onPointerUp={clearHold}
                onPointerLeave={clearHold}
                onPointerCancel={clearHold}
              >
                +
              </button>
              <button
                type="button"
                class="n-input-number-button n-input-number-button--minus"
                disabled={disabled()}
                onPointerDown={(event) => {
                  event.preventDefault();
                  startHold(-1);
                }}
                onPointerUp={clearHold}
                onPointerLeave={clearHold}
                onPointerCancel={clearHold}
              >
                -
              </button>
            </span>
          </Show>
        </div>
        <div class="n-input__border" />
        <div class="n-input__state-border" />
      </div>
      <KobalteNumberField.HiddenInput />
    </KobalteNumberField>
  );
}
