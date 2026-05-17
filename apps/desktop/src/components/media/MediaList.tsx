import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { useDismissibleOverlay } from "../../shared/ui/useDismissibleOverlay";
import {
  IconChevronDown,
  IconCopy,
  IconDelete,
  IconPlay,
  IconPlaylist,
  IconQueueAdd
} from "../icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { MediaListFloatTools } from "./MediaListFloatTools";
import { MediaListRow } from "./MediaListRow";
import { MediaSortPopover } from "./MediaSortPopover";
import { stripBracketedContent } from "./mediaListFormatting";
import { isMediaListItemCurrent } from "../../shared/media/mediaIdentity";
export { isMediaListItemCurrent, mediaKeyForPath } from "../../shared/media/mediaIdentity";
export {
  displayNameFromSourcePath,
  formatMediaDuration
} from "./mediaListFormatting";

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

const VIRTUALIZE_THRESHOLD = 120;
const VIRTUAL_ROW_HEIGHT_PX = 90;
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
    } catch (error) {
      console.warn("[MediaList] copy source_path failed", error);
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
    const measuredHeight = viewportHeight() || VIRTUAL_ROW_HEIGHT_PX * 8;
    const start = Math.max(0, Math.floor(scrollTop() / VIRTUAL_ROW_HEIGHT_PX) - VIRTUAL_OVERSCAN);
    const count = Math.ceil(measuredHeight / VIRTUAL_ROW_HEIGHT_PX) + VIRTUAL_OVERSCAN * 2;
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
    useVirtualRows() ? totalItems() * VIRTUAL_ROW_HEIGHT_PX : 0
  );
  const virtualOffset = createMemo<number>(() =>
    useVirtualRows()
      ? (remoteVirtualStart() ?? visibleRange().start) * VIRTUAL_ROW_HEIGHT_PX
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
      top: Math.max(0, absoluteIndex * VIRTUAL_ROW_HEIGHT_PX),
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

              return (
                <MediaListRow
                  item={item}
                  absoluteIndex={absoluteIndex()}
                  isCurrent={isCurrent()}
                  isSelected={isSelected()}
                  isPlayingNow={props.isPlayingNow}
                  showArtwork={showArtwork()}
                  hideSize={props.hideSize}
                  uiSettings={uiSettings}
                  emptyCreditsLabel={t("library.item.creditsEmpty")}
                  eqAriaLabel={t("media.eq.aria")}
                  playLabel={t("library.item.play")}
                  enqueueLabel={t("library.item.enqueue")}
                  displaySongText={displaySongText}
                  onSelect={setSelectedId}
                  onPlay={props.onPlay}
                  onEnqueue={props.onEnqueue}
                  onContextMenu={handleRowContextMenu}
                />
              );
            }}
          </For>
        </ul>
          </div>
        </div>
        <Show when={totalItems() > 0}>
          <MediaListFloatTools
            canLocateCurrent={canLocateCurrent()}
            scrollTop={scrollTop()}
            currentLabel={t("media.scroll.current")}
            topLabel={t("media.scroll.top")}
            onScrollToCurrent={scrollToCurrent}
            onScrollToTop={() => viewportRef?.scrollTo({ top: 0, behavior: "smooth" })}
          />
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
            <MediaSortPopover
              ref={(element) => {
                sortMenuRef = element;
              }}
              x={sortMenu().x}
              y={sortMenu().y}
              sort={props.sort}
              dialogLabel={t("media.sort.dialog")}
              fieldLabel={t("media.sort.field")}
              orderLabel={t("media.sort.order")}
              fields={sortFields()}
              orders={sortOrders()}
              sortLabel={sortLabel}
              sortOrderLabel={sortOrderLabel}
              onFieldChange={handleSortFieldChange}
              onOrderChange={handleSortOrderChange}
            />
          </Portal>
        </Show>
      </div>
    </Show>
  );
}
