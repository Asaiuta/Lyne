import { Show } from "solid-js";
import { IconFolder, IconMusic } from "../../components/icons";
import { MediaList, type MediaContextAction } from "../../components/media/MediaList";
import type { LocalPlaylist } from "../../shared/api/types";
import type { TranslationKey, TranslationParams } from "../../shared/i18n";
import { LibraryFoldersView } from "./LibraryFoldersView";
import { LibraryGroupedView } from "./LibraryGroupedView";
import { LibraryPlaylistsView } from "./LibraryPlaylistsView";
import type { LibraryListItem } from "./libraryViewTypes";
import type { useLibraryDataController } from "./useLibraryDataController";

type LibraryDataController = ReturnType<typeof useLibraryDataController>;

interface LibraryTabContentProps {
  controller: LibraryDataController;
  currentTrackPath: string | null;
  currentMediaId: string | null;
  isPlaying: boolean;
  onManageRoots: () => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (playlist: LocalPlaylist) => void;
  onPlay: (item: LibraryListItem, contextItems: readonly LibraryListItem[]) => void;
  onEnqueue: (item: LibraryListItem) => void;
  onContextAction: (action: MediaContextAction, item: LibraryListItem) => void;
  onActiveItemsChange: (items: LibraryListItem[]) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

export function LibraryTabContent(props: LibraryTabContentProps) {
  return (
    <div class="local-library-router">
      <Show when={props.controller.activeTab() === "songs"}>
        <Show
          when={props.controller.virtualTotal() > 0}
          fallback={
            <Show
              when={props.controller.libraryTotalCount() === 0}
              fallback={<div class="status-line">{props.t("library.tracks.emptyFilter")}</div>}
            >
              <div class="local-library-empty" role="status">
                <span class="empty-tab-icon" aria-hidden="true">
                  <IconMusic />
                </span>
                <span>{props.t("library.tracks.emptyAll")}</span>
                <button
                  type="button"
                  class="primary-button page-action"
                  onClick={props.onManageRoots}
                >
                  <IconFolder />
                  <span>{props.t("library.action.manageRoots")}</span>
                </button>
              </div>
            </Show>
          }
        >
          <MediaList
            items={props.controller.filteredItems()}
            totalCount={props.controller.virtualTotal()}
            virtualStart={props.controller.virtualRange().start}
            currentSourcePath={props.currentTrackPath}
            currentMediaId={props.currentMediaId}
            isPlayingNow={props.isPlaying}
            onPlay={(item) => props.onPlay(item, props.controller.filteredItems())}
            onEnqueue={props.onEnqueue}
            onCopyPath={(item) => void props.controller.copyItemPath(item)}
            onContextAction={props.onContextAction}
            onVisibleRangeChange={props.controller.setVirtualRange}
            isLoading={props.controller.isFetching()}
            emptyState={props.t("library.tracks.emptyAll")}
            contextActions={["play", "enqueue", "add-to-playlist", "search", "copy-name", "show-in-folder", "delete-from-library"]}
            deleteActionLabel={props.t("library.action.deleteFromLibrary")}
            sort={props.controller.sort()}
            onSortChange={props.controller.updateSort}
            onSortOrderChange={props.controller.updateSortOrder}
          />
        </Show>
      </Show>

      <Show when={props.controller.activeTab() === "artists"}>
        <LibraryGroupedView
          kind="artists"
          groups={props.controller.artistGroups()}
          selectedGroupKey={props.controller.selectedArtistGroupKey()}
          currentTrackPath={props.currentTrackPath}
          currentMediaId={props.currentMediaId}
          isPlaying={props.isPlaying}
          onSelectGroup={props.controller.selectArtistGroup}
          onPlay={props.onPlay}
          onEnqueue={props.onEnqueue}
          onContextAction={props.onContextAction}
          isLoading={props.controller.isFetching()}
          contextActions={["play", "enqueue", "add-to-playlist", "search", "copy-name", "show-in-folder", "delete-from-library"]}
          deleteActionLabel={props.t("library.action.deleteFromLibrary")}
          sort={props.controller.sort()}
          onSortChange={props.controller.updateSort}
          onSortOrderChange={props.controller.updateSortOrder}
          onActiveItemsChange={props.onActiveItemsChange}
        />
      </Show>
      <Show when={props.controller.activeTab() === "albums"}>
        <LibraryGroupedView
          kind="albums"
          groups={props.controller.albumGroups()}
          selectedGroupKey={props.controller.selectedAlbumGroupKey()}
          currentTrackPath={props.currentTrackPath}
          currentMediaId={props.currentMediaId}
          isPlaying={props.isPlaying}
          onSelectGroup={props.controller.selectAlbumGroup}
          onPlay={props.onPlay}
          onEnqueue={props.onEnqueue}
          onContextAction={props.onContextAction}
          isLoading={props.controller.isFetching()}
          contextActions={["play", "enqueue", "add-to-playlist", "search", "copy-name", "show-in-folder", "delete-from-library"]}
          deleteActionLabel={props.t("library.action.deleteFromLibrary")}
          sort={props.controller.sort()}
          onSortChange={props.controller.updateSort}
          onSortOrderChange={props.controller.updateSortOrder}
          onActiveItemsChange={props.onActiveItemsChange}
        />
      </Show>
      <Show when={props.controller.activeTab() === "playlists"}>
        <LibraryPlaylistsView
          playlists={props.controller.localPlaylists()}
          selectedPlaylistId={props.controller.selectedPlaylistId()}
          items={props.controller.selectedPlaylistSortedItems()}
          currentTrackPath={props.currentTrackPath}
          currentMediaId={props.currentMediaId}
          isPlaying={props.isPlaying}
          isLoading={props.controller.isFetching()}
          sort={props.controller.sort()}
          onSortChange={props.controller.updateSort}
          onSortOrderChange={props.controller.updateSortOrder}
          onSelectPlaylist={(playlistId) => void props.controller.selectLocalPlaylist(playlistId)}
          onCreatePlaylist={props.onCreatePlaylist}
          onDeletePlaylist={props.onDeletePlaylist}
          onPlay={props.onPlay}
          onEnqueue={props.onEnqueue}
          onContextAction={props.onContextAction}
          onActiveItemsChange={props.onActiveItemsChange}
        />
      </Show>
      <Show when={props.controller.activeTab() === "folders"}>
        <LibraryFoldersView
          nodes={props.controller.folderTree()}
          selectedFolder={props.controller.selectedFolder()}
          items={props.controller.filteredItems()}
          currentTrackPath={props.currentTrackPath}
          currentMediaId={props.currentMediaId}
          isPlaying={props.isPlaying}
          isLoading={props.controller.isFetching()}
          sort={props.controller.sort()}
          onSortChange={props.controller.updateSort}
          onSortOrderChange={props.controller.updateSortOrder}
          onSelectFolder={props.controller.setSelectedFolder}
          onPlay={props.onPlay}
          onEnqueue={props.onEnqueue}
          onContextAction={props.onContextAction}
        />
      </Show>
    </div>
  );
}
