import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  type JSX
} from "solid-js";
import { Portal } from "solid-js/web";
import { NaiveButton } from "./button";
import {
  computeFloatingPosition,
  type FloatingPosition
} from "./floating-position";
import {
  naivePopselectOptionCheckClass,
  naivePopselectOptionClass,
  naivePopselectOptionContentClass,
  naivePopselectPopoverClass,
  naivePopselectRootClass,
  naivePopselectTriggerClass,
  type NaivePopselectComponent,
  type NaivePopselectProps
} from "./popselect.shared";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export * from "./popselect.shared";

const POPSELECT_LEAVE_PRESENCE_MS = 180;

const lazyNaivePopselect = createLazyNaive<NaivePopselectComponent>(() =>
  import("./NaivePopselectKobalte").then(
    (module) => module.NaivePopselectKobalte as NaivePopselectComponent
  )
);

export function NaivePopselect<TValue extends string>(
  props: NaivePopselectProps<TValue>
): JSX.Element {
  let fallbackRoot: HTMLDivElement | undefined;
  const [fallbackPopover, setFallbackPopover] =
    createSignal<HTMLDivElement | null>(null);
  const [LoadedPopselect, setLoadedPopselect] =
    createSignal<NaivePopselectComponent | null>(lazyNaivePopselect.getLoaded());
  const [loadedWasRendered, setLoadedWasRendered] =
    createSignal<boolean>(lazyNaivePopselect.getLoaded() != null);
  const [fallbackPosition, setFallbackPosition] =
    createSignal<FloatingPosition | null>(null);
  const [fallbackPresent, setFallbackPresent] = createSignal<boolean>(props.open);
  let fallbackLeaveTimer: ReturnType<typeof setTimeout> | undefined;
  let fallbackPositionFrame: number | undefined;

  const gutter = () => props.gutter ?? 10;
  const renderedLoadedPopselect = (): NaivePopselectComponent | null => {
    const Loaded = LoadedPopselect();
    if (!Loaded) return null;
    if (!loadedWasRendered() && !props.open && fallbackPresent()) return null;
    return Loaded;
  };
  const rootClass = () => naivePopselectRootClass(props);
  const triggerClass = () => naivePopselectTriggerClass(props, props.open);
  const popoverPresenceClass = () => naivePopselectPopoverClass(props, props.open);
  const optionClass = (active: boolean) => naivePopselectOptionClass(props, active);
  const optionContentClass = () => naivePopselectOptionContentClass(props);
  const optionCheckClass = () => naivePopselectOptionCheckClass(props);

  const ensureLoaded = (): void => {
    void lazyNaivePopselect.load().then((component) => setLoadedPopselect(() => component));
  };
  const cancelFallbackPositionFrame = (): void => {
    if (fallbackPositionFrame === undefined || typeof window === "undefined") return;
    window.cancelAnimationFrame(fallbackPositionFrame);
    fallbackPositionFrame = undefined;
  };
  const updateFallbackPosition = (): void => {
    if (typeof window === "undefined") return;
    const trigger = fallbackRoot?.querySelector<HTMLButtonElement>(
      "[data-naive-popselect-trigger]"
    );
    const popover = fallbackPopover();
    if (!trigger || !popover) return;

    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    if (width <= 0 || height <= 0) return;

    setFallbackPosition(
      computeFloatingPosition({
        anchor: trigger.getBoundingClientRect(),
        content: { width, height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        placement: props.placement ?? "bottom",
        gutter: gutter()
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
  const clearFallbackLeaveTimer = (): void => {
    if (fallbackLeaveTimer === undefined) return;
    clearTimeout(fallbackLeaveTimer);
    fallbackLeaveTimer = undefined;
  };
  const stopPropagationIfNeeded = (event: Event): void => {
    if (props.stopTriggerPropagation) event.stopPropagation();
  };

  createEffect(() => {
    if (props.open) ensureLoaded();
  });

  createEffect(() => {
    if (props.open && LoadedPopselect()) setLoadedWasRendered(true);
  });

  createEffect(() => {
    if (LoadedPopselect()) {
      if (props.open || !fallbackPresent()) setFallbackPosition(null);
      return;
    }
    if (props.open) scheduleFallbackPositionUpdate();
  });

  createEffect(() => {
    if (props.open) {
      clearFallbackLeaveTimer();
      setFallbackPosition(null);
      setFallbackPresent(true);
      scheduleFallbackPositionUpdate();
      return;
    }
    if (!fallbackPresent()) return;
    clearFallbackLeaveTimer();
    fallbackLeaveTimer = setTimeout(() => {
      fallbackLeaveTimer = undefined;
      setFallbackPresent(false);
      setFallbackPosition(null);
    }, POPSELECT_LEAVE_PRESENCE_MS);
  });

  createEffect(() => {
    if (!props.open || LoadedPopselect() || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onOpenChange(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && fallbackRoot?.contains(target)) return;
      if (target instanceof Node && fallbackPopover()?.contains(target)) return;
      props.onOpenChange(false);
    };
    const handleLayoutChange = () => scheduleFallbackPositionUpdate();
    const popover = fallbackPopover();
    const resizeObserver =
      popover && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleLayoutChange)
        : null;

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, true);
    if (resizeObserver && popover) resizeObserver.observe(popover);
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

  lazyNaivePopselect.useIdlePreload({ idleTimeout: 1200, fallbackDelay: 600 });

  onCleanup(() => {
    clearFallbackLeaveTimer();
    cancelFallbackPositionFrame();
  });

  return (
    <Show
      when={renderedLoadedPopselect()}
      fallback={
        <div
          ref={fallbackRoot}
          class={rootClass()}
          onPointerEnter={lazyNaivePopselect.preload}
          onFocusIn={lazyNaivePopselect.preload}
        >
          <NaiveButton
            class={triggerClass()}
            ariaLabel={props.label}
            ariaHasPopup="menu"
            ariaExpanded={props.open}
            title={props.label}
            dataNaivePopselectTrigger={true}
            onPointerDown={stopPropagationIfNeeded}
            onClick={(event) => {
              stopPropagationIfNeeded(event);
              const nextOpen = !props.open;
              props.onOpenChange(nextOpen);
              if (nextOpen) {
                setFallbackPosition(null);
                scheduleFallbackPositionUpdate();
                ensureLoaded();
              }
            }}
          >
            {props.triggerContent}
          </NaiveButton>
          <Show
            when={fallbackPresent() && typeof document !== "undefined"}
          >
            <Portal mount={document.body}>
              <div
                ref={(element) => {
                  setFallbackPopover(element);
                  scheduleFallbackPositionUpdate();
                }}
                class={popoverPresenceClass()}
                role="menu"
                aria-label={props.label}
                aria-hidden={!props.open || fallbackPosition() == null}
                style={{
                  position: "fixed",
                  left: `${fallbackPosition()?.left ?? 0}px`,
                  top: `${fallbackPosition()?.top ?? 0}px`,
                  visibility: fallbackPosition() == null ? "hidden" : "visible",
                  "pointer-events":
                    props.open && fallbackPosition() != null ? "auto" : "none"
                }}
              >
                <For each={props.options}>
                  {(option) => {
                    const active = () => props.value === option.value;
                    return (
                      <NaiveButton
                        class={optionClass(active())}
                        role="menuitemradio"
                        ariaChecked={active()}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onChange(option.value);
                          props.onOpenChange(false);
                        }}
                      >
                        <span
                          class={joinClassNames(
                            "n-base-select-option__content",
                            optionContentClass()
                          )}
                        >
                          {option.label}
                        </span>
                        <Show when={active() && props.renderCheck}>
                          <span
                            class={joinClassNames(
                              "n-base-select-option__check",
                              optionCheckClass()
                            )}
                            aria-hidden="true"
                          >
                            {props.renderCheck?.(option)}
                          </span>
                        </Show>
                      </NaiveButton>
                    );
                  }}
                </For>
              </div>
            </Portal>
          </Show>
        </div>
      }
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
