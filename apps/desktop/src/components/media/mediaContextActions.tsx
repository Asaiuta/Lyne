import type { JSX } from "solid-js";
import type { TranslationKey } from "../../shared/i18n";
import type { UISettings } from "../../shared/state/uiSettingsModel";
import {
  IconBookOpen,
  IconCloud,
  IconCopy,
  IconDelete,
  IconDownload,
  IconDots,
  IconFolder,
  IconMessage,
  IconPlay,
  IconPlaylist,
  IconQueueAdd,
  IconSearch,
  IconShare,
  IconThumbDown,
  IconVideo
} from "../icons";
import type { ContextMenuItem } from "./ContextMenu";

export type MediaContextAction =
  | "play"
  | "enqueue"
  | "add-to-playlist"
  | "mv"
  | "view-comments"
  | "daily-dislike"
  | "copy-name"
  | "copy-id"
  | "copy-song-info"
  | "share-link"
  | "music-tag-editor"
  | "cloud-import"
  | "delete-from-playlist"
  | "delete-from-cloud"
  | "delete-from-local-disk"
  | "show-in-folder"
  | "cloud-match"
  | "song-wiki"
  | "search"
  | "download"
  | "copy-path"
  | "delete-from-library"
  | "delete";

export type MediaContextActionEffect =
  | "play"
  | "enqueue"
  | "copy-name"
  | "copy-id"
  | "share-link"
  | "view-comments"
  | "copy-path"
  | "search"
  | "emit";

interface MediaContextActionTarget {
  songId?: number;
  mvId?: number | null;
}

interface MediaContextActionDescriptor {
  labelKey: TranslationKey;
  icon: () => JSX.Element;
  enabled: (settings: UISettings) => boolean;
  visible?: (target: MediaContextActionTarget | null) => boolean;
  effect: MediaContextActionEffect;
}

type MenuNode =
  | { type: "action"; action: MediaContextAction }
  | { type: "divider"; key: string };

type MenuEntry =
  | MenuNode
  | {
      type: "submenu";
      key: string;
      labelKey: TranslationKey;
      icon: () => JSX.Element;
      children: readonly MenuNode[];
    };

interface MenuGroup {
  dividerBefore: boolean;
  entries: readonly MenuEntry[];
}

interface BuildContextMenuItemsOptions {
  actionSet: ReadonlySet<MediaContextAction>;
  settings: UISettings;
  target: MediaContextActionTarget | null;
  t: (key: TranslationKey) => string;
  deleteActionLabel?: string;
  renderIcons?: boolean;
}

export const DEFAULT_MEDIA_CONTEXT_ACTIONS: readonly MediaContextAction[] = [
  "play",
  "enqueue",
  "search",
  "copy-name",
  "copy-id",
  "share-link",
  "song-wiki",
  "view-comments"
];

const hasSongId = (target: MediaContextActionTarget | null): boolean =>
  typeof target?.songId === "number";

const hasDownloadSongId = (target: MediaContextActionTarget | null): boolean =>
  Boolean(target?.songId);

const hasMvId = (target: MediaContextActionTarget | null): boolean =>
  hasSongId(target) && Boolean(target?.mvId);

export const MEDIA_CONTEXT_ACTION_DESCRIPTORS: Record<MediaContextAction, MediaContextActionDescriptor> = {
  "play": {
    labelKey: "media.context.play",
    icon: () => <IconPlay />,
    enabled: (settings) => settings.contextMenuOptions.play,
    effect: "play"
  },
  "enqueue": {
    labelKey: "media.context.enqueue",
    icon: () => <IconQueueAdd />,
    enabled: (settings) => settings.contextMenuOptions.playNext,
    effect: "enqueue"
  },
  "add-to-playlist": {
    labelKey: "media.context.addToPlaylist",
    icon: () => <IconPlaylist />,
    enabled: (settings) => settings.contextMenuOptions.addToPlaylist,
    effect: "emit"
  },
  "mv": {
    labelKey: "media.context.mv",
    icon: () => <IconVideo />,
    enabled: (settings) => settings.contextMenuOptions.mv,
    visible: hasMvId,
    effect: "emit"
  },
  "view-comments": {
    labelKey: "media.context.viewComments",
    icon: () => <IconMessage />,
    enabled: (settings) => settings.useOnlineService,
    visible: hasSongId,
    effect: "view-comments"
  },
  "daily-dislike": {
    labelKey: "media.context.dailyDislike",
    icon: () => <IconThumbDown />,
    enabled: (settings) => settings.contextMenuOptions.dislike,
    effect: "emit"
  },
  "copy-name": {
    labelKey: "media.context.copyName",
    icon: () => <IconCopy />,
    enabled: (settings) => settings.contextMenuOptions.more && settings.contextMenuOptions.copyName,
    effect: "copy-name"
  },
  "copy-id": {
    labelKey: "media.context.copyId",
    icon: () => <IconCopy />,
    enabled: (settings) => settings.contextMenuOptions.more,
    visible: hasSongId,
    effect: "copy-id"
  },
  "copy-song-info": {
    labelKey: "media.context.copySongInfo",
    icon: () => <IconCopy />,
    enabled: (settings) => settings.contextMenuOptions.more,
    visible: hasSongId,
    effect: "emit"
  },
  "share-link": {
    labelKey: "media.context.shareLink",
    icon: () => <IconShare />,
    enabled: (settings) => settings.contextMenuOptions.more,
    visible: hasSongId,
    effect: "share-link"
  },
  "music-tag-editor": {
    labelKey: "media.context.musicTagEditor",
    icon: () => <IconBookOpen />,
    enabled: (settings) => settings.contextMenuOptions.more && settings.contextMenuOptions.musicTagEditor,
    effect: "emit"
  },
  "cloud-import": {
    labelKey: "media.context.cloudImport",
    icon: () => <IconCloud />,
    enabled: (settings) => settings.contextMenuOptions.cloudImport,
    effect: "emit"
  },
  "delete-from-playlist": {
    labelKey: "media.context.deleteFromPlaylist",
    icon: () => <IconDelete />,
    enabled: (settings) => settings.contextMenuOptions.deleteFromPlaylist,
    effect: "emit"
  },
  "delete-from-cloud": {
    labelKey: "media.context.deleteFromCloud",
    icon: () => <IconDelete />,
    enabled: (settings) => settings.contextMenuOptions.deleteFromCloud,
    effect: "emit"
  },
  "delete-from-local-disk": {
    labelKey: "media.context.deleteFromLocalDisk",
    icon: () => <IconDelete />,
    enabled: (settings) => settings.contextMenuOptions.deleteFromLocal,
    effect: "emit"
  },
  "show-in-folder": {
    labelKey: "media.context.showInFolder",
    icon: () => <IconFolder />,
    enabled: (settings) => settings.contextMenuOptions.openFolder,
    effect: "emit"
  },
  "cloud-match": {
    labelKey: "media.context.cloudMatch",
    icon: () => <IconCloud />,
    enabled: (settings) => settings.contextMenuOptions.cloudMatch,
    visible: hasSongId,
    effect: "emit"
  },
  "song-wiki": {
    labelKey: "media.context.songWiki",
    icon: () => <IconBookOpen />,
    enabled: (settings) => settings.contextMenuOptions.more && settings.contextMenuOptions.wiki,
    visible: hasSongId,
    effect: "emit"
  },
  "search": {
    labelKey: "media.context.search",
    icon: () => <IconSearch />,
    enabled: (settings) => settings.contextMenuOptions.search && settings.useOnlineService,
    effect: "search"
  },
  "download": {
    labelKey: "media.context.download",
    icon: () => <IconDownload />,
    enabled: (settings) => settings.contextMenuOptions.download,
    visible: hasDownloadSongId,
    effect: "emit"
  },
  "copy-path": {
    labelKey: "media.context.copyPath",
    icon: () => <IconCopy />,
    enabled: () => true,
    effect: "copy-path"
  },
  "delete-from-library": {
    labelKey: "media.context.deleteFromLibrary",
    icon: () => <IconDelete />,
    enabled: (settings) => settings.contextMenuOptions.deleteFromLibrary,
    effect: "emit"
  },
  "delete": {
    labelKey: "media.context.delete",
    icon: () => <IconDelete />,
    enabled: (settings) => settings.contextMenuOptions.delete,
    effect: "emit"
  }
};

const actionNode = (action: MediaContextAction): MenuNode => ({ type: "action", action });
const dividerNode = (key: string): MenuNode => ({ type: "divider", key });

const MEDIA_CONTEXT_MENU_GROUPS: readonly MenuGroup[] = [
  {
    dividerBefore: false,
    entries: [
      actionNode("play"),
      actionNode("enqueue"),
      actionNode("add-to-playlist"),
      actionNode("mv"),
      actionNode("view-comments")
    ]
  },
  {
    dividerBefore: true,
    entries: [actionNode("daily-dislike")]
  },
  {
    dividerBefore: true,
    entries: [
      {
        type: "submenu",
        key: "more",
        labelKey: "media.context.more",
        icon: () => <IconDots />,
        children: [
          actionNode("copy-name"),
          actionNode("copy-id"),
          actionNode("copy-song-info"),
          actionNode("share-link"),
          dividerNode("more-divider-tag"),
          actionNode("music-tag-editor")
        ]
      }
    ]
  },
  {
    dividerBefore: true,
    entries: [
      actionNode("cloud-import"),
      actionNode("delete-from-playlist"),
      actionNode("delete-from-cloud"),
      actionNode("delete-from-local-disk"),
      actionNode("show-in-folder"),
      actionNode("cloud-match"),
      actionNode("song-wiki"),
      actionNode("search"),
      actionNode("download"),
      actionNode("copy-path"),
      actionNode("delete-from-library"),
      actionNode("delete")
    ]
  }
];

export const isMediaContextAction = (key: string): key is MediaContextAction =>
  Object.prototype.hasOwnProperty.call(MEDIA_CONTEXT_ACTION_DESCRIPTORS, key);

export const isMediaContextActionVisible = (
  action: MediaContextAction,
  options: Pick<BuildContextMenuItemsOptions, "actionSet" | "settings" | "target">
): boolean => {
  const descriptor = MEDIA_CONTEXT_ACTION_DESCRIPTORS[action];
  return (
    options.actionSet.has(action) &&
    descriptor.enabled(options.settings) &&
    (descriptor.visible?.(options.target) ?? true)
  );
};

export const hasVisibleMediaContextActions = (
  actionSet: ReadonlySet<MediaContextAction>,
  settings: UISettings,
  target: MediaContextActionTarget | null
): boolean =>
  Array.from(actionSet).some((action) =>
    isMediaContextActionVisible(action, { actionSet, settings, target })
  );

const dividerItem = (key: string): ContextMenuItem => ({
  key,
  label: "",
  divider: true
});

const actionItem = (
  action: MediaContextAction,
  options: BuildContextMenuItemsOptions
): ContextMenuItem | null => {
  if (!isMediaContextActionVisible(action, options)) return null;
  const descriptor = MEDIA_CONTEXT_ACTION_DESCRIPTORS[action];
  const item: ContextMenuItem = {
    key: action,
    label:
      action === "delete"
        ? options.deleteActionLabel ?? options.t(descriptor.labelKey)
        : options.t(descriptor.labelKey)
  };
  if (options.renderIcons !== false) {
    item.icon = descriptor.icon();
  }
  return item;
};

const buildMenuNodeItems = (
  nodes: readonly MenuNode[],
  options: BuildContextMenuItemsOptions
): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [];
  let pendingDividerKey: string | null = null;

  for (const node of nodes) {
    if (node.type === "divider") {
      if (items.length > 0) {
        pendingDividerKey = node.key;
      }
      continue;
    }

    const item = actionItem(node.action, options);
    if (!item) continue;
    if (pendingDividerKey !== null) {
      items.push(dividerItem(pendingDividerKey));
      pendingDividerKey = null;
    }
    items.push(item);
  }

  return items;
};

const entryItem = (
  entry: MenuEntry,
  options: BuildContextMenuItemsOptions
): ContextMenuItem | null => {
  if (entry.type === "action") {
    return actionItem(entry.action, options);
  }
  if (entry.type === "divider") {
    return dividerItem(entry.key);
  }

  const children = buildMenuNodeItems(entry.children, options);
  if (children.length === 0) return null;
  const item: ContextMenuItem = {
    key: entry.key,
    label: options.t(entry.labelKey),
    children
  };
  if (options.renderIcons !== false) {
    item.icon = entry.icon();
  }
  return item;
};

export const createMediaContextMenuItems = (
  options: BuildContextMenuItemsOptions
): ContextMenuItem[] => {
  const items: ContextMenuItem[] = [];

  for (const group of MEDIA_CONTEXT_MENU_GROUPS) {
    const groupItems = group.entries
      .map((entry) => entryItem(entry, options))
      .filter((item): item is ContextMenuItem => item !== null && !item.divider);
    if (groupItems.length === 0) continue;
    if (group.dividerBefore && items.length > 0) {
      items.push(dividerItem(`divider-${items.length}`));
    }
    items.push(...groupItems);
  }

  return items;
};
