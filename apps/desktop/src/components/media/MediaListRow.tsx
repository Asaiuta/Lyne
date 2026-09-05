import { Show, createMemo } from "solid-js";
import type { UISettings } from "../../shared/state/uiSettingsModel";
import { NaiveTag, type NaiveTagTone } from "../../shared/ui/naive";
import { SImage } from "../SImage";
import {
  IconCloud,
  IconPause,
  IconPlay,
  IconQueueAdd,
  IconFavoriteFilled,
  IconFavoriteBorderFilled
} from "../icons";
import type { MediaListItem } from "../../shared/media/mediaListItem";
import type { MediaRowAction } from "./mediaListTypes";
import { displayNameFromSourcePath } from "../../shared/media/mediaPath";
import {
  formatMediaDuration,
  formatMediaSize,
  resolveMediaListArtworkUrl
} from "./mediaListFormatting";

interface MediaListRowProps<T extends MediaListItem> {
  item: T;
  absoluteIndex: number;
  isCurrent: boolean;
  isSelected: boolean;
  isDropTarget?: boolean;
  isPlayingNow?: boolean;
  showArtwork: boolean;
  hideSize?: boolean;
  uiSettings: UISettings;
  emptyCreditsLabel: string;
  eqAriaLabel: string;
  playLabel: string;
  enqueueLabel: string;
  rowAction: MediaRowAction<T>;
  displaySongText: (value: string) => string;
  onSelect: (id: string) => void;
  onPlay: (item: T) => void;
  onDoubleClick?: (item: T) => void;
  onEnqueue: (item: T) => void;
  onContextMenu: (event: MouseEvent, itemId: string) => void;
  draggable?: boolean;
  onDragStart?: (event: DragEvent, item: T, index: number) => void;
  onDragOver?: (event: DragEvent, index: number) => void;
  onDrop?: (event: DragEvent, index: number) => void;
  onDragEnd?: () => void;
}

const qualityTagTone = (quality: string): NaiveTagTone =>
  quality === "Hi-Res" || quality === "SQ" ? "warning" : quality === "HQ" ? "info" : "primary";

const qualityTagClass = (quality: string): string => {
  const tone = qualityTagTone(quality);
  return `media-row-tag media-row-quality-tag media-row-quality-tag-${tone}`;
};

const originalTagTone = (tag: string): NaiveTagTone => (tag === "翻唱" ? "info" : "primary");

const originalTagClass = (tag: string): string =>
  tag === "翻唱" ? "media-row-tag media-row-tag-info" : "media-row-tag media-row-tag-primary";

export function MediaListRow<T extends MediaListItem>(props: MediaListRowProps<T>) {
  const title = () => props.item.title ?? displayNameFromSourcePath(props.item.source_path ?? props.item.id);
  const displayTitle = () => props.displaySongText(title());
  const credits = () =>
    props.item.artist ? props.displaySongText(props.item.artist) : props.emptyCreditsLabel;
  const artworkUrl = createMemo<string | undefined>(() =>
    resolveMediaListArtworkUrl(props.item.artworkUrl, props.item.songId)
  );
  const artworkInitial = () => (title().trim().slice(0, 1) || "#").toUpperCase();
  const className = () =>
    [
      "media-row",
      props.isCurrent ? "is-current" : "",
      props.isSelected ? "is-selected" : "",
      props.isDropTarget ? "is-drop-target" : ""
    ]
      .filter(Boolean)
      .join(" ");
  const favoriteActive = () => {
    const action = props.rowAction;
    return action.kind === "favorite" && action.isActive(props.item);
  };
  const favoriteBusy = () => {
    const action = props.rowAction;
    return action.kind === "favorite" && (action.isBusy?.(props.item) ?? false);
  };
  const rowActionLabel = () => {
    const action = props.rowAction;
    if (action.kind === "enqueue") return props.enqueueLabel;
    return favoriteActive() ? action.activeLabel : action.inactiveLabel;
  };
  const handleRowActionClick = (event: MouseEvent) => {
    event.stopPropagation();
    const action = props.rowAction;
    switch (action.kind) {
      case "enqueue":
        props.onEnqueue(props.item);
        return;
      case "favorite":
        if (favoriteBusy()) return;
        action.onToggle(props.item, !favoriteActive());
        return;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  };
  const RowActionIcon = () => {
    const action = props.rowAction;
    if (action.kind === "enqueue") return <IconQueueAdd />;
    return favoriteActive() ? <IconFavoriteFilled /> : <IconFavoriteBorderFilled />;
  };

  return (
    <li
      class={className()}
      role="row"
      draggable={props.draggable}
      onClick={() => props.onSelect(props.item.id)}
      onDblClick={() => (props.onDoubleClick ?? props.onPlay)(props.item)}
      onContextMenu={(event) => props.onContextMenu(event, props.item.id)}
      onDragStart={(event) => props.onDragStart?.(event, props.item, props.absoluteIndex)}
      onDragOver={(event) => props.onDragOver?.(event, props.absoluteIndex)}
      onDrop={(event) => props.onDrop?.(event, props.absoluteIndex)}
      onDragEnd={() => props.onDragEnd?.()}
    >
      <div class="media-row-content" role="presentation">
        <span class="media-cell media-cell-index" role="cell">
          <Show when={props.isCurrent} fallback={<span class="media-row-index">{props.absoluteIndex + 1}</span>}>
            <span class="media-current-mark" aria-label={props.eqAriaLabel} role="img">♪</span>
          </Show>
          <button
            type="button"
            class="media-index-action media-index-action-play"
            aria-label={props.playLabel}
            title={props.playLabel}
            onClick={(event) => {
              event.stopPropagation();
              props.onPlay(props.item);
            }}
          >
            <IconPlay />
          </button>
          <button
            type="button"
            class="media-index-action media-index-action-status"
            aria-label={props.playLabel}
            title={props.playLabel}
            onClick={(event) => {
              event.stopPropagation();
              props.onPlay(props.item);
            }}
          >
            <Show when={props.isPlayingNow} fallback={<IconPlay />}>
              <IconPause />
            </Show>
          </button>
        </span>
        <span class="media-cell media-cell-title" role="cell">
          <span class="media-row-title-wrap">
            <Show when={props.showArtwork}>
              <Show
                when={artworkUrl()}
                fallback={
                  <span class="media-row-artwork media-row-artwork-fallback" aria-hidden="true">
                    {artworkInitial()}
                  </span>
                }
              >
                {(url) => (
                  <span class="media-row-artwork" aria-hidden="true">
                    <SImage src={url()} alt="" observeVisibility={true} shape="rect" aspect="square" />
                  </span>
                )}
              </Show>
            </Show>
            <span class="media-row-copy">
              <span class="media-row-title" title={props.item.source_path ?? title()}>
                <span class="media-row-title-text">{displayTitle()}</span>
              </span>
              <span class="media-row-desc">
                <Show when={props.uiSettings.showSongQuality && props.item.qualityLabel}>
                  {(quality) => (
                    <NaiveTag
                      class={qualityTagClass(quality())}
                      tone={qualityTagTone(quality())}
                    >
                      {quality()}
                    </NaiveTag>
                  )}
                </Show>
                <Show when={props.uiSettings.showSongOriginalTag && props.item.originalTag}>
                  {(tag) => (
                    <NaiveTag class={originalTagClass(tag())} tone={originalTagTone(tag())}>
                      {tag()}
                    </NaiveTag>
                  )}
                </Show>
                <Show when={props.uiSettings.showSongPrivilegeTag && props.item.privilegeTag}>
                  {(tag) => <NaiveTag class="media-row-tag media-row-tag-error" tone="error">{tag()}</NaiveTag>}
                </Show>
                <Show when={props.uiSettings.showSongPrivilegeTag && props.item.isCloud}>
                  <NaiveTag
                    class="media-row-tag media-row-tag-info media-row-tag-icon"
                    tone="info"
                    icon={true}
                    ariaLabel="Cloud"
                  >
                    <IconCloud />
                  </NaiveTag>
                </Show>
                <Show when={props.item.mvId}>
                  <NaiveTag class="media-row-tag media-row-tag-warning" tone="warning">MV</NaiveTag>
                </Show>
                <Show when={props.uiSettings.showSongExplicitTag && props.item.explicit}>
                  <NaiveTag class="media-row-tag media-row-tag-error" tone="error" title="Explicit Content">
                    E
                  </NaiveTag>
                </Show>
                <Show when={props.uiSettings.showSongArtist}>
                  <span class="media-row-credits">
                    {credits() || props.emptyCreditsLabel}
                  </span>
                </Show>
              </span>
            </span>
          </span>
        </span>
        <Show when={props.uiSettings.showSongAlbum}>
          <span class="media-cell media-cell-album" role="cell">
            {props.item.album ? props.displaySongText(props.item.album) : "—"}
          </span>
        </Show>
        <Show when={props.uiSettings.showSongOperations}>
          <span class="media-cell media-cell-actions" role="cell">
            <button
              type="button"
              class="media-row-action"
              classList={{
                "media-row-action-favorite": props.rowAction.kind === "favorite",
                "is-active": favoriteActive()
              }}
              aria-label={rowActionLabel()}
              aria-pressed={props.rowAction.kind === "favorite" ? favoriteActive() : undefined}
              title={rowActionLabel()}
              disabled={favoriteBusy()}
              onClick={handleRowActionClick}
            >
              <RowActionIcon />
            </button>
          </span>
        </Show>
        <Show when={props.uiSettings.showSongDuration}>
          <span class="media-cell media-cell-duration" role="cell">
            {formatMediaDuration(props.item.duration_secs)}
          </span>
        </Show>
        <Show when={!props.hideSize}>
          <span class="media-cell media-cell-size" role="cell">
            {formatMediaSize(props.item.size_bytes ?? null)}
          </span>
        </Show>
      </div>
    </li>
  );
}
