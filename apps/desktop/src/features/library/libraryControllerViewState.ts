import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import type {
  LibraryFolderSummary,
  LibraryRoot,
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
import type { LibraryWorkerFolderGroup, LibraryWorkerRow } from "./libraryWorkerProtocol";
import {
  LibraryWorkerClient,
  createLibraryWorkerViewInput
} from "./libraryWorkerClient";
import {
  buildFolderTreeFromFolders,
  fallbackLabel,
  folderNameFromPath,
  groupByKey,
  sortItems,
  splitArtists
} from "./libraryViewModel";
import type { ScanProgress } from "./libraryScanState";
import { nextSortForField, nextSortForOrder } from "./librarySortModel";

const DEFAULT_LIBRARY_RANGE = { start: 0, end: 80 };
const LEGACY_LIBRARY_TABS: readonly LibraryTab[] = ["artists", "albums", "folders"];

interface LibraryTrackSummariesPayload {
  revision: string;
  total_count: number;
  total_size_bytes: number;
  tracks: LibraryTrackSummary[];
  folders: LibraryFolderSummary[];
}

interface LibraryControllerViewStateOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  globalQuery: Accessor<string>;
  workerClient: LibraryWorkerClient;
  adaptWorkerRow: (row: LibraryWorkerRow) => LibraryListItem;
  readErrorMessage: (error: unknown) => string;
  setRawFeedback: (tone: "neutral" | "success" | "error", message: string) => void;
}

export function createLibraryControllerViewState(options: LibraryControllerViewStateOptions) {
  const { t, globalQuery, workerClient, adaptWorkerRow, readErrorMessage, setRawFeedback } = options;

  const [roots, setRoots] = createSignal<LibraryRoot[]>([]);
  const [libraryRevision, setLibraryRevision] = createSignal<string | null>(null);
  const [libraryTotalCount, setLibraryTotalCount] = createSignal<number>(0);
  const [virtualRows, setVirtualRows] = createSignal<LibraryListItem[]>([]);
  const [legacyRows, setLegacyRows] = createSignal<LibraryListItem[]>([]);
  const [virtualTotal, setVirtualTotal] = createSignal<number>(0);
  const [virtualRange, setVirtualRange] =
    createSignal<{ start: number; end: number }>(DEFAULT_LIBRARY_RANGE);
  const [folderOptions, setFolderOptions] = createSignal<LibraryWorkerFolderGroup[]>([]);
  const [workerReady, setWorkerReady] = createSignal<boolean>(false);
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

  onCleanup(() => {
    workerClient.dispose();
  });

  const currentWorkerViewInput = () =>
    createLibraryWorkerViewInput(
      debouncedQueries(),
      selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
      sort()
    );

  const currentLibraryQueryInput = (startTrackKey?: number | null) => ({
    search: debouncedQueries().join(" "),
    folderPath: selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
    sortField: sort().field,
    sortOrder: sort().order,
    startTrackKey: startTrackKey ?? null
  });

  const postWorkerView = () => {
    if (!workerReady()) return;
    workerClient.requestView(currentWorkerViewInput(), virtualRange());
  };

  const requestWorkerTrackKeys = async (startTrackKey?: number): Promise<number[]> => {
    if (!workerReady()) {
      throw new Error(t("common.error.requestFailed"));
    }
    const trackKeys = await workerClient.requestTrackKeys(currentWorkerViewInput());
    if (trackKeys.length === 0) {
      throw new Error(t("library.tracks.emptyFilter"));
    }
    if (startTrackKey !== undefined && !trackKeys.includes(startTrackKey)) {
      return [startTrackKey, ...trackKeys];
    }
    return trackKeys;
  };

  const requestWorkerRows = async (): Promise<LibraryListItem[]> => {
    if (!workerReady()) {
      throw new Error(t("common.error.requestFailed"));
    }
    const rows = await workerClient.requestRows(currentWorkerViewInput());
    return rows.map(adaptWorkerRow);
  };

  let legacyRowsAbortController: AbortController | null = null;

  const refreshLegacyRows = async () => {
    if (!workerReady()) {
      setLegacyRows([]);
      return;
    }
    legacyRowsAbortController?.abort();
    const abortController = new AbortController();
    legacyRowsAbortController = abortController;
    try {
      const rows = await requestWorkerRows();
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

  const applyTrackSummaries = (payload: LibraryTrackSummariesPayload) => {
    setLegacyRows([]);
    setLibraryRevision(payload.revision);
    setLibraryTotalCount(payload.total_count);
    setVirtualTotal(payload.total_count);
    setVirtualSizeBytes(payload.total_size_bytes);
    setWorkerReady(false);
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

  createEffect(() => {
    workerReady();
    debouncedQueries();
    selectedFolder();
    sort();
    virtualRange();
    postWorkerView();
  });

  createEffect(() => {
    const tab = activeTab();
    workerReady();
    debouncedQueries();
    selectedFolder();
    sort();
    if (LEGACY_LIBRARY_TABS.includes(tab)) {
      void refreshLegacyRows();
    }
  });

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
  const artistGroups = createMemo<LibraryGroup[]>(() =>
    groupByKey(legacyFilteredItems(), (item) => splitArtists(item.artist, t("library.group.unknownArtist")))
  );
  const albumGroups = createMemo<LibraryGroup[]>(() =>
    groupByKey(legacyFilteredItems(), (item) => [fallbackLabel(item.album, t("library.group.unknownAlbum"))])
  );
  const selectedPlaylistSortedItems = createMemo(() =>
    sortItems(selectedPlaylistItems(), sort())
  );
  const visibleSizeGb = createMemo<number>(() => {
    if (activeTab() === "songs") {
      return Number((virtualSizeBytes() / (1024 * 1024 * 1024)).toFixed(2));
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
    workerReady,
    setWorkerReady,
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
    currentLibraryQueryInput,
    requestWorkerTrackKeys,
    requestWorkerRows,
    applyTrackSummaries,
    filteredItems,
    artistGroups,
    albumGroups,
    folderGroups,
    folderTree,
    selectedPlaylistSortedItems,
    visibleSizeGb
  };
}
