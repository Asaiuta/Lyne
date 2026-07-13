import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import { IconClose } from "../../../components/icons";
import { PageHeader } from "../../../components/page/PageHeader";
import { useTranslation } from "../../../shared/i18n";
import { createApiClient } from "../../../shared/api/client";
import { usePresenceTransition } from "../../../shared/ui/usePresenceTransition";
import { NaiveP, NaiveTabs, type NaiveTabItem } from "../../../shared/ui/naive";
import { OnlineLikedPlaylistDetailRoute } from "../details/OnlineLikedPlaylistDetailRoute";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import { createErrorMessageReader, type FeedbackSetter } from "../shared/feedback";
import {
  ALL_PLAYLIST_CATEGORY,
  DISCOVER_ARTIST_AREAS,
  DISCOVER_ARTIST_INITIALS,
  DISCOVER_NEW_AREAS,
  DISCOVER_PAGE_LIMIT,
  safeLoadDiscover
} from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import type {
  DiscoverNewKind,
  DiscoverPlaylistKind,
  DiscoverCardItem,
  DiscoverTab,
  FeedCardItem,
  NcmProfile,
  OnlineTrackItem
} from "../shared/types";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";
import { createPagedDiscoverCards } from "../shared/usePagedDiscoverCards";
import {
  DiscoverArtistShowcase,
  DiscoverNewShowcase,
  DiscoverPlaylistShowcase,
  DiscoverToplistShowcase
} from "./discoverShowcases";
import { DISCOVER_TABS, normalizeDiscoverTab } from "../../../shared/ui/navigation";

const api = createApiClient();

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
  | { kind: "liked" }
  | { kind: "browse" };

export interface DiscoverModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  discoverTabRequest?: { tab: string; version: number };
  onDiscoverTabChange?: (tab: DiscoverTab) => void;
  onNavigateToDailySongs?: () => void;
  onNavigateToArtistDetail?: (artist: FeedCardItem) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
  onNavigateToAlbumDetail?: (album: FeedCardItem) => void;
  onNavigateToPlaylistDetail?: (playlist: OnlinePlaylistSummary) => void;
  onNavigateToVideoDetail?: (video: FeedCardItem) => void;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
}

export function DiscoverMode(props: DiscoverModeProps) {
  const { t } = useTranslation();

  const [discoverTab, setDiscoverTab] = createSignal<DiscoverTab>("playlists");

  const [discoverPlaylistKind, setDiscoverPlaylistKind] = createSignal<DiscoverPlaylistKind>("normal");
  const [discoverArtistInitial, setDiscoverArtistInitial] = createSignal<number | string>(-1);
  const [discoverArtistAreaIndex, setDiscoverArtistAreaIndex] = createSignal<number>(0);
  const [discoverNewKind, setDiscoverNewKind] = createSignal<DiscoverNewKind>("albums");
  const [discoverNewAreaIndex, setDiscoverNewAreaIndex] = createSignal<number>(0);

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

  const shouldShowPlaylistCards = () => discoverTab() === "playlists";
  const shouldShowAlbumCards = () => discoverTab() === "new" && discoverNewKind() === "albums";
  const shouldShowArtistCards = () => discoverTab() === "artists";

  createEffect(() => {
    if (shouldShowPlaylistCards()) void playlistCards.ensureLoaded();
    if (shouldShowAlbumCards()) void albumCards.ensureLoaded();
    if (shouldShowArtistCards()) void artistCards.ensureLoaded();
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

  const [discoverToplists] = createResource(() =>
    safeLoadDiscover(() => api.listNcmDiscoverToplists(), [])
  );
  const [discoverSongs] = createResource(
    () => selectedNewArea().songType,
    (type) => safeLoadDiscover(() => api.listNcmDiscoverSongs({ type }), [])
  );

  onMount(async () => {
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
    on(
      () => props.discoverTabRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        setDiscoverTab(normalizeDiscoverTab(props.discoverTabRequest?.tab));
      }
    )
  );

  const discoverTabLabel = (tab: DiscoverTab) => {
    switch (tab) {
      case "playlists": return t("ncm.discover.tab.playlists");
      case "toplists": return t("ncm.discover.tab.toplists");
      case "artists": return t("ncm.discover.tab.artists");
      case "new": return t("ncm.discover.tab.new");
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  };
  const discoverTabs = createMemo<ReadonlyArray<NaiveTabItem<DiscoverTab>>>(() =>
    DISCOVER_TABS.map((tab) => ({ value: tab, label: discoverTabLabel(tab) }))
  );
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

  const hasHqPlaylist = createMemo(() => {
    if (hqCatNames().size === 0) return false;
    if (catName() === ALL_PLAYLIST_CATEGORY) return true;
    return hqCatNames().has(catName());
  });

  const detailView = createMemo<DiscoverDetailView>(() => {
    if (detailNav.selectedLikedSongs()) return { kind: "liked" };
    return { kind: "browse" };
  });
  const hasDetailView = createMemo<boolean>(() => detailView().kind !== "browse");

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  const catTypesList = createMemo(() => {
    const types = catTypes();
    return Object.entries(types).map(([key, label]) => ({ key: Number(key), label }));
  });
  const catTypeTabs = createMemo<ReadonlyArray<NaiveTabItem<string>>>(() =>
    catTypesList().map((typeItem) => ({ value: String(typeItem.key), label: typeItem.label }))
  );
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
  const activeCatTypeValue = createMemo<string>(() => {
    const key = activeCatTypeKey();
    return key === null ? "" : String(key);
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
            <NaiveTabs
              class="discover-primary-tabs"
              value={discoverTab()}
              onChange={(next) => setDiscoverTabAndPersist(next)}
              items={discoverTabs()}
              type="segment"
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
                <NaiveTabs
                  class="cat-modal-tab-rail"
                  value={activeCatTypeValue()}
                  onChange={(next) => setCatModalType(Number(next))}
                  items={catTypeTabs()}
                  type="segment"
                  ariaLabel={t("ncm.discover.cat.title")}
                />
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
              onNavigateToSongWiki={props.onNavigateToSongWiki}
              onNavigateToMv={props.onNavigateToMv}
            />
          </Show>
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
                allPlaylists={playlistCards.items()}
                isLoadingPlaylists={playlistCards.isLoading()}
                hasMorePlaylists={playlistCards.hasMore()}
                onLoadPlaylist={(playlist) => props.onNavigateToPlaylistDetail?.(playlist)}
                onLoadMore={() => { void playlistCards.loadMore(); }}
              />
            </Show>
            <Show when={discoverTab() === "toplists"}>
              <DiscoverToplistShowcase
                discoverToplists={discoverToplists}
                onLoadPlaylist={(playlist) => props.onNavigateToPlaylistDetail?.(playlist)}
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
                allArtists={artistCards.items()}
                isLoadingArtists={artistCards.isLoading()}
                hasMoreArtists={artistCards.hasMore()}
                onLoadArtist={(artist) => props.onNavigateToArtistDetail?.(toFeedCardItem(artist))}
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
                allAlbums={albumCards.items()}
                discoverSongs={discoverSongs}
                isLoadingAlbums={albumCards.isLoading()}
                hasMoreAlbums={albumCards.hasMore()}
                onLoadMoreAlbums={() => { void albumCards.loadMore(); }}
                onLoadAlbum={(album) => props.onNavigateToAlbumDetail?.(toFeedCardItem(album))}
                playback={props.playback}
              />
            </Show>
          </div>
        </Match>
      </Switch>
    </>
  );
}
