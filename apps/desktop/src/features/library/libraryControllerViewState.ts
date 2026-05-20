import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  LibraryFolderSummary,
  LibraryTrackGroupsResponse,
  LibraryTrackGroupSummary,
  LibraryRoot,
  LibraryTrackViewResponse,
  LocalPlaylist
} from "../../shared/api/types";
import type { TranslationKey } from "../../shared/i18n";
import {
  ALL_FOLDERS_VALUE,
  type LibraryFolderNode,
  type LibraryGroup,
  type LibraryListItem,
  type LibrarySortField,
  type LibrarySortOrder,
  type LibrarySortState,
  type LibraryTab
} from "./libraryViewTypes";
import {
  buildFolderTreeFromFolders,
  folderNameFromPath,
  sortItems
} from "./libraryViewModel";
import type { ScanProgress } from "./libraryScanState";
import { nextSortForField, nextSortForOrder } from "./librarySortModel";

const DEFAULT_LIBRARY_RANGE = { start: 0, end: 80 };
const LEGACY_LIBRARY_TABS: readonly LibraryTab[] = ["artists", "albums", "folders"];

interface LibraryControllerViewStateOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  globalQuery: Accessor<string>;
  requestTrackView: (input: {
    queries: string[];
    folderPath: string | null;
    sort: LibrarySortState;
    range?: { start: number; end: number };
    includeMediaIds?: boolean;
  }) => Promise<LibraryTrackViewResponse>;
  requestTrackGroups: (input: {
    kind: "artists" | "albums";
    queries: string[];
    folderPath: string | null;
    sort: LibrarySortState;
    selectedGroupKey?: string | null;
  }) => Promise<LibraryTrackGroupsResponse>;
  adaptTrackSummary: (row: LibraryTrackViewResponse["rows"][number]) => LibraryListItem;
  resolveGroupArtworkUrl: (group: LibraryTrackGroupSummary) => string | null;
  readErrorMessage: (error: unknown) => string;
  setRawFeedback: (tone: "neutral" | "success" | "error", message: string) => void;
}

export function createLibraryControllerViewState(options: LibraryControllerViewStateOptions) {
  const {
    t,
    globalQuery,
    requestTrackView,
    requestTrackGroups,
    adaptTrackSummary,
    resolveGroupArtworkUrl,
    readErrorMessage,
    setRawFeedback
  } = options;

  const [roots, setRoots] = createSignal<LibraryRoot[]>([]);
  const [libraryRevision, setLibraryRevision] = createSignal<string | null>(null);
  const [libraryTotalCount, setLibraryTotalCount] = createSignal<number>(0);
  const [virtualRows, setVirtualRows] = createSignal<LibraryListItem[]>([]);
  const [legacyRows, setLegacyRows] = createSignal<LibraryListItem[]>([]);
  const [artistGroupOptions, setArtistGroupOptions] = createSignal<LibraryTrackGroupSummary[]>([]);
  const [albumGroupOptions, setAlbumGroupOptions] = createSignal<LibraryTrackGroupSummary[]>([]);
  const [selectedArtistGroupKey, setSelectedArtistGroupKey] = createSignal<string | null>(null);
  const [selectedAlbumGroupKey, setSelectedAlbumGroupKey] = createSignal<string | null>(null);
  const [artistGroupRows, setArtistGroupRows] = createSignal<LibraryListItem[]>([]);
  const [albumGroupRows, setAlbumGroupRows] = createSignal<LibraryListItem[]>([]);
  const [virtualTotal, setVirtualTotal] = createSignal<number>(0);
  const [virtualRange, setVirtualRange] =
    createSignal<{ start: number; end: number }>(DEFAULT_LIBRARY_RANGE);
  const [folderOptions, setFolderOptions] = createSignal<LibraryFolderSummary[]>([]);
  const [viewReady, setViewReady] = createSignal<boolean>(false);
  const [debouncedQueries, setDebouncedQueries] = createSignal<string[]>([]);
  const [virtualSizeBytes, setVirtualSizeBytes] = createSignal<number>(0);
  const [localPlaylists, setLocalPlaylists] = createSignal<LocalPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(null);
  const [selectedPlaylistItems, setSelectedPlaylistItems] = createSignal<LibraryListItem[]>([]);
  const [activeTab, setActiveTab] = createSignal<LibraryTab>("songs");
  const [sort, setSort] = createSignal<LibrarySortState>({ field: "default", order: "default" });
  const [localQuery, setLocalQuery] = createSignal("");
  const [selectedFolder, setSelectedFolder] = createSignal(ALL_FOLDERS_VALUE);
  const [manageOpen, setManageOpen] = createSignal(false);
  const [isFetching, setIsFetching] = createSignal(false);
  const [isScanning, setIsScanning] = createSignal(false);
  const [scanProgress, setScanProgress] = createSignal<ScanProgress | null>(null);

  let latestViewRequestId = 0;
  let latestGroupRequestId = 0;

  const currentTrackViewInput = (options?: {
    range?: { start: number; end: number };
    includeMediaIds?: boolean;
  }) => ({
    queries: debouncedQueries(),
    folderPath: selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
    sort: sort(),
    range: options?.range,
    includeMediaIds: options?.includeMediaIds
  });

  const applyTrackView = (payload: LibraryTrackViewResponse) => {
    setLibraryRevision(payload.revision);
    setLibraryTotalCount(payload.library_total_count);
    setVirtualRows(payload.rows.map(adaptTrackSummary));
    setVirtualTotal(payload.total_count);
    setVirtualSizeBytes(payload.total_size_bytes);
    setFolderOptions(payload.folders);
    setViewReady(true);
  };

  const requestVisibleTrackView = () => {
    const requestId = latestViewRequestId + 1;
    latestViewRequestId = requestId;
    void requestTrackView(currentTrackViewInput({ range: virtualRange() }))
      .then((payload) => {
        if (requestId !== latestViewRequestId) return;
        applyTrackView(payload);
      })
      .catch((error) => {
        if (requestId !== latestViewRequestId) return;
        setViewReady(false);
        setRawFeedback("error", readErrorMessage(error));
      });
  };

  const requestViewMediaIds = async (startMediaId?: string | null): Promise<string[]> => {
    const response = await requestTrackView(currentTrackViewInput({ includeMediaIds: true }));
    const mediaIds = response.media_ids ?? [];
    if (mediaIds.length === 0) {
      throw new Error(t("library.tracks.emptyFilter"));
    }
    if (startMediaId && !mediaIds.includes(startMediaId)) {
      return [startMediaId, ...mediaIds];
    }
    return mediaIds;
  };

  const requestViewRows = async (): Promise<LibraryListItem[]> => {
    const response = await requestTrackView(currentTrackViewInput());
    return response.rows.map(adaptTrackSummary);
  };

  const requestGroupedView = (
    kind: "artists" | "albums",
    selectedGroupKey?: string | null
  ) => {
    const requestId = latestGroupRequestId + 1;
    latestGroupRequestId = requestId;
    void requestTrackGroups({
      kind,
      ...currentTrackViewInput(),
      selectedGroupKey
    })
      .then((payload) => {
        if (requestId !== latestGroupRequestId) return;
        setLibraryRevision(payload.revision);
        setLibraryTotalCount(payload.library_total_count);
        setVirtualTotal(payload.total_count);
        setVirtualSizeBytes(payload.total_size_bytes);
        setFolderOptions(payload.folders);
        const rows = payload.rows.map(adaptTrackSummary);
        if (kind === "artists") {
          setArtistGroupOptions(payload.groups);
          setSelectedArtistGroupKey(payload.selected_group_key);
          setArtistGroupRows(rows);
        } else {
          setAlbumGroupOptions(payload.groups);
          setSelectedAlbumGroupKey(payload.selected_group_key);
          setAlbumGroupRows(rows);
        }
      })
      .catch((error) => {
        if (requestId !== latestGroupRequestId) return;
        setRawFeedback("error", readErrorMessage(error));
      });
  };

  let legacyRowsAbortController: AbortController | null = null;

  const refreshLegacyRows = async () => {
    if (!viewReady()) {
      setLegacyRows([]);
      return;
    }
    legacyRowsAbortController?.abort();
    const abortController = new AbortController();
    legacyRowsAbortController = abortController;
    try {
      const rows = await requestViewRows();
      if (!abortController.signal.aborted) {
        setLegacyRows(rows);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        setLegacyRows([]);
        setRawFeedback("error", readErrorMessage(error));
      }
    }
  };

  onCleanup(() => {
    legacyRowsAbortController?.abort();
  });

  const reloadLibraryView = async () => {
    const requestId = latestViewRequestId + 1;
    latestViewRequestId = requestId;
    latestGroupRequestId += 1;
    setLegacyRows([]);
    setArtistGroupOptions([]);
    setAlbumGroupOptions([]);
    setSelectedArtistGroupKey(null);
    setSelectedAlbumGroupKey(null);
    setArtistGroupRows([]);
    setAlbumGroupRows([]);
    setViewReady(false);
    const payload = await requestTrackView(currentTrackViewInput({ range: virtualRange() }));
    if (requestId !== latestViewRequestId) return;
    applyTrackView(payload);
  };

  const updateVirtualRange = (range: { start: number; end: number }) => {
    setVirtualRange((current) =>
      current.start === range.start && current.end === range.end ? current : range
    );
  };

  const updateSort = (field: LibrarySortField) => {
    setSort((current) => nextSortForField(current, field));
  };

  const updateSortOrder = (order: LibrarySortOrder) => {
    setSort((current) => nextSortForOrder(current, order));
  };

  createEffect(() => {
    const nextQueries = [globalQuery(), localQuery()]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0);
    const timer = window.setTimeout(() => {
      setDebouncedQueries(nextQueries);
      setVirtualRange(DEFAULT_LIBRARY_RANGE);
    }, 180);
    onCleanup(() => window.clearTimeout(timer));
  });

  createEffect(on([debouncedQueries, selectedFolder, sort, virtualRange], () => {
    if (viewReady()) requestVisibleTrackView();
  }));

  createEffect(() => {
    const tab = activeTab();
    viewReady();
    debouncedQueries();
    selectedFolder();
    sort();
    if (tab === "artists") {
      requestGroupedView("artists", untrack(selectedArtistGroupKey));
      return;
    }
    if (tab === "albums") {
      requestGroupedView("albums", untrack(selectedAlbumGroupKey));
      return;
    }
    if (LEGACY_LIBRARY_TABS.includes(tab)) {
      void refreshLegacyRows();
    }
  });

  const selectArtistGroup = (key: string | null) => {
    setSelectedArtistGroupKey(key);
    requestGroupedView("artists", key);
  };

  const selectAlbumGroup = (key: string | null) => {
    setSelectedAlbumGroupKey(key);
    requestGroupedView("albums", key);
  };

  const folderGroups = createMemo<LibraryGroup[]>(() => {
    const rootOptions = roots();
    if (rootOptions.length > 0) {
      return rootOptions.map((root) => ({
        key: root.source_path,
        label: folderNameFromPath(root.source_path),
        songs: [],
        artworkUrl: null,
        detail: root.source_path
      }));
    }
    return [];
  });
  const folderTree = createMemo<LibraryFolderNode[]>(() => buildFolderTreeFromFolders(folderOptions()));
  const legacyFilteredItems = createMemo(() => legacyRows());
  const filteredItems = createMemo(() =>
    activeTab() === "songs" ? virtualRows() : legacyFilteredItems()
  );
  const activeGroupedItems = createMemo(() => {
    const tab = activeTab();
    if (tab === "artists") return artistGroupRows();
    if (tab === "albums") return albumGroupRows();
    return legacyFilteredItems();
  });
  const artistGroups = createMemo<LibraryGroup[]>(() =>
    artistGroupOptions().map((group) => ({
      key: group.key,
      label: group.label ?? t("library.group.unknownArtist"),
      songs: selectedArtistGroupKey() === group.key ? artistGroupRows() : [],
      count: group.count,
      artworkUrl: null,
      detail: undefined
    }))
  );
  const albumGroups = createMemo<LibraryGroup[]>(() =>
    albumGroupOptions().map((group) => ({
      key: group.key,
      label: group.label ?? t("library.group.unknownAlbum"),
      songs: selectedAlbumGroupKey() === group.key ? albumGroupRows() : [],
      count: group.count,
      artworkUrl: resolveGroupArtworkUrl(group),
      detail: undefined
    }))
  );
  const selectedPlaylistSortedItems = createMemo(() =>
    sortItems(selectedPlaylistItems(), sort())
  );
  const visibleSizeGb = createMemo<number>(() => {
    if (activeTab() === "songs") {
      return Number((virtualSizeBytes() / (1024 * 1024 * 1024)).toFixed(2));
    }
    if (activeTab() === "artists" || activeTab() === "albums") {
      return Number(
        (activeGroupedItems().reduce((total, item) => total + (item.size_bytes ?? 0), 0) /
          (1024 * 1024 * 1024)).toFixed(2)
      );
    }
    const totalBytes = legacyFilteredItems().reduce((total, item) => total + (item.size_bytes ?? 0), 0);
    return Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
  });

  return {
    roots,
    setRoots,
    libraryRevision,
    setLibraryRevision,
    libraryTotalCount,
    setLibraryTotalCount,
    virtualRows,
    setVirtualRows,
    legacyRows,
    setLegacyRows,
    virtualTotal,
    setVirtualTotal,
    virtualRange,
    setVirtualRange: updateVirtualRange,
    folderOptions,
    setFolderOptions,
    viewReady,
    setViewReady,
    debouncedQueries,
    setDebouncedQueries,
    virtualSizeBytes,
    setVirtualSizeBytes,
    localPlaylists,
    setLocalPlaylists,
    selectedPlaylistId,
    setSelectedPlaylistId,
    selectedPlaylistItems,
    setSelectedPlaylistItems,
    activeTab,
    setActiveTab,
    sort,
    updateSort,
    updateSortOrder,
    localQuery,
    setLocalQuery,
    selectedFolder,
    setSelectedFolder,
    manageOpen,
    setManageOpen,
    isFetching,
    setIsFetching,
    isScanning,
    setIsScanning,
    scanProgress,
    setScanProgress,
    requestViewMediaIds,
    requestViewRows,
    reloadLibraryView,
    selectedArtistGroupKey,
    selectArtistGroup,
    selectedAlbumGroupKey,
    selectAlbumGroup,
    activeGroupedItems,
    filteredItems,
    artistGroups,
    albumGroups,
    folderGroups,
    folderTree,
    selectedPlaylistSortedItems,
    visibleSizeGb
  };
}
