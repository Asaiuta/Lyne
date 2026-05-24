import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { SImage } from "../../../components/SImage";
import { IconEye, IconMusic, IconPlay } from "../../../components/icons";
import { coverSizeUrl } from "../../../shared/ui/coverSize";

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
  onPlay: () => void;
  onTabChange?: (value: string) => void;
}

const formatCount = (value: number): string => {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(Math.round(value));
};

export function NcmListDetail(props: NcmListDetailProps) {
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
                    <IconPlay />
                    {count()}
                  </span>
                )}
              </Show>
            </div>
          )}
        </Show>
        <div class="ncm-list-detail-data">
          <h2 class="ncm-list-detail-name">{props.title}</h2>
          <Show when={props.description}>
            {(description) => <p class="ncm-list-detail-description">{description()}</p>}
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
              <button
                type="button"
                class="primary-button ncm-list-detail-play"
                disabled={props.playDisabled || props.loading}
                onClick={props.onPlay}
              >
                <IconPlay />
                {props.playLabel}
              </button>
              {props.actionButtons}
            </div>
            <Show when={(props.tabs ?? []).length > 0}>
              <div class="ncm-list-detail-tabs" role="tablist">
                <For each={props.tabs ?? []}>
                  {(tab) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab.value === props.activeTab}
                      class={tab.value === props.activeTab ? "is-active" : ""}
                      onClick={() => props.onTabChange?.(tab.value)}
                    >
                      {tab.label}
                      <Show when={tab.count != null}>
                        <span>{formatCount(tab.count ?? 0)}</span>
                      </Show>
                    </button>
                  )}
                </For>
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
