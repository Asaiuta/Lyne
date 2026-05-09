import { For, Show, createEffect, createMemo, createResource, createSignal, on, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { PageHeader } from "../../../components/page/PageHeader";
import { SegmentedTabs } from "../../../components/page/SegmentedTabs";
import { useTranslation } from "../../../shared/i18n";
import {
  albumNew,
  artistList,
  playlistCatlist,
  search,
  topPlaylist,
  topPlaylistHighquality,
  topSong,
  toplistDetail
} from "../../../shared/api/ncm";
import { readSearchPlaylists, type OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { DailySongsDetail } from "../details/DailySongsDetail";
import { LikedSongsDetail } from "../details/LikedSongsDetail";
import { PlaylistDetail } from "../details/PlaylistDetail";
import {
  asArray,
  asRecord,
  readDiscoverAlbums,
  readDiscoverArtists,
  readDiscoverPlaylists,
  readDiscoverToplists,
  readNumber,
  readPersonalizedSongs,
  readSearchTracks,
  readString,
  safeDiscoverFetch
} from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import type {
  DiscoverArtistArea,
  DiscoverArtistInitial,
  DiscoverCardItem,
  DiscoverNewArea,
  DiscoverNewKind,
  DiscoverPlaylistKind,
  DiscoverTab,
  Feedback,
  NcmProfile,
  OnlineTrackItem,
  SearchTab
} from "../shared/types";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import {
  DiscoverArtistShowcase,
  DiscoverNewShowcase,
  DiscoverPlaylistShowcase,
  DiscoverToplistShowcase
} from "./discoverShowcases";
import { SearchMode } from "./SearchMode";

const SEARCH_LIMIT = 30;
const DISCOVER_PAGE_LIMIT = 50;

const ARTIST_INITIALS: readonly DiscoverArtistInitial[] = [
  { key: -1, label: "ncm.discover.artists.hot" },
  ...Array.from({ length: 26 }, (_, index) => {
    const letter = String.fromCharCode(index + 65);
    return { key: letter, label: letter };
  }),
  { key: 0, label: "#" }
];

const ARTIST_AREAS: readonly DiscoverArtistArea[] = [
  { labelKey: "common.all", type: -1, area: -1 },
  { labelKey: "ncm.discover.artists.cn", type: -1, area: 7 },
  { labelKey: "ncm.discover.artists.cnMale", type: 1, area: 7 },
  { labelKey: "ncm.discover.artists.cnFemale", type: 2, area: 7 },
  { labelKey: "ncm.discover.artists.cnGroup", type: 3, area: 7 },
  { labelKey: "ncm.discover.artists.western", type: -1, area: 96 },
  { labelKey: "ncm.discover.artists.westernMale", type: 1, area: 96 },
  { labelKey: "ncm.discover.artists.westernFemale", type: 2, area: 96 },
  { labelKey: "ncm.discover.artists.westernGroup", type: 3, area: 96 },
  { labelKey: "ncm.discover.artists.jp", type: -1, area: 8 },
  { labelKey: "ncm.discover.artists.jpMale", type: 1, area: 8 },
  { labelKey: "ncm.discover.artists.jpFemale", type: 2, area: 8 },
  { labelKey: "ncm.discover.artists.jpGroup", type: 3, area: 8 },
  { labelKey: "ncm.discover.artists.kr", type: -1, area: 16 },
  { labelKey: "ncm.discover.artists.krMale", type: 1, area: 16 },
  { labelKey: "ncm.discover.artists.krFemale", type: 2, area: 16 },
  { labelKey: "ncm.discover.artists.krGroup", type: 3, area: 16 },
  { labelKey: "ncm.discover.artists.other", type: -1, area: 0 }
];

const NEW_AREAS: readonly DiscoverNewArea[] = [
  { labelKey: "common.all", albumArea: "ALL", songType: 0 },
  { labelKey: "ncm.discover.artists.cn", albumArea: "ZH", songType: 7 },
  { labelKey: "ncm.discover.artists.western", albumArea: "EA", songType: 96 },
  { labelKey: "ncm.discover.artists.kr", albumArea: "KR", songType: 16 },
  { labelKey: "ncm.discover.artists.jp", albumArea: "JP", songType: 8 }
];

interface CatEntry { name: string; category: number; hot: boolean }

export interface DiscoverModeProps {
  loginProfile: Accessor<NcmProfile | null>;
  globalQuery: Accessor<string>;
  submitNonce: Accessor<number>;
  pendingDiscoverSearch: Accessor<boolean>;
  clearPendingDiscoverSearch: () => void;
  discoverTabRequest?: { tab: string; version: number };
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: (tone: Feedback["tone"], message: string) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function DiscoverMode(props: DiscoverModeProps) {
  const { t } = useTranslation();

  const [searchTab] = createSignal<SearchTab>("songs");
  const [discoverTab, setDiscoverTab] = createSignal<DiscoverTab>("playlists");
  const [isSearching, setIsSearching] = createSignal(false);
  const [songResults, setSongResults] = createSignal<OnlineTrackItem[]>([]);
  const [playlistResults, setPlaylistResults] = createSignal<OnlinePlaylistSummary[]>([]);

  const [discoverPlaylistKind, setDiscoverPlaylistKind] = createSignal<DiscoverPlaylistKind>("normal");
  const [discoverArtistInitial, setDiscoverArtistInitial] = createSignal<number | string>(-1);
  const [discoverArtistAreaIndex, setDiscoverArtistAreaIndex] = createSignal<number>(0);
  const [discoverNewKind, setDiscoverNewKind] = createSignal<DiscoverNewKind>("albums");
  const [discoverNewAreaIndex, setDiscoverNewAreaIndex] = createSignal<number>(0);

  const [catName, setCatName] = createSignal("全部歌单");
  const [catModalOpen, setCatModalOpen] = createSignal(false);
  const [catTypes, setCatTypes] = createSignal<Record<number, string>>({});
  const [catEntries, setCatEntries] = createSignal<CatEntry[]>([]);
  const [hqCatNames, setHqCatNames] = createSignal<Set<string>>(new Set());

  const [playlistOffset, setPlaylistOffset] = createSignal(0);
  const [allPlaylists, setAllPlaylists] = createSignal<DiscoverCardItem[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = createSignal(false);
  const [hasMorePlaylists, setHasMorePlaylists] = createSignal(true);

  const [albumOffset, setAlbumOffset] = createSignal(0);
  const [allAlbums, setAllAlbums] = createSignal<DiscoverCardItem[]>([]);
  const [isLoadingAlbums, setIsLoadingAlbums] = createSignal(false);
  const [hasMoreAlbums, setHasMoreAlbums] = createSignal(true);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange
  });

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const fetchPlaylists = async (reset = false) => {
    const offset = reset ? 0 : playlistOffset();
    setIsLoadingPlaylists(true);
    try {
      const kind = discoverPlaylistKind();
      const cat = catName();
      const raw = await safeDiscoverFetch(
        () =>
          kind === "hq"
            ? topPlaylistHighquality({ cat, limit: DISCOVER_PAGE_LIMIT, before: offset > 0 ? allPlaylists()[allPlaylists().length - 1]?.id : undefined })
            : topPlaylist({ cat, order: "hot", limit: DISCOVER_PAGE_LIMIT, offset }),
        readDiscoverPlaylists
      );
      if (reset) {
        setAllPlaylists(raw);
        setPlaylistOffset(0);
      } else {
        setAllPlaylists((prev) => [...prev, ...raw]);
      }
      setHasMorePlaylists(raw.length >= DISCOVER_PAGE_LIMIT);
    } catch {
      if (reset) setAllPlaylists([]);
    } finally {
      setIsLoadingPlaylists(false);
    }
  };

  const fetchAlbums = async (reset = false) => {
    const offset = reset ? 0 : albumOffset();
    setIsLoadingAlbums(true);
    try {
      const area = selectedNewArea().albumArea;
      const raw = await safeDiscoverFetch(
        () => albumNew({ area, limit: DISCOVER_PAGE_LIMIT, offset }),
        readDiscoverAlbums
      );
      if (reset) {
        setAllAlbums(raw);
        setAlbumOffset(0);
      } else {
        setAllAlbums((prev) => [...prev, ...raw]);
      }
      setHasMoreAlbums(raw.length >= DISCOVER_PAGE_LIMIT);
    } catch {
      if (reset) setAllAlbums([]);
    } finally {
      setIsLoadingAlbums(false);
    }
  };

  createEffect(on(
    () => [catName(), discoverPlaylistKind()] as const,
    () => { setPlaylistOffset(0); void fetchPlaylists(true); },
    { defer: true }
  ));

  createEffect(on(
    () => selectedNewArea().albumArea,
    () => { setAlbumOffset(0); void fetchAlbums(true); },
    { defer: true }
  ));

  const [discoverToplists] = createResource(() =>
    safeDiscoverFetch(() => toplistDetail(), readDiscoverToplists)
  );
  const selectedArtistArea = createMemo(() => ARTIST_AREAS[discoverArtistAreaIndex()] ?? ARTIST_AREAS[0]);
  const [discoverArtists] = createResource(
    () => ({
      initial: discoverArtistInitial(),
      type: selectedArtistArea().type,
      area: selectedArtistArea().area
    }),
    (query) =>
      safeDiscoverFetch(
        () =>
          artistList({
            type: query.type,
            area: query.area,
            initial: query.initial,
            limit: DISCOVER_PAGE_LIMIT,
            offset: 0
          }),
        readDiscoverArtists
      )
  );
  const selectedNewArea = createMemo(() => NEW_AREAS[discoverNewAreaIndex()] ?? NEW_AREAS[0]);
  const [discoverSongs] = createResource(
    () => selectedNewArea().songType,
    (type) => safeDiscoverFetch(() => topSong({ type }), readPersonalizedSongs)
  );

  const hasSearchResults = () => songResults().length > 0 || playlistResults().length > 0;
  const shouldShowDiscoverResults = () => isSearching() || hasSearchResults();

  const runSearch = async () => {
    const query = props.globalQuery().trim();
    if (!query) {
      props.setFeedback("error", t("ncm.error.emptySearch"));
      return;
    }
    setIsSearching(true);
    detailNav.setSelectedPlaylist(null);
    detailNav.setPlaylistTracksState([]);
    try {
      const response = await search({
        keywords: query,
        type: searchTab() === "songs" ? 1 : 1000,
        limit: SEARCH_LIMIT
      });
      if (searchTab() === "songs") {
        setSongResults(readSearchTracks(response));
        setPlaylistResults([]);
      } else {
        const playlists = readSearchPlaylists(response);
        setPlaylistResults(playlists);
        setSongResults([]);
        if (playlists.length > 0) {
          void detailNav.loadPlaylistTracks(playlists[0]);
        }
      }
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
      const [catsRes, hqRes] = await Promise.all([playlistCatlist(), playlistCatlist(true)]);
      setCatTypes(asRecord(catsRes)?.categories as Record<number, string> ?? {});
      setCatEntries(
        asArray(asRecord(catsRes)?.sub).map((s: unknown) => {
          const item = asRecord(s);
          return { name: readString(item?.name) ?? "", category: readNumber(item?.category) ?? 0, hot: !!item?.hot };
        }).filter((e) => e.name !== "")
      );
      setHqCatNames(new Set(asArray(asRecord(hqRes)?.tags).map((t: unknown) => readString(asRecord(t)?.name)).filter((n): n is string => Boolean(n))));
    } catch {}
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
        if (tab) {
          setDiscoverTab(tab as DiscoverTab);
        }
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
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  });

  const hasHqPlaylist = createMemo(() => {
    if (hqCatNames().size === 0) return false;
    if (catName() === "全部歌单") return true;
    return hqCatNames().has(catName());
  });

  const catTypesList = createMemo(() => {
    const types = catTypes();
    return Object.entries(types).map(([key, label]) => ({ key: Number(key), label }));
  });


  const pageTitle = () => t("ncm.title.discover");

  return (
    <>
      <Show when={!detailNav.selectedPlaylist()}>
        <PageHeader
          title={pageTitle()}
          tabs={
            <SegmentedTabs
              value={discoverTab()}
              onChange={(next) => setDiscoverTab(next as DiscoverTab)}
              items={discoverTabs()}
              ariaLabel={t("ncm.discover.tabs.aria")}
            />
          }
        />
      </Show>
      <Show when={catModalOpen()}>
        <div class="cat-modal-overlay" onClick={() => setCatModalOpen(false)}>
          <div class="cat-modal" onClick={(e) => e.stopPropagation()}>
            <div class="cat-modal-header">
              <strong>{t("ncm.discover.cat.title")}</strong>
              <button
                type="button"
                class={`cat-modal-tag${catName() === "全部歌单" ? " is-active" : ""}`}
                onClick={() => { setCatName("全部歌单"); setCatModalOpen(false); }}
              >
                {t("ncm.discover.cat.all")}
              </button>
            </div>
            <div class="cat-modal-tabs">
              <For each={catTypesList()}>
                {(typeItem) => (
                  <div class="cat-modal-group">
                    <div class="cat-modal-group-label">{typeItem.label}</div>
                    <div class="cat-modal-tags">
                      <For each={catEntries().filter((c) => c.category === typeItem.key)}>
                        {(cat) => (
                          <button
                            type="button"
                            class={`cat-modal-tag${catName() === cat.name ? " is-active" : ""}`}
                            onClick={() => { setCatName(cat.name); setCatModalOpen(false); }}
                          >
                            {cat.hot ? <span class="cat-modal-hot" aria-hidden="true" /> : null}
                            {cat.name}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      <Show
        when={detailNav.selectedDailySongs()}
        fallback={
          <Show
            when={detailNav.selectedLikedSongs()}
            fallback={
              <Show
                when={detailNav.selectedAlbum()}
                fallback={
                  <Show
                    when={detailNav.selectedArtist()}
                    fallback={
                      <Show
                        when={detailNav.selectedPlaylist()}
                        fallback={
                          <div class="online-discover-view">
                            <Show when={discoverTab() === "playlists"}>
                              <DiscoverPlaylistShowcase
                                catName={catName()}
                                hasHqPlaylist={hasHqPlaylist()}
                                discoverPlaylistKind={discoverPlaylistKind()}
                                setDiscoverPlaylistKind={setDiscoverPlaylistKind}
                                setCatModalOpen={setCatModalOpen}
                                discoverSectionTitle={discoverSectionTitle()}
                                discoverSectionSubtitle={discoverSectionSubtitle()}
                                allPlaylists={allPlaylists()}
                                isLoadingPlaylists={isLoadingPlaylists()}
                                hasMorePlaylists={hasMorePlaylists()}
                                onLoadPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
                                onLoadMore={() => { setPlaylistOffset((o) => o + DISCOVER_PAGE_LIMIT); void fetchPlaylists(false); }}
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
                                artistInitials={ARTIST_INITIALS}
                                artistAreas={ARTIST_AREAS}
                                discoverArtistInitial={discoverArtistInitial()}
                                setDiscoverArtistInitial={setDiscoverArtistInitial}
                                discoverArtistAreaIndex={discoverArtistAreaIndex()}
                                setDiscoverArtistAreaIndex={setDiscoverArtistAreaIndex}
                                discoverSectionTitle={discoverSectionTitle()}
                                discoverSectionSubtitle={discoverSectionSubtitle()}
                                discoverArtists={discoverArtists}
                              />
                            </Show>
                            <Show when={discoverTab() === "new"}>
                              <DiscoverNewShowcase
                                newAreas={NEW_AREAS}
                                discoverNewKind={discoverNewKind()}
                                setDiscoverNewKind={setDiscoverNewKind}
                                discoverNewAreaIndex={discoverNewAreaIndex()}
                                setDiscoverNewAreaIndex={setDiscoverNewAreaIndex}
                                discoverSectionTitle={discoverSectionTitle()}
                                discoverSectionSubtitle={discoverSectionSubtitle()}
                                allAlbums={allAlbums()}
                                discoverSongs={discoverSongs}
                                isLoadingAlbums={isLoadingAlbums()}
                                hasMoreAlbums={hasMoreAlbums()}
                                onLoadMoreAlbums={() => { setAlbumOffset((o) => o + DISCOVER_PAGE_LIMIT); void fetchAlbums(false); }}
                                playback={props.playback}
                                currentTrackPath={props.currentTrackPath}
                                currentSongId={props.currentSongId}
                                isPlaying={props.isPlaying}
                              />
                            </Show>
                            <Show when={shouldShowDiscoverResults()}>
                              <SearchMode
                                searchTab={searchTab()}
                                songResults={songResults()}
                                playlistResults={playlistResults()}
                                globalQuery={props.globalQuery}
                                parentMode="discover"
                                selectedPlaylist={detailNav.selectedPlaylist()}
                                playlistTracks={detailNav.playlistTracksState()}
                                isLoadingPlaylistTracks={detailNav.isLoadingPlaylistTracks()}
                                onSelectPlaylist={(playlist) => void detailNav.loadPlaylistTracks(playlist)}
                                discoverSectionSubtitle={discoverSectionSubtitle()}
                                playback={props.playback}
                                currentTrackPath={props.currentTrackPath}
                                currentSongId={props.currentSongId}
                                isPlaying={props.isPlaying}
                              />
                            </Show>
                          </div>
                        }
                      >
                        <PlaylistDetail
                          playlist={detailNav.selectedPlaylist()}
                          tracks={detailNav.filteredPlaylistTracks()}
                          trackCount={detailNav.playlistTrackCount()}
                          metaText={detailNav.playlistMetaText()}
                          subtitleText={pageTitle()}
                          isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
                          isScrolled={detailNav.isPlaylistDetailScrolled()}
                          filter={detailNav.playlistFilter()}
                          detailTab={detailNav.playlistDetailTab()}
                          setFilter={detailNav.setPlaylistFilter}
                          setDetailTab={detailNav.setPlaylistDetailTab}
                          onBack={detailNav.handleBackToPlaylists}
                          onPlayAll={detailNav.playAllPlaylistTracks}
                          onScroll={detailNav.handlePlaylistTrackScroll}
                          playback={props.playback}
                          currentTrackPath={props.currentTrackPath}
                          currentSongId={props.currentSongId}
                          isPlaying={props.isPlaying}
                        />
                      </Show>
                    }
                  >
                    <ArtistDetail
                      artist={detailNav.selectedArtist()}
                      tracks={detailNav.artistTracksState()}
                      isLoading={detailNav.isLoadingArtistTracks()}
                      onBack={detailNav.exitArtist}
                      playback={props.playback}
                      currentTrackPath={props.currentTrackPath}
                      currentSongId={props.currentSongId}
                      isPlaying={props.isPlaying}
                    />
                  </Show>
                }
              >
                <AlbumDetail
                  album={detailNav.selectedAlbum()}
                  tracks={detailNav.albumTracksState()}
                  isLoading={detailNav.isLoadingAlbumTracks()}
                  onBack={detailNav.exitAlbum}
                  playback={props.playback}
                  currentTrackPath={props.currentTrackPath}
                  currentSongId={props.currentSongId}
                  isPlaying={props.isPlaying}
                />
              </Show>
            }
          >
            <LikedSongsDetail
              loginProfile={props.loginProfile()}
              tracks={detailNav.likedSongsState()}
              total={detailNav.likedSongsTotal()}
              isLoading={detailNav.isLoadingLikedSongs()}
              onBack={detailNav.exitLikedSongs}
              playback={props.playback}
              currentTrackPath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlaying={props.isPlaying}
            />
          </Show>
        }
      >
        <DailySongsDetail
          loginProfile={props.loginProfile()}
          tracks={detailNav.dailySongsState()}
          isLoading={detailNav.isLoadingDailySongs()}
          onBack={detailNav.exitDailySongs}
          playback={props.playback}
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
        />
      </Show>
    </>
  );
}
