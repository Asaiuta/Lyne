import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type JSX
} from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveTabsActivationMode = "automatic" | "manual";
export type NaiveTabsType = "bar" | "line" | "segment";
export type NaiveTabsSize = "small" | "medium" | "large";
export type NaiveTabsPlacement = "top" | "bottom" | "left" | "right";

export interface NaiveTabItem<TValue extends string = string> {
  value: TValue;
  label: string | JSX.Element;
  textValue?: string;
  disabled?: boolean;
}

export interface NaiveTabsProps<TValue extends string = string> {
  value: TValue;
  onChange: (next: TValue) => void;
  items: ReadonlyArray<NaiveTabItem<TValue>>;
  type?: NaiveTabsType;
  size?: NaiveTabsSize;
  placement?: NaiveTabsPlacement;
  activationMode?: NaiveTabsActivationMode;
  ariaLabel?: string;
  class?: string;
  navClass?: string;
  railClass?: string;
  wrapperClass?: string;
  tabClass?: string;
  tabActiveClass?: string;
  selectClass?: string;
}

export type NaiveTabsComponent = <TValue extends string>(
  props: NaiveTabsProps<TValue>
) => JSX.Element;

export interface NaiveTabRenderItem<TValue extends string = string> {
  value: TValue;
  label: string | JSX.Element;
  textValue: string;
  disabled: boolean;
}

export interface NaiveTabsResolvedProps<TValue extends string = string> {
  type: Accessor<NaiveTabsType>;
  size: Accessor<NaiveTabsSize>;
  placement: Accessor<NaiveTabsPlacement>;
  resolvedPlacement: Accessor<NaiveTabsPlacement>;
  orientation: Accessor<"horizontal" | "vertical">;
  items: Accessor<ReadonlyArray<NaiveTabRenderItem<TValue>>>;
  rootClass: Accessor<string>;
  navClass: Accessor<string>;
  railClass: Accessor<string>;
  wrapperClass: Accessor<string>;
  selectClass: Accessor<string>;
}

export interface NaiveTabsSegmentCapsule {
  railRef: (el: HTMLElement) => void;
  tabRef: (value: string, el: HTMLElement) => void;
  capsuleStyle: Accessor<JSX.CSSProperties>;
}

type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const defaultRootClass = "naive-tabs";
const defaultSelectClass = "naive-tabs-select hidden w-full";
const segmentRailPadding = 3;

let loadedNaiveTabs: NaiveTabsComponent | null = null;
let naiveTabsImport: Promise<NaiveTabsComponent> | null = null;

const tabType = <TValue extends string>(
  props: NaiveTabsProps<TValue>
): NaiveTabsType => props.type ?? "bar";
const tabSize = <TValue extends string>(
  props: NaiveTabsProps<TValue>
): NaiveTabsSize => props.size ?? "medium";
const tabPlacement = <TValue extends string>(
  props: NaiveTabsProps<TValue>
): NaiveTabsPlacement =>
  props.placement ?? "top";
const resolvedPlacementFor = (
  type: NaiveTabsType,
  placement: NaiveTabsPlacement
): NaiveTabsPlacement => (type === "segment" ? "top" : placement);

export const createNaiveTabsResolvedProps = <TValue extends string>(
  props: NaiveTabsProps<TValue>
): NaiveTabsResolvedProps<TValue> => {
  const type = () => tabType(props);
  const size = () => tabSize(props);
  const placement = () => tabPlacement(props);
  const resolvedPlacement = () => resolvedPlacementFor(type(), placement());
  const orientation = () =>
    resolvedPlacement() === "left" || resolvedPlacement() === "right"
      ? "vertical"
      : "horizontal";
  const items = createMemo<ReadonlyArray<NaiveTabRenderItem<TValue>>>(() =>
    props.items.map((item) => ({
      value: item.value,
      label: item.label,
      textValue: item.textValue ?? (typeof item.label === "string" ? item.label : item.value),
      disabled: item.disabled ?? false
    }))
  );
  const rootClass = () =>
    joinClassNames(
      defaultRootClass,
      "n-tabs",
      `n-tabs--${type()}-type`,
      `n-tabs--${size()}-size`,
      `n-tabs--${resolvedPlacement()}`,
      props.class
    );
  const navClass = () =>
    joinClassNames(
      "n-tabs-nav",
      `n-tabs-nav--${type()}-type`,
      `n-tabs-nav--${resolvedPlacement()}`,
      props.navClass
    );
  const railClass = () => joinClassNames("n-tabs-rail", props.railClass);
  const wrapperClass = () => joinClassNames("n-tabs-wrapper", props.wrapperClass);
  const selectClass = () => props.selectClass ?? defaultSelectClass;

  return {
    type,
    size,
    placement,
    resolvedPlacement,
    orientation,
    items,
    rootClass,
    navClass,
    railClass,
    wrapperClass,
    selectClass
  };
};

export const naiveTabsTabClass = (
  active: boolean,
  disabled: boolean,
  tabClass: string | undefined,
  activeClass: string | undefined
): string =>
  joinClassNames(
    "n-tabs-tab",
    active ? "n-tabs-tab--active" : false,
    disabled ? "n-tabs-tab--disabled" : false,
    tabClass,
    active ? activeClass : undefined
  );

export const createNaiveTabsSegmentCapsule = (
  value: Accessor<string>,
  items: Accessor<ReadonlyArray<NaiveTabRenderItem>>
): NaiveTabsSegmentCapsule => {
  const [capsuleStyle, setCapsuleStyle] = createSignal<JSX.CSSProperties>({
    opacity: 0,
    transform: "translateX(0px)"
  });
  const tabElements = new Map<string, HTMLElement>();
  let railEl: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let animationFrame = 0;

  const scheduleMeasure = (): void => {
    if (typeof window === "undefined") return;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(() => {
      if (!railEl) return;
      const activeEl = tabElements.get(value());
      if (!activeEl) {
        setCapsuleStyle({ opacity: 0, transform: "translateX(0px)" });
        return;
      }
      const railStyle = window.getComputedStyle(railEl);
      const railPaddingLeft = Number.parseFloat(railStyle.paddingLeft) || segmentRailPadding;
      setCapsuleStyle({
        width: `${activeEl.offsetWidth}px`,
        height: `${activeEl.offsetHeight}px`,
        opacity: 1,
        transform: `translateX(${activeEl.offsetLeft - railPaddingLeft}px)`
      });
    });
  };

  const railRef = (el: HTMLElement): void => {
    railEl = el;
    resizeObserver?.disconnect();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(el);
      tabElements.forEach((tabEl) => resizeObserver?.observe(tabEl));
    }
    scheduleMeasure();
  };

  const tabRef = (tabValue: string, el: HTMLElement): void => {
    tabElements.set(tabValue, el);
    resizeObserver?.observe(el);
    scheduleMeasure();
  };

  createEffect(() => {
    value();
    items().length;
    scheduleMeasure();
  });

  onCleanup(() => {
    if (typeof window !== "undefined") window.cancelAnimationFrame(animationFrame);
    resizeObserver?.disconnect();
    tabElements.clear();
  });

  return {
    railRef,
    tabRef,
    capsuleStyle
  };
};

const loadNaiveTabs = async (): Promise<NaiveTabsComponent> => {
  if (loadedNaiveTabs) return loadedNaiveTabs;
  naiveTabsImport ??= import("./NaiveTabsKobalte").then(
    (module) => module.NaiveTabsKobalte as NaiveTabsComponent
  );
  loadedNaiveTabs = await naiveTabsImport;
  return loadedNaiveTabs;
};

const preloadNaiveTabs = (): void => {
  void loadNaiveTabs();
};

export function NaiveTabs<TValue extends string>(
  props: NaiveTabsProps<TValue>
): JSX.Element {
  const [LoadedTabs, setLoadedTabs] = createSignal<NaiveTabsComponent | null>(loadedNaiveTabs);
  const resolved = createNaiveTabsResolvedProps(props);
  const segmentCapsule = createNaiveTabsSegmentCapsule(
    () => props.value,
    resolved.items
  );
  const buttons: Array<HTMLButtonElement | undefined> = [];

  const ensureLoaded = (): void => {
    void loadNaiveTabs().then((component) => setLoadedTabs(() => component));
  };
  const focusNext = (currentIndex: number, direction: 1 | -1): void => {
    const items = resolved.items();
    const total = items.length;
    let next = currentIndex;
    for (let step = 0; step < total; step += 1) {
      next = (next + direction + total) % total;
      const item = items[next];
      if (item && !item.disabled) {
        buttons[next]?.focus();
        if (props.activationMode !== "manual") props.onChange(item.value);
        return;
      }
    }
  };
  const activateFocused = (index: number): void => {
    const item = resolved.items()[index];
    if (item && !item.disabled) props.onChange(item.value);
  };
  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusNext(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusNext(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = resolved.items().findIndex((item) => !item.disabled);
      if (first >= 0) {
        buttons[first]?.focus();
        if (props.activationMode !== "manual") props.onChange(resolved.items()[first].value);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = resolved.items().length - 1; i >= 0; i -= 1) {
        const item = resolved.items()[i];
        if (item && !item.disabled) {
          buttons[i]?.focus();
          if (props.activationMode !== "manual") props.onChange(item.value);
          return;
        }
      }
    } else if (props.activationMode === "manual" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      activateFocused(index);
    }
  };

  onMount(() => {
    if (loadedNaiveTabs || typeof window === "undefined") return;

    const preloadWindow = window as IdlePreloadWindow;
    if (preloadWindow.requestIdleCallback) {
      const id = preloadWindow.requestIdleCallback(preloadNaiveTabs, { timeout: 800 });
      onCleanup(() => preloadWindow.cancelIdleCallback?.(id));
      return;
    }

    const id = preloadWindow.setTimeout(preloadNaiveTabs, 300);
    onCleanup(() => preloadWindow.clearTimeout(id));
  });

  return (
    <Show
      when={LoadedTabs()}
      fallback={
        <div
          class={resolved.rootClass()}
          onPointerEnter={preloadNaiveTabs}
          onFocusIn={ensureLoaded}
        >
          <div class={resolved.navClass()}>
            <Show
              when={resolved.type() === "segment"}
              fallback={
                <div class="n-tabs-nav-scroll-wrapper">
                  <div class="n-tabs-nav-scroll-content">
                    <div class={resolved.wrapperClass()} role="tablist" aria-label={props.ariaLabel}>
                      <For each={resolved.items()}>
                        {(item, index) => {
                          const active = () => item.value === props.value;
                          return (
                            <div class="n-tabs-tab-wrapper">
                              <Show when={index() !== 0}>
                                <div class="n-tabs-tab-pad" />
                              </Show>
                              <button
                                ref={(el) => {
                                  buttons[index()] = el;
                                }}
                                type="button"
                                role="tab"
                                data-name={item.value}
                                data-disabled={item.disabled ? "true" : undefined}
                                aria-selected={active()}
                                aria-disabled={item.disabled || undefined}
                                disabled={item.disabled}
                                class={naiveTabsTabClass(
                                  active(),
                                  item.disabled,
                                  props.tabClass,
                                  props.tabActiveClass
                                )}
                                tabIndex={active() ? 0 : -1}
                                onClick={() => {
                                  if (!item.disabled) props.onChange(item.value);
                                }}
                                onKeyDown={(event) => handleKeyDown(index(), event)}
                              >
                                <span class="n-tabs-tab__label">{item.label}</span>
                              </button>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                    <div class="n-tabs-bar" />
                  </div>
                </div>
              }
            >
              <div
                ref={segmentCapsule.railRef}
                class={resolved.railClass()}
                role="tablist"
                aria-label={props.ariaLabel}
              >
                <div class="n-tabs-capsule" style={segmentCapsule.capsuleStyle()} />
                <div class={resolved.wrapperClass()}>
                  <For each={resolved.items()}>
                    {(item, index) => {
                      const active = () => item.value === props.value;
                      return (
                        <div class="n-tabs-tab-wrapper">
                          <Show when={index() !== 0}>
                            <div class="n-tabs-tab-pad" />
                          </Show>
                          <button
                            ref={(el) => {
                              buttons[index()] = el;
                              segmentCapsule.tabRef(item.value, el);
                            }}
                            type="button"
                            role="tab"
                            data-name={item.value}
                            data-disabled={item.disabled ? "true" : undefined}
                            aria-selected={active()}
                            aria-disabled={item.disabled || undefined}
                            disabled={item.disabled}
                            class={naiveTabsTabClass(
                              active(),
                              item.disabled,
                              props.tabClass,
                              props.tabActiveClass
                            )}
                            tabIndex={active() ? 0 : -1}
                            onClick={() => {
                              if (!item.disabled) props.onChange(item.value);
                            }}
                            onKeyDown={(event) => handleKeyDown(index(), event)}
                          >
                            <span class="n-tabs-tab__label">{item.label}</span>
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
          <select
            class={resolved.selectClass()}
            value={props.value}
            onChange={(event) => props.onChange(event.currentTarget.value as TValue)}
            aria-label={props.ariaLabel}
          >
            <For each={resolved.items()}>
              {(item) => (
                <option value={item.value} disabled={item.disabled}>
                  {item.textValue}
                </option>
              )}
            </For>
          </select>
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
