import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconChevronDown, IconChevronRight, IconFolder } from "../../components/icons";
import { MediaList } from "../../components/media/MediaList";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import type {
  MediaSortField,
  MediaSortOrder,
  MediaSortState
} from "../../components/media/mediaListTypes";
import { useTranslation } from "../../shared/i18n";
import {
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

interface DisplayFolderNode {
  key: string;
  label: string;
  totalCount: number;
  depth: number;
  children: DisplayFolderNode[];
}

const mergeNode = (node: LibraryFolderNode, depth: number): DisplayFolderNode => {
  let label = node.label;
  let key = node.key;
  let children = node.children;
  let directCount = node.directCount;

  while (children.length === 1 && directCount === 0) {
    const child = children[0];
    const sep = key.includes("\\") ? "\\" : "/";
    label = `${label}${sep}${child.label}`;
    key = child.key;
    children = child.children;
    directCount = child.directCount;
  }

  return {
    key,
    label,
    totalCount: node.totalCount,
    depth,
    children: children.map((child) => mergeNode(child, depth + 1))
  };
};

const collectNodeKeys = (nodes: readonly DisplayFolderNode[]): Set<string> => {
  const keys = new Set<string>();
  const visit = (node: DisplayFolderNode) => {
    keys.add(node.key);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return keys;
};

interface FolderNodeButtonProps {
  node: DisplayFolderNode;
  selectedFolder: string;
  expandedKeys: ReadonlySet<string>;
  onSelectFolder: (folderKey: string) => void;
  onToggleExpand: (folderKey: string) => void;
}

function FolderNodeButton(props: FolderNodeButtonProps) {
  const { t } = useTranslation();
  const active = () => props.selectedFolder === props.node.key;
  const hasChildren = () => props.node.children.length > 0;
  const isExpanded = () => props.expandedKeys.has(props.node.key);

  return (
    <>
      <button
        type="button"
        class="local-folder-node"
        classList={{ "is-active": active() }}
        style={{ "padding-left": `${8 + props.node.depth * 14}px` }}
        onClick={() => props.onSelectFolder(props.node.key)}
      >
        <Show when={hasChildren()} fallback={<span class="local-folder-node-toggle local-folder-node-toggle--placeholder" aria-hidden="true" />}>
          <span
            class="local-folder-node-toggle"
            classList={{ "is-expanded": isExpanded() }}
            aria-label={isExpanded() ? t("library.folderFilter.collapse") : t("library.folderFilter.expand")}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleExpand(props.node.key);
            }}
          >
            <Show when={isExpanded()} fallback={<IconChevronRight />}>
              <IconChevronDown />
            </Show>
          </span>
        </Show>
        <span class="local-folder-node-icon" aria-hidden="true">
          <IconFolder />
        </span>
        <span class="local-folder-node-copy" title={props.node.key}>
          <span class="local-folder-node-name">{props.node.label}</span>
          <span class="local-folder-node-count" aria-label={t("library.group.songCount", { count: props.node.totalCount })}>
            ({props.node.totalCount})
          </span>
        </span>
      </button>
      <Show when={hasChildren() && isExpanded()}>
        <For each={props.node.children}>
          {(child) => (
            <FolderNodeButton
              node={child}
              selectedFolder={props.selectedFolder}
              expandedKeys={props.expandedKeys}
              onSelectFolder={props.onSelectFolder}
              onToggleExpand={props.onToggleExpand}
            />
          )}
        </For>
      </Show>
    </>
  );
}

export function LibraryFoldersView(props: LibraryFoldersViewProps) {
  const { t } = useTranslation();
  const mergedNodes = createMemo<DisplayFolderNode[]>(() =>
    props.nodes.map((node) => mergeNode(node, 0))
  );
  const [expandedKeys, setExpandedKeys] = createSignal<ReadonlySet<string>>(new Set());

  createEffect(() => {
    const nodes = mergedNodes();
    if (nodes.length === 0) return;
    const visibleKeys = collectNodeKeys(nodes);
    if (!visibleKeys.has(props.selectedFolder)) {
      props.onSelectFolder(nodes[0].key);
    }
    setExpandedKeys((current) => {
      if (current.size > 0) return current;
      return new Set(nodes.filter((node) => node.children.length > 0).map((node) => node.key));
    });
  });

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
          <For each={mergedNodes()}>
            {(node) => (
              <FolderNodeButton
                node={node}
                selectedFolder={props.selectedFolder}
                expandedKeys={expandedKeys()}
                onSelectFolder={props.onSelectFolder}
                onToggleExpand={toggleExpand}
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
            contextActions={["play", "enqueue", "add-to-playlist", "search", "copy-name", "copy-id", "copy-song-info", "share-link", "music-tag-editor", "copy-path", "show-in-folder", "song-wiki", "delete-from-library", "delete-from-local-disk"]}
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
