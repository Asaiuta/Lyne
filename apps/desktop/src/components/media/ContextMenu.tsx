import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { NaiveDivider } from "../../shared/ui/naive";
import {
  computeFloatingPosition,
  FLOATING_VIEWPORT_PADDING,
  type FloatingPosition
} from "../../shared/ui/naive/floating-position";
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

const EDGE_PADDING = FLOATING_VIEWPORT_PADDING;

const pointAnchor = (x: number, y: number) => ({
  left: x,
  right: x,
  top: y,
  bottom: y,
  width: 0,
  height: 0
});

function SubMenuItem(
  props: {
    item: ContextMenuItem;
    onSelect: (key: string) => void;
    onClose: () => void;
  }
) {
  const [submenuOpen, setSubmenuOpen] = createSignal(false);
  let itemRef: HTMLDivElement | undefined;
  const [submenuElement, setSubmenuElement] =
    createSignal<HTMLDivElement | null>(null);
  const [submenuPosition, setSubmenuPosition] =
    createSignal<FloatingPosition | null>(null);
  let closeTimer: number | undefined;
  let positionFrame: number | undefined;

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

  const cancelPositionFrame = (): void => {
    if (positionFrame === undefined) return;
    window.cancelAnimationFrame(positionFrame);
    positionFrame = undefined;
  };

  const updateSubmenuPosition = (): void => {
    const parentRect = itemRef?.getBoundingClientRect();
    const submenu = submenuElement();
    if (!parentRect || !submenu) return;

    const width = submenu.offsetWidth;
    const height = submenu.offsetHeight;
    if (width <= 0 || height <= 0) return;

    setSubmenuPosition(
      computeFloatingPosition({
        anchor: parentRect,
        content: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: "right-start",
        gutter: 4,
        padding: EDGE_PADDING
      })
    );
  };

  const schedulePositionUpdate = (): void => {
    if (positionFrame !== undefined) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = undefined;
      updateSubmenuPosition();
    });
  };

  createEffect(() => {
    if (!submenuOpen()) {
      setSubmenuPosition(null);
      cancelPositionFrame();
      return;
    }

    const submenu = submenuElement();
    const handleLayoutChange = () => schedulePositionUpdate();
    const resizeObserver =
      submenu && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleLayoutChange)
        : null;

    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    if (resizeObserver && submenu) resizeObserver.observe(submenu);
    schedulePositionUpdate();
    onCleanup(() => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
      resizeObserver?.disconnect();
    });
  });

  onCleanup(() => {
    if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    cancelPositionFrame();
  });

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
            ref={(element) => {
              setSubmenuElement(element);
              schedulePositionUpdate();
            }}
            class="context-menu-submenu"
            style={{
              top: `${submenuPosition()?.top ?? 0}px`,
              left: `${submenuPosition()?.left ?? 0}px`,
              visibility: submenuPosition() == null ? "hidden" : "visible"
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
  const [menuElement, setMenuElement] = createSignal<HTMLDivElement | null>(null);
  const [position, setPosition] = createSignal<FloatingPosition | null>(null);
  let positionFrame: number | undefined;

  const cancelPositionFrame = (): void => {
    if (positionFrame === undefined) return;
    window.cancelAnimationFrame(positionFrame);
    positionFrame = undefined;
  };

  const updatePosition = (): void => {
    const menu = menuElement();
    if (!props.open || !menu) return;

    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    if (width <= 0 || height <= 0) return;

    setPosition(
      computeFloatingPosition({
        anchor: pointAnchor(props.x, props.y),
        content: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: "bottom-start",
        padding: EDGE_PADDING
      })
    );
  };

  const schedulePositionUpdate = (): void => {
    if (positionFrame !== undefined) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = undefined;
      updatePosition();
    });
  };

  createEffect(() => {
    if (!props.open) {
      setPosition(null);
      cancelPositionFrame();
      return;
    }

    props.items;
    props.x;
    props.y;
    const menu = menuElement();
    const handleLayoutChange = () => schedulePositionUpdate();
    const resizeObserver =
      menu && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleLayoutChange)
        : null;

    setPosition(null);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    if (resizeObserver && menu) resizeObserver.observe(menu);
    schedulePositionUpdate();
    onCleanup(() => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
      resizeObserver?.disconnect();
    });
  });

  onCleanup(cancelPositionFrame);

  useDismissibleOverlay(() => props.open, {
    isInside: (target) => {
      if (menuElement()?.contains(target)) return true;
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
          ref={(element) => {
            setMenuElement(element);
            schedulePositionUpdate();
          }}
          class="context-menu"
          style={{
            top: `${position()?.top ?? 0}px`,
            left: `${position()?.left ?? 0}px`,
            visibility: position() == null ? "hidden" : "visible"
          }}
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
