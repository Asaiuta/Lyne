import {
  Show,
  createContext,
  createMemo,
  createSignal,
  onMount,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  naiveCollapseNameKey,
  normalizeNaiveCollapseNames,
  type NaiveCollapseExpandedNamesInput,
  type NaiveCollapseHeaderClickInfo,
  type NaiveCollapseName
} from "./collapse-logic";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export type {
  NaiveCollapseExpandedNamesInput,
  NaiveCollapseHeaderClickInfo,
  NaiveCollapseName
};

export type NaiveCollapseArrowPlacement = "left" | "right";

export interface NaiveCollapseProps {
  accordion?: boolean;
  expandedNames?: NaiveCollapseExpandedNamesInput;
  defaultExpandedNames?: NaiveCollapseExpandedNamesInput;
  arrowPlacement?: NaiveCollapseArrowPlacement;
  onUpdateExpandedNames?: (names: string[]) => void;
  onItemHeaderClick?: (info: NaiveCollapseHeaderClickInfo) => void;
  class?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children?: JSX.Element;
}

export interface NaiveCollapseItemHeaderOptions {
  readonly collapsed: boolean;
}

export interface NaiveCollapseItemProps {
  name: NaiveCollapseName;
  title?: JSX.Element;
  disabled?: boolean;
  header?: JSX.Element | ((options: NaiveCollapseItemHeaderOptions) => JSX.Element);
  class?: string;
  children?: JSX.Element;
}

export interface NaiveCollapseRenderState {
  active: boolean;
  disabled: boolean;
  arrowPlacement: NaiveCollapseArrowPlacement;
}

export interface NaiveCollapseContextValue {
  expandedNames: Accessor<readonly string[]>;
  arrowPlacement: Accessor<NaiveCollapseArrowPlacement>;
  isExpanded: (name: NaiveCollapseName) => boolean;
}

interface NaiveCollapseFamily {
  Collapse: (props: NaiveCollapseProps) => JSX.Element;
  CollapseItem: (props: NaiveCollapseItemProps) => JSX.Element;
}

const NaiveCollapseContext = createContext<NaiveCollapseContextValue | null>(null);

const lazyNaiveCollapseFamily = createLazyNaive<NaiveCollapseFamily>(() =>
  import("./NaiveCollapseKobalte").then((module) => ({
    Collapse: module.NaiveCollapseKobalte,
    CollapseItem: module.NaiveCollapseItemKobalte
  }))
);

export const useNaiveCollapse = (): NaiveCollapseContextValue | null =>
  useContext(NaiveCollapseContext);

export const naiveCollapseClass = (
  props: Pick<NaiveCollapseProps, "class">
): string => joinClassNames("n-collapse", props.class);

export const naiveCollapseItemClass = (
  props: Pick<NaiveCollapseItemProps, "class">,
  state: NaiveCollapseRenderState
): string =>
  joinClassNames(
    "n-collapse-item",
    state.active ? "n-collapse-item--active" : false,
    state.disabled ? "n-collapse-item--disabled" : false,
    `n-collapse-item--${state.arrowPlacement}-arrow-placement`,
    props.class
  );

export const createNaiveCollapseContext = (
  expandedNames: Accessor<readonly string[]>,
  arrowPlacement: Accessor<NaiveCollapseArrowPlacement>
): NaiveCollapseContextValue => {
  const expandedSet = createMemo(() => new Set(expandedNames()));
  return {
    expandedNames,
    arrowPlacement,
    isExpanded: (name) => expandedSet().has(naiveCollapseNameKey(name))
  };
};

export const renderNaiveCollapseHeader = (
  props: Pick<NaiveCollapseItemProps, "header" | "title">,
  collapsed: boolean
): JSX.Element => {
  if (typeof props.header === "function") return props.header({ collapsed });
  return props.header ?? props.title;
};

function NaiveCollapseFallback(
  props: NaiveCollapseProps & { onWarmup?: () => void }
): JSX.Element {
  const expandedNames = () => normalizeNaiveCollapseNames(props.expandedNames);
  const context = createNaiveCollapseContext(
    expandedNames,
    () => props.arrowPlacement ?? "left"
  );

  return (
    <NaiveCollapseContext.Provider value={context}>
      <div
        id={props.id}
        class={naiveCollapseClass(props)}
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
        aria-hidden="true"
        onPointerEnter={props.onWarmup}
        onFocusIn={props.onWarmup}
      >
        {props.children}
      </div>
    </NaiveCollapseContext.Provider>
  );
}

function NaiveCollapseItemFallback(props: NaiveCollapseItemProps): JSX.Element {
  const group = useNaiveCollapse();
  const active = () => group?.isExpanded(props.name) ?? false;
  const arrowPlacement = () => group?.arrowPlacement() ?? "left";
  const collapsed = () => !active();

  return (
    <div
      class={naiveCollapseItemClass(props, {
        active: active(),
        disabled: props.disabled ?? false,
        arrowPlacement: arrowPlacement()
      })}
    >
      <div class="n-collapse-item__header">
        <div class="n-collapse-item__header-main">
          <span class="n-collapse-item-arrow" data-arrow aria-hidden="true" />
          <span class="n-collapse-item__header-title">
            {renderNaiveCollapseHeader(props, collapsed())}
          </span>
        </div>
      </div>
      <Show when={active()}>
        <div class="n-collapse-item__content-wrapper">
          <div class="n-collapse-item__content-inner">{props.children}</div>
        </div>
      </Show>
    </div>
  );
}

export function NaiveCollapse(props: NaiveCollapseProps): JSX.Element {
  const [Family, setFamily] =
    createSignal<NaiveCollapseFamily | null>(lazyNaiveCollapseFamily.getLoaded());
  const ensureLoaded = (): void => {
    void lazyNaiveCollapseFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show
      when={Family()}
      fallback={<NaiveCollapseFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(family) => {
        const Component = family().Collapse;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export function NaiveCollapseItem(props: NaiveCollapseItemProps): JSX.Element {
  const [Family, setFamily] =
    createSignal<NaiveCollapseFamily | null>(lazyNaiveCollapseFamily.getLoaded());
  const ensureLoaded = (): void => {
    void lazyNaiveCollapseFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show when={Family()} fallback={<NaiveCollapseItemFallback {...props} />}>
      {(family) => {
        const Component = family().CollapseItem;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export { NaiveCollapseContext };
