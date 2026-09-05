import { Show, createMemo } from "solid-js";
import { NaiveTabs, type NaiveTabItem } from "../../shared/ui/naive";
import "../../shared/styles/components/segmented-tabs.css";

export interface SegmentedTabItem<TValue extends string = string> {
  value: TValue;
  label: string;
  count?: number | string | null;
  disabled?: boolean;
}

export type SegmentedTabsVariant = "accent" | "surface" | "tonal";
export type SegmentedTabsDensity = "regular" | "compact";

interface SegmentedTabsProps<TValue extends string> {
  value: TValue;
  onChange: (next: TValue) => void;
  items: ReadonlyArray<SegmentedTabItem<TValue>>;
  ariaLabel?: string;
  variant?: SegmentedTabsVariant;
  density?: SegmentedTabsDensity;
  class?: string;
  tabClass?: string;
  activeTabClass?: string;
  selectClass?: string;
}

const segmentedTabsClass = "segmented-tabs";

const segmentedTabBaseClass = "segmented-tab";

const segmentedTabActiveClass = "is-active";

const segmentedTabsSelectClass = "segmented-tabs-select hidden w-full";

/**
 * Compatibility adapter for page call sites that predates the shared Naive
 * package. NaiveTabs owns tab semantics, focus movement, and the animated
 * segment capsule; this wrapper only preserves the page-level variants and
 * optional count labels.
 */
export function SegmentedTabs<TValue extends string>(props: SegmentedTabsProps<TValue>) {
  const variantClass = () => `segmented-tabs--${props.variant ?? "accent"}`;
  const densityClass = () =>
    props.density === "compact" ? "segmented-tabs--compact" : "segmented-tabs--regular";
  const rootClass = () =>
    [segmentedTabsClass, variantClass(), densityClass(), props.class].filter(Boolean).join(" ");
  const tabClass = () =>
    [segmentedTabBaseClass, props.tabClass].filter(Boolean).join(" ");
  const activeTabClass = () =>
    [segmentedTabActiveClass, props.activeTabClass].filter(Boolean).join(" ");
  const selectClass = () =>
    [segmentedTabsSelectClass, props.selectClass].filter(Boolean).join(" ");
  const items = createMemo<ReadonlyArray<NaiveTabItem<TValue>>>(() =>
    props.items.map((item) => ({
      value: item.value,
      textValue: item.label,
      disabled: item.disabled,
      label: (
        <>
          <span>{item.label}</span>
          <Show when={item.count != null}>
            <span class="segmented-tab-count">{item.count}</span>
          </Show>
        </>
      )
    }))
  );

  return (
    <NaiveTabs
      type="segment"
      size="medium"
      value={props.value}
      onChange={props.onChange}
      items={items()}
      ariaLabel={props.ariaLabel}
      class={rootClass()}
      tabClass={tabClass()}
      tabActiveClass={activeTabClass()}
      selectClass={selectClass()}
    />
  );
}
