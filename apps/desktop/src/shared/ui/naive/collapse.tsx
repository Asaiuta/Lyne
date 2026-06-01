import {
  Show,
  createSignal,
  onMount,
  type JSX
} from "solid-js";
import { normalizeNaiveCollapseNames } from "./collapse-logic";
import {
  NaiveCollapseContext,
  createNaiveCollapseContext,
  naiveCollapseClass,
  naiveCollapseItemClass,
  renderNaiveCollapseHeader,
  useNaiveCollapse,
  type NaiveCollapseFamily,
  type NaiveCollapseItemProps,
  type NaiveCollapseProps
} from "./collapse.shared";
import { createLazyNaive } from "./lazy-naive";

export * from "./collapse.shared";

const lazyNaiveCollapseFamily = createLazyNaive<NaiveCollapseFamily>(() =>
  import("./NaiveCollapseKobalte").then((module) => ({
    Collapse: module.NaiveCollapseKobalte,
    CollapseItem: module.NaiveCollapseItemKobalte
  }))
);

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
