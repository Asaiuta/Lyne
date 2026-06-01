import { TextField } from "@kobalte/core/text-field";
import { Show, createSignal, type JSX } from "solid-js";
import type { NaiveInputProps } from "./input.shared";
import {
  NaiveInputShell,
  isNaiveInputTextarea,
  naiveInputAutosizeStyle,
  naiveInputElementClass
} from "./input.shared";

export function NaiveInputKobalte(props: NaiveInputProps): JSX.Element {
  let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined;
  const [focused, setFocused] = createSignal<boolean>(false);
  const [hovered, setHovered] = createSignal<boolean>(false);
  const [passwordRevealed, setPasswordRevealed] = createSignal<boolean>(false);

  const handleValueChange = (value: string): void => {
    if (props.allowInput && !props.allowInput(value)) {
      if (inputEl) inputEl.value = props.value;
      return;
    }
    props.onUpdateValue?.(value);
    props.onInput?.(value);
  };
  const handleClear = (event: MouseEvent): void => {
    props.onClear?.(event);
    handleValueChange("");
    props.onChange?.("");
    inputEl?.focus();
  };
  const handleFocus = (event: FocusEvent): void => {
    setFocused(true);
    props.onFocus?.(event);
  };
  const handleBlur = (event: FocusEvent): void => {
    setFocused(false);
    props.onBlur?.(event);
  };
  const handleChange = (event: Event): void => {
    const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
    props.onChange?.(target.value);
  };
  const togglePasswordReveal = (): void => {
    setPasswordRevealed((revealed) => !revealed);
    inputEl?.focus();
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

  return (
    <TextField
      value={props.value}
      onChange={handleValueChange}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      name={props.name}
      id={props.id}
      class="naive-input-root"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <NaiveInputShell
        inputProps={props}
        state={{ focused: focused(), hovered: hovered() }}
        onClear={handleClear}
        passwordReveal={passwordReveal()}
      >
        <div class={isNaiveInputTextarea(props) ? "n-input__textarea" : "n-input__input"}>
          {isNaiveInputTextarea(props) ? (
            <TextField.TextArea
              {...props.inputProps}
              ref={(el: HTMLTextAreaElement) => {
                inputEl = el;
              }}
              class={naiveInputElementClass(props)}
              placeholder={props.placeholder}
              rows={props.rows ?? 3}
              autoResize={!!props.autosize}
              minLength={props.minlength}
              maxLength={props.maxlength}
              autocomplete={props.autocomplete}
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledBy}
              aria-describedby={props.ariaDescribedBy}
              aria-controls={props.ariaControls}
              aria-expanded={props.ariaExpanded}
              style={naiveInputAutosizeStyle(props)}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={handleChange}
              onKeyDown={props.onKeyDown}
              onKeyUp={props.onKeyUp}
              onClick={props.onClick}
            />
          ) : (
            <TextField.Input
              {...props.inputProps}
              ref={(el: HTMLInputElement) => {
                inputEl = el;
              }}
              type={
                props.type === "password"
                  ? passwordRevealed()
                    ? "text"
                    : "password"
                  : props.type ?? "text"
              }
              class={naiveInputElementClass(props)}
              placeholder={props.placeholder}
              autofocus={props.autofocus}
              minLength={props.minlength}
              maxLength={props.maxlength}
              autocomplete={props.autocomplete}
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledBy}
              aria-describedby={props.ariaDescribedBy}
              aria-controls={props.ariaControls}
              aria-expanded={props.ariaExpanded}
              onFocus={handleFocus}
              onBlur={handleBlur}
              onChange={handleChange}
              onKeyDown={props.onKeyDown}
              onKeyUp={props.onKeyUp}
              onClick={props.onClick}
            />
          )}
          <Show when={props.placeholder && props.value.length === 0}>
            <div class="n-input__placeholder">
              <span>{props.placeholder}</span>
            </div>
          </Show>
        </div>
      </NaiveInputShell>
    </TextField>
  );
}
