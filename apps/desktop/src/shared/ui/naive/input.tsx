import {
  Show,
  createEffect,
  createSignal,
  onMount,
  type JSX
} from "solid-js";
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

let loadedNaiveInput: NaiveInputComponent | null = null;
let naiveInputImport: Promise<NaiveInputComponent> | null = null;

const loadNaiveInput = async (): Promise<NaiveInputComponent> => {
  if (loadedNaiveInput) return loadedNaiveInput;
  naiveInputImport ??= import("./NaiveInputKobalte").then(
    (module) => module.NaiveInputKobalte as NaiveInputComponent
  );
  loadedNaiveInput = await naiveInputImport;
  return loadedNaiveInput;
};

const isTextarea = (props: NaiveInputProps): boolean => props.type === "textarea";
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
    isTextarea(props) ? "n-input--textarea" : false,
    isTextarea(props) && (props.resizable ?? true) && !props.autosize
      ? "n-input--resizable"
      : false,
    props.autosize ? "n-input--autosize" : false,
    props.round && !isTextarea(props) ? "n-input--round" : false,
    state.focused ? "n-input--focus" : false,
    "n-input--stateful",
    props.class
  );

export const naiveInputElementClass = (props: NaiveInputProps): string =>
  joinClassNames(
    isTextarea(props) ? "n-input__textarea-el" : "n-input__input-el",
    props.inputClass
  );

export const naiveInputAutosizeStyle = (
  props: NaiveInputProps
): JSX.CSSProperties | undefined => {
  if (!isTextarea(props) || !props.autosize || props.autosize === true) return undefined;
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

export function NaiveInput(props: NaiveInputProps): JSX.Element {
  let fallbackInput: HTMLInputElement | HTMLTextAreaElement | undefined;
  const [LoadedInput, setLoadedInput] =
    createSignal<NaiveInputComponent | null>(loadedNaiveInput);
  const [focused, setFocused] = createSignal<boolean>(false);
  const [hovered, setHovered] = createSignal<boolean>(false);
  const [passwordRevealed, setPasswordRevealed] = createSignal<boolean>(false);

  const ensureLoaded = (): void => {
    void loadNaiveInput().then((component) => setLoadedInput(() => component));
  };
  const emitValue = (value: string): void => {
    if (props.allowInput && !props.allowInput(value)) {
      if (fallbackInput) fallbackInput.value = props.value;
      return;
    }
    props.onUpdateValue?.(value);
    props.onInput?.(value);
  };
  const handleClear = (event: MouseEvent): void => {
    props.onClear?.(event);
    emitValue("");
    props.onChange?.("");
    fallbackInput?.focus();
  };
  const togglePasswordReveal = (): void => {
    setPasswordRevealed((revealed) => !revealed);
    fallbackInput?.focus();
  };
  const passwordReveal = (): JSX.Element | undefined => {
    if (props.type !== "password") return undefined;
    return (
      <button
        type="button"
        class="n-input__suffix-icon n-input__suffix-icon--password-eye"
        aria-label={passwordRevealed() ? "Hide password" : "Show password"}
        aria-pressed={passwordRevealed()}
        onMouseDown={(event) => {
          event.preventDefault();
          if ((props.showPasswordOn ?? "click") === "mousedown") togglePasswordReveal();
        }}
        onClick={(event) => {
          event.preventDefault();
          if ((props.showPasswordOn ?? "click") === "click") togglePasswordReveal();
        }}
      />
    );
  };

  createEffect(() => {
    if (fallbackInput && fallbackInput.value !== props.value) {
      fallbackInput.value = props.value;
    }
  });

  onMount(ensureLoaded);

  return (
    <Show
      when={LoadedInput()}
      fallback={
        <div
          onPointerEnter={() => {
            setHovered(true);
            ensureLoaded();
          }}
          onPointerLeave={() => setHovered(false)}
        >
          <NaiveInputShell
            inputProps={props}
            state={{ focused: focused(), hovered: hovered() }}
            onClear={handleClear}
            passwordReveal={passwordReveal()}
          >
            <div class={isTextarea(props) ? "n-input__textarea" : "n-input__input"}>
              <Show
                when={isTextarea(props)}
                fallback={
                  <input
                    {...props.inputProps}
                    ref={(el) => {
                      fallbackInput = el;
                    }}
                    type={
                      props.type === "password"
                        ? passwordRevealed()
                          ? "text"
                          : "password"
                        : props.type ?? "text"
                    }
                    class={naiveInputElementClass(props)}
                    value={props.value}
                    placeholder={props.placeholder}
                    disabled={props.disabled}
                    readOnly={props.readonly}
                    required={props.required}
                    autofocus={props.autofocus}
                    name={props.name}
                    id={props.id}
                    minlength={props.minlength}
                    maxlength={props.maxlength}
                    autocomplete={props.autocomplete}
                    aria-label={props.ariaLabel}
                    aria-labelledby={props.ariaLabelledBy}
                    aria-describedby={props.ariaDescribedBy}
                    aria-controls={props.ariaControls}
                    aria-expanded={props.ariaExpanded}
                    onInput={(event) => emitValue(event.currentTarget.value)}
                    onChange={(event) => props.onChange?.(event.currentTarget.value)}
                    onFocus={(event) => {
                      setFocused(true);
                      props.onFocus?.(event);
                      ensureLoaded();
                    }}
                    onBlur={(event) => {
                      setFocused(false);
                      props.onBlur?.(event);
                    }}
                    onKeyDown={props.onKeyDown}
                    onKeyUp={props.onKeyUp}
                    onClick={props.onClick}
                  />
                }
              >
                <textarea
                  {...props.inputProps}
                  ref={(el) => {
                    fallbackInput = el;
                  }}
                  class={naiveInputElementClass(props)}
                  value={props.value}
                  placeholder={props.placeholder}
                  disabled={props.disabled}
                  readOnly={props.readonly}
                  required={props.required}
                  autofocus={props.autofocus}
                  name={props.name}
                  id={props.id}
                  rows={props.rows ?? 3}
                  minlength={props.minlength}
                  maxlength={props.maxlength}
                  autocomplete={props.autocomplete}
                  aria-label={props.ariaLabel}
                  aria-labelledby={props.ariaLabelledBy}
                  aria-describedby={props.ariaDescribedBy}
                  aria-controls={props.ariaControls}
                  aria-expanded={props.ariaExpanded}
                  style={naiveInputAutosizeStyle(props)}
                  onInput={(event) => emitValue(event.currentTarget.value)}
                  onChange={(event) => props.onChange?.(event.currentTarget.value)}
                  onFocus={(event) => {
                    setFocused(true);
                    props.onFocus?.(event);
                    ensureLoaded();
                  }}
                  onBlur={(event) => {
                    setFocused(false);
                    props.onBlur?.(event);
                  }}
                  onKeyDown={props.onKeyDown}
                  onKeyUp={props.onKeyUp}
                  onClick={props.onClick}
                />
              </Show>
              <Show when={props.placeholder && props.value.length === 0}>
                <div class="n-input__placeholder">
                  <span>{props.placeholder}</span>
                </div>
              </Show>
            </div>
          </NaiveInputShell>
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
