import { For, Show, createMemo } from "solid-js";
import type { JSX } from "solid-js";
import { SImage } from "../../../components/SImage";
import { IconEye, IconMusic, IconPlayFilled } from "../../../components/icons";
import { SegmentedTabs, type SegmentedTabItem, type SegmentedTabsVariant } from "../../../components/page/SegmentedTabs";
import { PageToolbarButton } from "../../../components/page/PageToolbarButton";
import { coverSizeUrl } from "../../../shared/ui/coverSize";
import { NaiveH2, NaiveP } from "../../../shared/ui/naive";
import "../../../shared/styles/pages/ncm-details.css";

export interface NcmListDetailMetaItem {
  icon: JSX.Element;
  text: string;
  onClick?: () => void;
}

export interface NcmListDetailTabItem {
  value: string;
  label: string;
  count?: number | null;
}

interface NcmListDetailProps {
  title: string;
  coverUrl?: string | null;
  description?: string | null;
  metaItems?: NcmListDetailMetaItem[];
  tabs?: NcmListDetailTabItem[];
  activeTab?: string;
  hiddenCover?: boolean;
  showCoverMask?: boolean;
  playCount?: number | null;
  playLabel: string;
  loading?: boolean;
  playDisabled?: boolean;
  compact?: boolean;
  coverShape?: "square" | "round";
  actionButtons?: JSX.Element;
  rightControls?: JSX.Element;
  tabVariant?: SegmentedTabsVariant;
  onPlay: () => void;
  onTabChange?: (value: string) => void;
}

const formatCount = (value: number): string => {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(Math.round(value));
};

export function NcmListDetail(props: NcmListDetailProps) {
  const tabs = createMemo<NcmListDetailTabItem[]>(() => props.tabs ?? []);
  const tabItems = createMemo<SegmentedTabItem[]>(() =>
    tabs().map((tab) => ({
      value: tab.value,
      label: tab.label,
      count: tab.count != null ? formatCount(tab.count) : null
    }))
  );
  const activeTab = createMemo<string>(() => props.activeTab ?? tabs()[0]?.value ?? "");
  const cover = () => coverSizeUrl(props.coverUrl, "m") ?? props.coverUrl ?? null;
  const playCountText = () => {
    const value = props.playCount;
    return value != null && value > 0 ? formatCount(value) : null;
  };

  return (
    <header class={`ncm-list-detail${props.hiddenCover ? " is-cover-hidden" : ""}${props.compact ? " is-compact" : ""}`}>
      <div class="ncm-list-detail-inner">
        <Show when={!props.hiddenCover && cover()}>
          {(url) => (
            <div class={`ncm-list-detail-cover${props.coverShape === "round" ? " is-round" : ""}`}>
              <SImage
                src={url()}
                alt=""
                class="ncm-list-detail-cover-img"
                observeVisibility={false}
                shape={props.coverShape === "round" ? "circle" : "rect"}
                aspect="square"
              />
              <SImage
                src={url()}
                alt=""
                class="ncm-list-detail-cover-shadow"
                observeVisibility={false}
                shape={props.coverShape === "round" ? "circle" : "rect"}
                aspect="square"
                ariaHidden="true"
              />
              <Show when={props.showCoverMask}>
                <span class="ncm-list-detail-cover-mask" />
              </Show>
              <Show when={playCountText()}>
                {(count) => (
                  <span class="ncm-list-detail-play-count">
                    <IconPlayFilled />
                    {count()}
                  </span>
                )}
              </Show>
            </div>
          )}
        </Show>
        <div class="ncm-list-detail-data">
          <NaiveH2 class="ncm-list-detail-name">{props.title}</NaiveH2>
          <Show when={props.description}>
            {(description) => <NaiveP class="ncm-list-detail-description">{description()}</NaiveP>}
          </Show>
          <Show when={(props.metaItems ?? []).length > 0}>
            <div class="ncm-list-detail-meta">
              <For each={props.metaItems ?? []}>
                {(item) => (
                  <button
                    type="button"
                    class="ncm-list-detail-meta-item"
                    onClick={() => item.onClick?.()}
                    disabled={!item.onClick}
                  >
                    {item.icon}
                    <span>{item.text}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <div class="ncm-list-detail-menu">
            <div class="ncm-list-detail-menu-left">
              <PageToolbarButton
                variant="primary"
                class="ncm-list-detail-play"
                disabled={props.playDisabled || props.loading}
                onClick={props.onPlay}
              >
                <IconPlayFilled />
                {props.playLabel}
              </PageToolbarButton>
              {props.actionButtons}
            </div>
            <Show when={props.rightControls || tabs().length > 0}>
              <div class="ncm-list-detail-menu-right">
                {props.rightControls}
                <Show when={tabs().length > 0}>
                  <SegmentedTabs
                    class="ncm-list-detail-tabs"
                    density={props.compact ? "compact" : "regular"}
                    variant={props.tabVariant ?? "surface"}
                    value={activeTab()}
                    onChange={(next) => props.onTabChange?.(next)}
                    items={tabItems()}
                    ariaLabel={props.title}
                  />
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </header>
  );
}

export const ncmListDetailIcons = {
  count: <IconMusic />,
  playCount: <IconEye />
};
