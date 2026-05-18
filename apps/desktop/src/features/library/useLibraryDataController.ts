import { onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient, type ApiClient } from "../../shared/api/client";
import { revealPathInFolder } from "../../shared/api/os";
import type { LibraryRoot, MediaItem, PlayerState } from "../../shared/api/types";
import type { TranslationKey } from "../../shared/i18n";
import { type LibraryListItem } from "./libraryViewTypes";
import type { LibraryWorkerRow } from "./libraryWorkerProtocol";
import { LibraryWorkerClient } from "./libraryWorkerClient";
import {
  adaptMediaItemToListItem,
  adaptWorkerRowToListItem,
  LibraryTrackDetailResolver
} from "./libraryDataBoundary";
import { scanProgressFromTask } from "./libraryScanState";
import { createLibraryScanPoller } from "./libraryScanPoller";
import { createLibraryFeedbackController } from "./libraryFeedback";
import { createLibraryScanActions } from "./libraryScanActions";
import { uniqueMediaIds } from "./librarySelectionModel";
import {
  enqueueLibraryItem,
  enqueueLibraryItems,
  mediaIdsForPlaybackContext
} from "./libraryQueueActions";
import { createLibraryControllerViewState } from "./libraryControllerViewState";

export type LibraryDataControllerApi = Pick<
  ApiClient,
  | "addMediaToLocalPlaylist"
  | "createLocalPlaylist"
  | "deleteLibraryRoot"
  | "deleteLocalPlaylist"
  | "deleteMediaItems"
  | "enqueueQueueFromMediaIds"
  | "enqueueTracks"
  | "getCoverArtUrl"
  | "getLibraryRoots"
  | "getLibraryScanTask"
  | "getLibraryTrackCoverArtUrl"
  | "getLibraryTrackDetail"
  | "getLibraryTrackSummaries"
  | "getLocalPlaylist"
  | "listLocalPlaylists"
  | "playFromQueue"
  | "removeMediaFromLocalPlaylist"
  | "replaceQueue"
  | "replaceQueueFromMediaIds"
  | "scanLibraryRoot"
>;

interface UseLibraryDataControllerOptions {
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  globalQuery: Accessor<string>;
  apiClient?: LibraryDataControllerApi;
}

export function useLibraryDataController(options: UseLibraryDataControllerOptions) {
  const { t, globalQuery } = options;
  const api = options.apiClient ?? createApiClient();
  const urlProvider = {
    getCoverArtUrl: (mediaId: string) => api.getCoverArtUrl(mediaId),
    getLibraryTrackCoverArtUrl: (trackKey: number) => api.getLibraryTrackCoverArtUrl(trackKey)
  };
  const adaptItem = (item: MediaItem): LibraryListItem =>
    adaptMediaItemToListItem(item, urlProvider);
  const adaptWorkerRow = (row: LibraryWorkerRow): LibraryListItem =>
    adaptWorkerRowToListItem(row, urlProvider);
  const {
    feedback,
    readErrorMessage,
    setKeyedFeedback,
    setRawFeedback
  } = createLibraryFeedbackController({
    t,
    initialKey: "library.feedback.initial"
  });

  const detailResolver = new LibraryTrackDetailResolver(async (trackKey) => {
    const detail = await api.getLibraryTrackDetail(trackKey);
    return detail.item;
  });

  const workerClient = new LibraryWorkerClient({
    onReady: (total) => {
      viewState.setWorkerReady(true);
      viewState.setVirtualTotal(total);
    },
    onViewResult: (result) => {
      viewState.setVirtualRows(result.rows.map(adaptWorkerRow));
      viewState.setVirtualTotal(result.total);
      viewState.setVirtualSizeBytes(result.totalSizeBytes);
      viewState.setFolderOptions(result.folders);
    },
    onError: () => {
      viewState.setWorkerReady(false);
    }
  });

  const viewState = createLibraryControllerViewState({
    t,
    globalQuery,
    workerClient,
    adaptWorkerRow,
    readErrorMessage,
    setRawFeedback
  });

  const scanPoller = createLibraryScanPoller({
    getTask: (taskId) => api.getLibraryScanTask(taskId),
    applyTask: (task) => viewState.setScanProgress(scanProgressFromTask(task)),
    scanTimeoutMessage: () => t("library.feedback.scanTimeout")
  });

  onCleanup(() => {
    scanPoller.dispose();
  });

  const resolveMediaIdsForPlaybackContext = async (
    item: LibraryListItem,
    contextItems: readonly LibraryListItem[]
  ): Promise<string[]> => {
    if (!item.media_id) {
      throw new Error(t("common.error.requestFailed"));
    }
    if (viewState.activeTab() === "songs") {
      return viewState.requestWorkerMediaIds(item.media_id);
    }
    const contextMediaIds = mediaIdsForPlaybackContext(item, contextItems);
    if (contextMediaIds.length === 0) {
      return viewState.requestWorkerMediaIds(item.media_id);
    }
    return contextMediaIds;
  };

  const replaceQueueFromSelectedPlaylist = async (
    item: LibraryListItem,
    contextItems: readonly LibraryListItem[]
  ): Promise<PlayerState> => {
    const playlistId = viewState.selectedPlaylistId();
    if (!playlistId || !item.media_id) {
      throw new Error(t("common.error.requestFailed"));
    }
    const mediaIds = mediaIdsForPlaybackContext(item, contextItems);
    if (mediaIds.length === 0) {
      throw new Error(t("common.error.requestFailed"));
    }
    const playback = await api.replaceQueueFromMediaIds({
      mediaIds,
      startMediaId: item.media_id
    });
    return playback.state;
  };

  const ensureItemDetail = (item: LibraryListItem): Promise<MediaItem | null> =>
    detailResolver.resolve(item);

  const refreshRoots = async () => {
    try {
      const list = await api.getLibraryRoots();
      viewState.setRoots(list);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const refreshItems = async () => {
    viewState.setIsFetching(true);
    try {
      const response = await api.getLibraryTrackSummaries();
      detailResolver.clear();
      viewState.applyTrackSummaries(response);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    } finally {
      viewState.setIsFetching(false);
    }
  };

  const refreshSelectedPlaylist = async (playlistId = viewState.selectedPlaylistId()) => {
    if (!playlistId) {
      viewState.setSelectedPlaylistItems([]);
      return;
    }

    try {
      const detail = await api.getLocalPlaylist(playlistId);
      viewState.setSelectedPlaylistId(detail.playlist.playlist_id);
      viewState.setSelectedPlaylistItems(detail.items.map(adaptItem));
    } catch (error) {
      viewState.setSelectedPlaylistId(null);
      viewState.setSelectedPlaylistItems([]);
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  const refreshPlaylists = async () => {
    try {
      const playlists = await api.listLocalPlaylists();
      viewState.setLocalPlaylists(playlists);
      const selected = viewState.selectedPlaylistId();
      const nextSelected =
        playlists.find((playlist) => playlist.playlist_id === selected)?.playlist_id ?? null;
      viewState.setSelectedPlaylistId(nextSelected);
      await refreshSelectedPlaylist(nextSelected);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  onMount(() => {
    void refreshRoots();
    void refreshItems();
    void refreshPlaylists();
  });

  const { handleScan, handleRescan } = createLibraryScanActions({
    api,
    t,
    poller: scanPoller,
    readErrorMessage,
    setKeyedFeedback,
    setRawFeedback,
    setIsScanning: viewState.setIsScanning,
    setScanProgress: viewState.setScanProgress,
    refreshAfterScan: async () => {
      await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists()]);
    }
  });

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

  const playItem = async (
    item: LibraryListItem,
    contextItems: readonly LibraryListItem[] = viewState.filteredItems()
  ): Promise<PlayerState> => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    try {
      if (viewState.activeTab() === "playlists") {
        const state = await replaceQueueFromSelectedPlaylist(item, contextItems);
        setKeyedFeedback("neutral", "library.feedback.initial");
        return state;
      } else if (item.media_id) {
        const mediaIds = await resolveMediaIdsForPlaybackContext(item, contextItems);
        const playback = await api.replaceQueueFromMediaIds({
          mediaIds,
          startMediaId: item.media_id
        });
        setKeyedFeedback("neutral", "library.feedback.initial");
        return playback.state;
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
        const state = await api.playFromQueue({
          entryId: entry.entry_id,
          sourcePath: entry.source_path
        });
        setKeyedFeedback("neutral", "library.feedback.initial");
        return state;
      }
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const playCurrentSongView = async (): Promise<PlayerState> => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    try {
      const mediaIds = await viewState.requestWorkerMediaIds();
      const playback = await api.replaceQueueFromMediaIds({ mediaIds, startMediaId: null });
      setKeyedFeedback("neutral", "library.feedback.initial");
      return playback.state;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const enqueueItem = async (item: LibraryListItem) => {
    try {
      const result = await enqueueLibraryItem({
        api,
        ensureItemDetail,
        requestFailedMessage: () => t("common.error.requestFailed")
      }, item);
      setRawFeedback("success", t("library.feedback.added", { title: result.title }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const enqueueItems = async (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    try {
      const result = await enqueueLibraryItems({
        api,
        ensureItemDetail,
        requestFailedMessage: () => t("common.error.requestFailed")
      }, items);
      setRawFeedback("success", t("library.feedback.addedMany", { count: result.enqueuedCount }));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const selectLocalPlaylist = async (playlistId: string) => {
    if (!playlistId) {
      viewState.setSelectedPlaylistId(null);
      viewState.setSelectedPlaylistItems([]);
      return;
    }
    viewState.setSelectedPlaylistId(playlistId);
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
      if (viewState.selectedPlaylistId() === playlistId) {
        viewState.setSelectedPlaylistId(null);
        viewState.setSelectedPlaylistItems([]);
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
    const mediaIds = uniqueMediaIds(details);
    if (mediaIds.length === 0) return 0;
    try {
      const addedCount = await api.addMediaToLocalPlaylist(playlistId, mediaIds);
      await refreshPlaylists();
      if (viewState.selectedPlaylistId() === playlistId) {
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
    const playlistId = viewState.selectedPlaylistId();
    if (!playlistId || items.length === 0) return 0;
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = uniqueMediaIds(details);
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
    const mediaIds = uniqueMediaIds(details);
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
    if (viewState.activeTab() === "songs") {
      return viewState.requestWorkerRows();
    }
    return viewState.filteredItems();
  };

  const notifyCopyPath = () => {
    setRawFeedback("success", t("media.copy.success"));
  };

  const notifyCopyName = () => {
    setRawFeedback("success", t("media.copyName.success"));
  };

  const copyItemPath = async (item: LibraryListItem) => {
    const detail = await ensureItemDetail(item);
    if (!detail || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    await navigator.clipboard.writeText(detail.source_path);
  };

  const revealItemInFolder = async (item: LibraryListItem) => {
    try {
      const detail = await ensureItemDetail(item);
      if (!detail) {
        throw new Error(t("common.error.requestFailed"));
      }
      await revealPathInFolder(detail.source_path);
      setRawFeedback("success", t("media.context.showInFolder.success"));
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
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

  return {
    roots: viewState.roots,
    libraryRevision: viewState.libraryRevision,
    libraryTotalCount: viewState.libraryTotalCount,
    virtualTotal: viewState.virtualTotal,
    virtualRange: viewState.virtualRange,
    setVirtualRange: viewState.setVirtualRange,
    localPlaylists: viewState.localPlaylists,
    selectedPlaylistId: viewState.selectedPlaylistId,
    selectedPlaylistItems: viewState.selectedPlaylistItems,
    selectedPlaylistSortedItems: viewState.selectedPlaylistSortedItems,
    filteredItems: viewState.filteredItems,
    artistGroups: viewState.artistGroups,
    albumGroups: viewState.albumGroups,
    folderGroups: viewState.folderGroups,
    folderTree: viewState.folderTree,
    activeTab: viewState.activeTab,
    setActiveTab: viewState.setActiveTab,
    sort: viewState.sort,
    updateSort: viewState.updateSort,
    updateSortOrder: viewState.updateSortOrder,
    localQuery: viewState.localQuery,
    setLocalQuery: viewState.setLocalQuery,
    selectedFolder: viewState.selectedFolder,
    setSelectedFolder: viewState.setSelectedFolder,
    manageOpen: viewState.manageOpen,
    setManageOpen: viewState.setManageOpen,
    isFetching: viewState.isFetching,
    isScanning: viewState.isScanning,
    scanProgress: viewState.scanProgress,
    feedback,
    visibleSizeGb: viewState.visibleSizeGb,
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
    notifyCopyName,
    copyItemPath,
    revealItemInFolder,
    handleScan,
    handleRescan,
    deleteLibraryRoot,
    handleRefresh,
    refreshItems,
    refreshRoots,
    refreshPlaylists
  };
}
