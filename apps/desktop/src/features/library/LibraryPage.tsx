import { For, Show, createMemo, createSignal } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { useUISearch } from "../../shared/state/UISearchContext";
import {
  IconChevronDown,
  IconFolder,
  IconList,
  IconMusic,
  IconPlayCircle,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStorage
} from "../../components/icons";
import { ContextMenu, type ContextMenuItem } from "../../components/media/ContextMenu";
import { MediaList, type MediaContextAction } from "../../components/media/MediaList";
import type { LocalPlaylist } from "../../shared/api/types";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { ManageRootsModal } from "./ManageRootsModal";
import {
  LibraryBatchModal,
  LibraryConfirmActionModal,
  LibraryPlaylistTargetModal
} from "./LibraryActionModals";
import { LibraryFoldersView } from "./LibraryFoldersView";
import { LibraryGroupedView } from "./LibraryGroupedView";
import { LibraryPlaylistsView } from "./LibraryPlaylistsView";
import type { LibraryListItem, LibraryTab } from "./libraryDataTypes";
import { ALL_FOLDERS_VALUE, useLibraryDataController } from "./useLibraryDataController";

interface LibraryPageProps {
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentMediaId: string | null;
  isPlaying: boolean;
}

export type { LibraryListItem } from "./libraryDataTypes";

type LibraryConfirmAction =
  | { kind: "delete-library"; items: LibraryListItem[] }
  | { kind: "remove-playlist-items"; items: LibraryListItem[] }
  | { kind: "delete-playlist"; playlist: LocalPlaylist };

export function LibraryPage(props: LibraryPageProps) {
  const { t } = useTranslation();
  const { query: globalQuery } = useUISearch();
  const controller = useLibraryDataController({ t, globalQuery });
  const [playlistModalItems, setPlaylistModalItems] = createSignal<LibraryListItem[] | null>(null);
  const [batchModalItems, setBatchModalItems] = createSignal<LibraryListItem[] | null>(null);
  const [confirmAction, setConfirmAction] = createSignal<LibraryConfirmAction | null>(null);
  const [moreMenu, setMoreMenu] = createSignal({ open: false, x: 0, y: 0 });
  const [groupPlaybackItems, setGroupPlaybackItems] = createSignal<LibraryListItem[]>([]);

  const activePlaybackItems = createMemo<LibraryListItem[]>(() =>
    controller.activeTab() === "playlists"
      ? controller.selectedPlaylistSortedItems()
      : controller.activeTab() === "artists" || controller.activeTab() === "albums"
        ? groupPlaybackItems()
      : controller.filteredItems()
  );
  const activePlaybackCount = createMemo<number>(() =>
    controller.activeTab() === "songs" ? controller.virtualTotal() : activePlaybackItems().length
  );

  const confirmTitle = createMemo<string>(() => {
    const action = confirmAction();
    if (!action) return "";
    if (action.kind === "delete-playlist") return t("library.playlists.delete.title");
    if (action.kind === "remove-playlist-items") return t("library.confirm.removePlaylistItems.title");
    return t("library.confirm.deleteTracks.title");
  });
  const confirmBody = createMemo<string>(() => {
    const action = confirmAction();
    if (!action) return "";
    if (action.kind === "delete-playlist") {
      return t("library.playlists.delete.body", { name: action.playlist.name });
    }
    if (action.kind === "remove-playlist-items") {
      return t("library.confirm.removePlaylistItems.body", { count: action.items.length });
    }
    return t("library.confirm.deleteTracks.body", { count: action.items.length });
  });
  const confirmLabel = createMemo<string>(() => {
    const action = confirmAction();
    if (!action) return t("library.action.confirm");
    if (action.kind === "delete-playlist") return t("library.action.deletePlaylist");
    if (action.kind === "remove-playlist-items") return t("library.action.removeFromPlaylist");
    return t("library.action.deleteFromLibrary");
  });

  const handlePlay = async (
    item: LibraryListItem,
    contextItems: readonly LibraryListItem[] = controller.filteredItems()
  ) => {
    try {
      await controller.playItem(item, contextItems);
      await props.onStateRefresh(item.source_path ?? null);
    } catch {
      // Feedback is handled inside the controller.
    }
  };

  const handleEnqueue = async (item: LibraryListItem) => {
    try {
      await controller.enqueueItem(item);
    } catch {
      // Feedback is handled inside the controller.
    }
  };

  const openAddToPlaylist = (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    setPlaylistModalItems([...items]);
  };

  const openCreatePlaylist = () => {
    setPlaylistModalItems([]);
  };

  const openDeleteFromLibrary = (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    setConfirmAction({ kind: "delete-library", items: [...items] });
  };

  const openRemoveFromPlaylist = (items: readonly LibraryListItem[]) => {
    if (items.length === 0) return;
    setConfirmAction({ kind: "remove-playlist-items", items: [...items] });
  };

  const handleContextAction = (action: MediaContextAction, item: LibraryListItem) => {
    if (action === "copy-path") {
      controller.notifyCopyPath();
    } else if (action === "add-to-playlist") {
      openAddToPlaylist([item]);
    } else if (action === "delete") {
      if (controller.activeTab() === "playlists") {
        openRemoveFromPlaylist([item]);
      } else {
        openDeleteFromLibrary([item]);
      }
    }
  };

  const handlePlayAll = () => {
    if (controller.activeTab() === "songs") {
      void controller.playCurrentSongView().then(() => props.onStateRefresh(null));
      return;
    }
    const items = activePlaybackItems();
    const first = items[0];
    if (first) {
      void handlePlay(first, items);
    }
  };

  const handleAddToExistingPlaylist = async (
    playlistId: string,
    items: readonly LibraryListItem[]
  ) => {
    await controller.addItemsToPlaylist(playlistId, items);
  };

  const handleCreatePlaylistAndMaybeAdd = async (
    name: string,
    description: string | null,
    items: readonly LibraryListItem[]
  ) => {
    const playlist = await controller.createLocalPlaylist(name, description);
    if (items.length > 0) {
      await controller.addItemsToPlaylist(playlist.playlist_id, items);
    }
  };

  const handleConfirmAction = async () => {
    const action = confirmAction();
    if (!action) return;
    if (action.kind === "delete-playlist") {
      await controller.deleteLocalPlaylist(action.playlist.playlist_id);
    } else if (action.kind === "remove-playlist-items") {
      await controller.removeItemsFromSelectedPlaylist(action.items);
    } else {
      await controller.deleteItemsFromLibrary(action.items);
    }
  };

  const tabItems = () => [
    { value: "songs", label: t("library.tabs.songs") },
    { value: "artists", label: t("library.tabs.artists") },
    { value: "albums", label: t("library.tabs.albums") },
    { value: "playlists", label: t("library.tabs.playlists") },
    { value: "folders", label: t("library.tabs.folders") }
  ];

  const moreMenuItems = (): ContextMenuItem[] => [
    {
      key: "manage-roots",
      label: t("library.action.manageRoots"),
      icon: <IconFolder />
    },
    {
      key: "batch",
      label: t("library.action.batch"),
      icon: <IconList />,
      disabled: activePlaybackCount() === 0
    }
  ];

  const handleMoreMenuSelect = (key: string) => {
    if (key === "manage-roots") {
      controller.setManageOpen(true);
      return;
    }
    if (key === "batch") {
      void controller.getCurrentBatchItems().then(setBatchModalItems);
    }
  };

  return (
    <section class="panel panel-library panel-page">
      <header class="local-library-head">
        <div class="local-library-title">
          <h1>{t("library.title")}</h1>
          <div
            class="local-library-status"
            aria-label={t("library.subtitle.complete", { count: controller.virtualTotal() })}
          >
            <span class="local-library-status-item">
              <IconMusic />
              <span>{t("library.status.songCount", { count: controller.virtualTotal() })}</span>
            </span>
            <span class="local-library-status-item">
              <IconStorage />
              <span>{controller.visibleSizeGb().toFixed(2)} GB</span>
            </span>
          </div>
        </div>
        <div class="local-library-menu">
          <div class="local-library-menu-left">
            <button
              type="button"
              class="primary-button page-action local-library-play"
              onClick={handlePlayAll}
              disabled={activePlaybackCount() === 0 || controller.isFetching()}
            >
              <IconPlayCircle />
              <span>{t("library.action.playAll")}</span>
            </button>
            <button
              type="button"
              class="ghost-button page-action local-library-circle"
              onClick={() => {
                if (controller.activeTab() === "playlists") {
                  openCreatePlaylist();
                  return;
                }
                void controller.handleRefresh();
              }}
              disabled={
                controller.activeTab() === "playlists"
                  ? false
                  : controller.isFetching() || controller.isScanning()
              }
              aria-label={
                controller.activeTab() === "playlists"
                  ? t("library.action.createPlaylist")
                  : t("library.action.refresh")
              }
              title={
                controller.activeTab() === "playlists"
                  ? t("library.action.createPlaylist")
                  : t("library.action.refresh")
              }
            >
              <Show when={controller.activeTab() === "playlists"} fallback={<IconRefresh />}>
                <IconPlus />
              </Show>
            </button>
            <button
              type="button"
              class="ghost-button page-action local-library-circle"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMoreMenu({ open: true, x: rect.left, y: rect.bottom + 6 });
              }}
              aria-label={t("library.action.more")}
              title={t("library.action.more")}
            >
              <IconList />
            </button>
          </div>
          <div class="local-library-menu-right">
            <Show when={controller.libraryTotalCount() > 0}>
              <label class="local-library-search">
                <IconSearch />
                <input
                  value={controller.localQuery()}
                  placeholder={t("library.tracks.fuzzySearch")}
                  autocomplete="off"
                  onInput={(event) => controller.setLocalQuery(event.currentTarget.value)}
                />
              </label>
            </Show>
            <Show when={controller.activeTab() !== "folders"}>
              <label class="local-library-folder-select" aria-label={t("library.folderFilter.label")}>
                <IconFolder />
                <select
                  value={controller.selectedFolder()}
                  onChange={(event) => controller.setSelectedFolder(event.currentTarget.value)}
                >
                  <option value={ALL_FOLDERS_VALUE}>{t("library.folderFilter.all")}</option>
                  <For each={controller.folderGroups()}>
                    {(group) => <option value={group.key}>{group.label}</option>}
                  </For>
                </select>
                <IconChevronDown />
              </label>
            </Show>
            <SegmentedTabs
              value={controller.activeTab()}
              onChange={(next) => controller.setActiveTab(next as LibraryTab)}
              items={tabItems()}
              ariaLabel={t("library.title")}
            />
          </div>
        </div>
      </header>

      <div class="local-library-router">
        <Show when={controller.activeTab() === "songs"}>
          <Show
            when={controller.virtualTotal() > 0}
            fallback={
              <Show
                when={controller.libraryTotalCount() === 0}
                fallback={<div class="status-line">{t("library.tracks.emptyFilter")}</div>}
              >
                <div class="local-library-empty" role="status">
                  <span class="empty-tab-icon" aria-hidden="true">
                    <IconMusic />
                  </span>
                  <span>{t("library.tracks.emptyAll")}</span>
                  <button
                    type="button"
                    class="primary-button page-action"
                    onClick={() => controller.setManageOpen(true)}
                  >
                    <IconFolder />
                    <span>{t("library.action.manageRoots")}</span>
                  </button>
                </div>
              </Show>
            }
          >
            <MediaList
              items={controller.filteredItems()}
              totalCount={controller.virtualTotal()}
              virtualStart={controller.virtualRange().start}
              currentSourcePath={props.currentTrackPath}
              currentMediaId={props.currentMediaId}
              isPlayingNow={props.isPlaying}
              onPlay={(item) => void handlePlay(item, controller.filteredItems())}
              onEnqueue={(item) => void handleEnqueue(item)}
              onCopyPath={(item) => void controller.copyItemPath(item)}
              onContextAction={handleContextAction}
              onVisibleRangeChange={controller.setVirtualRange}
              isLoading={controller.isFetching()}
              emptyState={t("library.tracks.emptyAll")}
              contextActions={["play", "enqueue", "add-to-playlist", "copy-path", "delete"]}
              deleteActionLabel={t("library.action.deleteFromLibrary")}
              sort={controller.sort()}
              onSortChange={controller.updateSort}
              onSortOrderChange={controller.updateSortOrder}
            />
          </Show>
        </Show>

        <Show when={controller.activeTab() === "artists"}>
          <LibraryGroupedView
            kind="artists"
            groups={controller.artistGroups()}
            currentTrackPath={props.currentTrackPath}
            isPlaying={props.isPlaying}
            onPlay={(item, groupSongs) => void handlePlay(item, groupSongs)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
            isLoading={controller.isFetching()}
            contextActions={["play", "enqueue", "add-to-playlist", "copy-path", "delete"]}
            deleteActionLabel={t("library.action.deleteFromLibrary")}
            sort={controller.sort()}
            onSortChange={controller.updateSort}
            onSortOrderChange={controller.updateSortOrder}
            onActiveItemsChange={setGroupPlaybackItems}
          />
        </Show>
        <Show when={controller.activeTab() === "albums"}>
          <LibraryGroupedView
            kind="albums"
            groups={controller.albumGroups()}
            currentTrackPath={props.currentTrackPath}
            isPlaying={props.isPlaying}
            onPlay={(item, groupSongs) => void handlePlay(item, groupSongs)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
            isLoading={controller.isFetching()}
            contextActions={["play", "enqueue", "add-to-playlist", "copy-path", "delete"]}
            deleteActionLabel={t("library.action.deleteFromLibrary")}
            sort={controller.sort()}
            onSortChange={controller.updateSort}
            onSortOrderChange={controller.updateSortOrder}
            onActiveItemsChange={setGroupPlaybackItems}
          />
        </Show>
        <Show when={controller.activeTab() === "playlists"}>
          <LibraryPlaylistsView
            playlists={controller.localPlaylists()}
            selectedPlaylistId={controller.selectedPlaylistId()}
            items={controller.selectedPlaylistSortedItems()}
            currentTrackPath={props.currentTrackPath}
            isPlaying={props.isPlaying}
            isLoading={controller.isFetching()}
            sort={controller.sort()}
            onSortChange={controller.updateSort}
            onSortOrderChange={controller.updateSortOrder}
            onSelectPlaylist={(playlistId) => void controller.selectLocalPlaylist(playlistId)}
            onCreatePlaylist={openCreatePlaylist}
            onDeletePlaylist={(playlist) => setConfirmAction({ kind: "delete-playlist", playlist })}
            onPlay={(item, playlistSongs) => void handlePlay(item, playlistSongs)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
          />
        </Show>
        <Show when={controller.activeTab() === "folders"}>
          <LibraryFoldersView
            nodes={controller.folderTree()}
            selectedFolder={controller.selectedFolder()}
            items={controller.filteredItems()}
            currentTrackPath={props.currentTrackPath}
            isPlaying={props.isPlaying}
            isLoading={controller.isFetching()}
            sort={controller.sort()}
            onSortChange={controller.updateSort}
            onSortOrderChange={controller.updateSortOrder}
            onSelectFolder={controller.setSelectedFolder}
            onPlay={(item, folderSongs) => void handlePlay(item, folderSongs)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
          />
        </Show>
      </div>

      <Show when={controller.feedback().message && controller.feedback().message !== t("library.feedback.initial")}>
        <div
          class={
            controller.feedback().tone === "error"
              ? "local-library-feedback status-error"
              : "local-library-feedback status-line"
          }
        >
          {controller.feedback().message}
        </div>
      </Show>
      <ContextMenu
        open={moreMenu().open}
        x={moreMenu().x}
        y={moreMenu().y}
        items={moreMenuItems()}
        onSelect={handleMoreMenuSelect}
        onClose={() => setMoreMenu((current) => ({ ...current, open: false }))}
      />
      <Show when={controller.scanProgress()}>
        {(progress) => (
          <div class="local-library-scan-progress" role="status">
            {t("library.feedback.scanProgress", {
              scanned: progress().scanned,
              indexed: progress().indexed,
              removed: progress().removed
            })}
          </div>
        )}
      </Show>

      <ManageRootsModal
        open={controller.manageOpen()}
        onClose={() => controller.setManageOpen(false)}
        roots={controller.roots()}
        isScanning={controller.isScanning()}
        onAddRoot={controller.handleScan}
        onDeleteRoot={controller.deleteLibraryRoot}
      />
      <LibraryPlaylistTargetModal
        open={playlistModalItems() !== null}
        items={playlistModalItems() ?? []}
        playlists={controller.localPlaylists()}
        onClose={() => setPlaylistModalItems(null)}
        onAddToPlaylist={handleAddToExistingPlaylist}
        onCreateAndAdd={handleCreatePlaylistAndMaybeAdd}
      />
      <LibraryBatchModal
        open={batchModalItems() !== null}
        items={batchModalItems() ?? []}
        onClose={() => setBatchModalItems(null)}
        onAddToPlaylist={(items) => {
          setBatchModalItems(null);
          openAddToPlaylist(items);
        }}
        onDeleteFromLibrary={(items) => {
          setBatchModalItems(null);
          openDeleteFromLibrary(items);
        }}
      />
      <LibraryConfirmActionModal
        open={confirmAction() !== null}
        title={confirmTitle()}
        body={confirmBody()}
        confirmLabel={confirmLabel()}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
    </section>
  );
}
