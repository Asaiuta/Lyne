import { Show, createSignal, onMount, type JSX } from "solid-js";
import {
  formatNaiveInputNumber,
  nativeInputNumberStyle,
  naiveInputNumberClass,
  naiveInputNumberInputClass,
  parseNaiveInputNumber,
  type NaiveInputNumberSize,
  type NaiveInputNumberStatus
} from "./input-number-core";
import { createLazyNaive } from "./lazy-naive";

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

const lazyNaiveInputNumber = createLazyNaive<NaiveInputNumberComponent>(() =>
  import("./NaiveInputNumberKobalte").then(
    (module) => module.NaiveInputNumberKobalte as NaiveInputNumberComponent
  )
);

const initialDisplayValue = (props: NaiveInputNumberProps): string =>
  formatNaiveInputNumber(props.value ?? props.defaultValue ?? null, props.precision);

export function NaiveInputNumber(props: NaiveInputNumberProps): JSX.Element {
  const [LoadedInputNumber, setLoadedInputNumber] =
    createSignal<NaiveInputNumberComponent | null>(lazyNaiveInputNumber.getLoaded());
  const [focused, setFocused] = createSignal<boolean>(false);
  const [hovered, setHovered] = createSignal<boolean>(false);

  const ensureLoaded = (): void => {
    void lazyNaiveInputNumber.load().then((component) => setLoadedInputNumber(() => component));
  };
  const commitValue = (raw: string): void => {
    const parsed = parseNaiveInputNumber(raw);
    props.onUpdateValue?.(parsed);
  };

  onMount(ensureLoaded);

  return (
    <Show
      when={LoadedInputNumber()}
      fallback={
        <div
          class={naiveInputNumberClass(props.class)}
          style={{ ...nativeInputNumberStyle(props.width), ...props.style }}
          onPointerEnter={() => {
            setHovered(true);
            ensureLoaded();
          }}
          onPointerLeave={() => setHovered(false)}
          onFocusIn={ensureLoaded}
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
                <input
                  {...props.inputProps}
                  class="n-input__input-el"
                  type="text"
                  inputMode="decimal"
                  value={initialDisplayValue(props)}
                  placeholder={props.placeholder}
                  disabled={props.disabled}
                  readOnly={props.readonly}
                  required={props.required}
                  autofocus={props.autofocus}
                  name={props.name}
                  id={props.id}
                  aria-label={props.ariaLabel}
                  aria-labelledby={props.ariaLabelledBy}
                  aria-describedby={props.ariaDescribedBy}
                  onInput={(event) => {
                    if (props.updateValueOnInput ?? true) commitValue(event.currentTarget.value);
                  }}
                  onChange={(event) => commitValue(event.currentTarget.value)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                />
              </div>
              <Show when={props.suffix}>
                {(suffix) => <span class="n-input-number-suffix">{suffix()}</span>}
              </Show>
            </div>
            <div class="n-input__border" />
            <div class="n-input__state-border" />
          </div>
        </div>
      }
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
