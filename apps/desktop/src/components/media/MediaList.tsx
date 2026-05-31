import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { copyToClipboard } from "../../shared/utils/clipboard";
import { useUISettings } from "../../shared/state/useUISettings";
import { IconChevronDown } from "../icons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  DEFAULT_MEDIA_CONTEXT_ACTIONS,
  MEDIA_CONTEXT_ACTION_DESCRIPTORS,
  createMediaContextMenuItems,
  hasVisibleMediaContextActions,
  isMediaContextAction,
  type MediaContextAction
} from "./mediaContextActions";
import { MediaListFloatTools } from "./MediaListFloatTools";
import { MediaListRow } from "./MediaListRow";
import { MediaSortPopover } from "./MediaSortPopover";
import { SImage } from "../SImage";
import { stripBracketedContent } from "./mediaListFormatting";
import type { MediaListItem } from "../../shared/media/mediaListItem";
import { displayNameFromSourcePath } from "../../shared/media/mediaPath";
import {
  createMediaIdentityIndex,
  findMediaIdentityIndex,
  isMediaListItemCurrent
} from "../../shared/media/mediaIdentity";
import {
  MEDIA_LIST_ROW_HEIGHT_PX,
  MEDIA_LIST_VIRTUALIZE_THRESHOLD,
  resolveMediaListVisibleRange,
  shouldVirtualizeMediaList
} from "./mediaListVirtualization";
import type {
  MediaListProps,
  MediaRowAction,
  MediaSortField,
  MediaSortOrder
} from "./mediaListTypes";

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  itemId: string | null;
}

const closedMenu: MenuState = {
  open: false,
  x: 0,
  y: 0,
  itemId: null
};

export function MediaList<T extends MediaListItem>(props: MediaListProps<T>) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<MenuState>(closedMenu);
  const [sortMenuOpen, setSortMenuOpen] = createSignal<boolean>(false);
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  let viewportRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let pendingScrollTop = 0;

  const contextActionSet = createMemo<Set<MediaContextAction>>(
    () =>
      new Set(
        props.contextActions ?? DEFAULT_MEDIA_CONTEXT_ACTIONS
      )
  );
  const hasVisibleContextActions = (target: T | null) =>
    hasVisibleMediaContextActions(contextActionSet(), uiSettings, target);
  const showArtwork = () => props.hideArtwork !== true && !uiSettings.hiddenCovers.list;
  const defaultRowAction: MediaRowAction<T> = { kind: "enqueue" };
  const rowAction = createMemo<MediaRowAction<T>>(() => props.rowAction ?? defaultRowAction);
  const rowHeight = createMemo<number>(() =>
    Math.max(1, Math.trunc(props.rowHeight ?? MEDIA_LIST_ROW_HEIGHT_PX))
  );
  const rowContentGap = createMemo<number>(() =>
    rowHeight() >= MEDIA_LIST_ROW_HEIGHT_PX ? 12 : 0
  );
  const tableStyle = createMemo<JSX.CSSProperties>(() => ({
    "--media-row-height": `${rowHeight()}px`,
    "--media-row-content-gap": `${rowContentGap()}px`
  }) as JSX.CSSProperties);
  const totalItems = createMemo<number>(() => props.totalCount ?? props.items.length);
  const remoteVirtualStart = createMemo<number | null>(() =>
    props.totalCount !== undefined ? props.virtualStart ?? 0 : null
  );
  const mediaIdentityIndex = createMemo(() => createMediaIdentityIndex(props.items));
  const currentRenderedIndex = createMemo<number>(() =>
    findMediaIdentityIndex(mediaIdentityIndex(), {
      sourcePath: props.currentSourcePath,
      mediaId: props.currentMediaId,
      songId: props.currentSongId
    })
  );
  const canLocateCurrent = createMemo<boolean>(() => currentRenderedIndex() >= 0);

  const closeMenu = () => {
    setMenu((current) => ({ ...current, open: false, itemId: null }));
  };

  const handleRowContextMenu = (event: MouseEvent, itemId: string) => {
    event.preventDefault();
    const target = props.items.find((item) => item.id === itemId) ?? null;
    if (!hasVisibleContextActions(target)) {
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
    if (item.source_path) {
      await copyToClipboard(item.source_path);
    }
    props.onContextAction?.("copy-path", item);
  };

  const displaySongText = (value: string): string =>
    uiSettings.hideBracketedContent ? stripBracketedContent(value) : value;

  const searchableTitle = (item: T): string =>
    displaySongText(
      item.title?.trim() ||
        item.fileName?.trim() ||
        (item.source_path ? displayNameFromSourcePath(item.source_path) : "")
    );
  const selectedMenuItem = createMemo<T | null>(
    () => props.items.find((item) => item.id === menu().itemId) ?? null
  );

  const handleCopyName = async (item: T) => {
    const name = searchableTitle(item).trim();
    if (!name) {
      return;
    }
    await copyToClipboard(name);
    props.onContextAction?.("copy-name", item);
  };

  const handleCopyId = async (item: T) => {
    if (typeof item.songId !== "number") return;
    await copyToClipboard(String(item.songId));
    props.onContextAction?.("copy-id", item);
  };

  const handleMenuSelect = (key: string) => {
    const target = selectedMenuItem();
    if (!target || !isMediaContextAction(key)) return;
    const action = MEDIA_CONTEXT_ACTION_DESCRIPTORS[key];
    switch (action.effect) {
      case "play":
        props.onPlay(target);
        props.onContextAction?.("play", target);
        return;
      case "enqueue":
        props.onEnqueue(target);
        props.onContextAction?.("enqueue", target);
        return;
      case "copy-name":
        void handleCopyName(target);
        return;
      case "copy-id":
        void handleCopyId(target);
        return;
      case "share-link":
        props.onContextAction?.("share-link", target);
        return;
      case "view-comments":
        props.onContextAction?.("view-comments", target);
        return;
      case "copy-path":
        void handleCopyPath(target);
        return;
      case "search":
        props.onContextAction?.("search", target);
        return;
      case "emit":
        props.onContextAction?.(key, target);
        return;
      default: {
        const _exhaustive: never = action.effect;
        return _exhaustive;
      }
    }
  };
  const handleDragStart = (event: DragEvent, _item: T, index: number) => {
    if (!props.draggable) return;
    setDraggedIndex(index);
    event.dataTransfer?.setData("text/plain", String(index));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  };
  const handleDragOver = (event: DragEvent, index: number) => {
    if (!props.draggable || draggedIndex() === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    setDropIndex(index);
  };
  const handleDrop = (event: DragEvent, index: number) => {
    if (!props.draggable) return;
    event.preventDefault();
    const from = draggedIndex();
    setDraggedIndex(null);
    setDropIndex(null);
    if (from === null || from === index) return;
    props.onReorder?.(from, index);
  };
  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropIndex(null);
  };

  const commitPendingScrollTop = () => {
    scrollFrame = 0;
    setScrollTop((current) => (current === pendingScrollTop ? current : pendingScrollTop));
  };

  const scheduleScrollTop = (nextScrollTop: number) => {
    pendingScrollTop = nextScrollTop;
    if (scrollFrame !== 0) return;
    if (typeof window === "undefined") {
      commitPendingScrollTop();
      return;
    }
    scrollFrame = window.requestAnimationFrame(commitPendingScrollTop);
  };

  onCleanup(() => {
    if (scrollFrame !== 0 && typeof window !== "undefined") {
      window.cancelAnimationFrame(scrollFrame);
    }
  });

  onMount(() => {
    if (!viewportRef) return;
    const updateViewportHeight = () => setViewportHeight(viewportRef?.clientHeight ?? 0);
    updateViewportHeight();
    const observer = new ResizeObserver(updateViewportHeight);
    observer.observe(viewportRef);
    onCleanup(() => observer.disconnect());
  });

  const useVirtualRows = createMemo<boolean>(() => shouldVirtualizeMediaList(totalItems()));
  const visibleRange = createMemo<{ start: number; end: number }>((previous) => {
    const next = resolveMediaListVisibleRange({
      totalItems: totalItems(),
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight(),
      rowHeight: rowHeight(),
      virtualizeThreshold: MEDIA_LIST_VIRTUALIZE_THRESHOLD
    });
    return previous.start === next.start && previous.end === next.end ? previous : next;
  }, { start: 0, end: 0 });
  const renderedItems = createMemo<T[]>(() => {
    if (remoteVirtualStart() !== null) {
      return props.items;
    }
    const range = visibleRange();
    return props.items.slice(range.start, range.end);
  });
  const virtualHeight = createMemo<number>(() =>
    useVirtualRows() ? totalItems() * rowHeight() : 0
  );
  const virtualOffset = createMemo<number>(() =>
    useVirtualRows()
      ? (remoteVirtualStart() ?? visibleRange().start) * rowHeight()
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
      top: Math.max(0, absoluteIndex * rowHeight()),
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
    if (props.sortDisabled === true || !props.onSortChange) {
      return <span>{t("media.column.title")}</span>;
    }
    const activeField = props.sort?.field ?? "default";
    const activeLabel = activeField === "default" ? "" : sortLabel(activeField);
    return (
      <MediaSortPopover
        open={sortMenuOpen()}
        onOpenChange={setSortMenuOpen}
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
        trigger={
          <button
            type="button"
            class="media-sort-button media-sort-title-button"
            classList={{ "is-active": activeField !== "default" }}
            aria-haspopup="dialog"
            aria-expanded={sortMenuOpen()}
          >
            <span>{t("media.column.title")}</span>
            <Show when={activeLabel}>
              {(label) => <span class="media-sort-current">({label()})</span>}
            </Show>
            <IconChevronDown />
          </button>
        }
      />
    );
  };

  const menuItems = (): ContextMenuItem[] =>
    createMediaContextMenuItems({
      actionSet: contextActionSet(),
      settings: uiSettings,
      target: selectedMenuItem(),
      t,
      deleteActionLabel: props.deleteActionLabel
    });
  const menuHeader = () => {
    const target = selectedMenuItem();
    if (!target) return null;
    const title = searchableTitle(target);
    const subtitle = target.artist?.trim() || target.album?.trim() || target.source_path || "";
    const initial = (title.trim().slice(0, 1) || "#").toUpperCase();
    return (
      <div class="context-menu-song-card">
        <Show when={showArtwork()}>
          <Show
            when={target.artworkUrl}
            fallback={
              <span class="context-menu-song-cover context-menu-song-cover-fallback">
                {initial}
              </span>
            }
          >
            {(artworkUrl) => (
              <SImage
                src={artworkUrl()}
                alt=""
                class="context-menu-song-cover"
                observeVisibility={true}
                shape="rect"
                aspect="square"
              />
            )}
          </Show>
        </Show>
        <span class="context-menu-song-copy">
          <span class="context-menu-song-title">{title}</span>
          <span class="context-menu-song-subtitle">{displaySongText(subtitle)}</span>
        </span>
      </div>
    );
  };

  return (
    <Show
      when={totalItems() > 0}
      fallback={
        <div class="media-list-table content-fade-in" data-state="empty" style={tableStyle()}>
          <div class="media-list-empty">{props.emptyState ?? null}</div>
        </div>
      }
    >
      <div
        class="media-list-table content-fade-in"
        classList={{
          "is-album-hidden": !uiSettings.showSongAlbum,
          "is-actions-hidden": !uiSettings.showSongOperations,
          "is-duration-hidden": !uiSettings.showSongDuration,
          "is-size-hidden": props.hideSize === true,
          "is-cover-hidden": !showArtwork()
        }}
        aria-busy={props.isLoading || undefined}
        style={tableStyle()}
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
          data-page-scroll-root="true"
          data-virtualized={useVirtualRows() ? "true" : undefined}
          onScroll={(event) => {
            scheduleScrollTop(event.currentTarget.scrollTop);
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
                  isDropTarget={dropIndex() === absoluteIndex()}
                  isPlayingNow={props.isPlayingNow}
                  showArtwork={showArtwork()}
                  hideSize={props.hideSize}
                  uiSettings={uiSettings}
                  emptyCreditsLabel={t("library.item.creditsEmpty")}
                  eqAriaLabel={t("media.eq.aria")}
                  playLabel={t("library.item.play")}
                  enqueueLabel={t("library.item.enqueue")}
                  rowAction={rowAction()}
                  displaySongText={displaySongText}
                  onSelect={setSelectedId}
                  onPlay={props.onPlay}
                  onDoubleClick={props.onDoubleClick}
                  onEnqueue={props.onEnqueue}
                  onContextMenu={handleRowContextMenu}
                  draggable={props.draggable}
                  onDragStart={handleDragStart}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
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
            showTop={props.hideTopScrollTool !== true}
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
          header={menuHeader()}
          items={menuItems()}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
      </div>
    </Show>
  );
}
