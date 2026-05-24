import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { useTranslation } from "../../shared/i18n";
import { ncmSongShareUrl } from "../../shared/api/ncm/urls";
import {
  readSongCommentsPayload,
  songComments,
  type NcmSongComment
} from "../../shared/api/ncm/comment";
import { useUISettings } from "../../shared/state/useUISettings";
import { useDismissibleOverlay } from "../../shared/ui/useDismissibleOverlay";
import { Modal } from "../Modal";
import {
  IconChevronDown,
  IconCloud,
  IconCopy,
  IconDelete,
  IconFolder,
  IconBookOpen,
  IconMessage,
  IconPlay,
  IconPlaylist,
  IconQueueAdd,
  IconSearch,
  IconShare,
  IconThumbDown
} from "../icons";
import { useUISearch } from "../../shared/state/UISearchContext";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { MediaListFloatTools } from "./MediaListFloatTools";
import { MediaListRow } from "./MediaListRow";
import { MediaSortPopover } from "./MediaSortPopover";
import { SImage } from "../SImage";
import { displayNameFromSourcePath, stripBracketedContent } from "./mediaListFormatting";
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
export { isMediaListItemCurrent, mediaKeyForPath } from "../../shared/media/mediaIdentity";
export {
  displayNameFromSourcePath,
  formatMediaDuration
} from "./mediaListFormatting";

export type MediaContextAction =
  | "play"
  | "enqueue"
  | "copy-name"
  | "copy-id"
  | "share-link"
  | "song-wiki"
  | "view-comments"
  | "copy-path"
  | "show-in-folder"
  | "add-to-playlist"
  | "search"
  | "daily-dislike"
  | "delete-from-playlist"
  | "delete-from-cloud"
  | "cloud-match"
  | "delete-from-library"
  | "delete";
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
  mvId?: number | null;
  isCloud?: boolean;
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
  onDoubleClick?: (item: T) => void;
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
  sortDisabled?: boolean;
  hideTopScrollTool?: boolean;
  draggable?: boolean;
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

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

interface CommentsModalState {
  open: boolean;
  title: string;
  status: "idle" | "loading" | "success" | "error";
  total: number;
  hotComments: readonly NcmSongComment[];
  comments: readonly NcmSongComment[];
  error: string | null;
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

const closedCommentsModal: CommentsModalState = {
  open: false,
  title: "",
  status: "idle",
  total: 0,
  hotComments: [],
  comments: [],
  error: null
};

export function MediaList<T extends MediaListItem>(props: MediaListProps<T>) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const search = useUISearch();
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [menu, setMenu] = createSignal<MenuState>(closedMenu);
  const [sortMenu, setSortMenu] = createSignal<SortMenuState>(closedSortMenu);
  const [commentsModal, setCommentsModal] = createSignal<CommentsModalState>(closedCommentsModal);
  const [scrollTop, setScrollTop] = createSignal<number>(0);
  const [draggedIndex, setDraggedIndex] = createSignal<number | null>(null);
  const [dropIndex, setDropIndex] = createSignal<number | null>(null);
  const [viewportHeight, setViewportHeight] = createSignal<number>(0);
  let viewportRef: HTMLDivElement | undefined;
  let sortMenuRef: HTMLDivElement | undefined;
  let scrollFrame = 0;
  let pendingScrollTop = 0;

  const contextActionSet = createMemo<Set<MediaContextAction>>(
    () =>
      new Set(
        props.contextActions ?? [
          "play",
          "enqueue",
          "search",
          "copy-name",
          "copy-id",
          "share-link",
          "song-wiki",
          "view-comments"
        ]
      )
  );
  const contextActionEnabled = (action: MediaContextAction): boolean => {
    switch (action) {
      case "play":
        return uiSettings.contextMenuOptions.play;
      case "enqueue":
        return uiSettings.contextMenuOptions.playNext;
      case "add-to-playlist":
        return uiSettings.contextMenuOptions.addToPlaylist;
      case "search":
        return uiSettings.contextMenuOptions.search;
      case "daily-dislike":
        return uiSettings.contextMenuOptions.dislike;
      case "copy-name":
        return uiSettings.contextMenuOptions.more && uiSettings.contextMenuOptions.copyName;
      case "copy-id":
      case "share-link":
      case "song-wiki":
        return uiSettings.contextMenuOptions.more;
      case "view-comments":
        return uiSettings.useOnlineService;
      case "copy-path":
        return true;
      case "show-in-folder":
        return uiSettings.contextMenuOptions.openFolder;
      case "delete-from-playlist":
        return uiSettings.contextMenuOptions.deleteFromPlaylist;
      case "delete-from-cloud":
        return uiSettings.contextMenuOptions.deleteFromCloud;
      case "cloud-match":
        return uiSettings.contextMenuOptions.cloudMatch;
      case "delete-from-library":
        return uiSettings.contextMenuOptions.deleteFromLibrary;
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

  const displaySongText = (value: string): string =>
    uiSettings.hideBracketedContent ? stripBracketedContent(value) : value;

  const searchableTitle = (item: T): string =>
    displaySongText(
      item.title?.trim() ||
        item.fileName?.trim() ||
        (item.source_path ? displayNameFromSourcePath(item.source_path) : "")
    );

  const handleSearchItem = (item: T) => {
    const keyword = searchableTitle(item).trim();
    if (!keyword) {
      return;
    }
    search.setQuery(keyword);
    search.submitSearch();
    props.onContextAction?.("search", item);
  };

  const handleCopyName = async (item: T) => {
    const name = searchableTitle(item).trim();
    if (!name) {
      return;
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(name);
      }
    } catch (error) {
      console.warn("[MediaList] copy name failed", error);
    }
    props.onContextAction?.("copy-name", item);
  };

  const handleCopyId = async (item: T) => {
    if (typeof item.songId !== "number") return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(String(item.songId));
      }
    } catch (error) {
      console.warn("[MediaList] copy song id failed", error);
    }
    props.onContextAction?.("copy-id", item);
  };

  const handleShareLink = async (item: T) => {
    if (typeof item.songId !== "number") return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(ncmSongShareUrl(item.songId, uiSettings.shareUrlFormat));
      }
    } catch (error) {
      console.warn("[MediaList] copy share link failed", error);
    }
    props.onContextAction?.("share-link", item);
  };

  const handleViewComments = async (item: T) => {
    if (typeof item.songId !== "number") return;
    const title = searchableTitle(item) || String(item.songId);
    setCommentsModal({
      ...closedCommentsModal,
      open: true,
      title,
      status: "loading"
    });
    props.onContextAction?.("view-comments", item);
    try {
      const payload = readSongCommentsPayload(await songComments(item.songId, 30, 0));
      setCommentsModal({
        open: true,
        title,
        status: "success",
        total: payload.total,
        hotComments: payload.hotComments,
        comments: payload.comments,
        error: null
      });
    } catch (error) {
      console.warn("[MediaList] load song comments failed", error);
      setCommentsModal({
        ...closedCommentsModal,
        open: true,
        title,
        status: "error",
        error: error instanceof Error ? error.message : t("common.error.requestFailed")
      });
    }
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
    } else if (key === "copy-name") {
      void handleCopyName(target);
    } else if (key === "copy-id") {
      void handleCopyId(target);
    } else if (key === "share-link") {
      void handleShareLink(target);
    } else if (key === "song-wiki") {
      props.onContextAction?.("song-wiki", target);
    } else if (key === "view-comments") {
      void handleViewComments(target);
    } else if (key === "copy-path") {
      void handleCopyPath(target);
    } else if (key === "show-in-folder") {
      props.onContextAction?.("show-in-folder", target);
    } else if (key === "search") {
      handleSearchItem(target);
    } else if (
      key === "add-to-playlist" ||
      key === "daily-dislike" ||
      key === "delete" ||
      key === "delete-from-playlist" ||
      key === "delete-from-cloud" ||
      key === "cloud-match" ||
      key === "delete-from-library"
    ) {
      props.onContextAction?.(key, target);
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
    useVirtualRows() ? totalItems() * MEDIA_LIST_ROW_HEIGHT_PX : 0
  );
  const virtualOffset = createMemo<number>(() =>
    useVirtualRows()
      ? (remoteVirtualStart() ?? visibleRange().start) * MEDIA_LIST_ROW_HEIGHT_PX
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
      top: Math.max(0, absoluteIndex * MEDIA_LIST_ROW_HEIGHT_PX),
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
    const target = props.items.find((item) => item.id === menu().itemId);
    const items: ContextMenuItem[] = [
      { key: "play", label: t("media.context.play"), icon: <IconPlay /> },
      { key: "enqueue", label: t("media.context.enqueue"), icon: <IconQueueAdd /> },
      { key: "add-to-playlist", label: t("media.context.addToPlaylist"), icon: <IconPlaylist /> },
      { key: "daily-dislike", label: t("media.context.dailyDislike"), icon: <IconThumbDown /> },
      { key: "search", label: t("media.context.search"), icon: <IconSearch /> },
      { key: "copy-name", label: t("media.context.copyName"), icon: <IconCopy /> },
      { key: "copy-id", label: t("media.context.copyId"), icon: <IconCopy /> },
      { key: "share-link", label: t("media.context.shareLink"), icon: <IconShare /> },
      { key: "song-wiki", label: t("media.context.songWiki"), icon: <IconBookOpen /> },
      { key: "view-comments", label: t("media.context.viewComments"), icon: <IconMessage /> },
      { key: "copy-path", label: t("media.context.copyPath"), icon: <IconCopy /> },
      { key: "show-in-folder", label: t("media.context.showInFolder"), icon: <IconFolder /> },
      { key: "delete-from-playlist", label: t("media.context.deleteFromPlaylist"), icon: <IconDelete /> },
      { key: "delete-from-cloud", label: t("media.context.deleteFromCloud"), icon: <IconDelete /> },
      { key: "cloud-match", label: t("media.context.cloudMatch"), icon: <IconCloud /> },
      { key: "delete-from-library", label: t("media.context.deleteFromLibrary"), icon: <IconDelete /> },
      { key: "delete", label: props.deleteActionLabel ?? t("media.context.delete"), icon: <IconDelete /> }
    ];
    return items.filter((item) => {
      const action = item.key as MediaContextAction;
      if (
        (action === "copy-id" ||
          action === "share-link" ||
          action === "song-wiki" ||
          action === "view-comments" ||
          action === "cloud-match") &&
        typeof target?.songId !== "number"
      ) {
        return false;
      }
      return actions.has(action) && contextActionEnabled(action);
    });
  };

  return (
    <Show
      when={totalItems() > 0}
      fallback={
        <div class="media-list-table content-fade-in" data-state="empty">
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
          items={menuItems()}
          onSelect={handleMenuSelect}
          onClose={closeMenu}
        />
        <Modal
          open={commentsModal().open}
          title={t("media.comments.title", { title: commentsModal().title })}
          onClose={() => setCommentsModal(closedCommentsModal)}
          size="lg"
        >
          <div class="media-comments-modal">
            <Show when={commentsModal().status === "loading"}>
              <div class="panel-note">{t("media.comments.loading")}</div>
            </Show>
            <Show when={commentsModal().status === "error"}>
              <div class="panel-note">{commentsModal().error ?? t("common.error.requestFailed")}</div>
            </Show>
            <Show when={commentsModal().status === "success" && commentsModal().total === 0}>
              <div class="panel-note">{t("media.comments.empty")}</div>
            </Show>
            <Show when={commentsModal().hotComments.length > 0}>
              <section class="media-comments-section">
                <h4>{t("media.comments.hot")}</h4>
                <For each={commentsModal().hotComments}>
                  {(comment) => <MediaCommentItem comment={comment} />}
                </For>
              </section>
            </Show>
            <Show when={commentsModal().comments.length > 0}>
              <section class="media-comments-section">
                <h4>
                  {t("media.comments.all")}
                  <Show when={commentsModal().total > 0}>
                    <span>{commentsModal().total}</span>
                  </Show>
                </h4>
                <For each={commentsModal().comments}>
                  {(comment) => <MediaCommentItem comment={comment} />}
                </For>
              </section>
            </Show>
          </div>
        </Modal>
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

function MediaCommentItem(props: { comment: NcmSongComment }) {
  const timeLabel = () =>
    props.comment.time === null ? "" : new Date(props.comment.time).toLocaleDateString();

  return (
    <article class="media-comment-item">
      <Show when={props.comment.user.avatarUrl} fallback={<div class="media-comment-avatar" aria-hidden="true" />}>
        {(avatarUrl) => (
          <SImage
            src={avatarUrl()}
            alt={props.comment.user.nickname}
            class="media-comment-avatar"
            observeVisibility={true}
            shape="circle"
            aspect="square"
          />
        )}
      </Show>
      <div class="media-comment-body">
        <div class="media-comment-meta">
          <span>{props.comment.user.nickname}</span>
          <span>{timeLabel()}</span>
        </div>
        <p>{props.comment.content}</p>
        <Show when={props.comment.likedCount > 0}>
          <span class="media-comment-like">{props.comment.likedCount}</span>
        </Show>
      </div>
    </article>
  );
}
