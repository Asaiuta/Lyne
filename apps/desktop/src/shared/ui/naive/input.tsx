import {
  Show,
  createEffect,
  createSignal,
  onMount,
  type JSX
} from "solid-js";
import {
  NaiveInputShell,
  isNaiveInputTextarea,
  naiveInputAutosizeStyle,
  naiveInputElementClass,
  type NaiveInputComponent,
  type NaiveInputProps
} from "./input.shared";
import { createLazyNaive } from "./lazy-naive";

export * from "./input.shared";

const lazyNaiveInput = createLazyNaive<NaiveInputComponent>(() =>
  import("./NaiveInputKobalte").then(
    (module) => module.NaiveInputKobalte as NaiveInputComponent
  )
);

export function NaiveInput(props: NaiveInputProps): JSX.Element {
  let fallbackInput: HTMLInputElement | HTMLTextAreaElement | undefined;
  const [LoadedInput, setLoadedInput] =
    createSignal<NaiveInputComponent | null>(lazyNaiveInput.getLoaded());
  const [focused, setFocused] = createSignal<boolean>(false);
  const [hovered, setHovered] = createSignal<boolean>(false);
  const [passwordRevealed, setPasswordRevealed] = createSignal<boolean>(false);

  const ensureLoaded = (): void => {
    void lazyNaiveInput.load().then((component) => setLoadedInput(() => component));
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
            <div class={isNaiveInputTextarea(props) ? "n-input__textarea" : "n-input__input"}>
              <Show
                when={isNaiveInputTextarea(props)}
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
