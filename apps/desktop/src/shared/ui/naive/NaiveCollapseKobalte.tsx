import { Accordion as KobalteAccordion } from "@kobalte/core/accordion";
import { Show, createSignal, type JSX } from "solid-js";
import type { NaiveCollapseItemProps, NaiveCollapseProps } from "./collapse.shared";
import {
  NaiveCollapseContext,
  createNaiveCollapseContext,
  naiveCollapseClass,
  naiveCollapseItemClass,
  renderNaiveCollapseHeader,
  useNaiveCollapse
} from "./collapse.shared";
import {
  naiveCollapseNameKey,
  normalizeNaiveCollapseNames,
  resolveNaiveCollapseHeaderClick
} from "./collapse-logic";

export function NaiveCollapseKobalte(props: NaiveCollapseProps): JSX.Element {
  const [localExpanded, setLocalExpanded] = createSignal<string[]>(
    normalizeNaiveCollapseNames(props.defaultExpandedNames)
  );
  const expandedNames = () =>
    props.expandedNames === undefined
      ? localExpanded()
      : normalizeNaiveCollapseNames(props.expandedNames);
  const arrowPlacement = () => props.arrowPlacement ?? "left";
  const context = createNaiveCollapseContext(expandedNames, arrowPlacement);

  const handleChange = (next: string[]): void => {
    const previous = expandedNames();
    setLocalExpanded(next);
    props.onUpdateExpandedNames?.(next);
    const headerClick = resolveNaiveCollapseHeaderClick(previous, next);
    if (headerClick) props.onItemHeaderClick?.(headerClick);
  };

  return (
    <NaiveCollapseContext.Provider value={context}>
      <KobalteAccordion
        id={props.id}
        class={naiveCollapseClass(props)}
        value={expandedNames()}
        defaultValue={normalizeNaiveCollapseNames(props.defaultExpandedNames)}
        onChange={handleChange}
        multiple={!(props.accordion ?? false)}
        collapsible
        aria-label={props.ariaLabel}
        aria-labelledby={props.ariaLabelledBy}
      >
        {props.children}
      </KobalteAccordion>
    </NaiveCollapseContext.Provider>
  );
}

export function NaiveCollapseItemKobalte(
  props: NaiveCollapseItemProps
): JSX.Element {
  const group = useNaiveCollapse();
  const itemName = () => naiveCollapseNameKey(props.name);
  const active = () => group?.isExpanded(itemName()) ?? false;
  const arrowPlacement = () => group?.arrowPlacement() ?? "left";
  const collapsed = () => !active();

  return (
    <KobalteAccordion.Item
      value={itemName()}
      disabled={props.disabled}
      class={naiveCollapseItemClass(props, {
        active: active(),
        disabled: props.disabled ?? false,
        arrowPlacement: arrowPlacement()
      })}
    >
      <KobalteAccordion.Header as="div" class="n-collapse-item__header">
        <KobalteAccordion.Trigger class="n-collapse-item__header-main">
          <span class="n-collapse-item-arrow" data-arrow aria-hidden="true" />
          <span class="n-collapse-item__header-title">
            {renderNaiveCollapseHeader(props, collapsed())}
          </span>
        </KobalteAccordion.Trigger>
      </KobalteAccordion.Header>
      <KobalteAccordion.Content class="n-collapse-item__content-wrapper">
        <Show when={active()}>
          <div class="n-collapse-item__content-inner">{props.children}</div>
        </Show>
      </KobalteAccordion.Content>
    </KobalteAccordion.Item>
  );
}
