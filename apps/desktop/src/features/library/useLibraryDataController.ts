import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient } from "../../shared/api/client";
import type { LibraryRoot, LibraryScanTask, LocalPlaylist, MediaItem } from "../../shared/api/types";
import type { TranslationKey } from "../../shared/i18n";
import type {
  LibraryFolderNode,
  LibraryGroup,
  LibraryListItem,
  LibrarySortField,
  LibrarySortOrder,
  LibrarySortState,
  LibraryTab,
  LibraryWorkerFolderGroup,
  LibraryWorkerRow
} from "./libraryDataTypes";
import {
  LibraryWorkerClient,
  createLibraryWorkerViewInput
} from "./libraryWorkerClient";

const api = createApiClient();
const ALL_FOLDERS_VALUE = "__all";
const DEFAULT_LIBRARY_RANGE = { start: 0, end: 80 };

interface Feedback {
  tone: "neutral" | "success" | "error";
  message: string;
}

interface ScanProgress {
  taskId: number;
  scanned: number;
  indexed: number;
  removed: number;
}

interface UseLibraryDataControllerOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  globalQuery: Accessor<string>;
}

const adaptItem = (item: MediaItem): LibraryListItem => ({
  ...item,
  id: item.media_id,
  artworkUrl: item.has_cover_art ? api.getCoverArtUrl(item.media_id) : item.external_artwork_url
});

const adaptWorkerRow = (row: LibraryWorkerRow): LibraryListItem => ({
  id: row.id,
  trackKey: row.trackKey,
  media_id: row.media_id,
  source_path: row.source_path,
  title: row.title,
  artist: row.artist,
  album: row.album,
  track_number: row.track_number,
  duration_secs: row.duration_secs,
  size_bytes: row.size_bytes,
  added_at_epoch_secs: row.added_at_epoch_secs,
  updated_at_epoch_secs: row.updated_at_epoch_secs,
  fileName: row.fileName,
  artworkUrl: row.hasCoverArt
    ? api.getLibraryTrackCoverArtUrl(row.trackKey)
    : row.externalArtworkUrl
});

const matchesSearch = (item: LibraryListItem, query: string) => {
  if (!query) return true;
  const haystacks = [item.title, item.artist, item.album, item.source_path];
  return haystacks.some((value) => value?.toLowerCase().includes(query));
};

const fallbackLabel = (value: string | null, fallback: string) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const normalizePath = (path: string) =>
  path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/i, "")
    .replace(/\\/g, "/");

const folderPathFromSource = (sourcePath: string) => {
  const normalized = normalizePath(sourcePath).replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
};

const folderNameFromPath = (path: string) => {
  const normalized = normalizePath(path).replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? path;
};

const pathContainsFolder = (parentFolder: string, childFolder: string) => {
  const parent = normalizePath(parentFolder).replace(/\/+$/, "");
  const child = normalizePath(childFolder).replace(/\/+$/, "");
  return child === parent || child.startsWith(`${parent}/`);
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const compareText = (left: string | null | undefined, right: string | null | undefined) =>
  collator.compare(left?.trim() ?? "", right?.trim() ?? "");

const sortItems = (
  items: readonly LibraryListItem[],
  sort: LibrarySortState
): LibraryListItem[] => {
  if (sort.field === "default" || sort.order === "default") {
    return [...items];
  }

  const factor = sort.order === "asc" ? 1 : -1;
  return [...items].sort((left, right) => {
    let result = 0;
    switch (sort.field) {
      case "title":
        result = compareText(
          left.title ?? folderNameFromPath(left.source_path ?? left.id),
          right.title ?? folderNameFromPath(right.source_path ?? right.id)
        );
        break;
      case "album":
        result = compareText(left.album, right.album);
        break;
      case "artist":
        result = compareText(left.artist, right.artist);
        break;
      case "trackNumber":
        result = (left.track_number ?? 0) - (right.track_number ?? 0);
        break;
      case "filename":
        result = compareText(
          left.fileName ?? folderNameFromPath(left.source_path ?? left.id),
          right.fileName ?? folderNameFromPath(right.source_path ?? right.id)
        );
        break;
      case "duration":
        result = (left.duration_secs ?? 0) - (right.duration_secs ?? 0);
        break;
      case "size":
        result = (left.size_bytes ?? 0) - (right.size_bytes ?? 0);
        break;
      case "createTime":
        result = (left.added_at_epoch_secs ?? 0) - (right.added_at_epoch_secs ?? 0);
        break;
      case "updatedTime":
        result = (left.updated_at_epoch_secs ?? 0) - (right.updated_at_epoch_secs ?? 0);
        break;
      case "default":
        result = 0;
        break;
      default: {
        const _exhaustive: never = sort.field;
        throw new Error(`Unhandled library sort field: ${_exhaustive}`);
      }
    }
    return result * factor;
  });
};

interface MutableFolderNode {
  key: string;
  label: string;
  directCount: number;
  totalCount: number;
  depth: number;
  children: Map<string, MutableFolderNode>;
}

const toFolderNode = (node: MutableFolderNode): LibraryFolderNode => ({
  key: node.key,
  label: node.label,
  directCount: node.directCount,
  totalCount: node.totalCount,
  depth: node.depth,
  children: [...node.children.values()]
    .sort((left, right) => collator.compare(left.label, right.label))
    .map(toFolderNode)
});

const compactFolderNode = (node: LibraryFolderNode, depth: number): LibraryFolderNode => {
  let current = node;
  let label = node.label;

  while (current.children.length === 1 && current.directCount === 0) {
    const child = current.children[0];
    const separator = child.key.includes("\\") ? "\\" : "/";
    label = `${label}${separator}${child.label}`;
    current = child;
  }

  return {
    key: current.key,
    label,
    directCount: current.directCount,
    totalCount: node.totalCount,
    depth,
    children: current.children.map((child) => compactFolderNode(child, depth + 1))
  };
};

const buildFolderTree = (items: readonly LibraryListItem[]): LibraryFolderNode[] => {
  const roots = new Map<string, MutableFolderNode>();
  const nodeByPath = new Map<string, MutableFolderNode>();

  const ensureNode = (key: string, label: string, depth: number, parent?: MutableFolderNode) => {
    const existing = nodeByPath.get(key);
    if (existing) return existing;
    const node: MutableFolderNode = {
      key,
      label,
      directCount: 0,
      totalCount: 0,
      depth,
      children: new Map<string, MutableFolderNode>()
    };
    nodeByPath.set(key, node);
    if (parent) {
      parent.children.set(key, node);
    } else {
      roots.set(key, node);
    }
    return node;
  };

  items.forEach((item) => {
    const folderPath = folderPathFromSource(item.source_path ?? item.id);
    const normalized = normalizePath(folderPath).replace(/\/+$/, "");
    const prefix = normalized.startsWith("/") ? "/" : "";
    const segments = normalized.split("/").filter(Boolean);
    let parent: MutableFolderNode | undefined;
    let currentPath = prefix;

    segments.forEach((segment, index) => {
      currentPath =
        currentPath === "/" || currentPath === ""
          ? `${currentPath}${segment}`
          : `${currentPath}/${segment}`;
      parent = ensureNode(currentPath, segment, index, parent);
      parent.totalCount += 1;
      if (index === segments.length - 1) {
        parent.directCount += 1;
      }
    });
  });

  return [...roots.values()]
    .sort((left, right) => collator.compare(left.label, right.label))
    .map(toFolderNode)
    .map((node) => compactFolderNode(node, 0));
};

const splitArtists = (artist: string | null, fallback: string) =>
  fallbackLabel(artist, fallback)
    .split(/[/、，,;&]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const groupByKey = (
  items: LibraryListItem[],
  keyForItem: (item: LibraryListItem) => string[],
  detailForGroup?: (key: string, songs: LibraryListItem[]) => string | undefined
): LibraryGroup[] => {
  const groups = items.reduce<Map<string, LibraryListItem[]>>((map, item) => {
    keyForItem(item).forEach((key) => {
      const current = map.get(key) ?? [];
      if (!current.some((existing) => existing.media_id === item.media_id)) {
        map.set(key, [...current, item]);
      }
    });
    return map;
  }, new Map<string, LibraryListItem[]>());

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, songs]) => ({
      key,
      label: key,
      songs,
      artworkUrl: songs.find((song) => song.artworkUrl)?.artworkUrl ?? null,
      detail: detailForGroup?.(key, songs)
    }));
};

export function useLibraryDataController(options: UseLibraryDataControllerOptions) {
  const { t, globalQuery } = options;
  const [roots, setRoots] = createSignal<LibraryRoot[]>([]);
  const [allItems, setAllItems] = createSignal<MediaItem[]>([]);
  const [legacyItemsLoaded, setLegacyItemsLoaded] = createSignal<boolean>(false);
  const [libraryRevision, setLibraryRevision] = createSignal<string | null>(null);
  const [libraryTotalCount, setLibraryTotalCount] = createSignal<number>(0);
  const [virtualRows, setVirtualRows] = createSignal<LibraryListItem[]>([]);
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
  const [feedbackKey, setFeedbackKey] = createSignal<TranslationKey | null>("library.feedback.initial");
  const [feedback, setFeedback] = createSignal<Feedback>({
    tone: "neutral",
    message: t("library.feedback.initial")
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const detailCache = new Map<number, MediaItem>();

  const setKeyedFeedback = (tone: Feedback["tone"], key: TranslationKey) => {
    setFeedbackKey(key);
    setFeedback({ tone, message: t(key) });
  };

  const setRawFeedback = (tone: Feedback["tone"], message: string) => {
    setFeedbackKey(null);
    setFeedback({ tone, message });
  };

  const workerClient = new LibraryWorkerClient({
    onReady: (total) => {
      setWorkerReady(true);
      setVirtualTotal(total);
    },
    onViewResult: (result) => {
      setVirtualRows(result.rows.map(adaptWorkerRow));
      setVirtualTotal(result.total);
      setVirtualSizeBytes(result.totalSizeBytes);
      setFolderOptions(result.folders);
    },
    onError: () => {
      setWorkerReady(false);
    }
  });

  onCleanup(() => {
    workerClient.dispose();
  });

  const currentWorkerViewInput = () =>
    createLibraryWorkerViewInput(
      debouncedQueries(),
      selectedFolder() === ALL_FOLDERS_VALUE ? null : selectedFolder(),
      sort()
    );

  const postWorkerView = () => {
    if (!workerReady()) return;
    workerClient.requestView(currentWorkerViewInput(), virtualRange());
  };

  const requestWorkerTrackKeys = async (): Promise<number[]> => {
    if (!workerReady()) {
      throw new Error(t("common.error.requestFailed"));
    }
    const trackKeys = await workerClient.requestTrackKeys(currentWorkerViewInput());
    if (trackKeys.length === 0) {
      throw new Error(t("library.tracks.emptyFilter"));
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

  const updateVirtualRange = (range: { start: number; end: number }) => {
    setVirtualRange((current) =>
      current.start === range.start && current.end === range.end ? current : range
    );
  };

  const selectedFolderPath = createMemo<string | null>(() => {
    const selected = selectedFolder();
    if (selected === ALL_FOLDERS_VALUE) return null;
    return folderOptions().find((folder) => folder.key === selected)?.path ?? null;
  });

  const detailForTrackKey = async (trackKey: number): Promise<MediaItem> => {
    const cached = detailCache.get(trackKey);
    if (cached) return cached;
    const detail = await api.getLibraryTrackDetail(trackKey);
    detailCache.set(trackKey, detail.item);
    return detail.item;
  };

  const ensureItemDetail = async (item: LibraryListItem): Promise<MediaItem | null> => {
    if (item.source_path && item.media_id) {
      return item as MediaItem;
    }
    if (item.trackKey === undefined) {
      return null;
    }
    return detailForTrackKey(item.trackKey);
  };

  const refreshRoots = async () => {
    try {
      const list = await api.getLibraryRoots();
      setRoots(list);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const refreshItems = async () => {
    setIsFetching(true);
    try {
      const response = await api.getLibraryTrackSummaries();
      detailCache.clear();
      setAllItems([]);
      setLegacyItemsLoaded(false);
      setLibraryRevision(response.revision);
      setLibraryTotalCount(response.total_count);
      setVirtualTotal(response.total_count);
      setVirtualSizeBytes(response.total_size_bytes);
      setWorkerReady(false);
      workerClient.init(response.tracks, response.folders);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsFetching(false);
    }
  };

  const refreshLegacyItems = async () => {
    if (legacyItemsLoaded()) return;
    setIsFetching(true);
    try {
      const list = await api.getMediaItems(undefined, true);
      setAllItems(list);
      setLegacyItemsLoaded(true);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setIsFetching(false);
    }
  };

  const refreshSelectedPlaylist = async (playlistId = selectedPlaylistId()) => {
    if (!playlistId) {
      setSelectedPlaylistItems([]);
      return;
    }

    try {
      const detail = await api.getLocalPlaylist(playlistId);
      setSelectedPlaylistId(detail.playlist.playlist_id);
      setSelectedPlaylistItems(detail.items.map(adaptItem));
    } catch (error) {
      setSelectedPlaylistId(null);
      setSelectedPlaylistItems([]);
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const refreshPlaylists = async () => {
    try {
      const playlists = await api.listLocalPlaylists();
      setLocalPlaylists(playlists);
      const selected = selectedPlaylistId();
      const nextSelected =
        playlists.find((playlist) => playlist.playlist_id === selected)?.playlist_id ?? null;
      setSelectedPlaylistId(nextSelected);
      await refreshSelectedPlaylist(nextSelected);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const applyScanTask = (task: LibraryScanTask) => {
    const payload = task.result ?? {};
    setScanProgress({
      taskId: task.task_id,
      scanned: payload.scanned_files ?? 0,
      indexed: payload.indexed_files ?? 0,
      removed: payload.removed_files ?? 0
    });
  };

  const pollScanTask = async (taskId: number) => {
    const maxAttempts = 240;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const task = await api.getLibraryScanTask(taskId);
      applyScanTask(task);
      if (task.status === "success" || task.status === "error") {
        return task;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
    throw new Error(t("library.feedback.scanTimeout"));
  };

  onMount(() => {
    void refreshRoots();
    void refreshItems();
    void refreshPlaylists();
  });

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
    if (tab === "artists" || tab === "albums" || tab === "folders") {
      void refreshLegacyItems();
    }
  });

  const adaptedItems = createMemo(() => allItems().map(adaptItem));
  const activeQueries = createMemo<string[]>(() =>
    [globalQuery(), localQuery()]
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const queryFilteredItems = createMemo(() => {
    const queries = activeQueries();
    if (queries.length === 0) return adaptedItems();
    return adaptedItems().filter((item) => queries.every((query) => matchesSearch(item, query)));
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
  const folderTree = createMemo<LibraryFolderNode[]>(() => buildFolderTree(queryFilteredItems()));
  const folderFilteredItems = createMemo(() => {
    const selected = selectedFolder();
    if (selected === ALL_FOLDERS_VALUE) return queryFilteredItems();
    const selectedPath = selectedFolderPath() ?? selected;
    return queryFilteredItems().filter((item) =>
      pathContainsFolder(selectedPath, folderPathFromSource(item.source_path ?? item.id))
    );
  });
  const legacyFilteredItems = createMemo(() => sortItems(folderFilteredItems(), sort()));
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
    const totalBytes = folderFilteredItems().reduce((total, item) => total + (item.size_bytes ?? 0), 0);
    return Number((totalBytes / (1024 * 1024 * 1024)).toFixed(2));
  });

  const handleScan = async (path: string, display: string) => {
    if (!path) {
      setKeyedFeedback("error", "library.feedback.emptyPath");
      return;
    }
    setIsScanning(true);
    setRawFeedback("neutral", t("library.feedback.scanning", { path }));
    try {
      const result = await api.scanLibraryRoot(path, display ? display : undefined);
      setScanProgress({
        taskId: result.task_id,
        scanned: result.scanned_files,
        indexed: result.indexed_files,
        removed: 0
      });
      const task = await pollScanTask(result.task_id);
      if (task.status === "error") {
        throw new Error(task.error ?? t("common.error.requestFailed"));
      }

      const finalScanned = task.result?.scanned_files ?? result.scanned_files;
      const finalIndexed = task.result?.indexed_files ?? result.indexed_files;
      const finalRemoved = task.result?.removed_files ?? 0;
      await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists()]);
      setRawFeedback(
        "success",
        t("library.feedback.scanComplete", {
          scanned: finalScanned,
          indexed: finalIndexed,
          removed: finalRemoved
        })
      );
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setScanProgress(null);
      setIsScanning(false);
    }
  };

  const handleRescan = async (root: LibraryRoot) => {
    setIsScanning(true);
    setRawFeedback("neutral", t("library.feedback.rescanning", { name: root.display_name }));
    try {
      const result = await api.scanLibraryRoot(
        root.source_path,
        root.display_name,
        root.source_key ?? undefined
      );
      setScanProgress({
        taskId: result.task_id,
        scanned: result.scanned_files,
        indexed: result.indexed_files,
        removed: 0
      });
      const task = await pollScanTask(result.task_id);
      if (task.status === "error") {
        throw new Error(task.error ?? t("common.error.requestFailed"));
      }
      const finalScanned = task.result?.scanned_files ?? result.scanned_files;
      const finalIndexed = task.result?.indexed_files ?? result.indexed_files;
      const finalRemoved = task.result?.removed_files ?? 0;
      await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists()]);
      setRawFeedback(
        "success",
        t("library.feedback.rescanComplete", {
          scanned: finalScanned,
          indexed: finalIndexed,
          removed: finalRemoved
        })
      );
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      setScanProgress(null);
      setIsScanning(false);
    }
  };

  const deleteLibraryRoot = async (root: LibraryRoot) => {
    try {
      await api.deleteLibraryRoot(root.root_id);
      await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists()]);
      setRawFeedback("success", t("library.roots.feedback.deleted", { name: root.display_name }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const playItem = async (item: LibraryListItem, contextItems: readonly LibraryListItem[] = filteredItems()) => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    try {
      if (item.trackKey !== undefined) {
        const trackKeys = await requestWorkerTrackKeys();
        await api.replaceQueueFromTrackKeys({
          trackKeys,
          startTrackKey: item.trackKey
        });
      } else {
        const paths = contextItems
          .map((contextItem) => contextItem.source_path)
          .filter((path): path is string => Boolean(path));
        const itemPath = item.source_path;
        if (!itemPath) {
          throw new Error(t("common.error.requestFailed"));
        }
        const queue = await api.replaceQueue(paths.length > 0 ? paths : [itemPath]);
        const contextIndex = contextItems.findIndex((contextItem) => contextItem.id === item.id);
        const entry = contextIndex >= 0 ? queue[contextIndex] : undefined;
        if (!entry) {
          throw new Error(t("common.error.requestFailed"));
        }
        await api.playFromQueue({ entryId: entry.entry_id, sourcePath: entry.source_path });
      }
      setKeyedFeedback("neutral", "library.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const playCurrentSongView = async () => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    try {
      const trackKeys = await requestWorkerTrackKeys();
      await api.replaceQueueFromTrackKeys({
        trackKeys,
        startTrackKey: null
      });
      setKeyedFeedback("neutral", "library.feedback.initial");
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const enqueueItem = async (item: LibraryListItem) => {
    try {
      const detail = await ensureItemDetail(item);
      if (!detail) {
        throw new Error(t("common.error.requestFailed"));
      }
      await api.enqueueTrack(detail.source_path);
      setRawFeedback("success", t("library.feedback.added", { title: item.title ?? detail.source_path }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const enqueueItems = async (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    try {
      for (const item of items) {
        const detail = await ensureItemDetail(item);
        if (detail) {
          await api.enqueueTrack(detail.source_path);
        }
      }
      setRawFeedback("success", t("library.feedback.addedMany", { count: items.length }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const selectLocalPlaylist = async (playlistId: string) => {
    if (!playlistId) {
      setSelectedPlaylistId(null);
      setSelectedPlaylistItems([]);
      return;
    }
    setSelectedPlaylistId(playlistId);
    await refreshSelectedPlaylist(playlistId);
  };

  const createLocalPlaylist = async (name: string, description?: string | null) => {
    try {
      const playlist = await api.createLocalPlaylist({ name, description });
      await refreshPlaylists();
      await selectLocalPlaylist(playlist.playlist_id);
      setRawFeedback("success", t("library.playlists.feedback.created", { name: playlist.name }));
      return playlist;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const deleteLocalPlaylist = async (playlistId: string) => {
    try {
      await api.deleteLocalPlaylist(playlistId);
      if (selectedPlaylistId() === playlistId) {
        setSelectedPlaylistId(null);
        setSelectedPlaylistItems([]);
      }
      await refreshPlaylists();
      setRawFeedback("success", t("library.playlists.feedback.deleted"));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const addItemsToPlaylist = async (playlistId: string, items: readonly LibraryListItem[]) => {
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = [...new Set(details.flatMap((item) => (item ? [item.media_id] : [])))];
    if (mediaIds.length === 0) return 0;
    try {
      const addedCount = await api.addMediaToLocalPlaylist(playlistId, mediaIds);
      await refreshPlaylists();
      if (selectedPlaylistId() === playlistId) {
        await refreshSelectedPlaylist(playlistId);
      }
      setRawFeedback("success", t("library.playlists.feedback.added", { count: addedCount }));
      return addedCount;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const removeItemsFromSelectedPlaylist = async (items: readonly LibraryListItem[]) => {
    const playlistId = selectedPlaylistId();
    if (!playlistId || items.length === 0) return 0;
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = [...new Set(details.flatMap((item) => (item ? [item.media_id] : [])))];
    try {
      const removedCount = await api.removeMediaFromLocalPlaylist(playlistId, mediaIds);
      await refreshPlaylists();
      await refreshSelectedPlaylist(playlistId);
      setRawFeedback("success", t("library.playlists.feedback.removed", { count: removedCount }));
      return removedCount;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const deleteItemsFromLibrary = async (items: readonly LibraryListItem[]) => {
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = [...new Set(details.flatMap((item) => (item ? [item.media_id] : [])))];
    if (mediaIds.length === 0) return 0;
    try {
      const deletedCount = await api.deleteMediaItems(mediaIds);
      await Promise.all([refreshItems(), refreshPlaylists()]);
      await refreshSelectedPlaylist();
      setRawFeedback("success", t("library.feedback.deleted", { count: deletedCount }));
      return deletedCount;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const getCurrentBatchItems = async (): Promise<LibraryListItem[]> => {
    if (activeTab() === "songs") {
      return requestWorkerRows();
    }
    return legacyFilteredItems();
  };

  const updateSort = (field: LibrarySortField) => {
    setSort((current) => {
      if (field === "default") {
        return { field: "default", order: "default" };
      }
      if (current.field === field) {
        return {
          field,
          order: current.order === "asc" ? "desc" : "asc"
        };
      }
      return {
        field,
        order:
          field === "duration" || field === "size" || field === "createTime" || field === "updatedTime"
            ? "desc"
            : "asc"
      };
    });
  };

  const updateSortOrder = (order: LibrarySortOrder) => {
    setSort((current) => {
      if (order === "default") {
        return { field: "default", order: "default" };
      }
      if (current.field === "default") {
        return { field: "title", order };
      }
      return { ...current, order };
    });
  };

  const notifyCopyPath = () => {
    setRawFeedback("success", t("media.copy.success"));
  };

  const copyItemPath = async (item: LibraryListItem) => {
    const detail = await ensureItemDetail(item);
    if (!detail || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(detail.source_path);
  };

  const handleRefresh = () => {
    void refreshRoots();
    void refreshItems();
    void refreshPlaylists();
  };

  const formatScanTimestamp = (epochSecs: number | null) => {
    if (epochSecs === null) return t("library.timestamp.never");
    const date = new Date(epochSecs * 1000);
    if (Number.isNaN(date.getTime())) return t("library.timestamp.never");
    return date.toLocaleString();
  };

  createEffect(() => {
    const key = feedbackKey();
    if (key) {
      setFeedback((current) => ({ ...current, message: t(key) }));
    }
  });

  createEffect(() => {
    activeTab();
    selectedFolder();
    selectedPlaylistId();
    localQuery();
    globalQuery();
  });

  return {
    roots,
    allItems,
    libraryRevision,
    libraryTotalCount,
    virtualTotal,
    virtualRange,
    setVirtualRange: updateVirtualRange,
    localPlaylists,
    selectedPlaylistId,
    selectedPlaylistItems,
    selectedPlaylistSortedItems,
    filteredItems,
    folderFilteredItems,
    artistGroups,
    albumGroups,
    folderGroups,
    folderTree,
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
    isScanning,
    scanProgress,
    feedback,
    visibleSizeGb,
    formatScanTimestamp,
    playItem,
    playCurrentSongView,
    enqueueItem,
    enqueueItems,
    selectLocalPlaylist,
    createLocalPlaylist,
    deleteLocalPlaylist,
    addItemsToPlaylist,
    removeItemsFromSelectedPlaylist,
    deleteItemsFromLibrary,
    getCurrentBatchItems,
    notifyCopyPath,
    copyItemPath,
    handleScan,
    handleRescan,
    deleteLibraryRoot,
    handleRefresh,
    refreshItems,
    refreshRoots,
    refreshPlaylists
  };
}

export { ALL_FOLDERS_VALUE };
