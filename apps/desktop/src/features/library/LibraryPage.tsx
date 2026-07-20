import { Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { useUISearch } from "../../shared/state/UISearchContext";
import {
  IconAddFilled,
  IconCheckmark,
  IconAlbum,
  IconArtist,
  IconBatchFilled,
  IconDeleteFilled,
  IconFolder,
  IconFolderCogFilled,
  IconFormatListFilled,
  IconMusic,
  IconPlayFilled,
  IconPlaylist,
  IconRefreshFilled,
  IconStorage
} from "../../components/icons";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import { KeyedOutInTransition } from "../../components/KeyedOutInTransition";
import type { LocalPlaylist, PlayerState } from "../../shared/api/types";
import type { RouteAnimation } from "../../shared/state/uiSettingsModel";
import {
  DEFAULT_LIBRARY_DESTINATION,
  libraryDestinationMotionKey,
  libraryDestinationToTab,
  type LibraryDestination,
  type LibraryTab
} from "../../shared/ui/navigation";
import { ManageRootsModal } from "./ManageRootsModal";
import {
  LibraryBatchModal,
  LibraryConfirmActionModal,
  LibraryPlaylistTargetModal
} from "./LibraryActionModals";
import { LibraryTabContent } from "./LibraryTabContent";
import type { LibraryListItem } from "./libraryViewTypes";
import { createLibraryPlaybackCoordinator } from "./libraryPlaybackCoordinator";
import {
  NaiveDropdown,
  NaiveH1,
  type NaiveDropdownOption
} from "../../shared/ui/naive";
import { useLibraryDataController } from "./useLibraryDataController";
import { localPlaylistRequestIdForRoute } from "./localPlaylistRequestState";
import { PageSearchInput } from "../../components/page/PageSearchInput";
import { PageToolbarButton } from "../../components/page/PageToolbarButton";
import "../../shared/styles/pages/local-library.css";

interface LibraryPageProps {
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentMediaId: string | null;
  isPlaying: boolean;
  onPlaybackState: (next: PlayerState) => void;
  onPlay: () => Promise<void> | undefined;
  onPause: () => Promise<void> | undefined;
  onPlaybackHistoryChanged: () => void;
  routeActive: boolean;
  destination: LibraryDestination;
  routeAnimation: RouteAnimation;
  showViewMenu: boolean;
  onDestinationChange: (destination: LibraryDestination) => void;
  onReplaceDestination: (destination: LibraryDestination) => void;
}

type LibraryConfirmAction =
  | { kind: "delete-library"; items: LibraryListItem[] }
  | { kind: "remove-playlist-items"; items: LibraryListItem[] }
  | { kind: "delete-playlist"; playlist: LocalPlaylist };

const emptyTopNavLibraryQuery = () => "";

export function LibraryPage(props: LibraryPageProps) {
  const { t } = useTranslation();
  const { setQuery: setGlobalQuery, submitSearch } = useUISearch();
  const controller = useLibraryDataController({ t, globalQuery: emptyTopNavLibraryQuery });
  const [playlistModalItems, setPlaylistModalItems] = createSignal<LibraryListItem[] | null>(null);
  const [batchModalItems, setBatchModalItems] = createSignal<LibraryListItem[] | null>(null);
  const [confirmAction, setConfirmAction] = createSignal<LibraryConfirmAction | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = createSignal<boolean>(false);
  const [viewMenuOpen, setViewMenuOpen] = createSignal<boolean>(false);
  const [groupPlaybackItems, setGroupPlaybackItems] = createSignal<LibraryListItem[]>([]);
  const [displayedDestination, setDisplayedDestination] =
    createSignal<LibraryDestination>(props.destination);
  const playbackCoordinator = createLibraryPlaybackCoordinator({
    getSnapshot: () => ({
      currentTrackPath: props.currentTrackPath,
      currentMediaId: props.currentMediaId,
      isPlaying: props.isPlaying
    }),
    playCurrent: props.onPlay,
    pauseCurrent: props.onPause,
    playLibraryItem: async (item, contextItems) => {
      const nextState = await controller.playItem(item, contextItems);
      props.onPlaybackState(nextState);
      await props.onStateRefresh(nextState.file_path ?? item.source_path ?? null);
      props.onPlaybackHistoryChanged();
    }
  });

  const activePlaybackItems = createMemo<LibraryListItem[]>(() =>
    controller.activeTab() === "playlists"
      ? groupPlaybackItems()
      : controller.activeTab() === "artists" || controller.activeTab() === "albums"
        ? controller.activeGroupedItems()
      : controller.filteredItems()
  );
  const activePlaybackCount = createMemo<number>(() =>
    controller.activeTab() === "songs" ? controller.virtualTotal() : activePlaybackItems().length
  );
  const playlistForDestination = (
    destination: LibraryDestination
  ): LocalPlaylist | null => {
    if (destination.kind !== "playlist") return null;
    return (
      controller.localPlaylists().find(
        (playlist) => playlist.playlist_id === destination.playlistId
      ) ?? null
    );
  };
  const activeLocalPlaylist = createMemo<LocalPlaylist | null>(() =>
    playlistForDestination(displayedDestination())
  );
  const activeTitle = createMemo<string>(() => {
    const destination = props.destination;
    if (destination.kind === "playlist") {
      return playlistForDestination(destination)?.name ?? t("library.tabs.playlists");
    }
    switch (destination.tab) {
      case "songs":
        return t("sidebar.nav.localLibrary.label");
      case "artists":
        return t("library.tabs.artists");
      case "albums":
        return t("library.tabs.albums");
      case "playlists":
        return t("library.tabs.playlists");
      case "folders":
        return t("library.tabs.folders");
      default: {
        const _exhaustive: never = destination.tab;
        return _exhaustive;
      }
    }
  });

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
      await playbackCoordinator.play(item, contextItems);
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

  const searchLibraryItem = (item: LibraryListItem) => {
    const keyword = (item.title?.trim() || item.fileName?.trim() || item.source_path?.trim() || "").trim();
    if (!keyword) return;
    setGlobalQuery(keyword);
    submitSearch();
  };

  const handleContextAction = (action: MediaContextAction, item: LibraryListItem) => {
    if (action === "copy-name") {
      controller.notifyCopyName();
    } else if (action === "copy-path") {
      controller.notifyCopyPath();
    } else if (action === "search") {
      searchLibraryItem(item);
    } else if (action === "show-in-folder") {
      void controller.revealItemInFolder(item).catch(() => undefined);
    } else if (action === "add-to-playlist") {
      openAddToPlaylist([item]);
    } else if (action === "delete-from-playlist") {
      openRemoveFromPlaylist([item]);
    } else if (action === "delete-from-library" || action === "delete") {
      openDeleteFromLibrary([item]);
    } else if (action === "delete-from-local-disk") {
      void controller.deleteItemFromLocalDisk(item).catch(() => undefined);
    } else if (action === "music-tag-editor") {
      // TODO: Implement music tag editor modal
      controller.notifyCopyName();
    } else if (action === "mv") {
      // TODO: Navigate to MV page — requires router integration
    } else if (action === "cloud-import") {
      // TODO: Implement cloud import
    } else if (action === "download") {
      // TODO: Implement download — developer mode only
    } else if (action === "copy-song-info") {
      // TODO: Implement copy song info
    }
  };

  const handlePlayAll = () => {
    if (controller.activeTab() === "songs") {
      void controller.playCurrentSongView().then(async (nextState) => {
        props.onPlaybackState(nextState);
        await props.onStateRefresh(nextState.file_path);
        props.onPlaybackHistoryChanged();
      });
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
    props.onDestinationChange({ kind: "playlist", playlistId: playlist.playlist_id });
  };

  createEffect(
    on(
      () => [props.routeActive, displayedDestination()] as const,
      ([routeActive, destination]) => {
        const playlistId = localPlaylistRequestIdForRoute(routeActive, destination);
        if (!routeActive) {
          controller.deactivateLocalPlaylistRoute();
          return;
        }
        controller.setActiveTab(libraryDestinationToTab(destination));
        if (playlistId !== null) {
          void controller.selectLocalPlaylist(playlistId);
          return;
        }
        void controller.selectLocalPlaylist("");
      }
    )
  );

  createEffect(
    on(
      () => [
        props.routeActive,
        props.destination,
        controller.localPlaylistRequestState()
      ] as const,
      ([routeActive, destination, requestState]) => {
        if (
          routeActive &&
          destination.kind === "playlist" &&
          requestState.status === "not-found" &&
          requestState.playlistId === destination.playlistId
        ) {
          props.onReplaceDestination(DEFAULT_LIBRARY_DESTINATION);
        }
      }
    )
  );

  createEffect(
    on(
      () => [
        props.routeActive,
        props.destination,
        controller.localPlaylistsReady(),
        controller.localPlaylists()
      ] as const,
      ([routeActive, destination, playlistsReady, playlists]) => {
        if (
          !routeActive ||
          destination.kind !== "playlist" ||
          !playlistsReady ||
          playlists.some((playlist) => playlist.playlist_id === destination.playlistId)
        ) {
          return;
        }
        props.onReplaceDestination(DEFAULT_LIBRARY_DESTINATION);
      }
    )
  );

  const handleConfirmAction = async () => {
    const action = confirmAction();
    if (!action) return;
    if (action.kind === "delete-playlist") {
      await controller.deleteLocalPlaylist(action.playlist.playlist_id);
      if (
        props.destination.kind === "playlist" &&
        props.destination.playlistId === action.playlist.playlist_id
      ) {
        props.onReplaceDestination(DEFAULT_LIBRARY_DESTINATION);
      }
    } else if (action.kind === "remove-playlist-items") {
      await controller.removeItemsFromSelectedPlaylist(action.items);
    } else {
      await controller.deleteItemsFromLibrary(action.items);
    }
  };

  const tabItems = createMemo<ReadonlyArray<{ value: LibraryTab; label: string }>>(() => [
    { value: "songs", label: t("library.tabs.songs") },
    { value: "artists", label: t("library.tabs.artists") },
    { value: "albums", label: t("library.tabs.albums") },
    { value: "playlists", label: t("library.tabs.playlists") },
    { value: "folders", label: t("library.tabs.folders") }
  ]);

  const viewMenuItems = createMemo<readonly NaiveDropdownOption[]>(() =>
    tabItems().map((item) => ({
      key: item.value,
      label: item.label,
      icon:
        item.value === "songs" ? <IconMusic /> :
        item.value === "artists" ? <IconArtist /> :
        item.value === "albums" ? <IconAlbum /> :
        item.value === "playlists" ? <IconPlaylist /> :
        <IconFolder />,
      suffix: item.value === controller.activeTab() ? <IconCheckmark /> : undefined
    }))
  );

  const activeTabLabel = createMemo<string>(
    () => tabItems().find((item) => item.value === controller.activeTab())?.label ?? ""
  );

  const moreMenuItems = (): readonly NaiveDropdownOption[] => [
    {
      key: "manage-roots",
      label: t("library.action.manageRoots"),
      icon: <IconFolderCogFilled />
    },
    {
      key: "batch",
      label: t("library.action.batch"),
      icon: <IconBatchFilled />,
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
        <KeyedOutInTransition
          value={activeTitle()}
          transitionKey={activeTitle()}
          transitionName="local-library-title-fade"
          motionScope="library-title"
        >
          {(displayedTitle) => (
            <div class="local-library-title">
              <NaiveH1>{displayedTitle()}</NaiveH1>
              <div
                class="local-library-status"
                aria-label={t("library.subtitle.complete", {
                  count: controller.virtualTotal()
                })}
              >
                <span class="local-library-status-item">
                  <IconMusic />
                  <span>
                    {t("library.status.songCount", {
                      count: controller.virtualTotal()
                    })}
                  </span>
                </span>
                <span class="local-library-status-item">
                  <IconStorage />
                  <span>{controller.visibleSizeGb().toFixed(2)} GB</span>
                </span>
              </div>
            </div>
          )}
        </KeyedOutInTransition>
        <div class="local-library-menu">
          <div class="local-library-menu-left">
            <PageToolbarButton
              variant="primary"
              class="local-library-play"
              onClick={handlePlayAll}
              disabled={activePlaybackCount() === 0 || controller.isFetching()}
            >
              <IconPlayFilled />
              <span>{t("library.action.playAll")}</span>
            </PageToolbarButton>
            <PageToolbarButton
              variant="icon"
              class="local-library-icon-button"
              onClick={() => {
                const playlist = activeLocalPlaylist();
                if (playlist) {
                  setConfirmAction({ kind: "delete-playlist", playlist });
                  return;
                }
                if (controller.activeTab() === "playlists") {
                  openCreatePlaylist();
                  return;
                }
                void controller.handleRefresh();
              }}
              disabled={
                activeLocalPlaylist() || controller.activeTab() === "playlists"
                  ? false
                  : controller.isFetching() || controller.isScanning()
              }
              ariaLabel={
                activeLocalPlaylist()
                  ? t("library.action.deletePlaylist")
                  : controller.activeTab() === "playlists"
                  ? t("library.action.createPlaylist")
                  : t("library.action.refresh")
              }
              title={
                activeLocalPlaylist()
                  ? t("library.action.deletePlaylist")
                  : controller.activeTab() === "playlists"
                  ? t("library.action.createPlaylist")
                  : t("library.action.refresh")
              }
            >
              <Show
                when={activeLocalPlaylist()}
                fallback={
                  <Show
                    when={controller.activeTab() === "playlists"}
                    fallback={<IconRefreshFilled />}
                  >
                    <IconAddFilled />
                  </Show>
                }
              >
                <IconDeleteFilled />
              </Show>
            </PageToolbarButton>
            <NaiveDropdown
              class="local-library-more-menu"
              options={moreMenuItems()}
              triggerMode="click"
              placement="bottom-start"
              open={moreMenuOpen()}
              onOpenChange={setMoreMenuOpen}
              onSelect={(option) => handleMoreMenuSelect(option.key)}
              ariaLabel={t("library.action.more")}
            >
              <PageToolbarButton
                variant="icon"
                class="local-library-icon-button"
                ariaLabel={t("library.action.more")}
                title={t("library.action.more")}
                ariaHasPopup="menu"
                ariaExpanded={moreMenuOpen()}
              >
                <IconFormatListFilled />
              </PageToolbarButton>
            </NaiveDropdown>
          </div>
          <div class="local-library-menu-right">
            <Show when={controller.libraryTotalCount() > 0}>
              <PageSearchInput
                class="local-library-search"
                value={controller.localQuery()}
                placeholder={t("library.tracks.fuzzySearch")}
                onUpdateValue={controller.setLocalQuery}
              />
            </Show>
            <Show when={props.showViewMenu}>
              <NaiveDropdown
                class="local-library-view-menu"
                options={viewMenuItems()}
                triggerMode="click"
                placement="bottom-end"
                open={viewMenuOpen()}
                onOpenChange={setViewMenuOpen}
                onSelect={(option) => {
                  const nextTab = tabItems().find((item) => item.value === option.key)?.value;
                  if (nextTab) props.onDestinationChange({ kind: "tab", tab: nextTab });
                }}
                ariaLabel={activeTitle()}
              >
                <button
                  type="button"
                  class="local-library-view-trigger"
                  aria-haspopup="menu"
                  aria-expanded={viewMenuOpen()}
                >
                  <IconCheckmark />
                  <span>{activeTabLabel()}</span>
                </button>
              </NaiveDropdown>
            </Show>
          </div>
        </div>
      </header>

      <KeyedOutInTransition
        value={props.destination}
        transitionKey={libraryDestinationMotionKey(props.destination)}
        transitionName={
          props.routeAnimation === "none" ? null : `page-${props.routeAnimation}`
        }
        motionScope="library-content"
        onDisplayedValueChange={(destination) =>
          setDisplayedDestination(() => destination)
        }
      >
        {(transitionDestination) => (
          <LibraryTabContent
            controller={controller}
            destination={transitionDestination()}
            currentTrackPath={props.currentTrackPath}
            currentMediaId={props.currentMediaId}
            isPlaying={props.isPlaying}
            onManageRoots={() => controller.setManageOpen(true)}
            onCreatePlaylist={openCreatePlaylist}
            onSelectPlaylist={(playlistId) =>
              props.onDestinationChange({ kind: "playlist", playlistId })
            }
            onPlay={(item, contextItems) => void handlePlay(item, contextItems)}
            onEnqueue={(item) => void handleEnqueue(item)}
            onContextAction={handleContextAction}
            onActiveItemsChange={setGroupPlaybackItems}
            t={t}
          />
        )}
      </KeyedOutInTransition>

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
