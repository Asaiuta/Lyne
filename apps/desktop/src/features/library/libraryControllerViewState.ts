import { createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  LibraryFolderSummary,
  LibraryTrackGroupsResponse,
  LibraryTrackGroupSummary,
  LibraryRoot,
  LibraryTrackSummariesResponse,
  LibraryTrackSummary,
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
import {
  LibraryWorkerClient,
  createLibraryWorkerViewInput,
  type LibraryWorkerViewResult
} from "./libraryWorkerClient";
import type { LibraryWorkerRow } from "./libraryWorkerProtocol";

const DEFAULT_LIBRARY_RANGE = { start: 0, end: 80 };
const FULL_ROW_LIBRARY_TABS: readonly LibraryTab[] = ["folders"];

interface LibraryControllerViewStateOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  globalQuery: Accessor<string>;
  requestTrackSummaries: () => Promise<LibraryTrackSummariesResponse>;
  requestTrackGroups: (input: {
    kind: "artists" | "albums";
    queries: string[];
    folderPath: string | null;
    sort: LibrarySortState;
    selectedGroupKey?: string | null;
  }) => Promise<LibraryTrackGroupsResponse>;
  adaptTrackSummary: (row: LibraryTrackSummary) => LibraryListItem;
  adaptWorkerRow: (row: LibraryWorkerRow) => LibraryListItem;
  resolveGroupArtworkUrl: (group: LibraryTrackGroupSummary) => string | null;
  readErrorMessage: (error: unknown) => string;
  setRawFeedback: (tone: "neutral" | "success" | "error", message: string) => void;
}

export function createLibraryControllerViewState(options: LibraryControllerViewStateOptions) {
  const {
    t,
    globalQuery,
    requestTrackSummaries,
    requestTrackGroups,
    adaptTrackSummary,
    adaptWorkerRow,
    resolveGroupArtworkUrl,
    readErrorMessage,
    setRawFeedback
  } = options;

  const [roots, setRoots] = createSignal<LibraryRoot[]>([]);
  const [libraryRevision, setLibraryRevision] = createSignal<string | null>(null);
  const [libraryTotalCount, setLibraryTotalCount] = createSignal<number>(0);
  const [virtualRows, setVirtualRows] = createSignal<LibraryListItem[]>([]);
  const [fullRows, setFullRows] = createSignal<LibraryListItem[]>([]);
  const [artistGroupOptions, setArtistGroupOptions] = createSignal<LibraryTrackGroupSummary[]>([]);
  const [albumGroupOptions, setAlbumGroupOptions] = createSignal<LibraryTrackGroupSummary[]>([]);
  const [selectedArtistGroupKey, setSelectedArtistGroupKey] = createSignal<string | null>(null);
  const [selectedAlbumGroupKey, setSelectedAlbumGroupKey] = createSignal<string | null>(null);
  const [artistGroupRows, setArtistGroupRows] = createSignal<LibraryListItem[]>([]);
  const [albumGroupRows, setAlbumGroupRows] = createSignal<LibraryListItem[]>([]);
  const [virtualTotal, setVirtualTotal] = createSignal<number>(0);
  const [virtualRange, setVirtualRange] =
    createSignal<{ start: number; end: number }>(DEFAULT_LIBRARY_RANGE);
  const [loadedVirtualRange, setLoadedVirtualRange] =
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

  const currentTrackViewInput = () => ({
    queries: debouncedQueries(),
    folderPath: selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
    sort: sort()
  });

  const currentWorkerInput = () =>
    createLibraryWorkerViewInput(
      debouncedQueries(),
      selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
      sort()
    );

  const applyWorkerView = (result: LibraryWorkerViewResult) => {
    setLoadedVirtualRange(result.range);
    setVirtualRows(result.rows.map(adaptWorkerRow));
    setVirtualTotal(result.total);
    setVirtualSizeBytes(result.totalSizeBytes);
    setFolderOptions(result.folders);
    setViewReady(true);
  };

  const workerClient = new LibraryWorkerClient({
    onReady: () => {
      workerClient.requestView(currentWorkerInput(), virtualRange());
    },
    onViewResult: applyWorkerView,
    onError: (error) => {
      setViewReady(false);
      setRawFeedback("error", readErrorMessage(error));
    }
  });

  const requestVisibleWorkerView = () => {
    workerClient.requestView(currentWorkerInput(), virtualRange());
  };

  const requestViewMediaIds = async (startMediaId?: string | null): Promise<string[]> => {
    const mediaIds = await workerClient.requestMediaIds(currentWorkerInput());
    if (mediaIds.length === 0) {
      throw new Error(t("library.tracks.emptyFilter"));
    }
    if (startMediaId && !mediaIds.includes(startMediaId)) {
      return [startMediaId, ...mediaIds];
    }
    return mediaIds;
  };

  const requestViewRows = async (): Promise<LibraryListItem[]> => {
    const rows = await workerClient.requestRows(currentWorkerInput());
    return rows.map(adaptWorkerRow);
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

  let fullRowsAbortController: AbortController | null = null;

  const refreshFullRows = async () => {
    if (!viewReady()) {
      setFullRows([]);
      return;
    }
    fullRowsAbortController?.abort();
    const abortController = new AbortController();
    fullRowsAbortController = abortController;
    try {
      const rows = await requestViewRows();
      if (!abortController.signal.aborted) {
        setFullRows(rows);
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        setFullRows([]);
        setRawFeedback("error", readErrorMessage(error));
      }
    }
  };

  onCleanup(() => {
    fullRowsAbortController?.abort();
    workerClient.dispose();
  });

  const reloadLibraryView = async () => {
    const requestId = latestViewRequestId + 1;
    latestViewRequestId = requestId;
    latestGroupRequestId += 1;
    workerClient.dispose();
    setFullRows([]);
    setArtistGroupOptions([]);
    setAlbumGroupOptions([]);
    setSelectedArtistGroupKey(null);
    setSelectedAlbumGroupKey(null);
    setArtistGroupRows([]);
    setAlbumGroupRows([]);
    setVirtualRows([]);
    setFullRows([]);
    setVirtualTotal(0);
    setVirtualSizeBytes(0);
    setLoadedVirtualRange(DEFAULT_LIBRARY_RANGE);
    setViewReady(false);
    const payload = await requestTrackSummaries();
    if (requestId !== latestViewRequestId) return;
    setLibraryRevision(payload.revision);
    setLibraryTotalCount(payload.total_count);
    setVirtualTotal(payload.total_count);
    setVirtualSizeBytes(payload.total_size_bytes);
    setFolderOptions(payload.folders);
    workerClient.init(payload.tracks, payload.folders);
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
    if (viewReady()) requestVisibleWorkerView();
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
    if (FULL_ROW_LIBRARY_TABS.includes(tab)) {
      void refreshFullRows();
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
  const fullRowItems = createMemo(() => fullRows());
  const filteredItems = createMemo(() =>
    activeTab() === "songs" ? virtualRows() : fullRowItems()
  );
  const activeGroupedItems = createMemo(() => {
    const tab = activeTab();
    if (tab === "artists") return artistGroupRows();
    if (tab === "albums") return albumGroupRows();
    return fullRowItems();
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
    const totalBytes = fullRowItems().reduce((total, item) => total + (item.size_bytes ?? 0), 0);
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
    fullRows,
    setFullRows,
    virtualTotal,
    setVirtualTotal,
    virtualRange,
    setVirtualRange: updateVirtualRange,
    loadedVirtualRange,
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
