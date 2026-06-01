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
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export * from "./dropdown.shared";

type FallbackDropdownPosition = {
  readonly left: number;
  readonly top: number;
};

const DROPDOWN_FALLBACK_LEAVE_PRESENCE_MS = 180;
const DROPDOWN_FALLBACK_VIEWPORT_PADDING = 8;
const DROPDOWN_FALLBACK_OPTION_HEIGHT = 34;
const DROPDOWN_FALLBACK_DIVIDER_HEIGHT = 9;
const DROPDOWN_FALLBACK_VERTICAL_PADDING = 8;
const DROPDOWN_FALLBACK_MIN_WIDTH = 120;

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
  let fallbackMenu: HTMLDivElement | undefined;
  const [uncontrolledOpen, setUncontrolledOpen] =
    createSignal<boolean>(props.defaultOpen ?? false);
  const [fallbackPresent, setFallbackPresent] =
    createSignal<boolean>(fallbackOpenState(props));
  const [fallbackPosition, setFallbackPosition] =
    createSignal<FallbackDropdownPosition | null>(null);
  let fallbackLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  const triggerMode = () => fallbackTriggerMode(props);
  const controlledOpen = () => props.show ?? props.open;
  const open = (): boolean => controlledOpen() ?? uncontrolledOpen();
  const isVirtual = (): boolean =>
    typeof props.x === "number" && typeof props.y === "number";
  const estimatedMenuHeight = (): number =>
    props.options.reduce(
      (height, option) =>
        height +
        (option.type === "divider"
          ? DROPDOWN_FALLBACK_DIVIDER_HEIGHT
          : DROPDOWN_FALLBACK_OPTION_HEIGHT),
      DROPDOWN_FALLBACK_VERTICAL_PADDING
    );
  const estimatedMenuWidth = (): number =>
    props.class === "player-inline-menu-popover" ? 168 : DROPDOWN_FALLBACK_MIN_WIDTH;
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
  const updateFallbackPosition = (): void => {
    if (typeof window === "undefined") return;

    const anchorRect = isVirtual()
      ? {
          left: props.x ?? 0,
          right: props.x ?? 0,
          top: props.y ?? 0,
          bottom: props.y ?? 0,
          width: 0,
          height: 0
        }
      : fallbackRoot?.getBoundingClientRect();
    if (!anchorRect) return;

    const placement = props.placement ?? "bottom-start";
    const side = placement.split("-")[0] ?? "bottom";
    const align = placement.split("-")[1] ?? "center";
    const gutter = props.gutter ?? 6;
    const estimatedWidth = estimatedMenuWidth();
    const estimatedHeight = estimatedMenuHeight();
    const rawLeft =
      side === "left"
        ? anchorRect.left - gutter - estimatedWidth
        : side === "right"
          ? anchorRect.right + gutter
          : align === "end"
            ? anchorRect.right - estimatedWidth
            : align === "start"
              ? anchorRect.left
              : anchorRect.left + anchorRect.width / 2 - estimatedWidth / 2;
    const rawTop =
      side === "top"
        ? anchorRect.top - gutter - estimatedHeight
        : side === "bottom"
          ? anchorRect.bottom + gutter
          : align === "end"
            ? anchorRect.bottom - estimatedHeight
            : align === "start"
              ? anchorRect.top
              : anchorRect.top + anchorRect.height / 2 - estimatedHeight / 2;

    setFallbackPosition({
      left: Math.max(
        DROPDOWN_FALLBACK_VIEWPORT_PADDING,
        Math.min(rawLeft, window.innerWidth - estimatedWidth - DROPDOWN_FALLBACK_VIEWPORT_PADDING)
      ),
      top: Math.max(
        DROPDOWN_FALLBACK_VIEWPORT_PADDING,
        Math.min(rawTop, window.innerHeight - estimatedHeight - DROPDOWN_FALLBACK_VIEWPORT_PADDING)
      )
    });
  };
  const setFallbackOpen = (nextOpen: boolean): void => {
    if (props.disabled) return;
    if (nextOpen) {
      updateFallbackPosition();
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
      setFallbackPresent(true);
      props.onWarmup();
      queueMicrotask(updateFallbackPosition);
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
      if (target instanceof Node && fallbackMenu?.contains(target)) return;
      setFallbackOpen(false);
    };
    const handleLayoutChange = () => updateFallbackPosition();

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, true);
    });
  });

  onCleanup(clearFallbackLeaveTimer);

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
        when={
          fallbackPresent() && typeof document !== "undefined"
            ? fallbackPosition()
            : null
        }
      >
        {(position) => (
          <Portal mount={props.to ?? document.body}>
            <div
              ref={fallbackMenu}
              class={naiveDropdownMenuClass({ class: props.class })}
              role="menu"
              aria-label={props.ariaLabel}
              aria-hidden={!open()}
              data-closed={!open() ? "" : undefined}
              style={{
                position: "fixed",
                left: `${position().left}px`,
                top: `${position().top}px`,
                "pointer-events": open() ? "auto" : "none"
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
        )}
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
