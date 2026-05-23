import { createMemo, createSignal, type Accessor } from "solid-js";
import type { UserPlaylistMode } from "../features/online/ncmPlaylistSummary";
import type { FeedCardItem, OnlineTrackItem, RadioSubscribeEvent } from "../features/online/shared/types";
import { isPlaylistPage, type ActivePage } from "../shared/ui/navigation";

export interface DiscoverTabRequest {
  tab: string;
  version: number;
}

export interface ArtistDetailRequest {
  artist: FeedCardItem | null;
  version: number;
}

export interface AlbumDetailRequest {
  album: FeedCardItem | null;
  version: number;
}

export interface RadioDetailRequest {
  radio: FeedCardItem | null;
  version: number;
}

export interface SongWikiRequest {
  track: OnlineTrackItem | null;
  version: number;
}

export type LikedCollectionTabRequest = {
  tab: "playlists" | "albums" | "artists";
  version: number;
};

export interface LocalPlaylistRequest {
  playlistId: string | null;
  version: number;
}

export interface NavigationController {
  activePage: Accessor<ActivePage>;
  selectedPlaylistId: Accessor<number | null>;
  localPlaylistRequest: Accessor<LocalPlaylistRequest>;
  discoverTabRequest: Accessor<DiscoverTabRequest>;
  artistDetailRequest: Accessor<ArtistDetailRequest>;
  albumDetailRequest: Accessor<AlbumDetailRequest>;
  radioDetailRequest: Accessor<RadioDetailRequest>;
  songWikiRequest: Accessor<SongWikiRequest>;
  radioSubscribeEvent: Accessor<RadioSubscribeEvent | null>;
  likedCollectionTabRequest: Accessor<LikedCollectionTabRequest>;
  canGoBack: Accessor<boolean>;
  canGoForward: Accessor<boolean>;
  handleActivePageChange: (page: ActivePage) => void;
  handleSidebarPlaylistSelect: (page: UserPlaylistMode, playlistId: number) => void;
  handleSidebarLocalPlaylistSelect: (playlistId: string) => void;
  handleSelectedPlaylistChange: (playlistId: number | null) => void;
  handleNavigateToDiscover: (tab: string) => void;
  handleNavigateToArtistDetail: (artist: FeedCardItem) => void;
  handleNavigateToAlbumDetail: (album: FeedCardItem) => void;
  handleNavigateToRadioDetail: (radio: FeedCardItem) => void;
  handleNavigateToSongWiki: (track: OnlineTrackItem) => void;
  handleRadioSubscribeChange: (radio: FeedCardItem, subscribed: boolean) => void;
  handleNavigateToLikedCollectionTab: (tab: LikedCollectionTabRequest["tab"]) => void;
  handleGoBack: () => void;
  handleGoForward: () => void;
}

/**
 * In-app page navigation: active page, sidebar-driven playlist selection,
 * the back/forward history stack, and the "jump into discover with a
 * specific tab" request.
 *
 * Extracted from useAppController so the player/queue orchestrator does
 * not need to own routing state. The composing controller can still bolt
 * UI-level coordination (e.g. closing the full player when navigating
 * to the queue) on top of these primitives.
 */
export function useNavigationController(): NavigationController {
  const [activePage, setActivePage] = createSignal<ActivePage>("recommend");
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<number | null>(null);
  const [discoverTabRequest, setDiscoverTabRequest] = createSignal<DiscoverTabRequest>({
    tab: "playlists",
    version: 0
  });
  const [artistDetailRequest, setArtistDetailRequest] = createSignal<ArtistDetailRequest>({
    artist: null,
    version: 0
  });
  const [albumDetailRequest, setAlbumDetailRequest] = createSignal<AlbumDetailRequest>({
    album: null,
    version: 0
  });
  const [radioDetailRequest, setRadioDetailRequest] = createSignal<RadioDetailRequest>({
    radio: null,
    version: 0
  });
  const [songWikiRequest, setSongWikiRequest] = createSignal<SongWikiRequest>({
    track: null,
    version: 0
  });
  const [radioSubscribeEvent, setRadioSubscribeEvent] = createSignal<RadioSubscribeEvent | null>(null);
  const [likedCollectionTabRequest, setLikedCollectionTabRequest] =
    createSignal<LikedCollectionTabRequest>({
      tab: "playlists",
      version: 0
    });
  const [localPlaylistRequest, setLocalPlaylistRequest] = createSignal<LocalPlaylistRequest>({
    playlistId: null,
    version: 0
  });
  const [historyStack, setHistoryStack] = createSignal<ActivePage[]>(["recommend"]);
  const [historyIndex, setHistoryIndex] = createSignal(0);

  const commitPageChange = (page: ActivePage) => {
    setActivePage(page);
    if (!isPlaylistPage(page)) {
      setSelectedPlaylistId(null);
    }
  };

  const pushNavigation = (page: ActivePage) => {
    const current = activePage();
    if (page === current) {
      if (!isPlaylistPage(page)) {
        setSelectedPlaylistId(null);
      }
      return;
    }

    const nextIndex = historyIndex() + 1;
    setHistoryStack((prev) => [...prev.slice(0, nextIndex), page]);
    setHistoryIndex(nextIndex);
    commitPageChange(page);
  };

  const handleActivePageChange = (page: ActivePage) => {
    pushNavigation(page);
  };

  const handleSidebarPlaylistSelect = (page: UserPlaylistMode, playlistId: number) => {
    if (activePage() !== page) {
      const nextIndex = historyIndex() + 1;
      setHistoryStack((prev) => [...prev.slice(0, nextIndex), page]);
      setHistoryIndex(nextIndex);
    }
    commitPageChange(page);
    setSelectedPlaylistId(playlistId);
  };

  const handleSelectedPlaylistChange = (playlistId: number | null) => {
    setSelectedPlaylistId(playlistId);
  };

  const handleSidebarLocalPlaylistSelect = (playlistId: string) => {
    setSelectedPlaylistId(null);
    setLocalPlaylistRequest((prev) => ({ playlistId, version: prev.version + 1 }));
    pushNavigation("library");
  };

  const handleNavigateToDiscover = (tab: string) => {
    setDiscoverTabRequest((prev) => ({ tab, version: prev.version + 1 }));
    pushNavigation("discover");
  };

  const handleNavigateToArtistDetail = (artist: FeedCardItem) => {
    setArtistDetailRequest((prev) => ({ artist, version: prev.version + 1 }));
    pushNavigation("discover");
  };

  const handleNavigateToAlbumDetail = (album: FeedCardItem) => {
    setAlbumDetailRequest((prev) => ({ album, version: prev.version + 1 }));
    pushNavigation("discover");
  };

  const handleNavigateToRadioDetail = (radio: FeedCardItem) => {
    setRadioDetailRequest((prev) => ({ radio, version: prev.version + 1 }));
    pushNavigation("radio");
  };

  const handleNavigateToSongWiki = (track: OnlineTrackItem) => {
    setSongWikiRequest((prev) => ({ track, version: prev.version + 1 }));
    pushNavigation("song-wiki");
  };

  const handleRadioSubscribeChange = (radio: FeedCardItem, subscribed: boolean) => {
    setRadioSubscribeEvent((prev) => ({
      radio,
      subscribed,
      version: (prev?.version ?? 0) + 1
    }));
  };

  const handleNavigateToLikedCollectionTab = (tab: LikedCollectionTabRequest["tab"]) => {
    setLikedCollectionTabRequest((prev) => ({ tab, version: prev.version + 1 }));
    pushNavigation("liked");
  };

  const handleGoBack = () => {
    const nextIndex = historyIndex() - 1;
    if (nextIndex < 0) return;
    const target = historyStack()[nextIndex];
    if (!target) return;
    setHistoryIndex(nextIndex);
    commitPageChange(target);
  };

  const handleGoForward = () => {
    const nextIndex = historyIndex() + 1;
    const target = historyStack()[nextIndex];
    if (!target) return;
    setHistoryIndex(nextIndex);
    commitPageChange(target);
  };

  const canGoBack = createMemo(() => historyIndex() > 0);
  const canGoForward = createMemo(() => historyIndex() < historyStack().length - 1);

  return {
    activePage,
    selectedPlaylistId,
    localPlaylistRequest,
    discoverTabRequest,
    artistDetailRequest,
    albumDetailRequest,
    radioDetailRequest,
    songWikiRequest,
    radioSubscribeEvent,
    likedCollectionTabRequest,
    canGoBack,
    canGoForward,
    handleActivePageChange,
    handleSidebarPlaylistSelect,
    handleSidebarLocalPlaylistSelect,
    handleSelectedPlaylistChange,
    handleNavigateToDiscover,
    handleNavigateToArtistDetail,
    handleNavigateToAlbumDetail,
    handleNavigateToRadioDetail,
    handleNavigateToSongWiki,
    handleRadioSubscribeChange,
    handleNavigateToLikedCollectionTab,
    handleGoBack,
    handleGoForward
  };
}
