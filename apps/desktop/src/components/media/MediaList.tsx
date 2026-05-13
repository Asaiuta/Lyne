import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { useDismissibleOverlay } from "../../shared/ui/useDismissibleOverlay";
import {
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDelete,
  IconLocation,
  IconPause,
  IconPlay,
  IconPlaylist,
  IconQueueAdd
} from "../icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

export type MediaContextAction = "play" | "enqueue" | "copy-path" | "add-to-playlist" | "delete";
export type MediaSortField =
  | "default"
  | "title"
  | "artist"
  | "album"
  | "trackNumber"
  | "filename"
  | "duration"
  | "size"
  | "createTime"
  | "updatedTime";
export type MediaSortOrder = "default" | "asc" | "desc";

export interface MediaSortState {
  field: MediaSortField;
  order: MediaSortOrder;
}

export interface MediaListItem {
  id: string;
  source_path?: string | null;
  media_id?: string | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  track_number?: number | null;
  duration_secs: number | null;
  songId?: number;
  size_bytes?: number | null;
  updated_at_epoch_secs?: number | null;
  added_at_epoch_secs?: number | null;
  fileName?: string | null;
  artworkUrl?: string | null;
  qualityLabel?: string | null;
  privilegeTag?: string | null;
  explicit?: boolean;
  originalTag?: string | null;
}

interface MediaListProps<T extends MediaListItem> {
  items: T[];
  totalCount?: number;
  virtualStart?: number;
  currentSourcePath?: string | null;
  currentMediaId?: string | null;
  currentSongId?: number | null;
  isPlayingNow?: boolean;
  onPlay: (item: T) => void;
  onEnqueue: (item: T) => void;
  onCopyPath?: (item: T) => void;
  onVisibleRangeChange?: (range: { start: number; end: number }) => void;
  onScroll?: (event: Event) => void;
  onContextAction?: (action: MediaContextAction, item: T) => void;
  isLoading?: boolean;
  emptyState?: JSX.Element;
  hideSize?: boolean;
  hideArtwork?: boolean;
  contextActions?: readonly MediaContextAction[];
  deleteActionLabel?: string;
  sort?: MediaSortState;
  onSortChange?: (field: MediaSortField) => void;
  onSortOrderChange?: (order: MediaSortOrder) => void;
}

export const formatMediaDuration = (secs: number | null): string => {
  if (secs === null || !Number.isFinite(secs)) return "—";
  const total = Math.max(0, Math.floor(secs));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatSize = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(2)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${(bytes / KB).toFixed(0)} KB`;
  return `${bytes} B`;
};

export const displayNameFromSourcePath = (sourcePath: string): string => {
  const normalized = sourcePath
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  return trimmed.split("/").filter(Boolean).pop() ?? sourcePath;
};

export const mediaKeyForPath = (path: string | null | undefined): string | null => {
  if (!path) return null;
  return path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\\/g, "/")
    .toLowerCase();
};

export const isMediaListItemCurrent = (
  item: MediaListItem,
  current: {
    sourcePath?: string | null;
    mediaId?: string | null;
    songId?: number | null;
  }
): boolean =>
  (current.songId !== null &&
    current.songId !== undefined &&
    item.songId === current.songId) ||
  (current.mediaId !== null &&
    current.mediaId !== undefined &&
    item.media_id !== null &&
    item.media_id !== undefined &&
    item.media_id === current.mediaId) ||
  (current.sourcePath !== null &&
    current.sourcePath !== undefined &&
    item.source_path !== null &&
    item.source_path !== undefined &&
    mediaKeyForPath(item.source_path) === mediaKeyForPath(current.sourcePath));

const stripBracketedContent = (value: string): string => {
  const stripped = value
    .replace(/\s*[\(（［\[{【].*?[\)）\]］}】]\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return stripped || value;
};

const VIRTUALIZE_THRESHOLD = 120;
const VIRTUAL_ROW_HEIGHT = 90;
const VIRTUAL_OVERSCAN = 5;

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  itemId: string | null;
}

interface SortMenuState {
  open: boolean;
  x: number;
  y: number;
}

const closedMenu: MenuState = {
  open: false,
  x: 0,
  y: 0,
  itemId: null
};

const closedSortMenu: SortMenuState = {
  open: false,
  x: 0,
  y: 0
};

export function MediaList<T extends MediaListItem>(props: MediaListProps<T>) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<MenuState>(closedMenu);
  const [sortMenu, setSortMenu] = createSignal<SortMenuState>(closedSortMenu);
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  let viewportRef: HTMLDivElement | undefined;
  let sortMenuRef: HTMLDivElement | undefined;

  const contextActionSet = createMemo<Set<MediaContextAction>>(
    () => new Set(props.contextActions ?? ["play", "enqueue", "copy-path"])
  );
  const contextActionEnabled = (action: MediaContextAction): boolean => {
    switch (action) {
      case "play":
        return uiSettings.contextMenuOptions.play;
      case "enqueue":
        return uiSettings.contextMenuOptions.playNext;
      case "add-to-playlist":
        return uiSettings.contextMenuOptions.addToPlaylist;
      case "copy-path":
        return uiSettings.contextMenuOptions.copyName;
      case "delete":
        return uiSettings.contextMenuOptions.delete;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  };
  const hasVisibleContextActions = () => [...contextActionSet()].some(contextActionEnabled);
  const showArtwork = () => props.hideArtwork !== true && !uiSettings.hiddenCovers.list;
  const totalItems = createMemo<number>(() => props.totalCount ?? props.items.length);
  const remoteVirtualStart = createMemo<number | null>(() =>
    props.totalCount !== undefined ? props.virtualStart ?? 0 : null
  );
  const currentRenderedIndex = createMemo<number>(() =>
    props.items.findIndex((item) =>
      isMediaListItemCurrent(item, {
        sourcePath: props.currentSourcePath,
        mediaId: props.currentMediaId,
        songId: props.currentSongId
      })
    )
  );
  const canLocateCurrent = createMemo<boolean>(() => currentRenderedIndex() >= 0);

  const closeMenu = () => {
    setMenu((current) => ({ ...current, open: false, itemId: null }));
  };

  const closeSortMenu = () => {
    setSortMenu((current) => ({ ...current, open: false }));
  };

  useDismissibleOverlay(() => sortMenu().open, {
    isInside: (target) => !!sortMenuRef && sortMenuRef.contains(target),
    onDismiss: closeSortMenu,
    scroll: true,
    blur: true
  });

  const handleRowContextMenu = (event: MouseEvent, itemId: string) => {
    event.preventDefault();
    if (!hasVisibleContextActions()) {
      closeMenu();
      return;
    }
    setSelectedId(itemId);
    setMenu({ open: true, x: event.clientX, y: event.clientY, itemId });
  };

  const handleCopyPath = async (item: T) => {
    if (props.onCopyPath) {
      props.onCopyPath(item);
      props.onContextAction?.("copy-path", item);
      return;
    }
    try {
      if (item.source_path && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(item.source_path);
      }
    } catch {
      // Best-effort clipboard write; callback users can surface failure.
    }
    props.onContextAction?.("copy-path", item);
  };

  const handleMenuSelect = (key: string) => {
    const target = props.items.find((item) => item.id === menu().itemId);
    if (!target) return;
    if (key === "play") {
      props.onPlay(target);
      props.onContextAction?.("play", target);
    } else if (key === "enqueue") {
      props.onEnqueue(target);
      props.onContextAction?.("enqueue", target);
    } else if (key === "copy-path") {
      void handleCopyPath(target);
    } else if (key === "add-to-playlist" || key === "delete") {
      props.onContextAction?.(key, target);
    }
  };

  onMount(() => {
    if (!viewportRef) return;
    const updateViewportHeight = () => setViewportHeight(viewportRef?.clientHeight ?? 0);
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewportRef);
    onCleanup(() => observer.disconnect());
  });

  const useVirtualRows = createMemo<boolean>(() => totalItems() > VIRTUALIZE_THRESHOLD);
  const visibleRange = createMemo<{ start: number; end: number }>(() => {
    if (!useVirtualRows()) return { start: 0, end: totalItems() };
    const measuredHeight = viewportHeight() || VIRTUAL_ROW_HEIGHT * 8;
    const start = Math.max(0, Math.floor(scrollTop() / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const count = Math.ceil(measuredHeight / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2;
    return { start, end: Math.min(totalItems(), start + count) };
  });
  const renderedItems = createMemo<T[]>(() => {
    if (remoteVirtualStart() !== null) {
      return props.items;
    }
    const range = visibleRange();
    return props.items.slice(range.start, range.end);
  });
  const virtualHeight = createMemo<number>(() =>
    useVirtualRows() ? totalItems() * VIRTUAL_ROW_HEIGHT : 0
  );
  const virtualOffset = createMemo<number>(() =>
    useVirtualRows()
      ? (remoteVirtualStart() ?? visibleRange().start) * VIRTUAL_ROW_HEIGHT
      : 0
  );

  createEffect(() => {
    props.onVisibleRangeChange?.(visibleRange());
  });

  const scrollToCurrent = () => {
    const index = currentRenderedIndex();
    if (index < 0) return;
    const absoluteIndex = remoteVirtualStart() !== null ? (props.virtualStart ?? 0) + index : index;
    viewportRef?.scrollTo({
      top: Math.max(0, absoluteIndex * VIRTUAL_ROW_HEIGHT),
      behavior: "smooth"
    });
  };

  const sortLabel = (field: MediaSortField): string => {
    switch (field) {
      case "default":
        return t("media.sort.default");
      case "title":
        return t("media.sort.title");
      case "artist":
        return t("media.sort.artist");
      case "album":
        return t("media.sort.album");
      case "trackNumber":
        return t("media.sort.trackNumber");
      case "filename":
        return t("media.sort.filename");
      case "duration":
        return t("media.sort.duration");
      case "size":
        return t("media.sort.size");
      case "createTime":
        return t("media.sort.createTime");
      case "updatedTime":
        return t("media.sort.updatedTime");
      default: {
        const _exhaustive: never = field;
        return _exhaustive;
      }
    }
  };

  const sortFields = (): readonly MediaSortField[] => [
    "default",
    "title",
    "artist",
    "album",
    "trackNumber",
    "filename",
    "duration",
    "size",
    "createTime",
    "updatedTime"
  ];

  const sortOrders = (): readonly MediaSortOrder[] => ["default", "asc", "desc"];

  const sortOrderLabel = (order: MediaSortOrder): string => {
    switch (order) {
      case "default":
        return t("media.sortOrder.default");
      case "asc":
        return t("media.sortOrder.asc");
      case "desc":
        return t("media.sortOrder.desc");
      default: {
        const _exhaustive: never = order;
        return _exhaustive;
      }
    }
  };

  const handleSortFieldChange = (field: MediaSortField) => {
    props.onSortChange?.(field);
  };

  const handleSortOrderChange = (order: MediaSortOrder) => {
    if (props.onSortOrderChange) {
      props.onSortOrderChange(order);
      return;
    }
    if (order === "default") {
      props.onSortChange?.("default");
    }
  };

  const titleSortHeader = () => {
    if (!props.onSortChange) {
      return <span>{t("media.column.title")}</span>;
    }
    const activeField = props.sort?.field ?? "default";
    const activeLabel = activeField === "default" ? "" : sortLabel(activeField);
    return (
      <button
        type="button"
        class="media-sort-button media-sort-title-button"
        classList={{ "is-active": activeField !== "default" }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setSortMenu({
            open: true,
            x: rect.left,
            y: rect.bottom + 6
          });
        }}
      >
        <span>{t("media.column.title")}</span>
        <Show when={activeLabel}>
          {(label) => <span class="media-sort-current">({label()})</span>}
        </Show>
        <IconChevronDown />
      </button>
    );
  };

  const menuItems = (): ContextMenuItem[] => {
    const actions = contextActionSet();
    const items: ContextMenuItem[] = [
      { key: "play", label: t("media.context.play"), icon: <IconPlay /> },
      { key: "enqueue", label: t("media.context.enqueue"), icon: <IconQueueAdd /> },
      { key: "add-to-playlist", label: t("media.context.addToPlaylist"), icon: <IconPlaylist /> },
      { key: "copy-path", label: t("media.context.copyPath"), icon: <IconCopy /> },
      { key: "delete", label: props.deleteActionLabel ?? t("media.context.delete"), icon: <IconDelete /> }
    ];
    return items.filter((item) => {
      const action = item.key as MediaContextAction;
      return actions.has(action) && contextActionEnabled(action);
    });
  };

  const displaySongText = (value: string): string =>
    uiSettings.hideBracketedContent ? stripBracketedContent(value) : value;

  return (
    <Show
      when={totalItems() > 0}
      fallback={
        <div class="media-list-table" data-state="empty">
          <div class="media-list-empty">{props.emptyState ?? null}</div>
        </div>
      }
    >
      <div
        class="media-list-table"
        classList={{
          "is-album-hidden": !uiSettings.showSongAlbum,
          "is-actions-hidden": !uiSettings.showSongOperations,
          "is-duration-hidden": !uiSettings.showSongDuration,
          "is-size-hidden": props.hideSize === true,
          "is-cover-hidden": !showArtwork()
        }}
        aria-busy={props.isLoading || undefined}
      >
        <div class="media-list-header" role="row">
          <span class="media-cell media-cell-index" role="columnheader">
            {t("media.column.index")}
          </span>
          <span class="media-cell media-cell-title" role="columnheader">
            {titleSortHeader()}
          </span>
          <Show when={uiSettings.showSongAlbum}>
            <span class="media-cell media-cell-album" role="columnheader">
              {t("media.column.album")}
            </span>
          </Show>
          <Show when={uiSettings.showSongOperations}>
            <span class="media-cell media-cell-actions" role="columnheader">
              <span class="visually-hidden">{t("media.column.actions")}</span>
            </span>
          </Show>
          <Show when={uiSettings.showSongDuration}>
            <span class="media-cell media-cell-duration" role="columnheader">
              {t("media.column.duration")}
            </span>
          </Show>
          <Show when={!props.hideSize}>
            <span class="media-cell media-cell-size" role="columnheader">
              {t("media.column.size")}
            </span>
          </Show>
        </div>
        <div
          ref={viewportRef}
          class="media-list-viewport"
          data-virtualized={useVirtualRows() ? "true" : undefined}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
            props.onScroll?.(event);
          }}
        >
          <div
            class="media-list-spacer"
            style={useVirtualRows() ? { height: `${virtualHeight()}px` } : undefined}
          >
        <ul
          class="media-list-rows"
          role="rowgroup"
          style={useVirtualRows() ? { transform: `translateY(${virtualOffset()}px)` } : undefined}
        >
          <For each={renderedItems()}>
            {(item, index) => {
              const absoluteIndex = () => (remoteVirtualStart() ?? visibleRange().start) + index();
              const isCurrent = () =>
                isMediaListItemCurrent(item, {
                  sourcePath: props.currentSourcePath,
                  mediaId: props.currentMediaId,
                  songId: props.currentSongId
                });
              const isSelected = () => selectedId() === item.id;
              const title = () => item.title ?? displayNameFromSourcePath(item.source_path ?? item.id);
              const displayTitle = () => displaySongText(title());
              const credits = () =>
                item.artist ? displaySongText(item.artist) : t("library.item.creditsEmpty");
              const artworkInitial = () => (title().trim().slice(0, 1) || "#").toUpperCase();
              const className = () =>
                [
                  "media-row",
                  isCurrent() ? "is-current" : "",
                  isSelected() ? "is-selected" : ""
                ]
                  .filter(Boolean)
                  .join(" ");

              return (
                <li
                  class={className()}
                  role="row"
                  onClick={() => setSelectedId(item.id)}
                  onDblClick={() => props.onPlay(item)}
                  onContextMenu={(event) => handleRowContextMenu(event, item.id)}
                >
                  <span class="media-cell media-cell-index" role="cell">
                    <Show
                      when={isCurrent()}
                      fallback={<span class="media-row-index">{absoluteIndex() + 1}</span>}
                    >
                      <span class="media-current-mark" aria-label={t("media.eq.aria")} role="img">♪</span>
                    </Show>
                    <button
                      type="button"
                      class="media-index-action media-index-action-play"
                      aria-label={t("library.item.play")}
                      title={t("library.item.play")}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onPlay(item);
                      }}
                    >
                      <IconPlay />
                    </button>
                    <button
                      type="button"
                      class="media-index-action media-index-action-status"
                      aria-label={t("library.item.play")}
                      title={t("library.item.play")}
                      onClick={(event) => {
                        event.stopPropagation();
                        props.onPlay(item);
                      }}
                    >
                      <Show when={props.isPlayingNow} fallback={<IconPlay />}>
                        <IconPause />
                      </Show>
                    </button>
                  </span>
                  <span class="media-cell media-cell-title" role="cell">
                    <span class="media-row-title-wrap">
                      <Show when={showArtwork()}>
                        <Show when={item.artworkUrl}>
                          <span class="media-row-artwork" aria-hidden="true">
                            <img src={item.artworkUrl ?? ""} alt="" />
                          </span>
                        </Show>
                        <Show when={!item.artworkUrl}>
                          <span class="media-row-artwork media-row-artwork-fallback" aria-hidden="true">
                            {artworkInitial()}
                          </span>
                        </Show>
                      </Show>
                      <span class="media-row-copy">
                        <span class="media-row-title" title={item.source_path ?? title()}>
                          <span class="media-row-title-text">{displayTitle()}</span>
                          <Show when={uiSettings.showSongQuality && item.qualityLabel}>
                            {(quality) => <span class="media-row-tag">{quality()}</span>}
                          </Show>
                          <Show when={uiSettings.showSongPrivilegeTag && item.privilegeTag}>
                            {(tag) => <span class="media-row-tag media-row-tag-muted">{tag()}</span>}
                          </Show>
                          <Show when={uiSettings.showSongExplicitTag && item.explicit}>
                            <span class="media-row-tag media-row-tag-muted">E</span>
                          </Show>
                          <Show when={uiSettings.showSongOriginalTag && item.originalTag}>
                            {(tag) => <span class="media-row-tag media-row-tag-muted">{tag()}</span>}
                          </Show>
                        </span>
                        <Show when={uiSettings.showSongArtist}>
                          <span class="media-row-credits">
                            {credits() || t("library.item.creditsEmpty")}
                          </span>
                        </Show>
                      </span>
                    </span>
                  </span>
                  <Show when={uiSettings.showSongAlbum}>
                    <span class="media-cell media-cell-album" role="cell">
                      {item.album ? displaySongText(item.album) : "—"}
                    </span>
                  </Show>
                  <Show when={uiSettings.showSongOperations}>
                    <span class="media-cell media-cell-actions" role="cell">
                      <button
                        type="button"
                        class="row-action"
                        aria-label={t("library.item.enqueue")}
                        title={t("library.item.enqueue")}
                        onClick={(event) => {
                          event.stopPropagation();
                          props.onEnqueue(item);
                        }}
                      >
                        <IconQueueAdd />
                      </button>
                    </span>
                  </Show>
                  <Show when={uiSettings.showSongDuration}>
                    <span class="media-cell media-cell-duration" role="cell">
                      {formatMediaDuration(item.duration_secs)}
                    </span>
                  </Show>
                  <Show when={!props.hideSize}>
                    <span class="media-cell media-cell-size" role="cell">
                      {formatSize(item.size_bytes ?? null)}
                    </span>
                  </Show>
                </li>
              );
            }}
          </For>
        </ul>
          </div>
        </div>
        <Show when={totalItems() > 0}>
          <div class="media-list-float-tools">
            <Show when={canLocateCurrent()}>
              <button
                type="button"
                class="media-list-float-button"
                onClick={scrollToCurrent}
                aria-label={t("media.scroll.current")}
                title={t("media.scroll.current")}
              >
                <IconLocation />
              </button>
            </Show>
            <button
              type="button"
              class="media-list-float-button"
              classList={{ "is-hidden": scrollTop() <= 100 }}
              onClick={() => viewportRef?.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label={t("media.scroll.top")}
              title={t("media.scroll.top")}
            >
              <IconChevronUp />
            </button>
          </div>
        </Show>
        <ContextMenu
          open={menu().open}
          x={menu().x}
          y={menu().y}
          items={menuItems()}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
        <Show when={sortMenu().open && typeof document !== "undefined"}>
          <Portal mount={document.body}>
            <div
              ref={sortMenuRef}
              class="media-sort-popover"
              style={{ top: `${sortMenu().y}px`, left: `${sortMenu().x}px` }}
              role="dialog"
              aria-label={t("media.sort.dialog")}
            >
              <div class="media-sort-group">
                <div class="media-sort-label">{t("media.sort.field")}</div>
                <For each={sortFields()}>
                  {(field) => (
                    <label class="media-sort-radio">
                      <input
                        type="radio"
                        name="media-sort-field"
                        checked={(props.sort?.field ?? "default") === field}
                        onChange={() => handleSortFieldChange(field)}
                      />
                      <span>{sortLabel(field)}</span>
                    </label>
                  )}
                </For>
              </div>
              <div class="media-sort-divider" aria-hidden="true" />
              <div class="media-sort-group">
                <div class="media-sort-label">{t("media.sort.order")}</div>
                <For each={sortOrders()}>
                  {(order) => (
                    <label class="media-sort-radio">
                      <input
                        type="radio"
                        name="media-sort-order"
                        checked={(props.sort?.order ?? "default") === order}
                        onChange={() => handleSortOrderChange(order)}
                      />
                      <span>{sortOrderLabel(order)}</span>
                    </label>
                  )}
                </For>
              </div>
            </div>
          </Portal>
        </Show>
      </div>
    </Show>
  );
}
