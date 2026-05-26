import {
  createContext,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  NAIVE_GRID_DEFAULT_COLS,
  NAIVE_GRID_DEFAULT_SPAN,
  parseNaiveGridResponsiveValue,
  resolveNaiveGridItemStates,
  type NaiveGridRegisteredItem,
  type NaiveGridResponsive,
  type NaiveGridResponsiveValue
} from "./grid-logic";
import { joinClassNames, toCssLength } from "./utils";

export type NaiveGridStyle = JSX.HTMLAttributes<HTMLDivElement>["style"];

export interface NaiveGridProps {
  children: JSX.Element;
  class?: string;
  collapsed?: boolean;
  collapsedRows?: number;
  cols?: NaiveGridResponsiveValue;
  id?: string;
  itemResponsive?: boolean;
  itemStyle?: NaiveGridStyle;
  layoutShiftDisabled?: boolean;
  responsive?: NaiveGridResponsive | false;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  style?: NaiveGridStyle;
  xGap?: NaiveGridResponsiveValue;
  yGap?: NaiveGridResponsiveValue;
}

export interface NaiveGridItemRenderState {
  overflow: boolean;
}

export interface NaiveGridItemProps {
  children: JSX.Element | ((state: NaiveGridItemRenderState) => JSX.Element);
  class?: string;
  offset?: NaiveGridResponsiveValue;
  role?: JSX.HTMLAttributes<HTMLDivElement>["role"];
  span?: NaiveGridResponsiveValue;
  style?: NaiveGridStyle;
  suffix?: boolean;
}

interface NaiveGridContextValue {
  itemStyle: Accessor<NaiveGridStyle | undefined>;
  itemState: (id: string) => {
    colStart?: number;
    offset: number;
    overflow: boolean;
    show: boolean;
    span: number;
  };
  register: (item: NaiveGridRegisteredItem) => void;
  unregister: (id: string) => void;
  update: (item: NaiveGridRegisteredItem) => void;
  xGap: Accessor<string>;
}

const NaiveGridContext = createContext<NaiveGridContextValue | null>(null);

const isResponsiveValue = (value: NaiveGridResponsiveValue | undefined): boolean =>
  typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim());

const styleName = (name: string): string =>
  name.startsWith("--")
    ? name
    : name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

const styleObjectToString = (
  style: Exclude<NaiveGridStyle, string | undefined>
): string =>
  Object.entries(style as Record<string, string | number | undefined>)
    .filter(([, value]) => value != null && String(value).length > 0)
    .map(([name, value]) => `${styleName(name)}:${value}`)
    .join(";");

const mergeStyle = (
  base: NaiveGridStyle | undefined,
  next: NaiveGridStyle | undefined
): NaiveGridStyle => {
  if (next == null) return base ?? {};
  if (typeof base === "string") {
    const serialized =
      typeof next === "string" ? next : styleObjectToString(next);
    return serialized.length > 0 ? `${base};${serialized}` : base;
  }
  if (typeof next === "string") {
    const serialized = base == null ? "" : styleObjectToString(base);
    return serialized.length > 0 ? `${serialized};${next}` : next;
  }
  return { ...base, ...next };
};

const appendStyle = (
  base: NaiveGridStyle,
  next: NaiveGridStyle | undefined
): NaiveGridStyle => {
  if (next == null) return base;
  if (typeof base === "string") {
    return typeof next === "string" ? `${base};${next}` : mergeStyle(base, next);
  }
  if (typeof next === "string") return mergeStyle(next, base);
  return { ...base, ...next };
};

const createNaiveGridQuery = (props: NaiveGridProps) => {
  const [selfWidth, setSelfWidth] = createSignal<number | undefined>(undefined);
  const [screenWidth, setScreenWidth] = createSignal<number | undefined>(
    typeof window === "undefined" ? undefined : window.innerWidth
  );
  let rootEl: HTMLDivElement | undefined;

  const ref = (el: HTMLDivElement): void => {
    rootEl = el;
    setSelfWidth(el.getBoundingClientRect().width);
  };

  onMount(() => {
    if (typeof window === "undefined") return;

    const updateScreenWidth = (): void => {
      setScreenWidth(window.innerWidth);
    };
    window.addEventListener("resize", updateScreenWidth);
    onCleanup(() => window.removeEventListener("resize", updateScreenWidth));

    if (!rootEl || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setSelfWidth(entry.contentRect.width);
    });
    observer.observe(rootEl);
    onCleanup(() => observer.disconnect());
  });

  const query = () => {
    const responsive = props.responsive ?? "self";
    if (responsive === false || props.layoutShiftDisabled) return undefined;
    const needsResponsive =
      props.itemResponsive ||
      isResponsiveValue(props.cols) ||
      isResponsiveValue(props.xGap) ||
      isResponsiveValue(props.yGap);
    if (!needsResponsive) return undefined;
    return responsive === "screen" ? screenWidth() : selfWidth();
  };

  return { query, ref };
};

export function NaiveGrid(props: NaiveGridProps): JSX.Element {
  const { query, ref } = createNaiveGridQuery(props);
  const [items, setItems] = createSignal<ReadonlyArray<NaiveGridRegisteredItem>>([]);
  const cols = () =>
    Math.max(
      1,
      Math.floor(
        parseNaiveGridResponsiveValue(
          props.cols,
          query(),
          props.cols == null ? NAIVE_GRID_DEFAULT_COLS : NAIVE_GRID_DEFAULT_COLS
        )
      )
    );
  const xGap = () =>
    toCssLength(parseNaiveGridResponsiveValue(props.xGap, query(), 0)) ?? "0px";
  const yGap = () =>
    toCssLength(parseNaiveGridResponsiveValue(props.yGap, query(), 0)) ?? "0px";
  const states = createMemo(() =>
    resolveNaiveGridItemStates({
      collapsed: props.collapsed ?? false,
      collapsedRows: props.collapsedRows ?? 1,
      cols: cols(),
      items: items(),
      query: query()
    })
  );
  const gridStyle = () =>
    mergeStyle(props.style, {
      "column-gap": xGap(),
      display: "grid",
      "grid-template-columns": `repeat(${cols()}, minmax(0, 1fr))`,
      "row-gap": yGap(),
      width: "100%"
    });
  const upsertItem = (item: NaiveGridRegisteredItem): void => {
    setItems((current) => {
      const index = current.findIndex((entry) => entry.id === item.id);
      if (index < 0) return [...current, item];
      return current.map((entry) => (entry.id === item.id ? item : entry));
    });
  };
  const context: NaiveGridContextValue = {
    itemStyle: () => props.itemStyle,
    itemState: (id) =>
      states()[id] ?? {
        offset: 0,
        overflow: false,
        show: true,
        span: NAIVE_GRID_DEFAULT_SPAN
      },
    register: upsertItem,
    unregister: (id) => setItems((current) => current.filter((item) => item.id !== id)),
    update: upsertItem,
    xGap
  };

  return (
    <NaiveGridContext.Provider value={context}>
      <div
        ref={ref}
        id={props.id}
        class={joinClassNames("naive-grid", "n-grid", props.class)}
        role={props.role}
        style={gridStyle()}
      >
        {props.children}
      </div>
    </NaiveGridContext.Provider>
  );
}

export function NaiveGridItem(props: NaiveGridItemProps): JSX.Element {
  const context = useContext(NaiveGridContext);
  const id = createUniqueId();

  createEffect(() => {
    context?.update({
      id,
      offset: props.offset ?? 0,
      span: props.span ?? NAIVE_GRID_DEFAULT_SPAN,
      suffix: props.suffix ?? false
    });
  });
  onCleanup(() => context?.unregister(id));

  const state = () => context?.itemState(id) ?? {
    offset: 0,
    overflow: false,
    show: true,
    span: NAIVE_GRID_DEFAULT_SPAN
  };
  const itemStyle = () => {
    const itemState = state();
    const span = Math.max(1, itemState.span);
    const offset = itemState.offset;
    const xGap = context?.xGap() ?? "0px";
    const gridColumn = `${itemState.colStart ?? `span ${span}`} / span ${span}`;
    const marginLeft =
      offset > 0
        ? `calc((100% - (${span} - 1) * ${xGap}) / ${span} * ${offset} + ${xGap} * ${offset})`
        : "";
    return mergeStyle(context?.itemStyle(), {
      display: itemState.show ? undefined : "none",
      "grid-column": gridColumn,
      "margin-left": marginLeft
    });
  };
  const children = () => {
    if (typeof props.children === "function") {
      return props.children({ overflow: state().overflow });
    }
    return props.children;
  };

  return (
    <div
      class={joinClassNames("naive-grid-item", "n-gi", props.class)}
      role={props.role}
      style={appendStyle(itemStyle(), props.style)}
    >
      {children()}
    </div>
  );
}

export const NaiveGi = NaiveGridItem;
