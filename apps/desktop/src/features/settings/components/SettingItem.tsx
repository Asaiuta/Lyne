import { Show, type JSX } from "solid-js";

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
