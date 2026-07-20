import { Show, createMemo, type JSX } from "solid-js";
import "../../shared/styles/pages/context-menu.css";
import {
  NaiveDivider,
  NaiveDropdown,
  type NaiveDropdownOption
} from "../../shared/ui/naive";
import { IconChevronRight } from "../icons";

export interface ContextMenuItem {
  key: string;
  label: string;
  icon?: JSX.Element;
  disabled?: boolean;
  divider?: boolean;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  header?: JSX.Element;
  items: ContextMenuItem[];
  onSelect: (key: string) => void;
  onClose: () => void;
}

const toDropdownOption = (item: ContextMenuItem): NaiveDropdownOption => {
  if (item.divider) {
    return { key: item.key, type: "divider" };
  }
  const children = item.children?.map(toDropdownOption);
  return {
    key: item.key,
    label: item.label,
    icon: item.icon ? <span class="context-menu-icon">{item.icon}</span> : undefined,
    disabled: item.disabled,
    suffix: children && children.length > 0
      ? <IconChevronRight class="context-menu-submenu-arrow" />
      : undefined,
    children
  };
};

export function ContextMenu(props: ContextMenuProps) {
  const options = createMemo<ReadonlyArray<NaiveDropdownOption>>(() =>
    props.items.map(toDropdownOption)
  );

  return (
    <NaiveDropdown
      triggerMode="manual"
      placement="bottom-start"
      gutter={0}
      x={props.x}
      y={props.y}
      show={props.open}
      onShowChange={(open) => {
        if (!open) props.onClose();
      }}
      class="context-menu"
      options={options()}
      onSelect={(option) => {
        props.onSelect(option.key);
        props.onClose();
      }}
      header={
        <Show when={props.header}>
          {(header) => (
            <div class="context-menu-header">
              {header()}
              <NaiveDivider class="context-menu-divider" />
            </div>
          )}
        </Show>
      }
    />
  );
}
