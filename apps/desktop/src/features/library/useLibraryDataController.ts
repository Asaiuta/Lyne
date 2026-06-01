import { onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { createApiClient, type ApiClient } from "../../shared/api/client";
import { deleteFile, revealPathInFolder } from "../../shared/api/os";
import type { LibraryRoot, MediaItem, PlayerState } from "../../shared/api/types";
import type { TranslationKey } from "../../shared/i18n";
import { copyToClipboard } from "../../shared/utils/clipboard";
import { type LibraryListItem } from "./libraryViewTypes";
import {
  adaptLibraryWorkerRowToListItem,
  adaptTrackSummaryToListItem,
  adaptMediaItemToListItem,
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
import {
  loadLocalPlaylistsCached,
  refreshLocalPlaylistsCache,
  subscribeLocalPlaylists
} from "./localPlaylistSummaryCache";

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
  | "getLibraryTrackGroups"
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
  const adaptTrackSummary = (
    row: Parameters<typeof adaptTrackSummaryToListItem>[0]
  ): LibraryListItem => adaptTrackSummaryToListItem(row, urlProvider);
  const adaptWorkerRow = (
    row: Parameters<typeof adaptLibraryWorkerRowToListItem>[0]
  ): LibraryListItem => adaptLibraryWorkerRowToListItem(row, urlProvider);
  const resolveGroupArtworkUrl = (
    group: Awaited<ReturnType<LibraryDataControllerApi["getLibraryTrackGroups"]>>["groups"][number]
  ) =>
    group.external_artwork_url ??
    (group.artwork_track_key && group.has_cover_art
      ? api.getLibraryTrackCoverArtUrl(group.artwork_track_key)
      : null);
  const {
    feedback,
    readErrorMessage,
    setKeyedFeedback,
    setRawFeedback
  } = createLibraryFeedbackController({
    t,
    initialKey: "library.feedback.initial"
  });
  const withFeedback = async <T>(
    fn: () => Promise<T>,
    onSuccess?: (result: T) => void | Promise<void>
  ): Promise<T> => {
    try {
      const result = await fn();
      await onSuccess?.(result);
      return result;
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
      throw error;
    }
  };

  const detailResolver = new LibraryTrackDetailResolver(async (trackKey) => {
    const detail = await api.getLibraryTrackDetail(trackKey);
    return detail.item;
  });

  const viewState = createLibraryControllerViewState({
    t,
    globalQuery,
    requestTrackSummaries: () => api.getLibraryTrackSummaries(),
    requestTrackGroups: (input) => api.getLibraryTrackGroups(input),
    adaptTrackSummary,
    adaptWorkerRow,
    resolveGroupArtworkUrl,
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
      return viewState.requestViewMediaIds(item.media_id);
    }
    const contextMediaIds = mediaIdsForPlaybackContext(item, contextItems);
    if (contextMediaIds.length === 0) {
      return viewState.requestViewMediaIds(item.media_id);
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
      detailResolver.clear();
      await viewState.reloadLibraryView();
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

  let appliedLocalPlaylistSnapshot: Awaited<ReturnType<LibraryDataControllerApi["listLocalPlaylists"]>> | null = null;
  const applyLocalPlaylists = async (playlists: Awaited<ReturnType<LibraryDataControllerApi["listLocalPlaylists"]>>) => {
    if (playlists === appliedLocalPlaylistSnapshot) return;
    appliedLocalPlaylistSnapshot = playlists;
    viewState.setLocalPlaylists(playlists);
    const selected = viewState.selectedPlaylistId();
    const nextSelected =
      playlists.find((playlist) => playlist.playlist_id === selected)?.playlist_id ?? null;
    viewState.setSelectedPlaylistId(nextSelected);
    await refreshSelectedPlaylist(nextSelected);
  };

  const refreshPlaylists = async (options: { force?: boolean } = {}) => {
    try {
      const playlists = options.force
        ? await refreshLocalPlaylistsCache(api)
        : await loadLocalPlaylistsCached(api);
      await applyLocalPlaylists(playlists);
    } catch (error) {
      setRawFeedback("error", readErrorMessage(error));
    }
  };

  onMount(() => {
    const unsubscribe = subscribeLocalPlaylists((playlists) => {
      void applyLocalPlaylists(playlists);
    });
    void refreshRoots();
    void refreshItems();
    void refreshPlaylists();
    onCleanup(unsubscribe);
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
      await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists({ force: true })]);
    }
  });

  const deleteLibraryRoot = async (root: LibraryRoot) => {
    await withFeedback(
      async () => {
        await api.deleteLibraryRoot(root.root_id);
        await Promise.all([refreshRoots(), refreshItems(), refreshPlaylists({ force: true })]);
      },
      () =>
        setRawFeedback("success", t("library.roots.feedback.deleted", { name: root.display_name }))
    );
  };

  const playItem = async (
    item: LibraryListItem,
    contextItems: readonly LibraryListItem[] = viewState.filteredItems()
  ): Promise<PlayerState> => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    return withFeedback(
      async () => {
        if (viewState.activeTab() === "playlists") {
          return replaceQueueFromSelectedPlaylist(item, contextItems);
        } else if (item.media_id) {
          const mediaIds = await resolveMediaIdsForPlaybackContext(item, contextItems);
          const playback = await api.replaceQueueFromMediaIds({
            mediaIds,
            startMediaId: item.media_id
          });
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
          return state;
        }
      },
      () => setKeyedFeedback("neutral", "library.feedback.initial")
    );
  };

  const playCurrentSongView = async (): Promise<PlayerState> => {
    setKeyedFeedback("neutral", "library.feedback.initial");
    return withFeedback(
      async () => {
        const mediaIds = await viewState.requestViewMediaIds();
        const playback = await api.replaceQueueFromMediaIds({ mediaIds, startMediaId: null });
        return playback.state;
      },
      () => setKeyedFeedback("neutral", "library.feedback.initial")
    );
  };

  const enqueueItem = async (item: LibraryListItem) => {
    await withFeedback(
      async () =>
        enqueueLibraryItem(
          {
            api,
            ensureItemDetail,
            requestFailedMessage: () => t("common.error.requestFailed")
          },
          item
        ),
      (result) => setRawFeedback("success", t("library.feedback.added", { title: result.title }))
    );
  };

  const enqueueItems = async (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    await withFeedback(
      async () =>
        enqueueLibraryItems(
          {
            api,
            ensureItemDetail,
            requestFailedMessage: () => t("common.error.requestFailed")
          },
          items
        ),
      (result) =>
        setRawFeedback("success", t("library.feedback.addedMany", { count: result.enqueuedCount }))
    );
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

  const createLocalPlaylist = async (name: string, description?: string | null) =>
    withFeedback(
      async () => {
        const playlist = await api.createLocalPlaylist({ name, description });
        await refreshPlaylists({ force: true });
        await selectLocalPlaylist(playlist.playlist_id);
        return playlist;
      },
      (playlist) =>
        setRawFeedback("success", t("library.playlists.feedback.created", { name: playlist.name }))
    );

  const deleteLocalPlaylist = async (playlistId: string) => {
    await withFeedback(
      async () => {
        await api.deleteLocalPlaylist(playlistId);
        if (viewState.selectedPlaylistId() === playlistId) {
          viewState.setSelectedPlaylistId(null);
          viewState.setSelectedPlaylistItems([]);
        }
        await refreshPlaylists({ force: true });
      },
      () => setRawFeedback("success", t("library.playlists.feedback.deleted"))
    );
  };

  const addItemsToPlaylist = async (playlistId: string, items: readonly LibraryListItem[]) => {
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = uniqueMediaIds(details);
    if (mediaIds.length === 0) return 0;
    return withFeedback(
      async () => {
        const addedCount = await api.addMediaToLocalPlaylist(playlistId, mediaIds);
        await refreshPlaylists({ force: true });
        if (viewState.selectedPlaylistId() === playlistId) {
          await refreshSelectedPlaylist(playlistId);
        }
        return addedCount;
      },
      (addedCount) =>
        setRawFeedback("success", t("library.playlists.feedback.added", { count: addedCount }))
    );
  };

  const removeItemsFromSelectedPlaylist = async (items: readonly LibraryListItem[]) => {
    const playlistId = viewState.selectedPlaylistId();
    if (!playlistId || items.length === 0) return 0;
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = uniqueMediaIds(details);
    return withFeedback(
      async () => {
        const removedCount = await api.removeMediaFromLocalPlaylist(playlistId, mediaIds);
        await refreshPlaylists({ force: true });
        await refreshSelectedPlaylist(playlistId);
        return removedCount;
      },
      (removedCount) =>
        setRawFeedback("success", t("library.playlists.feedback.removed", { count: removedCount }))
    );
  };

  const deleteItemsFromLibrary = async (items: readonly LibraryListItem[]) => {
    const details = await Promise.all(items.map(ensureItemDetail));
    const mediaIds = uniqueMediaIds(details);
    if (mediaIds.length === 0) return 0;
    return withFeedback(
      async () => {
        const deletedCount = await api.deleteMediaItems(mediaIds);
        await Promise.all([refreshItems(), refreshPlaylists({ force: true })]);
        await refreshSelectedPlaylist();
        return deletedCount;
      },
      (deletedCount) =>
        setRawFeedback("success", t("library.feedback.deleted", { count: deletedCount }))
    );
  };

  const getCurrentBatchItems = async (): Promise<LibraryListItem[]> => {
    if (viewState.activeTab() === "songs") {
      return viewState.requestViewRows();
    }
    if (viewState.activeTab() === "artists" || viewState.activeTab() === "albums") {
      return viewState.activeGroupedItems();
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
    if (!detail) {
      return;
    }
    await copyToClipboard(detail.source_path);
  };

  const revealItemInFolder = async (item: LibraryListItem) => {
    await withFeedback(
      async () => {
        const detail = await ensureItemDetail(item);
        if (!detail) {
          throw new Error(t("common.error.requestFailed"));
        }
        await revealPathInFolder(detail.source_path);
      },
      () => setRawFeedback("success", t("media.context.showInFolder.success"))
    );
  };

  const deleteItemFromLocalDisk = async (item: LibraryListItem) => {
    await withFeedback(
      async () => {
        const detail = await ensureItemDetail(item);
        if (!detail || !detail.source_path) {
          throw new Error(t("common.error.requestFailed"));
        }
        await deleteFile(detail.source_path);
        await deleteItemsFromLibrary([item]);
      },
      () =>
        setRawFeedback("success", t("library.feedback.deletedFromDisk", { name: item.title ?? "" }))
    );
  };

  const handleRefresh = () => {
    void refreshRoots();
    void refreshItems();
    void refreshPlaylists({ force: true });
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
    loadedVirtualRange: viewState.loadedVirtualRange,
    setVirtualRange: viewState.setVirtualRange,
    localPlaylists: viewState.localPlaylists,
    selectedPlaylistId: viewState.selectedPlaylistId,
    selectedPlaylistItems: viewState.selectedPlaylistItems,
    selectedPlaylistSortedItems: viewState.selectedPlaylistSortedItems,
    filteredItems: viewState.filteredItems,
    activeGroupedItems: viewState.activeGroupedItems,
    artistGroups: viewState.artistGroups,
    albumGroups: viewState.albumGroups,
    selectedArtistGroupKey: viewState.selectedArtistGroupKey,
    selectArtistGroup: viewState.selectArtistGroup,
    selectedAlbumGroupKey: viewState.selectedAlbumGroupKey,
    selectAlbumGroup: viewState.selectAlbumGroup,
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
    deleteItemFromLocalDisk,
    handleScan,
    handleRescan,
    deleteLibraryRoot,
    handleRefresh,
    refreshItems,
    refreshRoots,
    refreshPlaylists
  };
}
