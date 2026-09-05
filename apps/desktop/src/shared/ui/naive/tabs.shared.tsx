import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
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

const defaultRootClass = "naive-tabs";
const defaultSelectClass = "naive-tabs-select hidden w-full";

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
    transform: "translate(0px, 0px)"
  });
  const tabElements = new Map<string, HTMLElement>();
  let railEl: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let animationFrame = 0;

  const scheduleMeasure = (): void => {
    if (typeof window === "undefined") return;
    window.cancelAnimationFrame(animationFrame);
    // Items are keyed by object identity; an async count update rebuilds the
    // whole tab list, so the registered element can briefly be detached (or
    // report a 0-size rect) mid-rebuild. Measuring that transient state would
    // pin the capsule to a wrong/shrunk size until the next trigger. Retry a
    // few frames before committing to a measurement; if the element is gone
    // for good, fall back to hiding the capsule.
    //
    // Sizing/positioning intentionally uses layout offsets (offsetWidth /
    // offsetHeight / offsetLeft chain) instead of getBoundingClientRect:
    // rect values are visual-space and get distorted by ancestor transforms
    // (page-enter scale, hero zoom), which would shrink the capsule to the
    // animated scale; offset* are layout-space and always stable.
    let retries = 0;
    const measure = (): void => {
      if (!railEl) return;
      const activeEl = tabElements.get(value());
      if (!activeEl) {
        if (retries < 3) {
          retries += 1;
          animationFrame = window.requestAnimationFrame(measure);
          return;
        }
        setCapsuleStyle({ opacity: 0, transform: "translate(0px, 0px)" });
        return;
      }
      const stale = !activeEl.isConnected || activeEl.offsetWidth <= 0 || activeEl.offsetHeight <= 0;
      if (stale) {
        if (retries < 3) {
          retries += 1;
          animationFrame = window.requestAnimationFrame(measure);
          return;
        }
        return;
      }
      // Layout-space position of the active tab relative to the rail,
      // walking the offsetParent chain (the rail is position-relative). This
      // mirrors naive-ui's segment capsule algorithm (offsetWidth/offsetLeft)
      // and stays immune to ancestor transforms. The chain offset already
      // starts at the rail's border-box origin (padding included), matching
      // the capsule's absolute top/left baseline, so no padding subtraction
      // is applied.
      let offsetLeft = activeEl.offsetLeft;
      let offsetTop = activeEl.offsetTop;
      let ancestor = activeEl.offsetParent as HTMLElement | null;
      while (ancestor && ancestor !== railEl) {
        offsetLeft += ancestor.offsetLeft;
        offsetTop += ancestor.offsetTop;
        ancestor = ancestor.offsetParent as HTMLElement | null;
      }
      setCapsuleStyle({
        width: `${activeEl.offsetWidth}px`,
        height: `${activeEl.offsetHeight}px`,
        opacity: 1,
        transform: `translate(${Math.max(0, offsetLeft)}px, ${Math.max(0, offsetTop)}px)`
      });
    };
    animationFrame = window.requestAnimationFrame(measure);
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
