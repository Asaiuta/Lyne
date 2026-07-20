import { createEffect, createMemo, createSignal, on, type Accessor } from "solid-js";
import type { OnlinePlaylistSummary, UserPlaylistMode } from "../features/online/ncmPlaylistSummary";
import type { FeedCardItem, OnlineTrackItem, RadioSubscribeEvent } from "../features/online/shared/types";
import {
  persistNavigationStateSnapshot,
  readNavigationStateSnapshot
} from "../shared/state/navigationPersistence";
import {
  DEFAULT_LIBRARY_DESTINATION,
  isPlaylistPage,
  normalizeDiscoverTab,
  normalizeLibraryDestination,
  type ActivePage,
  type DiscoverTab,
  type LibraryDestination,
  type NavigationLocation
} from "../shared/ui/navigation";
import {
  createNavigationHistory,
  enterOfflineNavigation,
  moveNavigationHistory,
  pushNavigationLocation,
  replaceNavigationLocation,
  type NavigationHistoryState
} from "./navigationHistory";

export interface DiscoverTabRequest {
  tab: DiscoverTab;
  version: number;
}

export interface DailySongsRequest {
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

export interface PlaylistDetailRequest {
  playlist: OnlinePlaylistSummary | null;
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

export interface VideoDetailRequest {
  video: FeedCardItem | null;
  version: number;
}

export type LikedCollectionTabRequest = {
  tab: "playlists" | "albums" | "artists";
  version: number;
};

export interface NavigationController {
  activePage: Accessor<ActivePage>;
  libraryDestination: Accessor<LibraryDestination>;
  selectedPlaylistId: Accessor<number | null>;
  discoverTabRequest: Accessor<DiscoverTabRequest>;
  dailySongsRequest: Accessor<DailySongsRequest>;
  artistDetailRequest: Accessor<ArtistDetailRequest>;
  albumDetailRequest: Accessor<AlbumDetailRequest>;
  playlistDetailRequest: Accessor<PlaylistDetailRequest>;
  radioDetailRequest: Accessor<RadioDetailRequest>;
  songWikiRequest: Accessor<SongWikiRequest>;
  videoDetailRequest: Accessor<VideoDetailRequest>;
  radioSubscribeEvent: Accessor<RadioSubscribeEvent | null>;
  likedCollectionTabRequest: Accessor<LikedCollectionTabRequest>;
  canGoBack: Accessor<boolean>;
  canGoForward: Accessor<boolean>;
  handleActivePageChange: (page: ActivePage) => void;
  handleNavigateToLibrary: (destination: LibraryDestination) => void;
  handleReplaceLibraryDestination: (destination: LibraryDestination) => void;
  handleEnterOfflineMode: () => void;
  handleSidebarPlaylistSelect: (page: UserPlaylistMode, playlist: OnlinePlaylistSummary) => void;
  handleSidebarLocalPlaylistSelect: (playlistId: string) => void;
  handleSelectedPlaylistChange: (playlistId: number | null) => void;
  handleNavigateToDiscover: (tab: string) => void;
  handleDiscoverTabChange: (tab: string) => void;
  handleNavigateToDailySongs: () => void;
  handleNavigateToArtistDetail: (artist: FeedCardItem) => void;
  handleNavigateToAlbumDetail: (album: FeedCardItem) => void;
  handleNavigateToPlaylistDetail: (playlist: OnlinePlaylistSummary) => void;
  handleNavigateToRadioDetail: (radio: FeedCardItem) => void;
  handleNavigateToVideoDetail: (video: FeedCardItem) => void;
  handleNavigateToSongWiki: (track: OnlineTrackItem) => void;
  handleNavigateToMv: (track: OnlineTrackItem) => void;
  handleRadioSubscribeChange: (radio: FeedCardItem, subscribed: boolean) => void;
  handleNavigateToLikedCollectionTab: (tab: LikedCollectionTabRequest["tab"]) => void;
  handleLikedCollectionTabChange: (tab: LikedCollectionTabRequest["tab"]) => void;
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
  const restoredNavigation = readNavigationStateSnapshot();
  const [activePage, setActivePage] =
    createSignal<ActivePage>(restoredNavigation.activePage);
  const [libraryDestination, setLibraryDestination] = createSignal<LibraryDestination>(
    restoredNavigation.libraryDestination
  );
  const [selectedPlaylistId, setSelectedPlaylistId] =
    createSignal<number | null>(restoredNavigation.selectedPlaylistId);
  const [discoverTabRequest, setDiscoverTabRequest] = createSignal<DiscoverTabRequest>({
    tab: restoredNavigation.discoverTab,
    version: restoredNavigation.discoverTab === "playlists" ? 0 : 1
  });
  const [dailySongsRequest, setDailySongsRequest] = createSignal<DailySongsRequest>({
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
  const [playlistDetailRequest, setPlaylistDetailRequest] = createSignal<PlaylistDetailRequest>({
    playlist: null,
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
  const [videoDetailRequest, setVideoDetailRequest] = createSignal<VideoDetailRequest>({
    video: null,
    version: 0
  });
  const [radioSubscribeEvent, setRadioSubscribeEvent] = createSignal<RadioSubscribeEvent | null>(null);
  const [likedCollectionTabRequest, setLikedCollectionTabRequest] =
    createSignal<LikedCollectionTabRequest>({
      tab: restoredNavigation.likedCollectionTab,
      version: restoredNavigation.likedCollectionTab === "playlists" ? 0 : 1
    });
  const initialLocation: NavigationLocation = {
    page: restoredNavigation.activePage,
    libraryDestination: restoredNavigation.libraryDestination
  };
  const [historyState, setHistoryState] = createSignal<NavigationHistoryState>(
    createNavigationHistory(initialLocation)
  );

  const canRetainPlaylistSelection = (page: ActivePage): boolean =>
    isPlaylistPage(page) || page === "playlist-detail";

  const commitLocation = (location: NavigationLocation) => {
    setActivePage(location.page);
    setLibraryDestination(location.libraryDestination);
    if (!canRetainPlaylistSelection(location.page)) {
      setSelectedPlaylistId(null);
    }
  };

  const pushLocation = (location: NavigationLocation) => {
    const currentHistory = historyState();
    const nextHistory = pushNavigationLocation(currentHistory, location);
    if (nextHistory === currentHistory) {
      if (!canRetainPlaylistSelection(location.page)) {
        setSelectedPlaylistId(null);
      }
      return;
    }
    setHistoryState(nextHistory);
    commitLocation(location);
  };

  const pushNavigation = (page: ActivePage) => {
    pushLocation({
      page,
      libraryDestination:
        page === "library" ? DEFAULT_LIBRARY_DESTINATION : libraryDestination()
    });
  };

  const handleActivePageChange = (page: ActivePage) => {
    pushNavigation(page);
  };

  const handleNavigateToLibrary = (destination: LibraryDestination) => {
    pushLocation({
      page: "library",
      libraryDestination: normalizeLibraryDestination(destination)
    });
  };

  const handleReplaceLibraryDestination = (destination: LibraryDestination) => {
    const location: NavigationLocation = {
      page: "library",
      libraryDestination: normalizeLibraryDestination(destination)
    };
    if (activePage() !== "library") {
      pushLocation(location);
      return;
    }
    const nextHistory = replaceNavigationLocation(historyState(), location);
    setHistoryState(nextHistory);
    commitLocation(location);
  };

  const handleEnterOfflineMode = () => {
    const nextHistory = enterOfflineNavigation(historyState());
    const target = nextHistory.entries[nextHistory.index];
    if (!target) return;
    setHistoryState(nextHistory);
    commitLocation(target);
  };

  const handleSidebarPlaylistSelect = (page: UserPlaylistMode, playlist: OnlinePlaylistSummary) => {
    pushNavigation(page);
    setSelectedPlaylistId(playlist.id);
    setPlaylistDetailRequest((prev) => ({ playlist, version: prev.version + 1 }));
    pushNavigation("playlist-detail");
  };

  const handleSelectedPlaylistChange = (playlistId: number | null) => {
    setSelectedPlaylistId(playlistId);
  };

  const handleSidebarLocalPlaylistSelect = (playlistId: string) => {
    setSelectedPlaylistId(null);
    handleNavigateToLibrary({ kind: "playlist", playlistId });
  };

  const handleNavigateToDiscover = (tab: string) => {
    setDiscoverTabRequest((prev) => ({ tab: normalizeDiscoverTab(tab), version: prev.version + 1 }));
    pushNavigation("discover");
  };

  const handleDiscoverTabChange = (tab: string) => {
    setDiscoverTabRequest((prev) => ({ tab: normalizeDiscoverTab(tab), version: prev.version }));
  };

  const handleNavigateToDailySongs = () => {
    setDailySongsRequest((prev) => ({ version: prev.version + 1 }));
    pushNavigation("daily-songs");
  };

  const handleNavigateToArtistDetail = (artist: FeedCardItem) => {
    setArtistDetailRequest((prev) => ({ artist, version: prev.version + 1 }));
    pushNavigation("artist-detail");
  };

  const handleNavigateToAlbumDetail = (album: FeedCardItem) => {
    setAlbumDetailRequest((prev) => ({ album, version: prev.version + 1 }));
    pushNavigation("album-detail");
  };

  const handleNavigateToPlaylistDetail = (playlist: OnlinePlaylistSummary) => {
    setSelectedPlaylistId(playlist.id);
    setPlaylistDetailRequest((prev) => ({ playlist, version: prev.version + 1 }));
    pushNavigation("playlist-detail");
  };

  const handleNavigateToRadioDetail = (radio: FeedCardItem) => {
    setRadioDetailRequest((prev) => ({ radio, version: prev.version + 1 }));
    pushNavigation("radio-detail");
  };

  const handleNavigateToVideoDetail = (video: FeedCardItem) => {
    setVideoDetailRequest((prev) => ({ video, version: prev.version + 1 }));
    pushNavigation("video-detail");
  };

  const handleNavigateToSongWiki = (track: OnlineTrackItem) => {
    setSongWikiRequest((prev) => ({ track, version: prev.version + 1 }));
    pushNavigation("song-wiki");
  };

  const handleNavigateToMv = (track: OnlineTrackItem) => {
    if (typeof track.mvId !== "number" || track.mvId <= 0) return;
    const video: FeedCardItem = {
      id: track.mvId,
      videoId: String(track.mvId),
      videoKind: "mv",
      title: track.title ?? String(track.mvId),
      subtitle: track.artist ?? null,
      coverUrl: track.artworkUrl ?? null,
      playCount: null,
      description: null
    };
    handleNavigateToVideoDetail(video);
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

  const handleLikedCollectionTabChange = (tab: LikedCollectionTabRequest["tab"]) => {
    setLikedCollectionTabRequest((prev) => ({ tab, version: prev.version }));
  };

  const handleGoBack = () => {
    const currentHistory = historyState();
    const nextHistory = moveNavigationHistory(currentHistory, -1);
    if (nextHistory === currentHistory) return;
    const target = nextHistory.entries[nextHistory.index];
    if (!target) return;
    setHistoryState(nextHistory);
    commitLocation(target);
  };

  const handleGoForward = () => {
    const currentHistory = historyState();
    const nextHistory = moveNavigationHistory(currentHistory, 1);
    if (nextHistory === currentHistory) return;
    const target = nextHistory.entries[nextHistory.index];
    if (!target) return;
    setHistoryState(nextHistory);
    commitLocation(target);
  };

  const canGoBack = createMemo<boolean>(() => historyState().index > 0);
  const canGoForward = createMemo<boolean>(
    () => historyState().index < historyState().entries.length - 1
  );

  createEffect(
    on(
      () => [
        activePage(),
        libraryDestination(),
        selectedPlaylistId(),
        discoverTabRequest().tab,
        likedCollectionTabRequest().tab
      ] as const,
      ([page, destination, playlistId, discoverTab, likedCollectionTab]) => {
        persistNavigationStateSnapshot({
          activePage: page,
          libraryDestination: destination,
          selectedPlaylistId: playlistId,
          discoverTab,
          likedCollectionTab
        });
      }
    )
  );

  return {
    activePage,
    libraryDestination,
    selectedPlaylistId,
    discoverTabRequest,
    dailySongsRequest,
    artistDetailRequest,
    albumDetailRequest,
    playlistDetailRequest,
    radioDetailRequest,
    songWikiRequest,
    videoDetailRequest,
    radioSubscribeEvent,
    likedCollectionTabRequest,
    canGoBack,
    canGoForward,
    handleActivePageChange,
    handleNavigateToLibrary,
    handleReplaceLibraryDestination,
    handleEnterOfflineMode,
    handleSidebarPlaylistSelect,
    handleSidebarLocalPlaylistSelect,
    handleSelectedPlaylistChange,
    handleNavigateToDiscover,
    handleDiscoverTabChange,
    handleNavigateToDailySongs,
    handleNavigateToArtistDetail,
    handleNavigateToAlbumDetail,
    handleNavigateToPlaylistDetail,
    handleNavigateToRadioDetail,
    handleNavigateToVideoDetail,
    handleNavigateToSongWiki,
    handleNavigateToMv,
    handleRadioSubscribeChange,
    handleNavigateToLikedCollectionTab,
    handleLikedCollectionTabChange,
    handleGoBack,
    handleGoForward
  };
}
