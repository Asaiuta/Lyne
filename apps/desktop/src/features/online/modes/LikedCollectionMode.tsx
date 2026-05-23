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
import { useTranslation, type TranslationKey } from "../../../shared/i18n";
import {
  userAlbumSublist,
  userArtistSublist,
  userDjSublist,
  userMvSublist,
  userSubcount,
  type NcmCollectionSublistParams,
  type NcmUserSubcountData
} from "../../../shared/api/ncm/user";
import { useUISettings } from "../../../shared/state/useUISettings";
import {
  loadNcmUserPlaylistGroups,
  type OnlinePlaylistSummary
} from "../ncmPlaylistSummary";
import { AlbumDetail } from "../details/AlbumDetail";
import { ArtistDetail } from "../details/ArtistDetail";
import { PlaylistDetail } from "../details/PlaylistDetail";
import { VideoDetail } from "../details/VideoDetail";
import {
  createErrorMessageReader,
  createLoginStatusText,
  type FeedbackSetter
} from "../shared/feedback";
import { readPositiveCount, readUserSubcountData } from "../shared/parsers";
import type { FeedCardItem, NcmProfile, OnlineTrackItem, RadioSubscribeEvent } from "../shared/types";
import type { PlaybackController } from "../shared/playback";
import { useDetailNavigation } from "../shared/useDetailNavigation";

type CollectionTab = "playlists" | "albums" | "artists" | "videos" | "radios";
type PlaylistScope = "created" | "collected";

interface CollectionStat {
  key: CollectionTab;
  labelKey: TranslationKey;
  count: number;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
}

interface LikedCollectionModeProps {
  loginProfile: Accessor<NcmProfile | null>;
  isCheckingLogin: Accessor<boolean>;
  isLoginBusy: Accessor<boolean>;
  onBeginLogin: () => void;
  onLogout: () => void | Promise<void>;
  tabRequest?: { tab: "playlists" | "albums" | "artists"; version: number };
  radioSubscribeEvent?: RadioSubscribeEvent | null;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onPause: () => Promise<void>;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
}

const api = createApiClient();
const COLLECTION_PAGE_SIZE = 50;

const collectionTabs: Array<{ value: CollectionTab; labelKey: TranslationKey }> = [
  { value: "playlists", labelKey: "ncm.collection.tabs.playlists" },
  { value: "albums", labelKey: "ncm.collection.tabs.albums" },
  { value: "artists", labelKey: "ncm.collection.tabs.artists" },
  { value: "videos", labelKey: "ncm.collection.tabs.videos" },
  { value: "radios", labelKey: "ncm.collection.tabs.radios" }
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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
  const [isLoadingPlaylists, setIsLoadingPlaylists] = createSignal(false);
  const [isLoadingCollections, setIsLoadingCollections] = createSignal(false);
  const [hasLoadedCollections, setHasLoadedCollections] = createSignal(false);

  const detailNav = useDetailNavigation({
    t,
    loginProfile: props.loginProfile,
    playback: props.playback,
    setFeedback: props.setFeedback,
    onSelectedPlaylistChange: props.onSelectedPlaylistChange,
    onPlaylistSubscribeChange: (playlist, subscribed) => {
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

  const totalPlaylistCount = createMemo(() => {
    if (hasLoadedCollections()) {
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
      count: hasLoadedCollections() ? collectionAlbums().length : readPositiveCount(subcount().albumCount),
      icon: IconAlbum
    },
    {
      key: "artists",
      labelKey: "ncm.collection.status.artists",
      count: hasLoadedCollections() ? collectionArtists().length : readPositiveCount(subcount().artistCount),
      icon: IconArtist
    },
    {
      key: "videos",
      labelKey: "ncm.collection.status.videos",
      count: hasLoadedCollections() ? collectionVideos().length : readPositiveCount(subcount().mvCount),
      icon: IconPlayCircle
    },
    {
      key: "radios",
      labelKey: "ncm.collection.status.radios",
      count: hasLoadedCollections() ? collectionRadios().length : readPositiveCount(subcount().djRadioCount),
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
      setHasLoadedCollections(false);
      detailNav.setSelectedPlaylist(null);
      detailNav.setPlaylistTracksState([]);
    }
  }, { defer: true }));

  createEffect(() => {
    const profile = props.loginProfile();
    if (profile === null) return;

    let cancelled = false;
    const run = async () => {
      setIsLoadingPlaylists(true);
      setIsLoadingCollections(true);
      setHasLoadedCollections(false);
      try {
        const [playlistGroups, countEnvelope, albums, artists, videos, radios] = await Promise.all([
          loadNcmUserPlaylistGroups(api, profile.userId),
          userSubcount().catch(() => null),
          loadAllSublist(userAlbumSublist, "data", parseCoverCollectionItem),
          loadAllSublist(userArtistSublist, "data", parseArtistCollectionItem),
          loadAllSublist(userMvSublist, "data", parseCoverCollectionItem),
          loadAllSublist(userDjSublist, "djRadios", parseCoverCollectionItem)
        ]);
        if (cancelled) return;
        setCreatedPlaylists(playlistGroups.created);
        setCollectedPlaylists(playlistGroups.collected);
        setCollectionAlbums(albums);
        setCollectionArtists(artists);
        setCollectionVideos(videos);
        setCollectionRadios(radios);
        setSubcount(countEnvelope === null ? {} : readUserSubcountData(countEnvelope));
        setHasLoadedCollections(true);
      } catch (error) {
        if (!cancelled) {
          setCreatedPlaylists([]);
          setCollectedPlaylists([]);
          setCollectionAlbums([]);
          setCollectionArtists([]);
          setCollectionVideos([]);
          setCollectionRadios([]);
          setSubcount({});
          setHasLoadedCollections(false);
          props.setFeedback("error", readErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingPlaylists(false);
          setIsLoadingCollections(false);
        }
      }
    };

    void run();
    onCleanup(() => {
      cancelled = true;
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

  const hasDetailView = createMemo<boolean>(() =>
    detailNav.selectedAlbum() !== null ||
    detailNav.selectedArtist() !== null ||
    detailNav.selectedPlaylist() !== null ||
    detailNav.selectedVideo() !== null
  );

  const renderCollectionGrid = (
    items: Accessor<FeedCardItem[]>,
    emptyKey: TranslationKey,
    onClick: (item: FeedCardItem) => void,
    options: { shape?: "round"; video?: boolean } = {}
  ) => (
    <Show
      when={items().length > 0}
      fallback={
        <div class="panel-note">
          {isLoadingCollections() ? t("ncm.playlist.loading") : t(emptyKey)}
        </div>
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
              <h1>{t("ncm.collection.title")}</h1>
              <div class="liked-collection-status" aria-label={loginStatusText()}>
                <For each={stats()}>
                  {(item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        type="button"
                        class={`liked-collection-status-item${activeTab() === item.key ? " is-active" : ""}`}
                        onClick={() => setActiveTab(item.key)}
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

          <Show when={props.loginProfile() !== null} fallback={<div class="panel-note">{t("ncm.empty.loginRequired")}</div>}>
            <SegmentedTabs
              value={activeTab()}
              onChange={(next) => setActiveTab(next as CollectionTab)}
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
                      <div class="panel-note">
                        {isLoadingPlaylists() ? t("ncm.playlist.loading") : t("ncm.empty.noUserPlaylists")}
                      </div>
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
        <PlaylistDetail
          playlist={detailNav.selectedPlaylist()}
          detail={detailNav.playlistDetailInfo()}
          tracks={detailNav.filteredPlaylistTracks()}
          trackCount={detailNav.playlistTrackCount()}
          metaText={detailNav.playlistMetaText()}
          subtitleText={t("ncm.collection.title")}
          isLoadingTracks={detailNav.isLoadingPlaylistTracks()}
          isLoadingDetail={detailNav.isLoadingPlaylistDetail()}
          isTogglingSubscribe={detailNav.isTogglingPlaylistSubscribe()}
          isScrolled={detailNav.isPlaylistDetailScrolled()}
          filter={detailNav.playlistFilter()}
          detailTab={detailNav.playlistDetailTab()}
          setFilter={detailNav.setPlaylistFilter}
          setDetailTab={detailNav.setPlaylistDetailTab}
          onBack={detailNav.handleBackToPlaylists}
          onPlayAll={detailNav.playAllPlaylistTracks}
          onToggleSubscribe={detailNav.togglePlaylistSubscribe}
          onNavigateToSongWiki={props.onNavigateToSongWiki}
          onScroll={detailNav.handlePlaylistTrackScroll}
          loginProfile={props.loginProfile()}
          setFeedback={props.setFeedback}
          playback={props.playback}
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
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
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
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
          currentTrackPath={props.currentTrackPath}
          currentSongId={props.currentSongId}
          isPlaying={props.isPlaying}
        />
      </Show>
      <Show when={detailNav.selectedVideo() !== null}>
        <VideoDetail
          video={detailNav.selectedVideo()}
          onBack={detailNav.exitVideo}
          onPauseAudio={props.onPause}
          onSelectArtist={(artist) => void detailNav.loadArtistTracks(artist)}
        />
      </Show>
    </>
  );
}
