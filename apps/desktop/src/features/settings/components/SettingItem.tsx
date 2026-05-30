import { Show, createEffect, type JSX } from "solid-js";

export const settingsSectionClass = "settings-section";

export const settingItemClass = "set-item";

export const settingItemSlideInClass =
  "settings-slide-in-item";

export const settingItemHighlightedClass =
  "is-highlighted";

export const settingItemBlockClass = "set-item-block";

export const settingItemLabelClass = "set-item-label";

export const settingItemNameClass = "set-item-name";

export const settingItemDescriptionClass = "set-item-desc";

export const settingItemControlClass = "set-item-control";

export const settingItemBlockBodyClass = "set-item-block-body";

export const settingsHintClass = "settings-hint";

export const rangeWithValueClass = "range-with-value";

export const rangeValueClass = "range-value";

export const rangeInputClass = "range-with-value-input";

function updateRangeFill(el: HTMLInputElement) {
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const val = Number(el.value) || 0;
  const pct = ((val - min) / (max - min)) * 100;
  el.style.setProperty("--range-pct", `${pct}%`);
}

interface RangeInputProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onPreview?: (value: number) => void;
  onCommit?: (value: number) => void;
  disabled?: boolean;
  formatSuffix?: string;
}

export function RangeInput(props: RangeInputProps) {
  let inputRef: HTMLInputElement | undefined;

  const readValue = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);

  const handleInput = (e: Event) => {
    const el = e.currentTarget as HTMLInputElement;
    updateRangeFill(el);
    props.onPreview?.(Number(el.value));
  };

  const handleCommit = (e: Event) => {
    props.onCommit?.(readValue(e));
  };

  createEffect(() => {
    const value = props.value;
    if (!inputRef) return;
    inputRef.value = String(value);
    updateRangeFill(inputRef);
  });

  return (
    <div class={rangeWithValueClass}>
      <span class={rangeValueClass}>
        {props.value}{props.formatSuffix ?? ""}
      </span>
      <input
        ref={(el) => {
          inputRef = el;
          requestAnimationFrame(() => updateRangeFill(el));
        }}
        class={rangeInputClass}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={handleInput}
        onChange={handleCommit}
        disabled={props.disabled}
      />
    </div>
  );
}

interface SettingItemProps {
  id?: string;
  label: string;
  description?: string;
  highlighted?: boolean;
  index?: number;
  badge?: JSX.Element;
  children: JSX.Element;
}

export function SettingItem(props: SettingItemProps) {
  const className = () => {
    const classes = [settingItemClass];
    if (props.highlighted) classes.push(settingItemHighlightedClass);
    if (props.index !== undefined) classes.push(settingItemSlideInClass);
    return classes.join(" ");
  };

  const style = () =>
    props.index !== undefined
      ? { "animation-delay": `${Math.min(props.index, 15) * 0.03}s` }
      : undefined;

  return (
    <div
      class={className()}
      style={style()}
      id={props.id ? `setting-${props.id}` : undefined}
      data-setting-id={props.id}
    >
      <div class={settingItemLabelClass}>
        <span class={settingItemNameClass}>
          <span>{props.label}</span>
          <Show when={props.badge}>{props.badge}</Show>
        </span>
        <Show when={props.description}>
          <span class={settingItemDescriptionClass}>{props.description}</span>
        </Show>
      </div>
      <div class={settingItemControlClass}>{props.children}</div>
    </div>
  );
}
