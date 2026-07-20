import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export interface NaiveColorPickerProps {
  value: string;
  onUpdateValue?: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  class?: string;
  title?: string;
}

/**
 * Compact color-well facade for settings swatch rows. The browser color input
 * owns platform color selection while the shared API owns controlled value,
 * completion, disabled, and Naive-compatible class contracts.
 */
export function NaiveColorPicker(props: NaiveColorPickerProps): JSX.Element {
  return (
    <input
      type="color"
      class={joinClassNames(
        "naive-color-picker",
        "n-color-picker",
        "n-color-picker-trigger",
        props.class
      )}
      value={props.value}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      title={props.title}
      onInput={(event) => props.onUpdateValue?.(event.currentTarget.value)}
      onChange={(event) => props.onComplete?.(event.currentTarget.value)}
    />
  );
}
