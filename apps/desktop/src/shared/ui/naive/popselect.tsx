import {
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX
} from "solid-js";
import { Portal } from "solid-js/web";
import { NaiveButton } from "./button";
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

type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

type FallbackPopoverPosition = {
  readonly left: number;
  readonly top: number;
};

let loadedNaivePopselect: NaivePopselectComponent | null = null;
let naivePopselectImport: Promise<NaivePopselectComponent> | null = null;

const fallbackClass = (className: string | undefined, fallback: string): string =>
  className ?? fallback;

const activeClass = (active: boolean, className: string | undefined): string | false =>
  active ? className ?? "is-active" : false;

const loadNaivePopselect = async (): Promise<NaivePopselectComponent> => {
  if (loadedNaivePopselect) return loadedNaivePopselect;
  naivePopselectImport ??= import("./NaivePopselectKobalte").then(
    (module) => module.NaivePopselectKobalte as NaivePopselectComponent
  );
  loadedNaivePopselect = await naivePopselectImport;
  return loadedNaivePopselect;
};

const preloadNaivePopselect = (): void => {
  void loadNaivePopselect();
};

export function NaivePopselect<TValue extends string>(
  props: NaivePopselectProps<TValue>
): JSX.Element {
  let fallbackRoot: HTMLDivElement | undefined;
  let fallbackPopover: HTMLDivElement | undefined;
  const [LoadedPopselect, setLoadedPopselect] =
    createSignal<NaivePopselectComponent | null>(loadedNaivePopselect);
  const [fallbackPosition, setFallbackPosition] = createSignal<FallbackPopoverPosition | null>(
    null
  );

  const popoverWidth = () => props.fallbackPopoverWidth ?? 100;
  const gutter = () => props.gutter ?? 10;
  const rootClass = () => fallbackClass(props.class, "naive-popselect");
  const triggerClass = () =>
    joinClassNames(
      fallbackClass(props.triggerClass, "naive-popselect-trigger"),
      props.open ? props.triggerOpenClass ?? "is-open" : false
    );
  const popoverClass = () => fallbackClass(props.popoverClass, "naive-popselect-popover");
  const optionClass = (active: boolean) =>
    joinClassNames(
      fallbackClass(props.optionClass, "naive-popselect-option"),
      activeClass(active, props.optionActiveClass)
    );
  const optionContentClass = () =>
    fallbackClass(props.optionContentClass, "naive-popselect-option-content");
  const optionCheckClass = () =>
    fallbackClass(props.optionCheckClass, "naive-popselect-option-check");

  const ensureLoaded = (): void => {
    void loadNaivePopselect().then((component) => setLoadedPopselect(() => component));
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
  const stopPropagationIfNeeded = (event: Event): void => {
    if (props.stopTriggerPropagation) event.stopPropagation();
  };

  createEffect(() => {
    if (props.open) ensureLoaded();
  });

  createEffect(() => {
    if (!props.open || LoadedPopselect()) {
      setFallbackPosition(null);
      return;
    }
    updateFallbackPosition();
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

  onMount(() => {
    if (loadedNaivePopselect || typeof window === "undefined") return;

    const preloadWindow = window as IdlePreloadWindow;
    if (preloadWindow.requestIdleCallback) {
      const id = preloadWindow.requestIdleCallback(preloadNaivePopselect, { timeout: 1200 });
      onCleanup(() => preloadWindow.cancelIdleCallback?.(id));
      return;
    }

    const id = preloadWindow.setTimeout(preloadNaivePopselect, 600);
    onCleanup(() => preloadWindow.clearTimeout(id));
  });

  return (
    <Show
      when={LoadedPopselect()}
      fallback={
        <div
          ref={fallbackRoot}
          class={rootClass()}
          onPointerEnter={preloadNaivePopselect}
          onFocusIn={preloadNaivePopselect}
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
          <Show when={props.open && typeof document !== "undefined" ? fallbackPosition() : null}>
            {(position) => (
              <Portal mount={document.body}>
                <div
                  ref={fallbackPopover}
                  class={popoverClass()}
                  role="menu"
                  aria-label={props.label}
                  style={{
                    left: `${position().left}px`,
                    top: `${position().top}px`,
                    width: `${popoverWidth()}px`
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
                          <span class={optionContentClass()}>{option.label}</span>
                          <Show when={active() && props.renderCheck}>
                            <span class={optionCheckClass()} aria-hidden="true">
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
