import type { SidebarHiddenItemKey, SidebarHiddenItems } from "../shared/state/uiSettingsModel";
import type { ActivePage, LibraryDestination, LibraryTab } from "../shared/ui/navigation";

type OfflineLibraryTab = Extract<LibraryTab, "songs" | "albums" | "artists" | "folders">;

export type OfflineSidebarBlock =
  | {
      readonly kind: "library";
      readonly tab: OfflineLibraryTab;
      readonly settingKey: Extract<
        SidebarHiddenItemKey,
        "library" | "libraryAlbums" | "libraryArtists" | "libraryFolders"
      >;
      readonly labelKey: string;
      readonly icon: "music" | "album" | "artist" | "folder";
    }
  | {
      readonly kind: "local-playlists";
      readonly settingKey: "createdPlaylists";
    }
  | {
      readonly kind: "page";
      readonly page: "recent";
      readonly settingKey: "recent";
      readonly labelKey: string;
      readonly icon: "recent";
    };

export const OFFLINE_SIDEBAR_BLOCKS: readonly OfflineSidebarBlock[] = [
  {
    kind: "library",
    tab: "songs",
    settingKey: "library",
    labelKey: "sidebar.nav.localLibrary.label",
    icon: "music"
  },
  { kind: "local-playlists", settingKey: "createdPlaylists" },
  {
    kind: "library",
    tab: "albums",
    settingKey: "libraryAlbums",
    labelKey: "sidebar.nav.libraryAlbums.label",
    icon: "album"
  },
  {
    kind: "library",
    tab: "artists",
    settingKey: "libraryArtists",
    labelKey: "sidebar.nav.libraryArtists.label",
    icon: "artist"
  },
  {
    kind: "library",
    tab: "folders",
    settingKey: "libraryFolders",
    labelKey: "sidebar.nav.libraryFolders.label",
    icon: "folder"
  },
  {
    kind: "page",
    page: "recent",
    settingKey: "recent",
    labelKey: "sidebar.nav.recent.label",
    icon: "recent"
  }
];

export const visibleOfflineSidebarBlocks = (
  hiddenItems: Readonly<SidebarHiddenItems>
): readonly OfflineSidebarBlock[] =>
  OFFLINE_SIDEBAR_BLOCKS.filter((block) => !hiddenItems[block.settingKey]);

export const isOfflineSidebarBlockActive = (
  block: OfflineSidebarBlock,
  activePage: ActivePage,
  destination: LibraryDestination
): boolean => {
  if (block.kind === "page") return activePage === block.page;
  if (block.kind === "local-playlists") return false;
  return (
    activePage === "library" &&
    destination.kind === "tab" &&
    destination.tab === block.tab
  );
};

