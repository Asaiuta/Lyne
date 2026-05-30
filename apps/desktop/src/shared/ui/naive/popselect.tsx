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
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export interface NaivePopselectOption<TValue extends string> {
  value: TValue;
  label: string;
}

export type NaivePopselectPlacement =
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "top"
  | "top-start"
  | "top-end"
  | "left"
  | "right";

export interface NaivePopselectProps<TValue extends string> {
  label: string;
  open: boolean;
  value: TValue;
  options: ReadonlyArray<NaivePopselectOption<TValue>>;
  triggerContent: JSX.Element;
  class?: string;
  triggerClass?: string;
  triggerOpenClass?: string;
  popoverClass?: string;
  optionClass?: string;
  optionActiveClass?: string;
  optionContentClass?: string;
  optionCheckClass?: string;
  placement?: NaivePopselectPlacement;
  gutter?: number;
  fallbackPopoverWidth?: number;
  stopTriggerPropagation?: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: TValue) => void;
  renderCheck?: (option: NaivePopselectOption<TValue>) => JSX.Element;
}

export type NaivePopselectComponent = <TValue extends string>(
  props: NaivePopselectProps<TValue>
) => JSX.Element;

type FallbackPopoverPosition = {
  readonly left: number;
  readonly top: number;
};

const POPSELECT_LEAVE_PRESENCE_MS = 180;

const lazyNaivePopselect = createLazyNaive<NaivePopselectComponent>(() =>
  import("./NaivePopselectKobalte").then(
    (module) => module.NaivePopselectKobalte as NaivePopselectComponent
  )
);

const fallbackClass = (className: string | undefined, fallback: string): string =>
  className ?? fallback;

const activeClass = (active: boolean, className: string | undefined): string | false =>
  active ? className ?? "is-active" : false;

export function NaivePopselect<TValue extends string>(
  props: NaivePopselectProps<TValue>
): JSX.Element {
  let fallbackRoot: HTMLDivElement | undefined;
  let fallbackPopover: HTMLDivElement | undefined;
  const [LoadedPopselect, setLoadedPopselect] =
    createSignal<NaivePopselectComponent | null>(lazyNaivePopselect.getLoaded());
  const [loadedWasRendered, setLoadedWasRendered] =
    createSignal<boolean>(lazyNaivePopselect.getLoaded() != null);
  const [fallbackPosition, setFallbackPosition] = createSignal<FallbackPopoverPosition | null>(
    null
  );
  const [fallbackPresent, setFallbackPresent] = createSignal<boolean>(props.open);
  let fallbackLeaveTimer: ReturnType<typeof setTimeout> | undefined;

  const popoverWidth = () => props.fallbackPopoverWidth ?? 100;
  const gutter = () => props.gutter ?? 10;
  const renderedLoadedPopselect = (): NaivePopselectComponent | null => {
    const Loaded = LoadedPopselect();
    if (!Loaded) return null;
    if (!loadedWasRendered() && !props.open && fallbackPresent()) return null;
    return Loaded;
  };
  const rootClass = () => fallbackClass(props.class, "naive-popselect");
  const triggerClass = () =>
    joinClassNames(
      fallbackClass(props.triggerClass, "naive-popselect-trigger"),
      props.open ? props.triggerOpenClass ?? "is-open" : false
    );
  const popoverClass = () => fallbackClass(props.popoverClass, "naive-popselect-popover");
  const popoverPresenceClass = () =>
    joinClassNames(
      "n-popselect-menu",
      "n-base-select-menu",
      popoverClass(),
      props.open ? "is-open" : "is-closing",
      "is-naive-popselect-transition"
    );
  const optionClass = (active: boolean) =>
    joinClassNames(
      "n-base-select-option",
      "n-base-select-option--show-checkmark",
      fallbackClass(props.optionClass, "naive-popselect-option"),
      activeClass(active, "n-base-select-option--selected"),
      activeClass(active, props.optionActiveClass)
    );
  const optionContentClass = () =>
    fallbackClass(props.optionContentClass, "naive-popselect-option-content");
  const optionCheckClass = () =>
    fallbackClass(props.optionCheckClass, "naive-popselect-option-check");

  const ensureLoaded = (): void => {
    void lazyNaivePopselect.load().then((component) => setLoadedPopselect(() => component));
  };
  const updateFallbackPosition = (): void => {
    const trigger = fallbackRoot?.querySelector<HTMLButtonElement>(
      "[data-naive-popselect-trigger]"
    );
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = popoverWidth();
    setFallbackPosition({
      left: rect.left + rect.width / 2 - width / 2,
      top: rect.bottom + gutter()
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
    if (props.open) updateFallbackPosition();
  });

  createEffect(() => {
    if (props.open) {
      clearFallbackLeaveTimer();
      setFallbackPresent(true);
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
      if (target instanceof Node && fallbackPopover?.contains(target)) return;
      props.onOpenChange(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    });
  });

  lazyNaivePopselect.useIdlePreload({ idleTimeout: 1200, fallbackDelay: 600 });

  onCleanup(clearFallbackLeaveTimer);

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
                updateFallbackPosition();
                ensureLoaded();
              }
            }}
          >
            {props.triggerContent}
          </NaiveButton>
          <Show
            when={
              fallbackPresent() && typeof document !== "undefined"
                ? fallbackPosition()
                : null
            }
          >
            {(position) => (
              <Portal mount={document.body}>
                <div
                  ref={fallbackPopover}
                  class={popoverPresenceClass()}
                  role="menu"
                  aria-label={props.label}
                  aria-hidden={!props.open}
                  style={{
                    left: `${position().left}px`,
                    top: `${position().top}px`,
                    width: `${popoverWidth()}px`,
                    "pointer-events": props.open ? "auto" : "none"
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
            )}
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
