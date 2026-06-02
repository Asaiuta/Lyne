import { For, Match, Show, Switch, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import type { Accessor, Component, JSX } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import {
  IconAlbum,
  IconArtist,
  IconHeart,
  IconPlayCircle,
  IconPlaylist,
  IconVolumeHigh
} from "../../../components/icons";
import { SegmentedTabs } from "../../../components/page/SegmentedTabs";
import { createApiClient } from "../../../shared/api/client";
import { isRecord, readArray, readNumber, readString } from "../../../shared/jsonReaders";
import { useTranslation, type TranslationKey } from "../../../shared/i18n";
import {
  userAlbumSublist,
  userArtistSublist,
  userDjSublist,
  userMvSublist,
  readPositiveCount,
  readUserSubcountData,
  userSubcount,
  type NcmCollectionSublistParams,
  type NcmUserSubcountData
} from "../../../shared/api/ncm/user";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveH1, NaiveP } from "../../../shared/ui/naive";
import {
  type OnlinePlaylistSummary,
  type UserPlaylistGroups
} from "../ncmPlaylistSummary";
import {
  applyNcmPlaylistSubscribeCacheUpdate,
  loadNcmUserPlaylistGroupsCached,
  subscribeNcmUserPlaylistGroups
} from "../ncmPlaylistSummaryCache";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { OnlinePlaylistDetailRoute } from "../details/OnlinePlaylistDetailRoute";
import { VideoDetail } from "../details/VideoDetail";
import {
  createErrorMessageReader,
  createLoginStatusText,
  type FeedbackSetter
} from "../shared/feedback";
import type { FeedCardItem, NcmProfile, OnlineTrackItem, RadioSubscribeEvent } from "../shared/types";
import type { PlaybackController } from "../shared/playback";
import { createDetailViewReporter, type OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import { useDetailNavigation } from "../shared/useDetailNavigation";

type CollectionTab = "playlists" | "albums" | "artists" | "videos" | "radios";
type PlaylistScope = "created" | "collected";
type CollectionLoadState = "idle" | "loading" | "loaded" | "error";

interface CollectionStat {
  key: CollectionTab;
  labelKey: TranslationKey;
  count: number;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}

interface LikedCollectionModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onLogout: () => void | Promise<void>;
  tabRequest?: { tab: "playlists" | "albums" | "artists"; version: number };
  onTabChange?: (tab: "playlists" | "albums" | "artists") => void;
  radioSubscribeEvent?: RadioSubscribeEvent | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
}

const api = createApiClient();
const COLLECTION_PAGE_SIZE = 50;
const collectionLoaders = {
  albums: () => loadAllSublist(userAlbumSublist, "data", parseCoverCollectionItem),
  artists: () => loadAllSublist(userArtistSublist, "data", parseArtistCollectionItem),
  videos: () => loadAllSublist(userMvSublist, "data", parseCoverCollectionItem),
  radios: () => loadAllSublist(userDjSublist, "djRadios", parseCoverCollectionItem)
} as const;
const emptyCollectionLoadState = (): Record<CollectionTab, CollectionLoadState> => ({
  playlists: "idle",
  albums: "idle",
  artists: "idle",
  videos: "idle",
  radios: "idle"
});

interface LikedCollectionCache {
  userId: number;
  subcount: NcmUserSubcountData;
  playlists?: UserPlaylistGroups;
  albums?: FeedCardItem[];
  artists?: FeedCardItem[];
  videos?: FeedCardItem[];
  radios?: FeedCardItem[];
}

let likedCollectionCache: LikedCollectionCache | null = null;

const collectionTabs: Array<{ value: CollectionTab; labelKey: TranslationKey }> = [
  { value: "playlists", labelKey: "ncm.collection.tabs.playlists" },
  { value: "albums", labelKey: "ncm.collection.tabs.albums" },
  { value: "artists", labelKey: "ncm.collection.tabs.artists" },
  { value: "videos", labelKey: "ncm.collection.tabs.videos" },
  { value: "radios", labelKey: "ncm.collection.tabs.radios" }
];

const readNestedName = (value: unknown): string | null => {
  if (!isRecord(value)) return null;
  return readString(value.nickname) ?? readString(value.name) ?? readString(value.userName);
};

const readArtists = (value: unknown): string | null => {
  const names = readArray(value)
    .map((item) => (isRecord(item) ? readString(item.name) : null))
    .filter((name): name is string => name !== null);
  return names.length > 0 ? names.join(" / ") : null;
};

const readCoverUrl = (value: Record<string, unknown>): string | null => {
  const album = isRecord(value.album) ? value.album : isRecord(value.al) ? value.al : null;
  return (
    readString(value.cover) ??
    readString(value.picUrl) ??
    readString(value.coverUrl) ??
    readString(value.coverImgUrl) ??
    readString(value.imgurl) ??
    readString(value.img1v1Url) ??
    (album ? readString(album.picUrl) : null)
  );
};

const parseCoverCollectionItem = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id ?? value.vid);
  const title = readString(value.name ?? value.title);
  if (id === null || title === null) return null;
  const creator = Array.isArray(value.creator) ? value.creator[0] : value.creator;
  const subtitle =
    readArtists(value.artist) ??
    readArtists(value.artists) ??
    readArtists(value.ar) ??
    readNestedName(creator) ??
    readNestedName(value.dj) ??
    readString(value.category);
  return {
    id,
    title,
    subtitle,
    coverUrl: readCoverUrl(value),
    playCount: readNumber(value.playCount ?? value.listenerCount ?? value.subCount),
    description: readString(value.description ?? value.desc ?? value.copywriter ?? value.updateFrequency)
  };
};

const parseArtistCollectionItem = (value: unknown): FeedCardItem | null => {
  if (!isRecord(value)) return null;
  const id = readNumber(value.id);
  const title = readString(value.name);
  if (id === null || title === null) return null;
  const albumSize = readNumber(value.albumSize);
  const musicSize = readNumber(value.musicSize);
  const subtitle =
    readString(value.alias) ??
    (musicSize !== null ? `${musicSize} 首歌曲` : albumSize !== null ? `${albumSize} 张专辑` : null);
  return {
    id,
    title,
    subtitle,
    coverUrl: readCoverUrl(value),
    playCount: readNumber(value.fans),
    description: readString(value.description ?? value.briefDesc)
  };
};

const readSublistItems = (payload: unknown, key: "data" | "djRadios"): unknown[] => {
  if (!isRecord(payload)) return [];
  if (key === "djRadios") {
    const nestedData = isRecord(payload.data) ? payload.data : null;
    return readArray(payload.djRadios ?? nestedData?.djRadios);
  }
  return readArray(payload.data);
};

const loadAllSublist = async (
  load: (params: NcmCollectionSublistParams) => Promise<unknown>,
  key: "data" | "djRadios",
  parse: (value: unknown) => FeedCardItem | null
): Promise<FeedCardItem[]> => {
  const allItems: FeedCardItem[] = [];
  for (let offset = 0; ; offset += COLLECTION_PAGE_SIZE) {
    const pageItems = readSublistItems(await load({ limit: COLLECTION_PAGE_SIZE, offset }), key);
    if (pageItems.length === 0) break;
    allItems.push(...pageItems.map(parse).filter((item): item is FeedCardItem => item !== null));
    if (pageItems.length < COLLECTION_PAGE_SIZE) break;
  }
  return allItems;
};

const ensureLikedCollectionCache = (userId: number): LikedCollectionCache => {
  if (likedCollectionCache?.userId !== userId) {
    likedCollectionCache = { userId, subcount: {} };
  }
  return likedCollectionCache;
};

export function LikedCollectionMode(props: LikedCollectionModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [activeTab, setActiveTab] = createSignal<CollectionTab>("playlists");
  const [playlistScope, setPlaylistScope] = createSignal<PlaylistScope>("created");
  const [createdPlaylists, setCreatedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectedPlaylists, setCollectedPlaylists] = createSignal<OnlinePlaylistSummary[]>([]);
  const [collectionAlbums, setCollectionAlbums] = createSignal<FeedCardItem[]>([]);
  const [collectionArtists, setCollectionArtists] = createSignal<FeedCardItem[]>([]);
  const [collectionVideos, setCollectionVideos] = createSignal<FeedCardItem[]>([]);
  const [collectionRadios, setCollectionRadios] = createSignal<FeedCardItem[]>([]);
  const [subcount, setSubcount] = createSignal<NcmUserSubcountData>({});
  const [loadState, setLoadState] =
    createSignal<Record<CollectionTab, CollectionLoadState>>(emptyCollectionLoadState());

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange,
    onPlaylistSubscribeChange: (playlist, subscribed) => {
      const profile = props.loginProfile();
      if (profile) {
        applyNcmPlaylistSubscribeCacheUpdate(profile.userId, playlist, subscribed);
      }
      setCollectedPlaylists((current) => {
        if (!subscribed) {
          return current.filter((item) => item.id !== playlist.id);
        }
        return current.some((item) => item.id === playlist.id) ? current : [playlist, ...current];
      });
    },
    onAlbumSubscribeChange: (album, subscribed) => {
      setCollectionAlbums((current) => {
        if (!subscribed) {
          return current.filter((item) => item.id !== album.id);
        }
        return current.some((item) => item.id === album.id) ? current : [album, ...current];
      });
    },
    onArtistSubscribeChange: (artist, followed) => {
      setCollectionArtists((current) => {
        if (!followed) {
          return current.filter((item) => item.id !== artist.id);
        }
        return current.some((item) => item.id === artist.id) ? current : [artist, ...current];
      });
    }
  });

  const readErrorMessage = createErrorMessageReader(t);

  const visibleCreatedPlaylists = createMemo(() => createdPlaylists().slice(1));
  const currentPlaylists = createMemo(() =>
    playlistScope() === "created" ? visibleCreatedPlaylists() : collectedPlaylists()
  );
  const activeTabLoading = createMemo<boolean>(() => loadState()[activeTab()] === "loading");
  const activeCollectionLoading = createMemo<boolean>(() =>
    activeTab() !== "playlists" && activeTabLoading()
  );

  const totalPlaylistCount = createMemo(() => {
    if (loadState().playlists === "loaded") {
      return visibleCreatedPlaylists().length + collectedPlaylists().length;
    }
    const fromSubcount =
      readPositiveCount(subcount().playlistCount) ||
      readPositiveCount(subcount().createdPlaylistCount) +
        readPositiveCount(subcount().subPlaylistCount);
    return fromSubcount || visibleCreatedPlaylists().length + collectedPlaylists().length;
  });

  const stats = createMemo<CollectionStat[]>(() => [
    {
      key: "playlists",
      labelKey: "ncm.collection.status.playlists",
      count: totalPlaylistCount(),
      icon: IconPlaylist
    },
    {
      key: "albums",
      labelKey: "ncm.collection.status.albums",
      count: loadState().albums === "loaded" ? collectionAlbums().length : readPositiveCount(subcount().albumCount),
      icon: IconAlbum
    },
    {
      key: "artists",
      labelKey: "ncm.collection.status.artists",
      count: loadState().artists === "loaded" ? collectionArtists().length : readPositiveCount(subcount().artistCount),
      icon: IconArtist
    },
    {
      key: "videos",
      labelKey: "ncm.collection.status.videos",
      count: loadState().videos === "loaded" ? collectionVideos().length : readPositiveCount(subcount().mvCount),
      icon: IconPlayCircle
    },
    {
      key: "radios",
      labelKey: "ncm.collection.status.radios",
      count: loadState().radios === "loaded" ? collectionRadios().length : readPositiveCount(subcount().djRadioCount),
      icon: IconVolumeHigh
    }
  ]);

  const loginStatusText = createLoginStatusText(t, props.isCheckingLogin, props.loginProfile);

  createEffect(on(props.loginProfile, (profile, prev) => {
    if (prev !== undefined && prev !== null && profile === null) {
      setCreatedPlaylists([]);
      setCollectedPlaylists([]);
      setCollectionAlbums([]);
      setCollectionArtists([]);
      setCollectionVideos([]);
      setCollectionRadios([]);
      setSubcount({});
      setLoadState(emptyCollectionLoadState());
      detailNav.setSelectedPlaylist(null);
      detailNav.setPlaylistTracksState([]);
    }
  }, { defer: true }));

  const markTabState = (tab: CollectionTab, state: CollectionLoadState) => {
    setLoadState((current) => ({ ...current, [tab]: state }));
  };

  const applyPlaylistGroups = (userId: number, groups: UserPlaylistGroups) => {
    const cache = ensureLikedCollectionCache(userId);
    cache.playlists = groups;
    setCreatedPlaylists(groups.created);
    setCollectedPlaylists(groups.collected);
    markTabState("playlists", "loaded");
  };

  const applyCacheSnapshot = (cache: LikedCollectionCache) => {
    setSubcount(cache.subcount);
    if (cache.playlists) {
      setCreatedPlaylists(cache.playlists.created);
      setCollectedPlaylists(cache.playlists.collected);
      markTabState("playlists", "loaded");
    }
    if (cache.albums) {
      setCollectionAlbums(cache.albums);
      markTabState("albums", "loaded");
    }
    if (cache.artists) {
      setCollectionArtists(cache.artists);
      markTabState("artists", "loaded");
    }
    if (cache.videos) {
      setCollectionVideos(cache.videos);
      markTabState("videos", "loaded");
    }
    if (cache.radios) {
      setCollectionRadios(cache.radios);
      markTabState("radios", "loaded");
    }
  };

  const loadSubcount = async (userId: number, isCancelled: () => boolean) => {
    const cache = ensureLikedCollectionCache(userId);
    if (Object.keys(cache.subcount).length > 0) {
      setSubcount(cache.subcount);
      return;
    }
    const countEnvelope = await userSubcount().catch(() => null);
    if (isCancelled()) return;
    const nextSubcount = countEnvelope === null ? {} : readUserSubcountData(countEnvelope);
    cache.subcount = nextSubcount;
    setSubcount(nextSubcount);
  };

  const loadPlaylistTab = async (profile: NcmProfile, isCancelled: () => boolean) => {
    const cache = ensureLikedCollectionCache(profile.userId);
    if (cache.playlists) {
      applyPlaylistGroups(profile.userId, cache.playlists);
      return;
    }
    markTabState("playlists", "loading");
    try {
      const playlistGroups = await loadNcmUserPlaylistGroupsCached(api, profile.userId);
      if (isCancelled()) return;
      applyPlaylistGroups(profile.userId, playlistGroups);
    } catch (error) {
      if (!isCancelled()) {
        setCreatedPlaylists([]);
        setCollectedPlaylists([]);
        markTabState("playlists", "error");
        props.setFeedback("error", readErrorMessage(error));
      }
    }
  };

  const loadCollectionTab = async (
    profile: NcmProfile,
    tab: Exclude<CollectionTab, "playlists">,
    isCancelled: () => boolean
  ) => {
    const cache = ensureLikedCollectionCache(profile.userId);
    const cachedItems = cache[tab];
    if (cachedItems) {
      if (tab === "albums") setCollectionAlbums(cachedItems);
      if (tab === "artists") setCollectionArtists(cachedItems);
      if (tab === "videos") setCollectionVideos(cachedItems);
      if (tab === "radios") setCollectionRadios(cachedItems);
      markTabState(tab, "loaded");
      return;
    }
    markTabState(tab, "loading");
    try {
      const items = await collectionLoaders[tab]();
      if (isCancelled()) return;
      cache[tab] = items;
      if (tab === "albums") setCollectionAlbums(items);
      if (tab === "artists") setCollectionArtists(items);
      if (tab === "videos") setCollectionVideos(items);
      if (tab === "radios") setCollectionRadios(items);
      markTabState(tab, "loaded");
    } catch (error) {
      if (!isCancelled()) {
        markTabState(tab, "error");
        props.setFeedback("error", readErrorMessage(error));
      }
    }
  };

  createEffect(() => {
    const profile = props.loginProfile();
    if (profile === null) return;

    let cancelled = false;
    const unsubscribePlaylists = subscribeNcmUserPlaylistGroups(profile.userId, (groups) => {
      applyPlaylistGroups(profile.userId, groups);
    });
    const run = async () => {
      const cache = ensureLikedCollectionCache(profile.userId);
      applyCacheSnapshot(cache);
      void loadSubcount(profile.userId, () => cancelled);
      const tab = activeTab();
      if (tab === "playlists") {
        await loadPlaylistTab(profile, () => cancelled);
      } else {
        await loadCollectionTab(profile, tab, () => cancelled);
      }
    };

    void run();
    onCleanup(() => {
      cancelled = true;
      unsubscribePlaylists();
    });
  });

  createEffect(on(
    () => props.tabRequest?.version,
    (version) => {
      if (version === undefined || version === 0) return;
      const tab = props.tabRequest?.tab;
      if (tab) {
        detailNav.clearAllDetailViews();
        setActiveTab(tab);
      }
    }
  ));

  createEffect(on(
    () => props.radioSubscribeEvent?.version,
    (version) => {
      if (version === undefined || version === 0) return;
      const event = props.radioSubscribeEvent;
      if (!event) return;
      setCollectionRadios((current) => {
        if (!event.subscribed) {
          return current.filter((item) => item.id !== event.radio.id);
        }
        return current.some((item) => item.id === event.radio.id)
          ? current
          : [event.radio, ...current];
      });
    }
  ));

  const handlePlaylistClick = (playlist: OnlinePlaylistSummary) => {
    props.onSelectedPlaylistChange?.(playlist.id);
    void detailNav.loadPlaylistTracks(playlist);
  };

  const setActiveTabAndPersist = (tab: CollectionTab) => {
    setActiveTab(tab);
    if (tab === "playlists" || tab === "albums" || tab === "artists") {
      props.onTabChange?.(tab);
    }
  };

  const hasDetailView = createMemo<boolean>(() =>
    detailNav.selectedAlbum() !== null ||
    detailNav.selectedArtist() !== null ||
    detailNav.selectedPlaylist() !== null ||
    detailNav.selectedVideo() !== null
  );

  createDetailViewReporter(hasDetailView, props.onDetailViewChange);

  const renderCollectionGrid = (
    items: Accessor<FeedCardItem[]>,
    emptyKey: TranslationKey,
    onClick: (item: FeedCardItem) => void,
    options: { shape?: "round"; video?: boolean } = {}
  ) => (
    <Show
      when={items().length > 0}
      fallback={
        <NaiveP class="panel-note">
          {activeCollectionLoading() ? t("ncm.playlist.loading") : t(emptyKey)}
        </NaiveP>
      }
    >
      <div class={`album-grid content-fade-in${options.video ? " liked-collection-video-grid" : ""}`}>
        <For each={items()}>
          {(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={!uiSettings.hiddenCovers.like}
              size="md"
              shape={options.shape}
              playCount={item.playCount}
              description={item.description}
              onClick={() => onClick(item)}
            />
          )}
        </For>
      </div>
    </Show>
  );

  return (
    <>
      <Show when={!hasDetailView()}>
        <section class="liked-collection">
          <header class="liked-collection-head">
            <div class="liked-collection-title">
              <NaiveH1>{t("ncm.collection.title")}</NaiveH1>
              <div class="liked-collection-status" aria-label={loginStatusText()}>
                <For each={stats()}>
                  {(item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        class={`liked-collection-status-item${activeTab() === item.key ? " is-active" : ""}`}
                        onClick={() => setActiveTabAndPersist(item.key)}
                      >
                        <Icon />
                        <span>{t(item.labelKey, { count: item.count })}</span>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
            <Show
              when={props.loginProfile() === null}
              fallback={
                <button
                  type="button"
                  class="ghost-button page-action"
                  onClick={() => void props.onLogout()}
                  disabled={props.isLoginBusy()}
                >
                  {t("ncm.login.action.logout")}
                </button>
              }
            >
              <button
                type="button"
                class="primary-button page-action"
                onClick={props.onBeginLogin}
                disabled={props.isLoginBusy()}
              >
                <IconHeart />
                {t("ncm.login.action.qr")}
              </button>
            </Show>
          </header>

          <Show when={props.loginProfile() !== null} fallback={<NaiveP class="panel-note">{t("ncm.empty.loginRequired")}</NaiveP>}>
            <SegmentedTabs
              value={activeTab()}
              onChange={(next) => setActiveTabAndPersist(next as CollectionTab)}
              items={collectionTabs.map((item) => ({ value: item.value, label: t(item.labelKey) }))}
              ariaLabel={t("ncm.collection.title")}
            />

            <Switch>
              <Match when={activeTab() === "playlists"}>
                <section class="liked-collection-playlists">
                  <div class="liked-collection-filter">
                    <For
                      each={[
                        { value: "created" as const, label: t("ncm.collection.playlistFilter.created") },
                        { value: "collected" as const, label: t("ncm.collection.playlistFilter.collected") }
                      ]}
                    >
                      {(item) => (
                        <button
                          type="button"
                          class={`liked-collection-chip${playlistScope() === item.value ? " is-active" : ""}`}
                          onClick={() => setPlaylistScope(item.value)}
                        >
                          {item.label}
                        </button>
                      )}
                    </For>
                  </div>
                  <Show
                    when={currentPlaylists().length > 0}
                    fallback={
                      <NaiveP class="panel-note">
                        {activeTabLoading() ? t("ncm.playlist.loading") : t("ncm.empty.noUserPlaylists")}
                      </NaiveP>
                    }
                  >
                    <div class="album-grid content-fade-in">
                      <For each={currentPlaylists()}>
                        {(playlist) => (
                          <AlbumCard
                            title={playlist.name}
                            subtitle={t("ncm.playlist.meta", {
                              count: playlist.trackCount ?? 0,
                              creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
                            })}
                            coverUrl={playlist.coverUrl}
                            coverVisible={!uiSettings.hiddenCovers.like}
                            size="md"
                            active={detailNav.selectedPlaylist()?.id === playlist.id}
                            onClick={() => handlePlaylistClick(playlist)}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </Match>
              <Match when={activeTab() === "albums"}>
                {renderCollectionGrid(
                  collectionAlbums,
                  "ncm.collection.empty.albums",
                  (item) => void detailNav.loadAlbumTracks(item)
                )}
              </Match>
              <Match when={activeTab() === "artists"}>
                {renderCollectionGrid(
                  collectionArtists,
                  "ncm.collection.empty.artists",
                  (item) => void detailNav.loadArtistTracks(item),
                  { shape: "round" }
                )}
              </Match>
              <Match when={activeTab() === "videos"}>
                {renderCollectionGrid(
                  collectionVideos,
                  "ncm.collection.empty.videos",
                  (item) => detailNav.enterVideo(item),
                  { video: true }
                )}
              </Match>
              <Match when={activeTab() === "radios"}>
                {renderCollectionGrid(
                  collectionRadios,
                  "ncm.collection.empty.radios",
                  (item) => props.onNavigateToRadioDetail?.(item)
                )}
              </Match>
            </Switch>
          </Show>
        </section>
      </Show>

      <Show when={detailNav.selectedPlaylist()}>
        <OnlinePlaylistDetailRoute
          detailNav={detailNav}
          subtitleText={t("ncm.collection.title")}
          loginProfile={props.loginProfile()}
          setFeedback={props.setFeedback}
          playback={props.playback}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
        />
      </Show>
      <Show when={detailNav.selectedAlbum() !== null}>
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
        />
      </Show>
      <Show when={detailNav.selectedArtist() !== null}>
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
        />
      </Show>
      <Show when={detailNav.selectedVideo() !== null}>
        <VideoDetail
          video={detailNav.selectedVideo()}
          onBack={detailNav.exitVideo}
          onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
        />
      </Show>
    </>
  );
}
