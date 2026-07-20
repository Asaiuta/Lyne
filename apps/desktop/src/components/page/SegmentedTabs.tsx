import { Show, createMemo } from "solid-js";
import { NaiveTabs, type NaiveTabItem } from "../../shared/ui/naive";

export interface SegmentedTabItem {
  value: string;
  label: string;
  count?: number | string | null;
  disabled?: boolean;
}

export type SegmentedTabsVariant = "accent" | "surface" | "tonal";

interface SegmentedTabsProps {
  value: string;
  onChange: (next: string) => void;
  items: SegmentedTabItem[];
  ariaLabel?: string;
  variant?: SegmentedTabsVariant;
  class?: string;
  tabClass?: string;
  activeTabClass?: string;
  selectClass?: string;
}

const segmentedTabsClass = "segmented-tabs rounded-pill shadow-none";

const segmentedTabBaseClass =
  "segmented-tab min-h-[34px] px-3 rounded-pill text-xs font-600 transition-colors duration-fast ease-standard disabled:opacity-[0.48] disabled:cursor-not-allowed";

const segmentedTabActiveClass = "is-active shadow-none";

const segmentedTabsSelectClass = "segmented-tabs-select hidden w-full";

/**
 * Compatibility adapter for page call sites that predates the shared Naive
 * package. NaiveTabs owns tab semantics, focus movement, and the animated
 * segment capsule; this wrapper only preserves the page-level variants and
 * optional count labels.
 */
export function SegmentedTabs(props: SegmentedTabsProps) {
  const variantClass = () => `segmented-tabs--${props.variant ?? "accent"}`;
  const rootClass = () =>
    [segmentedTabsClass, variantClass(), props.class].filter(Boolean).join(" ");
  const tabClass = () =>
    [segmentedTabBaseClass, props.tabClass].filter(Boolean).join(" ");
  const activeTabClass = () =>
    [segmentedTabActiveClass, props.activeTabClass].filter(Boolean).join(" ");
  const selectClass = () =>
    [segmentedTabsSelectClass, props.selectClass].filter(Boolean).join(" ");
  const items = createMemo<ReadonlyArray<NaiveTabItem<string>>>(() =>
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
      size="small"
      value={props.value}
      onChange={props.onChange}
      items={items()}
      ariaLabel={props.ariaLabel}
      class={rootClass()}
      railClass="segmented-tabs-rail"
      tabClass={tabClass()}
      tabActiveClass={activeTabClass()}
      selectClass={selectClass()}
    />
  );
}
