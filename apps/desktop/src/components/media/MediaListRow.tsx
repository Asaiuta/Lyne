import { Show } from "solid-js";
import type { UISettings } from "../../shared/state/useUISettings";
import { SImage } from "../SImage";
import { IconCloud, IconPause, IconPlay, IconQueueAdd } from "../icons";
import type { MediaListItem } from "./MediaList";
import {
  displayNameFromSourcePath,
  formatMediaDuration,
  formatMediaSize
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

const qualityTagClass = (quality: string): string => {
  const tone = quality === "Hi-Res" || quality === "SQ" ? "warning" : quality === "HQ" ? "info" : "primary";
  return `media-row-tag media-row-quality-tag media-row-quality-tag-${tone}`;
};

const originalTagClass = (tag: string): string =>
  tag === "翻唱" ? "media-row-tag media-row-tag-info" : "media-row-tag media-row-tag-primary";

export function MediaListRow<T extends MediaListItem>(props: MediaListRowProps<T>) {
  const title = () => props.item.title ?? displayNameFromSourcePath(props.item.source_path ?? props.item.id);
  const displayTitle = () => props.displaySongText(title());
  const credits = () =>
    props.item.artist ? props.displaySongText(props.item.artist) : props.emptyCreditsLabel;
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
            <Show when={props.item.artworkUrl}>
              <span class="media-row-artwork" aria-hidden="true">
                <SImage src={props.item.artworkUrl} alt="" observeVisibility={true} shape="rect" aspect="square" />
              </span>
            </Show>
            <Show when={!props.item.artworkUrl}>
              <span class="media-row-artwork media-row-artwork-fallback" aria-hidden="true">
                {artworkInitial()}
              </span>
            </Show>
          </Show>
          <span class="media-row-copy">
            <span class="media-row-title" title={props.item.source_path ?? title()}>
              <span class="media-row-title-text">{displayTitle()}</span>
            </span>
            <span class="media-row-desc">
              <Show when={props.uiSettings.showSongQuality && props.item.qualityLabel}>
                {(quality) => <span class={qualityTagClass(quality())}>{quality()}</span>}
              </Show>
              <Show when={props.uiSettings.showSongOriginalTag && props.item.originalTag}>
                {(tag) => <span class={originalTagClass(tag())}>{tag()}</span>}
              </Show>
              <Show when={props.uiSettings.showSongPrivilegeTag && props.item.privilegeTag}>
                {(tag) => <span class="media-row-tag media-row-tag-error">{tag()}</span>}
              </Show>
              <Show when={props.uiSettings.showSongPrivilegeTag && props.item.isCloud}>
                <span class="media-row-tag media-row-tag-info media-row-tag-icon" aria-label="Cloud">
                  <IconCloud />
                </span>
              </Show>
              <Show when={props.item.mvId}>
                <span class="media-row-tag media-row-tag-warning">MV</span>
              </Show>
              <Show when={props.uiSettings.showSongExplicitTag && props.item.explicit}>
                <span class="media-row-tag media-row-tag-error" title="Explicit Content">E</span>
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
            class="row-action"
            aria-label={props.enqueueLabel}
            title={props.enqueueLabel}
            onClick={(event) => {
              event.stopPropagation();
              props.onEnqueue(props.item);
            }}
          >
            <IconQueueAdd />
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
    </li>
  );
}
