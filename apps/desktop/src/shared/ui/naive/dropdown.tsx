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
            <For each={props.options}>
              {(option) => (
                <Show
                  when={option.type === "divider"}
                  fallback={
                    <button
                      type="button"
                      role="menuitem"
                      disabled={option.disabled}
                      aria-disabled={option.disabled ? "true" : undefined}
                      data-disabled={option.disabled ? "" : undefined}
                      data-key={option.key}
                      class={naiveDropdownOptionClass({
                        disabled: option.disabled,
                        className: option.class
                      })}
                      onClick={() => handleSelect(option)}
                    >
                      <Show when={option.icon != null}>
                        <span
                          class={naiveDropdownOptionPrefixClass({ hasIcon: true })}
                          aria-hidden="true"
                        >
                          {option.icon}
                        </span>
                      </Show>
                      <span class={naiveDropdownOptionLabelClass()}>{option.label}</span>
                      <Show when={option.suffix != null}>
                        <span class={naiveDropdownOptionSuffixClass()} aria-hidden="true">
                          {option.suffix}
                        </span>
                      </Show>
                    </button>
                  }
                >
                  <div class={naiveDropdownDividerClass()} role="separator" aria-hidden="true" />
                </Show>
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
