import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { NaiveDivider } from "../../shared/ui/naive";
import { useDismissibleOverlay } from "../../shared/ui/useDismissibleOverlay";

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

const EDGE_PADDING = 8;

function SubMenuItem(
  props: {
    item: ContextMenuItem;
    onSelect: (key: string) => void;
    onClose: () => void;
  }
) {
  const [submenuOpen, setSubmenuOpen] = createSignal(false);
  let itemRef: HTMLDivElement | undefined;
  let submenuRef: HTMLDivElement | undefined;
  let closeTimer: number | undefined;

  const handleEnter = () => {
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    setSubmenuOpen(true);
  };

  const handleLeave = () => {
    closeTimer = window.setTimeout(() => setSubmenuOpen(false), 150);
  };

  const submenuPosition = () => {
    const parentRect = itemRef?.getBoundingClientRect();
    if (!parentRect) return { top: 0, left: 0 };

    let top = parentRect.top;
    let left = parentRect.right + 4;

    if (typeof window !== "undefined" && submenuRef) {
      const submenuRect = submenuRef.getBoundingClientRect();
      const submenuWidth = submenuRect.width || 200;
      const submenuHeight = submenuRect.height || (props.item.children!.length * 36 + 16);

      if (left + submenuWidth > window.innerWidth - EDGE_PADDING) {
        left = Math.max(EDGE_PADDING, parentRect.left - submenuWidth - 4);
      }
      if (top + submenuHeight > window.innerHeight - EDGE_PADDING) {
        top = Math.max(EDGE_PADDING, window.innerHeight - submenuHeight - EDGE_PADDING);
      }
    }

    return { top, left };
  };

  return (
    <>
      <div
        ref={itemRef}
        class="context-menu-item context-menu-item--has-submenu"
        classList={{ "context-menu-item--submenu-open": submenuOpen() }}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        role="menuitem"
        aria-haspopup="true"
        aria-expanded={submenuOpen()}
      >
        <Show when={props.item.icon}>
          {(icon) => (
            <span class="context-menu-icon" aria-hidden="true">
              {icon()}
            </span>
          )}
        </Show>
        <span class="context-menu-label">{props.item.label}</span>
        <span class="context-menu-submenu-arrow" aria-hidden="true">▸</span>
      </div>
      <Show when={submenuOpen() && typeof document !== "undefined"}>
        <Portal mount={document.body}>
          <div
            ref={submenuRef}
            class="context-menu-submenu"
            style={{
              top: `${submenuPosition().top}px`,
              left: `${submenuPosition().left}px`
            }}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
            role="menu"
          >
            <For each={props.item.children!}>
              {(child) => (
                <Show
                  when={!child.divider}
                  fallback={<NaiveDivider class="context-menu-divider" />}
                >
                  <button
                    type="button"
                    role="menuitem"
                    class="context-menu-item"
                    disabled={child.disabled}
                    onClick={() => {
                      if (child.disabled) return;
                      props.onSelect(child.key);
                      props.onClose();
                    }}
                  >
                    <Show when={child.icon}>
                      {(icon) => (
                        <span class="context-menu-icon" aria-hidden="true">
                          {icon()}
                        </span>
                      )}
                    </Show>
                    <span class="context-menu-label">{child.label}</span>
                  </button>
                </Show>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

export function ContextMenu(props: ContextMenuProps) {
  let menuRef: HTMLDivElement | undefined;
  const [position, setPosition] = createSignal({ top: props.y, left: props.x });

  createEffect(() => {
    if (!props.open) {
      return;
    }

    props.items;
    const frame = window.requestAnimationFrame(() => {
      const node = menuRef;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      let top = props.y;
      let left = props.x;
      if (left + rect.width > window.innerWidth - EDGE_PADDING) {
        left = Math.max(EDGE_PADDING, window.innerWidth - rect.width - EDGE_PADDING);
      }
      if (top + rect.height > window.innerHeight - EDGE_PADDING) {
        top = Math.max(EDGE_PADDING, props.y - rect.height);
      }
      setPosition({ top, left });
    });

    onCleanup(() => window.cancelAnimationFrame(frame));
  });

  useDismissibleOverlay(() => props.open, {
    isInside: (target) => {
      if (menuRef && menuRef.contains(target)) return true;
      const submenus = document.querySelectorAll(".context-menu-submenu");
      for (const submenu of submenus) {
        if (submenu.contains(target)) return true;
      }
      return false;
    },
    onDismiss: () => props.onClose(),
    scroll: true,
    blur: true
  });

  return (
    <Show when={props.open && typeof document !== "undefined"}>
      <Portal mount={document.body}>
        <div
          ref={menuRef}
          class="context-menu"
          style={{ top: `${position().top}px`, left: `${position().left}px` }}
          role="menu"
        >
          <Show when={props.header}>
            {(header) => (
              <>
                {header()}
                <NaiveDivider class="context-menu-divider" />
              </>
            )}
          </Show>
          <For each={props.items}>
            {(item) => (
              <Show
                when={!item.divider}
                fallback={<NaiveDivider class="context-menu-divider" />}
              >
                <Show
                  when={item.children && item.children.length > 0}
                  fallback={
                    <button
                      type="button"
                      role="menuitem"
                      class="context-menu-item"
                      disabled={item.disabled}
                      onClick={() => {
                        if (item.disabled) return;
                        props.onSelect(item.key);
                        props.onClose();
                      }}
                    >
                      <Show when={item.icon}>
                        {(icon) => (
                          <span class="context-menu-icon" aria-hidden="true">
                            {icon()}
                          </span>
                        )}
                      </Show>
                      <span class="context-menu-label">{item.label}</span>
                    </button>
                  }
                >
                  <SubMenuItem
                    item={item}
                    onSelect={props.onSelect}
                    onClose={props.onClose}
                  />
                </Show>
              </Show>
            )}
          </For>
        </div>
      </Portal>
    </Show>
  );
}
