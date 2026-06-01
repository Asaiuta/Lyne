import { Show, type JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveInputType =
  | "text"
  | "search"
  | "password"
  | "email"
  | "url"
  | "tel"
  | "textarea";
export type NaiveInputSize = "tiny" | "small" | "medium" | "large";
export type NaiveInputStatus = "warning" | "error";

export interface NaiveInputAutosize {
  minRows?: number;
  maxRows?: number;
}

type NativeInputPassthroughValue = string | number | boolean | undefined;
export type NativeInputPassthroughProps = Record<string, NativeInputPassthroughValue>;

export interface NaiveInputProps {
  value: string;
  onUpdateValue?: (value: string) => void;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: FocusEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onClick?: (event: MouseEvent) => void;
  onClear?: (event: MouseEvent) => void;
  allowInput?: (value: string) => boolean;
  type?: NaiveInputType;
  size?: NaiveInputSize;
  status?: NaiveInputStatus;
  placeholder?: string;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  clearable?: boolean;
  round?: boolean;
  bordered?: boolean;
  loading?: boolean;
  autofocus?: boolean;
  showPasswordOn?: "click" | "mousedown";
  inputProps?: NativeInputPassthroughProps;
  name?: string;
  id?: string;
  rows?: number;
  autosize?: boolean | NaiveInputAutosize;
  resizable?: boolean;
  minlength?: number;
  maxlength?: number;
  autocomplete?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  ariaControls?: string;
  ariaExpanded?: boolean;
  class?: string;
  inputClass?: string;
  prefix?: JSX.Element;
  suffix?: JSX.Element;
}

export interface NaiveInputRenderState {
  focused: boolean;
  hovered: boolean;
}

export type NaiveInputComponent = (props: NaiveInputProps) => JSX.Element;

export const isNaiveInputTextarea = (props: NaiveInputProps): boolean =>
  props.type === "textarea";

const isBordered = (props: NaiveInputProps): boolean => props.bordered ?? true;

const hasSuffix = (props: NaiveInputProps, state: NaiveInputRenderState): boolean =>
  props.suffix != null ||
  props.type === "password" ||
  props.loading !== undefined ||
  (props.clearable === true && props.value.length > 0 && (state.focused || state.hovered));

export const naiveInputClass = (
  props: NaiveInputProps,
  state: NaiveInputRenderState
): string =>
  joinClassNames(
    "naive-input",
    "n-input",
    props.status ? `n-input--${props.status}-status` : false,
    props.size ? `naive-input--${props.size}` : false,
    props.disabled ? "n-input--disabled" : false,
    isNaiveInputTextarea(props) ? "n-input--textarea" : false,
    isNaiveInputTextarea(props) && (props.resizable ?? true) && !props.autosize
      ? "n-input--resizable"
      : false,
    props.autosize ? "n-input--autosize" : false,
    props.round && !isNaiveInputTextarea(props) ? "n-input--round" : false,
    state.focused ? "n-input--focus" : false,
    "n-input--stateful",
    props.class
  );

export const naiveInputElementClass = (props: NaiveInputProps): string =>
  joinClassNames(
    isNaiveInputTextarea(props) ? "n-input__textarea-el" : "n-input__input-el",
    props.inputClass
  );

export const naiveInputAutosizeStyle = (
  props: NaiveInputProps
): JSX.CSSProperties | undefined => {
  if (!isNaiveInputTextarea(props) || !props.autosize || props.autosize === true) {
    return undefined;
  }
  const style: JSX.CSSProperties = {};
  if (props.autosize.minRows) {
    style["min-height"] = `calc(var(--n-padding-vertical) * 2 + var(--n-line-height-textarea) * var(--n-font-size) * ${props.autosize.minRows})`;
  }
  if (props.autosize.maxRows) {
    style["max-height"] = `calc(var(--n-padding-vertical) * 2 + var(--n-line-height-textarea) * var(--n-font-size) * ${props.autosize.maxRows})`;
  }
  return style;
};

export function NaiveInputShell(props: {
  inputProps: NaiveInputProps;
  state: NaiveInputRenderState;
  children: JSX.Element;
  onClear?: (event: MouseEvent) => void;
  passwordReveal?: JSX.Element;
}): JSX.Element {
  const inputProps = () => props.inputProps;
  const showSuffix = () => hasSuffix(inputProps(), props.state);
  const showClear = () =>
    inputProps().clearable === true &&
    inputProps().value.length > 0 &&
    (props.state.focused || props.state.hovered) &&
    !inputProps().disabled &&
    !inputProps().readonly;

  return (
    <div class={naiveInputClass(inputProps(), props.state)}>
      <div class="n-input-wrapper">
        <Show when={inputProps().prefix}>
          {(prefix) => <div class="n-input__prefix">{prefix()}</div>}
        </Show>
        {props.children}
        <Show when={showSuffix()}>
          <div class="n-input__suffix">
            <Show when={showClear()}>
              <button
                type="button"
                class="n-base-clear"
                aria-label="Clear"
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => props.onClear?.(event)}
              >
                <span class="n-base-icon" aria-hidden="true" />
              </button>
            </Show>
            <Show when={inputProps().loading !== undefined}>
              <span
                class={joinClassNames(
                  "n-base-loading",
                  inputProps().loading ? "is-loading" : false
                )}
                aria-hidden="true"
              />
            </Show>
            {props.passwordReveal}
            {inputProps().suffix}
          </div>
        </Show>
      </div>
      <Show when={isBordered(inputProps())}>
        <div class="n-input__border" />
        <div class="n-input__state-border" />
      </Show>
    </div>
  );
}
