import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { SegmentedTabs } from "../../../components/page/SegmentedTabs";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { usePresenceTransition } from "../../../shared/ui/usePresenceTransition";
import { NaiveP } from "../../../shared/ui/naive";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { DailySongsDetail } from "../details/DailySongsDetail";
import { OnlineLikedPlaylistDetailRoute } from "../details/OnlineLikedPlaylistDetailRoute";
import { OnlinePlaylistDetailRoute } from "../details/OnlinePlaylistDetailRoute";
import { VideoDetail } from "../details/VideoDetail";
import { cloudsearch } from "../../../shared/api/ncm/search";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import {
  ALL_PLAYLIST_CATEGORY,
  DISCOVER_ARTIST_AREAS,
  DISCOVER_ARTIST_INITIALS,
  DISCOVER_MV_AREAS,
  DISCOVER_MV_ORDERS,
  DISCOVER_MV_TYPES,
  DISCOVER_NEW_AREAS,
  DISCOVER_PAGE_LIMIT,
  DISCOVER_SEARCH_LIMIT,
  safeLoadDiscover
} from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import {
  NCM_SEARCH_TYPES,
  parseNcmMvAllCards,
  parseNcmSearchAlbums,
  parseNcmSearchArtists,
  parseNcmSearchRadios,
  parseNcmSearchVideos
} from "../searchParsers";
import type {
  DiscoverNewKind,
  DiscoverPlaylistKind,
  DiscoverCardItem,
  DiscoverTab,
  FeedCardItem,
  NcmProfile,
  OnlineTrackItem,
  SearchTab
} from "../shared/types";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { createPagedDiscoverCards } from "../shared/usePagedDiscoverCards";
import {
  DiscoverArtistShowcase,
  DiscoverMvShowcase,
  DiscoverNewShowcase,
  DiscoverPlaylistShowcase,
  DiscoverToplistShowcase
} from "./discoverShowcases";
import { SearchMode } from "./SearchMode";
import { mvAll } from "../../../shared/api/ncm/video";

const api = createApiClient();

const SPLAYER_DISCOVER_TABS = ["playlists", "toplists", "artists", "new"] as const;
type SplayerDiscoverTab = typeof SPLAYER_DISCOVER_TABS[number];

const isSplayerDiscoverTab = (tab: string | undefined): tab is SplayerDiscoverTab =>
  tab !== undefined && (SPLAYER_DISCOVER_TABS as readonly string[]).includes(tab);

const toFeedCardItem = (item: DiscoverCardItem): FeedCardItem => ({
  id: item.id,
  title: item.title,
  subtitle: item.subtitle,
  coverUrl: item.coverUrl,
  playCount: item.playCount,
  description: item.description
});

interface CatEntry { name: string; category: number; hot: boolean }

type DiscoverDetailView =
  | { kind: "daily" }
  | { kind: "liked" }
  | { kind: "album" }
  | { kind: "artist" }
  | { kind: "video" }
  | { kind: "playlist" }
  | { kind: "browse" };

export interface DiscoverModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  globalQuery: Accessor<string>;
  submitNonce: Accessor<number>;
  pendingDiscoverSearch: Accessor<boolean>;
  clearPendingDiscoverSearch: () => void;
  discoverTabRequest?: { tab: string; version: number };
  onDiscoverTabChange?: (tab: DiscoverTab) => void;
  artistDetailRequest?: { artist: FeedCardItem | null; version: number };
  albumDetailRequest?: { album: FeedCardItem | null; version: number };
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onPause: () => Promise<void>;
}

export function DiscoverMode(props: DiscoverModeProps) {
  const { t } = useTranslation();

  const [searchTab, setSearchTab] = createSignal<SearchTab>("songs");
  const [discoverTab, setDiscoverTab] = createSignal<DiscoverTab>("playlists");
  const [isSearching, setIsSearching] = createSignal(false);
  const [songResults, setSongResults] = createSignal<OnlineTrackItem[]>([]);
  const [playlistResults, setPlaylistResults] = createSignal<OnlinePlaylistSummary[]>([]);
  const [artistResults, setArtistResults] = createSignal<FeedCardItem[]>([]);
  const [albumResults, setAlbumResults] = createSignal<FeedCardItem[]>([]);
  const [videoResults, setVideoResults] = createSignal<FeedCardItem[]>([]);
  const [radioResults, setRadioResults] = createSignal<FeedCardItem[]>([]);

  const [discoverPlaylistKind, setDiscoverPlaylistKind] = createSignal<DiscoverPlaylistKind>("normal");
  const [discoverArtistInitial, setDiscoverArtistInitial] = createSignal<number | string>(-1);
  const [discoverArtistAreaIndex, setDiscoverArtistAreaIndex] = createSignal<number>(0);
  const [discoverNewKind, setDiscoverNewKind] = createSignal<DiscoverNewKind>("albums");
  const [discoverNewAreaIndex, setDiscoverNewAreaIndex] = createSignal<number>(0);
  const [discoverMvAreaIndex, setDiscoverMvAreaIndex] = createSignal<number>(0);
  const [discoverMvTypeIndex, setDiscoverMvTypeIndex] = createSignal<number>(0);
  const [discoverMvOrderIndex, setDiscoverMvOrderIndex] = createSignal<number>(0);

  const [catName, setCatName] = createSignal(ALL_PLAYLIST_CATEGORY);
  const [catModalOpen, setCatModalOpen] = createSignal(false);
  const [catModalType, setCatModalType] = createSignal<number | null>(null);
  const [catTypes, setCatTypes] = createSignal<Record<number, string>>({});
  const [catEntries, setCatEntries] = createSignal<CatEntry[]>([]);
  const [hqCatNames, setHqCatNames] = createSignal<Set<string>>(new Set());
  const catModalPresence = usePresenceTransition(catModalOpen);
  let catButtonRef: HTMLButtonElement | undefined;
  let catModalRef: HTMLDivElement | undefined;

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const readErrorMessage = createErrorMessageReader(t);

  const selectedArtistArea = createMemo(
    () =>
      DISCOVER_ARTIST_AREAS[discoverArtistAreaIndex()] ?? DISCOVER_ARTIST_AREAS[0]
  );
  const selectedNewArea = createMemo(
    () => DISCOVER_NEW_AREAS[discoverNewAreaIndex()] ?? DISCOVER_NEW_AREAS[0]
  );
  const selectedMvArea = createMemo(
    () => DISCOVER_MV_AREAS[discoverMvAreaIndex()] ?? DISCOVER_MV_AREAS[0]
  );
  const selectedMvType = createMemo(
    () => DISCOVER_MV_TYPES[discoverMvTypeIndex()] ?? DISCOVER_MV_TYPES[0]
  );
  const selectedMvOrder = createMemo(
    () => DISCOVER_MV_ORDERS[discoverMvOrderIndex()] ?? DISCOVER_MV_ORDERS[0]
  );

  const playlistCards = createPagedDiscoverCards(
    ({ offset, currentItems }) => {
      const kind = discoverPlaylistKind();
      const cat = catName();
      const lastCursor = currentItems.length > 0 ? currentItems[currentItems.length - 1]?.cursor ?? null : null;
      return api.listNcmDiscoverPlaylists({
        cat,
        kind,
        limit: DISCOVER_PAGE_LIMIT,
        offset,
        before: kind === "hq" && offset > 0 ? lastCursor : null
      });
    },
    {
      pageSize: DISCOVER_PAGE_LIMIT,
      onError: (error) => console.warn("[NeteasePage] discover playlists fetch failed", error)
    }
  );

  const albumCards = createPagedDiscoverCards(
    ({ offset }) => {
      const area = selectedNewArea().albumArea;
      return api.listNcmDiscoverAlbums({ area, limit: DISCOVER_PAGE_LIMIT, offset });
    },
    {
      pageSize: DISCOVER_PAGE_LIMIT,
      onError: (error) => console.warn("[NeteasePage] discover albums fetch failed", error)
    }
  );

  const artistCards = createPagedDiscoverCards(
    async ({ offset }) => {
      const area = selectedArtistArea();
      const items = await api.listNcmDiscoverArtists({
        type: area.type,
        area: area.area,
        initial: discoverArtistInitial(),
        limit: DISCOVER_PAGE_LIMIT,
        offset
      });
      return {
        items,
        hasMore: items.length >= DISCOVER_PAGE_LIMIT
      };
    },
    {
      pageSize: DISCOVER_PAGE_LIMIT,
      onError: (error) => console.warn("[NeteasePage] discover artists fetch failed", error)
    }
  );

  const mvCards = createPagedDiscoverCards(
    async ({ offset }) => {
      const payload = await mvAll({
        area: selectedMvArea().value,
        type: selectedMvType().value,
        order: selectedMvOrder().value,
        limit: DISCOVER_PAGE_LIMIT,
        offset
      });
      const items = parseNcmMvAllCards(payload);
      return {
        items,
        hasMore: items.length >= DISCOVER_PAGE_LIMIT
      };
    },
    {
      pageSize: DISCOVER_PAGE_LIMIT,
      onError: (error) => console.warn("[NeteasePage] discover MVs fetch failed", error)
    }
  );

  const shouldShowPlaylistCards = () => discoverTab() === "playlists";
  const shouldShowAlbumCards = () => discoverTab() === "new" && discoverNewKind() === "albums";
  const shouldShowArtistCards = () => discoverTab() === "artists";
  const shouldShowMvCards = () => discoverTab() === "mvs";

  createEffect(() => {
    if (shouldShowPlaylistCards()) void playlistCards.ensureLoaded();
    if (shouldShowAlbumCards()) void albumCards.ensureLoaded();
    if (shouldShowArtistCards()) void artistCards.ensureLoaded();
    if (shouldShowMvCards()) void mvCards.ensureLoaded();
  });

  createEffect(on(
    () => [catName(), discoverPlaylistKind()] as const,
    () => { void playlistCards.reset(); },
    { defer: true }
  ));

  createEffect(on(
    () => selectedNewArea().albumArea,
    () => {
      if (!albumCards.hasLoaded() && !shouldShowAlbumCards()) return;
      void albumCards.reset();
    },
    { defer: true }
  ));

  createEffect(on(
    () => [discoverArtistInitial(), selectedArtistArea().type, selectedArtistArea().area] as const,
    () => {
      if (!artistCards.hasLoaded() && !shouldShowArtistCards()) return;
      void artistCards.reset();
    },
    { defer: true }
  ));

  createEffect(on(
    () => [selectedMvArea().value, selectedMvType().value, selectedMvOrder().value] as const,
    () => {
      if (!mvCards.hasLoaded() && !shouldShowMvCards()) return;
      void mvCards.reset();
    },
    { defer: true }
  ));

  const [discoverToplists] = createResource(() =>
    safeLoadDiscover(() => api.listNcmDiscoverToplists(), [])
  );
  const [discoverSongs] = createResource(
    () => selectedNewArea().songType,
    (type) => safeLoadDiscover(() => api.listNcmDiscoverSongs({ type }), [])
  );

  const hasSearchResults = () =>
    songResults().length > 0 ||
    playlistResults().length > 0 ||
    artistResults().length > 0 ||
    albumResults().length > 0 ||
    videoResults().length > 0 ||
    radioResults().length > 0;
  const shouldShowDiscoverResults = () => isSearching() || hasSearchResults();

  const runSearch = async () => {
    const query = props.globalQuery().trim();
    if (!query) {
      props.setFeedback("error", t("ncm.error.emptySearch"));
      return;
    }
    setIsSearching(true);
    detailNav.clearAllDetailViews();
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);
    setAlbumResults([]);
    setVideoResults([]);
    setRadioResults([]);
    try {
      const [songs, playlists, artists, albums, videos, radios] = await Promise.all([
        api.searchNcmTracks({ keywords: query, limit: DISCOVER_SEARCH_LIMIT }),
        api.searchNcmPlaylists({ keywords: query, limit: DISCOVER_SEARCH_LIMIT }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.artists }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.albums }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.videos }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.radios })
      ]);
      setSongResults(songs);
      setPlaylistResults(playlists);
      setArtistResults(parseNcmSearchArtists(artists));
      setAlbumResults(parseNcmSearchAlbums(albums));
      setVideoResults(parseNcmSearchVideos(videos));
      setRadioResults(parseNcmSearchRadios(radios));
    } catch (error) {
      props.setFeedback("error", readErrorMessage(error));
    } finally {
      setIsSearching(false);
    }
  };

  onMount(async () => {
    if (props.pendingDiscoverSearch() && props.globalQuery().trim()) {
      props.clearPendingDiscoverSearch();
      void runSearch();
    }
    try {
      const categories = await api.getNcmDiscoverPlaylistCategories();
      setCatTypes(categories.categories);
      setCatEntries(categories.entries);
      setHqCatNames(new Set(categories.hqNames));
    } catch (error) {
      console.warn("[DiscoverMode] failed to fetch playlist categories", error);
      props.setFeedback("error", readErrorMessage(error));
    }
  });

  createEffect(
    on(props.submitNonce, () => {
      if (!props.globalQuery().trim()) return;
      void runSearch();
    })
  );

  createEffect(
    on(
      () => props.discoverTabRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const tab = props.discoverTabRequest?.tab;
        if (isSplayerDiscoverTab(tab)) {
          setDiscoverTab(tab);
        } else if (tab) {
          setDiscoverTab("playlists");
        }
      }
    )
  );

  createEffect(
    on(
      () => props.artistDetailRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const artist = props.artistDetailRequest?.artist;
        if (!artist) return;
        setDiscoverTab("artists");
        void detailNav.loadArtistTracks(artist);
      }
    )
  );

  createEffect(
    on(
      () => props.albumDetailRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const album = props.albumDetailRequest?.album;
        if (!album) return;
        setDiscoverTab("new");
        setDiscoverNewKind("albums");
        void detailNav.loadAlbumTracks(album);
      }
    )
  );

  const discoverTabs = createMemo(() => [
    { value: "playlists", label: t("ncm.discover.tab.playlists") },
    { value: "toplists", label: t("ncm.discover.tab.toplists") },
    { value: "artists", label: t("ncm.discover.tab.artists") },
    { value: "new", label: t("ncm.discover.tab.new") }
  ]);
  const discoverSectionTitle = createMemo(() => {
    const tab = discoverTab();
    switch (tab) {
      case "playlists": return t("ncm.discover.section.playlists");
      case "toplists": return t("ncm.discover.section.toplists");
      case "artists": return t("ncm.discover.section.artists");
      case "new": return t("ncm.discover.section.new");
      case "mvs": return t("ncm.discover.section.mvs");
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  });
  const discoverSectionSubtitle = createMemo(() => {
    const tab = discoverTab();
    switch (tab) {
      case "playlists": return t("ncm.discover.subtitle.playlists");
      case "toplists": return t("ncm.discover.subtitle.toplists");
      case "artists": return t("ncm.discover.subtitle.artists");
      case "new": return t("ncm.discover.subtitle.new");
      case "mvs": return t("ncm.discover.subtitle.mvs");
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  });

  const hasHqPlaylist = createMemo(() => {
    if (hqCatNames().size === 0) return false;
    if (catName() === ALL_PLAYLIST_CATEGORY) return true;
    return hqCatNames().has(catName());
  });

  const detailView = createMemo<DiscoverDetailView>(() => {
    if (detailNav.selectedDailySongs()) return { kind: "daily" };
    if (detailNav.selectedLikedSongs()) return { kind: "liked" };
    if (detailNav.selectedAlbum()) return { kind: "album" };
    if (detailNav.selectedArtist()) return { kind: "artist" };
    if (detailNav.selectedVideo()) return { kind: "video" };
    if (detailNav.selectedPlaylist()) return { kind: "playlist" };
    return { kind: "browse" };
  });
  const hasDetailView = createMemo<boolean>(() => detailView().kind !== "browse");

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  const catTypesList = createMemo(() => {
    const types = catTypes();
    return Object.entries(types).map(([key, label]) => ({ key: Number(key), label }));
  });
  const selectedCatTypeKey = createMemo(() => {
    const selected = catEntries().find((cat) => cat.name === catName());
    return selected?.category ?? catTypesList()[0]?.key ?? null;
  });
  const activeCatTypeKey = createMemo(() => {
    const selected = catModalType();
    const available = catTypesList();
    if (selected !== null && available.some((typeItem) => typeItem.key === selected)) {
      return selected;
    }
    return available[0]?.key ?? null;
  });
  const activeCatEntries = createMemo(() => {
    const activeType = activeCatTypeKey();
    if (activeType === null) return [];
    return catEntries().filter((cat) => cat.category === activeType);
  });

  const pageTitle = () => t("ncm.title.discover");
  const setDiscoverTabAndPersist = (tab: DiscoverTab) => {
    setDiscoverTab(tab);
    props.onDiscoverTabChange?.(tab);
  };
  const closeCatModal = () => {
    setCatModalOpen(false);
    queueMicrotask(() => catButtonRef?.focus());
  };

  createEffect(() => {
    if (!catModalOpen()) return;
    setCatModalType(selectedCatTypeKey());

    queueMicrotask(() => {
      const activeTag = catModalRef?.querySelector<HTMLButtonElement>(".cat-modal-tag.is-active");
      const firstButton = catModalRef?.querySelector<HTMLButtonElement>("button");
      (activeTag ?? firstButton)?.focus();
    });

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCatModal();
    };

    window.addEventListener("keydown", handleKey);
    onCleanup(() => window.removeEventListener("keydown", handleKey));
  });

  return (
    <>
      <Show when={!detailNav.selectedPlaylist()}>
        <PageHeader
          title={pageTitle()}
          tabs={
            <SegmentedTabs
              value={discoverTab()}
              onChange={(next) => setDiscoverTabAndPersist(next as DiscoverTab)}
              items={discoverTabs()}
              ariaLabel={t("ncm.discover.tabs.aria")}
            />
          }
        />
      </Show>
      <Show when={catModalPresence.rendered() && typeof document !== "undefined"}>
        <Portal mount={document.body}>
          <div
            class={`cat-modal-overlay${catModalPresence.visible() && !catModalPresence.closing() ? " is-open" : ""}${catModalPresence.closing() ? " is-closing" : ""}`}
            onClick={() => {
              if (catModalOpen()) closeCatModal();
            }}
          >
            <div
              ref={(element) => {
                catModalRef = element;
              }}
              class="cat-modal"
              role="dialog"
              aria-modal="true"
              aria-label={t("ncm.discover.cat.title")}
              onClick={(e) => e.stopPropagation()}
            >
              <div class="cat-modal-header">
                <strong>{t("ncm.discover.cat.title")}</strong>
                <button
                  type="button"
                  class={`cat-modal-tag${catName() === ALL_PLAYLIST_CATEGORY ? " is-active" : ""}`}
                  onClick={() => { setCatName(ALL_PLAYLIST_CATEGORY); closeCatModal(); }}
                >
                  {t("ncm.discover.cat.all")}
                </button>
                <button type="button" class="cat-modal-close" aria-label={t("window.aria.close")} onClick={closeCatModal}>
                  <IconClose />
                </button>
              </div>
              <div class="cat-modal-tabs">
                <div class="cat-modal-tab-rail" role="tablist" aria-label={t("ncm.discover.cat.title")}>
                  <For each={catTypesList()}>
                    {(typeItem) => (
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeCatTypeKey() === typeItem.key}
                        class={`cat-modal-tab${activeCatTypeKey() === typeItem.key ? " is-active" : ""}`}
                        onClick={() => setCatModalType(typeItem.key)}
                      >
                        {typeItem.label}
                      </button>
                    )}
                  </For>
                </div>
                <div class="cat-modal-pane" role="tabpanel">
                  <div class="cat-modal-tags">
                    <For each={activeCatEntries()}>
                      {(cat) => (
                        <button
                          type="button"
                          class={`cat-modal-tag${catName() === cat.name ? " is-active" : ""}`}
                          onClick={() => { setCatName(cat.name); closeCatModal(); }}
                        >
                          {cat.hot ? <span class="cat-modal-hot" aria-hidden="true" /> : null}
                          {cat.name}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      </Show>

      <Switch>
        <Match when={detailView().kind === "daily"}>
          <DailySongsDetail
            loginProfile={props.loginProfile()}
            tracks={detailNav.dailySongsState()}
            updatedAt={detailNav.dailySongsUpdatedAt()}
            isLoading={detailNav.isLoadingDailySongs()}
            onBack={detailNav.exitDailySongs}
            onRefresh={detailNav.refreshDailySongs}
            onPlayAll={detailNav.playAllDailySongs}
            onDislike={detailNav.dislikeDailySong}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            setFeedback={props.setFeedback}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailView().kind === "liked"}>
          <Show
            when={detailNav.selectedPlaylist()}
            fallback={<NaiveP class="panel-note">{detailNav.isLoadingLikedSongs() ? t("ncm.playlist.loading") : t("ncm.liked.empty")}</NaiveP>}
          >
            <OnlineLikedPlaylistDetailRoute
              detailNav={detailNav}
              loginProfile={props.loginProfile()}
              setFeedback={props.setFeedback}
              playback={props.playback}
              currentTrackPath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlaying={props.isPlaying}
              onNavigateToSongWiki={props.onNavigateToSongWiki}
            />
          </Show>
        </Match>
        <Match when={detailView().kind === "album"}>
          <AlbumDetail
            album={detailNav.selectedAlbum()}
            detail={detailNav.albumDetailInfo()}
            tracks={detailNav.albumTracksState()}
            isLoading={detailNav.isLoadingAlbumTracks()}
            isLoadingDetail={detailNav.isLoadingAlbumDetail()}
            isTogglingSubscribe={detailNav.isTogglingAlbumSubscribe()}
            onToggleSubscribe={detailNav.toggleAlbumSubscribe}
            onBack={detailNav.exitAlbum}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailView().kind === "artist"}>
          <ArtistDetail
            artist={detailNav.selectedArtist()}
            detail={detailNav.artistDetailInfo()}
            tracks={detailNav.artistTracksState()}
            isLoading={detailNav.isLoadingArtistTracks()}
            trackOrder={detailNav.artistTrackOrder()}
            hasMoreTracks={detailNav.artistTracksHasMore()}
            isLoadingDetail={detailNav.isLoadingArtistDetail()}
            isTogglingSubscribe={detailNav.isTogglingArtistSubscribe()}
            albums={detailNav.artistAlbumsState()}
            videos={detailNav.artistVideosState()}
            isLoadingAlbums={detailNav.isLoadingArtistAlbums()}
            isLoadingVideos={detailNav.isLoadingArtistVideos()}
            hasMoreAlbums={detailNav.artistAlbumsHasMore()}
            hasMoreVideos={detailNav.artistVideosHasMore()}
            onLoadAlbums={() => detailNav.loadArtistAlbums()}
            onLoadVideos={() => detailNav.loadArtistVideos()}
            onChangeTrackOrder={(order) => detailNav.changeArtistTrackOrder(order)}
            onLoadMoreTracks={() => detailNav.loadArtistTrackPage({ append: true })}
            onLoadMoreAlbums={() => detailNav.loadArtistAlbums({ append: true })}
            onLoadMoreVideos={() => detailNav.loadArtistVideos({ append: true })}
            onSelectAlbum={(album) => void detailNav.loadAlbumTracks(album)}
            onSelectVideo={(video) => detailNav.enterVideo(video)}
            onToggleSubscribe={detailNav.toggleArtistSubscribe}
            onBack={detailNav.exitArtist}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
          />
        </Match>
        <Match when={detailView().kind === "video"}>
          <VideoDetail
            video={detailNav.selectedVideo()}
            onBack={detailNav.exitVideo}
            onPauseAudio={props.onPause}
            onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
          />
        </Match>
        <Match when={detailView().kind === "playlist"}>
          <OnlinePlaylistDetailRoute
            detailNav={detailNav}
            subtitleText={pageTitle()}
            loginProfile={props.loginProfile()}
            setFeedback={props.setFeedback}
            playback={props.playback}
            currentTrackPath={props.currentTrackPath}
            currentSongId={props.currentSongId}
            isPlaying={props.isPlaying}
            onNavigateToSongWiki={props.onNavigateToSongWiki}
          />
        </Match>
        <Match when={detailView().kind === "browse"}>
          <div class="online-discover-view">
            <Show when={discoverTab() === "playlists"}>
              <DiscoverPlaylistShowcase
                catName={catName()}
                hasHqPlaylist={hasHqPlaylist()}
                discoverPlaylistKind={discoverPlaylistKind()}
                setDiscoverPlaylistKind={setDiscoverPlaylistKind}
                setCatModalOpen={setCatModalOpen}
                setCatButtonRef={(element) => {
                  catButtonRef = element;
                }}
                discoverSectionTitle={discoverSectionTitle()}
                discoverSectionSubtitle={discoverSectionSubtitle()}
                allPlaylists={playlistCards.items()}
                isLoadingPlaylists={playlistCards.isLoading()}
                hasMorePlaylists={playlistCards.hasMore()}
                onLoadPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
                onLoadMore={() => { void playlistCards.loadMore(); }}
              />
            </Show>
            <Show when={discoverTab() === "toplists"}>
              <DiscoverToplistShowcase
                discoverToplists={discoverToplists}
                onLoadPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
              />
            </Show>
            <Show when={discoverTab() === "artists"}>
              <DiscoverArtistShowcase
                artistInitials={DISCOVER_ARTIST_INITIALS}
                artistAreas={DISCOVER_ARTIST_AREAS}
                discoverArtistInitial={discoverArtistInitial()}
                setDiscoverArtistInitial={setDiscoverArtistInitial}
                discoverArtistAreaIndex={discoverArtistAreaIndex()}
                setDiscoverArtistAreaIndex={setDiscoverArtistAreaIndex}
                discoverSectionTitle={discoverSectionTitle()}
                discoverSectionSubtitle={discoverSectionSubtitle()}
                allArtists={artistCards.items()}
                isLoadingArtists={artistCards.isLoading()}
                hasMoreArtists={artistCards.hasMore()}
                onLoadArtist={(artist) => void detailNav.loadArtistTracks(toFeedCardItem(artist))}
                onLoadMore={() => { void artistCards.loadMore(); }}
              />
            </Show>
            <Show when={discoverTab() === "new"}>
              <DiscoverNewShowcase
                newAreas={DISCOVER_NEW_AREAS}
                discoverNewKind={discoverNewKind()}
                setDiscoverNewKind={setDiscoverNewKind}
                discoverNewAreaIndex={discoverNewAreaIndex()}
                setDiscoverNewAreaIndex={setDiscoverNewAreaIndex}
                discoverSectionTitle={discoverSectionTitle()}
                discoverSectionSubtitle={discoverSectionSubtitle()}
                allAlbums={albumCards.items()}
                discoverSongs={discoverSongs}
                isLoadingAlbums={albumCards.isLoading()}
                hasMoreAlbums={albumCards.hasMore()}
                onLoadMoreAlbums={() => { void albumCards.loadMore(); }}
                onLoadAlbum={(album) => void detailNav.loadAlbumTracks(toFeedCardItem(album))}
                playback={props.playback}
                currentTrackPath={props.currentTrackPath}
                currentSongId={props.currentSongId}
                isPlaying={props.isPlaying}
              />
            </Show>
            <Show when={discoverTab() === "mvs"}>
              <DiscoverMvShowcase
                mvAreas={DISCOVER_MV_AREAS}
                mvTypes={DISCOVER_MV_TYPES}
                mvOrders={DISCOVER_MV_ORDERS}
                discoverMvAreaIndex={discoverMvAreaIndex()}
                setDiscoverMvAreaIndex={setDiscoverMvAreaIndex}
                discoverMvTypeIndex={discoverMvTypeIndex()}
                setDiscoverMvTypeIndex={setDiscoverMvTypeIndex}
                discoverMvOrderIndex={discoverMvOrderIndex()}
                setDiscoverMvOrderIndex={setDiscoverMvOrderIndex}
                discoverSectionTitle={discoverSectionTitle()}
                discoverSectionSubtitle={discoverSectionSubtitle()}
                allVideos={mvCards.items().map(toFeedCardItem)}
                isLoadingVideos={mvCards.isLoading()}
                hasMoreVideos={mvCards.hasMore()}
                onLoadVideo={(video) => detailNav.enterVideo(video)}
                onLoadMore={() => { void mvCards.loadMore(); }}
              />
            </Show>
            <Show when={shouldShowDiscoverResults()}>
              <SearchMode
                searchTab={searchTab()}
                onSearchTabChange={setSearchTab}
                isSearching={isSearching()}
                songResults={songResults()}
                playlistResults={playlistResults()}
                artistResults={artistResults()}
                albumResults={albumResults()}
                videoResults={videoResults()}
                radioResults={radioResults()}
                globalQuery={props.globalQuery}
                parentMode="discover"
                onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
                onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
                onSelectAlbum={(album) => void detailNav.loadAlbumTracks(album)}
                onSelectVideo={(video) => detailNav.enterVideo(video)}
                onSelectRadio={(radio) => props.onNavigateToRadioDetail?.(radio)}
                onNavigateToSongWiki={props.onNavigateToSongWiki}
                discoverSectionSubtitle={discoverSectionSubtitle()}
                playback={props.playback}
                currentTrackPath={props.currentTrackPath}
                currentSongId={props.currentSongId}
                isPlaying={props.isPlaying}
              />
            </Show>
          </div>
        </Match>
      </Switch>
    </>
  );
}
