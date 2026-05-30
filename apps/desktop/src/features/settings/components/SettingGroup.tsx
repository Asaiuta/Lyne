import type { JSX } from "solid-js";

interface SettingGroupProps {
  title: string;
  children: JSX.Element;
}

export function SettingGroup(props: SettingGroupProps) {
  return (
    <div class="settings-section-group">
      <h3 class="settings-section-group-title">
        <span class="settings-section-group-title-bar" aria-hidden="true" />
        <span>{props.title}</span>
      </h3>
      {props.children}
    </div>
  );
}
