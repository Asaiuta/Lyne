import { For, Show, createMemo } from "solid-js";
import { IconFolder, IconMusic } from "../../components/icons";
import {
  MediaList,
  type MediaContextAction,
  type MediaSortField,
  type MediaSortOrder,
  type MediaSortState
} from "../../components/media/MediaList";
import { useTranslation } from "../../shared/i18n";
import {
  ALL_FOLDERS_VALUE,
  type LibraryFolderNode,
  type LibraryListItem
} from "./libraryViewTypes";

interface LibraryFoldersViewProps {
  nodes: readonly LibraryFolderNode[];
  selectedFolder: string;
  items: LibraryListItem[];
  currentTrackPath: string | null;
  currentMediaId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  sort: MediaSortState;
  onSortChange: (field: MediaSortField) => void;
  onSortOrderChange: (order: MediaSortOrder) => void;
  onSelectFolder: (folderKey: string) => void;
  onPlay: (item: LibraryListItem, contextItems: readonly LibraryListItem[]) => void;
  onEnqueue: (item: LibraryListItem) => void;
  onContextAction: (action: MediaContextAction, item: LibraryListItem) => void;
}

const totalFolderCount = (nodes: readonly LibraryFolderNode[]): number =>
  nodes.reduce((total, node) => total + node.totalCount, 0);

interface FolderNodeButtonProps {
  node: LibraryFolderNode;
  selectedFolder: string;
  onSelectFolder: (folderKey: string) => void;
}

function FolderNodeButton(props: FolderNodeButtonProps) {
  const { t } = useTranslation();
  const active = () => props.selectedFolder === props.node.key;

  return (
    <>
      <button
        type="button"
        class="local-folder-node"
        classList={{ "is-active": active() }}
        style={{ "padding-left": `${12 + props.node.depth * 14}px` }}
        onClick={() => props.onSelectFolder(props.node.key)}
      >
        <span class="local-folder-node-icon" aria-hidden="true">
          <IconFolder />
        </span>
        <span class="local-folder-node-copy">
          <span class="local-folder-node-name" title={props.node.key}>{props.node.label}</span>
          <span class="local-folder-node-count">
            {t("library.group.songCount", { count: props.node.totalCount })}
          </span>
        </span>
      </button>
      <For each={props.node.children}>
        {(child) => (
          <FolderNodeButton
            node={child}
            selectedFolder={props.selectedFolder}
            onSelectFolder={props.onSelectFolder}
          />
        )}
      </For>
    </>
  );
}

export function LibraryFoldersView(props: LibraryFoldersViewProps) {
  const { t } = useTranslation();
  const allCount = createMemo<number>(() => totalFolderCount(props.nodes));

  return (
    <Show
      when={props.nodes.length > 0}
      fallback={
        <div class="empty-tab" role="status">
          <span class="empty-tab-icon" aria-hidden="true">
            <IconFolder />
          </span>
          <span>{t("library.tabs.empty.folders")}</span>
        </div>
      }
    >
      <div class="local-browser local-browser-folders">
        <aside class="local-browser-list local-folder-tree" aria-label={t("library.tabs.folders")}>
          <button
            type="button"
            class="local-folder-node local-folder-node-root"
            classList={{ "is-active": props.selectedFolder === ALL_FOLDERS_VALUE }}
            onClick={() => props.onSelectFolder(ALL_FOLDERS_VALUE)}
          >
            <span class="local-folder-node-icon" aria-hidden="true">
              <IconMusic />
            </span>
            <span class="local-folder-node-copy">
              <span class="local-folder-node-name">{t("library.folderFilter.all")}</span>
              <span class="local-folder-node-count">
                {t("library.group.songCount", { count: allCount() })}
              </span>
            </span>
          </button>
          <For each={props.nodes}>
            {(node) => (
              <FolderNodeButton
                node={node}
                selectedFolder={props.selectedFolder}
                onSelectFolder={props.onSelectFolder}
              />
            )}
          </For>
        </aside>

        <div class="local-browser-songs">
          <MediaList
            items={props.items}
            currentSourcePath={props.currentTrackPath}
            currentMediaId={props.currentMediaId}
            isPlayingNow={props.isPlaying}
            onPlay={(item) => props.onPlay(item, props.items)}
            onEnqueue={props.onEnqueue}
            onContextAction={props.onContextAction}
            isLoading={props.isLoading}
            emptyState={t("library.tracks.emptyFilter")}
            contextActions={["play", "enqueue", "add-to-playlist", "search", "copy-name", "show-in-folder", "delete-from-library"]}
            deleteActionLabel={t("library.action.deleteFromLibrary")}
            sort={props.sort}
            onSortChange={props.onSortChange}
            onSortOrderChange={props.onSortOrderChange}
          />
        </div>
      </div>
    </Show>
  );
}
