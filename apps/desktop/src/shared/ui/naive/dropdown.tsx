import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type JSX
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  naiveDropdownDividerClass,
  naiveDropdownMenuClass,
  naiveDropdownOptionClass,
  naiveDropdownOptionLabelClass,
  naiveDropdownOptionPrefixClass,
  naiveDropdownOptionSuffixClass,
  type NaiveDropdownComponent,
  type NaiveDropdownOption,
  type NaiveDropdownProps,
  type NaiveDropdownTriggerMode
} from "./dropdown.shared";
import {
  computeFloatingPosition,
  type FloatingAnchorRect,
  type FloatingPosition
} from "./floating-position";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export * from "./dropdown.shared";

const DROPDOWN_FALLBACK_LEAVE_PRESENCE_MS = 180;

const lazyNaiveDropdown = createLazyNaive<NaiveDropdownComponent>(() =>
  import("./NaiveDropdownKobalte").then(
    (module) => module.NaiveDropdownKobalte as NaiveDropdownComponent
  )
);

const fallbackOpenState = (props: NaiveDropdownProps): boolean =>
  props.show ?? props.open ?? props.defaultOpen ?? false;

const fallbackTriggerMode = (props: NaiveDropdownProps): NaiveDropdownTriggerMode =>
  props.triggerMode ?? "hover";

interface FallbackDropdownOptionRowProps {
  option: NaiveDropdownOption;
  onSelect: (option: NaiveDropdownOption) => void;
  mountTarget?: HTMLElement;
  menuClass: string;
  registerSurface: (element: HTMLElement) => void;
  unregisterSurface: (element: HTMLElement) => void;
}

function FallbackDropdownOptionContent(props: {
  option: NaiveDropdownOption;
}): JSX.Element {
  return (
    <>
      <Show when={props.option.icon != null}>
        <span
          class={naiveDropdownOptionPrefixClass({ hasIcon: true })}
          aria-hidden="true"
        >
          {props.option.icon}
        </span>
      </Show>
      <span class={naiveDropdownOptionLabelClass()}>{props.option.label}</span>
      <Show when={props.option.suffix != null}>
        <span class={naiveDropdownOptionSuffixClass()} aria-hidden="true">
          {props.option.suffix}
        </span>
      </Show>
    </>
  );
}

function FallbackDropdownSubmenuRow(
  props: FallbackDropdownOptionRowProps
): JSX.Element {
  const [open, setOpen] = createSignal<boolean>(false);
  const [submenu, setSubmenu] = createSignal<HTMLDivElement | null>(null);
  const [position, setPosition] = createSignal<FloatingPosition | null>(null);
  let trigger: HTMLButtonElement | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let positionFrame: number | undefined;

  const clearCloseTimer = (): void => {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
  };
  const cancelPositionFrame = (): void => {
    if (positionFrame === undefined || typeof window === "undefined") return;
    window.cancelAnimationFrame(positionFrame);
    positionFrame = undefined;
  };
  const updatePosition = (): void => {
    if (typeof window === "undefined") return;
    const anchor = trigger?.getBoundingClientRect();
    const content = submenu();
    if (!anchor || !content || content.offsetWidth <= 0 || content.offsetHeight <= 0) return;
    setPosition(
      computeFloatingPosition({
        anchor,
        content: { width: content.offsetWidth, height: content.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: "right-start",
        gutter: 4
      })
    );
  };
  const schedulePosition = (): void => {
    if (positionFrame !== undefined || typeof window === "undefined") return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = undefined;
      updatePosition();
    });
  };
  const openSubmenu = (focusFirst = false): void => {
    if (props.option.disabled) return;
    clearCloseTimer();
    setOpen(true);
    setPosition(null);
    schedulePosition();
    if (focusFirst) {
      window.setTimeout(() => {
        submenu()
          ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
          ?.focus();
      }, 0);
    }
  };
  const scheduleClose = (): void => {
    clearCloseTimer();
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      setOpen(false);
      setPosition(null);
    }, 150);
  };

  createEffect(() => {
    if (!open() || typeof window === "undefined") return;
    const handleLayoutChange = (): void => schedulePosition();
    const content = submenu();
    const observer =
      content && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleLayoutChange)
        : undefined;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    if (content) observer?.observe(content);
    schedulePosition();
    onCleanup(() => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
      observer?.disconnect();
      cancelPositionFrame();
    });
  });

  onCleanup(() => {
    clearCloseTimer();
    cancelPositionFrame();
    const content = submenu();
    if (content) props.unregisterSurface(content);
  });

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open()}
        aria-disabled={props.option.disabled ? "true" : undefined}
        disabled={props.option.disabled}
        data-key={props.option.key}
        data-expanded={open() ? "" : undefined}
        class={naiveDropdownOptionClass({
          disabled: props.option.disabled,
          className: props.option.class
        })}
        onPointerEnter={() => openSubmenu()}
        onPointerLeave={scheduleClose}
        onClick={() => (open() ? setOpen(false) : openSubmenu())}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openSubmenu(true);
          }
        }}
      >
        <FallbackDropdownOptionContent option={props.option} />
      </button>
      <Show when={open() && typeof document !== "undefined"}>
        <Portal mount={props.mountTarget ?? document.body}>
          <div
            ref={(element) => {
              setSubmenu(element);
              props.registerSurface(element);
              schedulePosition();
            }}
            class={joinClassNames(props.menuClass, "n-dropdown-submenu")}
            role="menu"
            aria-hidden={position() == null}
            style={{
              position: "fixed",
              left: `${position()?.left ?? 0}px`,
              top: `${position()?.top ?? 0}px`,
              visibility: position() == null ? "hidden" : "visible"
            }}
            onPointerEnter={clearCloseTimer}
            onPointerLeave={scheduleClose}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft") return;
              event.preventDefault();
              setOpen(false);
              trigger?.focus();
            }}
          >
            <For each={props.option.children}>
              {(option) => <FallbackDropdownOptionTreeRow {...props} option={option} />}
            </For>
          </div>
        </Portal>
      </Show>
    </>
  );
}

function FallbackDropdownOptionTreeRow(
  props: FallbackDropdownOptionRowProps
): JSX.Element {
  if (props.option.type === "divider") {
    return <div class={naiveDropdownDividerClass()} role="separator" aria-hidden="true" />;
  }
  if (props.option.children && props.option.children.length > 0) {
    return <FallbackDropdownSubmenuRow {...props} />;
  }
  return (
    <button
      type="button"
      role="menuitem"
      disabled={props.option.disabled}
      aria-disabled={props.option.disabled ? "true" : undefined}
      data-disabled={props.option.disabled ? "" : undefined}
      data-key={props.option.key}
      class={naiveDropdownOptionClass({
        disabled: props.option.disabled,
        className: props.option.class
      })}
      onClick={() => props.onSelect(props.option)}
    >
      <FallbackDropdownOptionContent option={props.option} />
    </button>
  );
}

function NaiveDropdownFallback(props: NaiveDropdownProps & {
  onWarmup: () => void;
}): JSX.Element {
  let fallbackRoot: HTMLSpanElement | undefined;
  const [fallbackMenu, setFallbackMenu] = createSignal<HTMLDivElement | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] =
    createSignal<boolean>(props.defaultOpen ?? false);
  const [fallbackPresent, setFallbackPresent] =
    createSignal<boolean>(fallbackOpenState(props));
  const [fallbackPosition, setFallbackPosition] =
    createSignal<FloatingPosition | null>(null);
  let fallbackLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackPositionFrame: number | undefined;
  const fallbackSubmenuSurfaces = new Set<HTMLElement>();
  const triggerMode = () => fallbackTriggerMode(props);
  const controlledOpen = () => props.show ?? props.open;
  const open = (): boolean => controlledOpen() ?? uncontrolledOpen();
  const isVirtual = (): boolean =>
    typeof props.x === "number" && typeof props.y === "number";
  const emitOpenChange = (open: boolean): void => {
    if (controlledOpen() === undefined) setUncontrolledOpen(open);
    props.onOpenChange?.(open);
    if (isVirtual()) {
      props.onShowChange?.(open);
    }
  };
  const clearFallbackLeaveTimer = (): void => {
    if (fallbackLeaveTimer === undefined) return;
    clearTimeout(fallbackLeaveTimer);
    fallbackLeaveTimer = undefined;
  };
  const cancelFallbackPositionFrame = (): void => {
    if (fallbackPositionFrame === undefined || typeof window === "undefined") return;
    window.cancelAnimationFrame(fallbackPositionFrame);
    fallbackPositionFrame = undefined;
  };
  const fallbackAnchorRect = (): FloatingAnchorRect | null => {
    if (isVirtual()) {
      const x = props.x ?? 0;
      const y = props.y ?? 0;
      return {
        left: x,
        right: x,
        top: y,
        bottom: y,
        width: 0,
        height: 0
      };
    }
    return fallbackRoot?.getBoundingClientRect() ?? null;
  };
  const updateFallbackPosition = (): void => {
    if (typeof window === "undefined") return;
    const anchorRect = fallbackAnchorRect();
    const menu = fallbackMenu();
    if (!anchorRect || !menu) return;

    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    if (width <= 0 || height <= 0) return;

    setFallbackPosition(
      computeFloatingPosition({
        anchor: anchorRect,
        content: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: props.placement ?? "bottom-start",
        gutter: props.gutter ?? 6
      })
    );
  };
  const scheduleFallbackPositionUpdate = (): void => {
    if (typeof window === "undefined" || fallbackPositionFrame !== undefined) return;
    fallbackPositionFrame = window.requestAnimationFrame(() => {
      fallbackPositionFrame = undefined;
      updateFallbackPosition();
    });
  };
  const setFallbackOpen = (nextOpen: boolean): void => {
    if (props.disabled) return;
    if (nextOpen) {
      setFallbackPosition(null);
      props.onWarmup();
    }
    emitOpenChange(nextOpen);
  };
  const handleSelect = (option: NaiveDropdownOption): void => {
    if (option.disabled || option.type === "divider") return;
    option.onSelect?.(option);
    props.onSelect?.(option);
    setFallbackOpen(false);
  };

  createEffect(() => {
    if (open()) {
      clearFallbackLeaveTimer();
      setFallbackPosition(null);
      setFallbackPresent(true);
      props.onWarmup();
      scheduleFallbackPositionUpdate();
      return;
    }
    if (!fallbackPresent()) return;
    clearFallbackLeaveTimer();
    fallbackLeaveTimer = setTimeout(() => {
      fallbackLeaveTimer = undefined;
      setFallbackPresent(false);
      setFallbackPosition(null);
    }, DROPDOWN_FALLBACK_LEAVE_PRESENCE_MS);
  });

  createEffect(() => {
    if (!open() || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFallbackOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && fallbackRoot?.contains(target)) return;
      if (target instanceof Node && fallbackMenu()?.contains(target)) return;
      if (
        target instanceof Node &&
        [...fallbackSubmenuSurfaces].some((surface) => surface.contains(target))
      ) {
        return;
      }
      setFallbackOpen(false);
    };
    const handleLayoutChange = () => scheduleFallbackPositionUpdate();
    const menu = fallbackMenu();
    const resizeObserver =
      menu && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleLayoutChange)
        : null;

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    if (resizeObserver && menu) resizeObserver.observe(menu);
    scheduleFallbackPositionUpdate();
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
      resizeObserver?.disconnect();
      cancelFallbackPositionFrame();
    });
  });

  onCleanup(() => {
    clearFallbackLeaveTimer();
    cancelFallbackPositionFrame();
    fallbackSubmenuSurfaces.clear();
  });

  return (
    <span
      ref={fallbackRoot}
      class={joinClassNames("naive-dropdown-trigger", props.triggerClass)}
      style={props.triggerStyle}
      data-naive-dropdown-trigger
      onPointerEnter={() => {
        props.onWarmup();
        if (triggerMode() === "hover") setFallbackOpen(true);
      }}
      onPointerLeave={() => {
        if (triggerMode() === "hover") setFallbackOpen(false);
      }}
      onFocusIn={() => props.onWarmup()}
      onClick={() => {
        props.onWarmup();
        if (triggerMode() === "click") setFallbackOpen(!open());
      }}
    >
      {props.children}
      <Show
        when={fallbackPresent() && typeof document !== "undefined"}
      >
        <Portal mount={props.to ?? document.body}>
          <div
            ref={(element) => {
              setFallbackMenu(element);
              scheduleFallbackPositionUpdate();
            }}
            class={naiveDropdownMenuClass({ class: props.class })}
            role="menu"
            aria-label={props.ariaLabel}
            aria-hidden={!open() || fallbackPosition() == null}
            data-closed={!open() ? "" : undefined}
            style={{
              position: "fixed",
              left: `${fallbackPosition()?.left ?? 0}px`,
              top: `${fallbackPosition()?.top ?? 0}px`,
              visibility: fallbackPosition() == null ? "hidden" : "visible",
              "pointer-events": open() && fallbackPosition() != null ? "auto" : "none"
            }}
            onPointerEnter={() => {
              if (triggerMode() === "hover") {
                clearFallbackLeaveTimer();
                emitOpenChange(true);
              }
            }}
            onPointerLeave={() => {
              if (triggerMode() === "hover") setFallbackOpen(false);
            }}
          >
            {props.header}
            <For each={props.options}>
              {(option) => (
                <FallbackDropdownOptionTreeRow
                  option={option}
                  onSelect={handleSelect}
                  mountTarget={props.to}
                  menuClass={naiveDropdownMenuClass({ class: props.class })}
                  registerSurface={(element) => fallbackSubmenuSurfaces.add(element)}
                  unregisterSurface={(element) => fallbackSubmenuSurfaces.delete(element)}
                />
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </span>
  );
}

export function NaiveDropdown(props: NaiveDropdownProps): JSX.Element {
  const [LoadedDropdown, setLoadedDropdown] =
    createSignal<NaiveDropdownComponent | null>(lazyNaiveDropdown.getLoaded());

  const ensureLoaded = (): void => {
    void lazyNaiveDropdown.load().then((component) => setLoadedDropdown(() => component));
  };

  lazyNaiveDropdown.useIdlePreload({ idleTimeout: 1200, fallbackDelay: 600 });

  return (
    <Show
      when={LoadedDropdown()}
      fallback={<NaiveDropdownFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
