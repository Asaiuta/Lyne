import { For, Show, createMemo, createResource } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import { DailySongsCard, type DailySongsCardCover } from "../../components/DailySongsCard";
import { HorizontalCardRow } from "../../components/HorizontalCardRow";
import { IconAlbum, IconArtist, IconPause, IconPlay, IconPlaylist, IconSkipNext } from "../../components/icons";
import { createApiClient, type NcmHomeFeed } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { cacheFetch } from "../../shared/state/cacheFetch";
import { useUISettings, type HomeSectionKey } from "../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "./ncmPlaylistSummary";
import type { DiscoverTab, FeedCardItem } from "./shared/types";

const EMPTY_HOME_FEED: NcmHomeFeed = {
  dailyPicks: [],
  dailySongCovers: [],
  likedSongCovers: [],
  personalFmCovers: [],
  personalFmPreview: null,
  radarPlaylists: [],
  recommendedPlaylists: [],
  newAlbums: [],
  featuredArtists: [],
  recommendedMvs: [],
  podcasts: [],
  errors: []
};

interface NeteaseHomeFeedProps {
  isLoggedIn: boolean;
  userId: number | null;
  onSelectPlaylist: (playlist: OnlinePlaylistSummary) => void;
  onSelectDailySongs?: () => void;
  onSelectLikedSongs?: () => void;
  onPlayPersonalFm?: () => void;
  onSelectAlbum?: (album: FeedCardItem) => void;
  onSelectArtist?: (artist: FeedCardItem) => void;
  onNavigateToDiscover?: (tab: DiscoverTab) => void;
}

const DEFAULT_TTL = 10 * 60 * 1000;
const api = createApiClient();

const loadHomeFeed = async (userId: number | null): Promise<NcmHomeFeed> => {
  try {
    return await cacheFetch(
      `ncm.home.feed.${userId ?? "anonymous"}`,
      () => api.getNcmHomeFeed({ userId }),
      DEFAULT_TTL
    );
  } catch (error) {
    console.warn("[NeteaseHomeFeed] feed fetch failed", error);
    return EMPTY_HOME_FEED;
  }
};

export function NeteaseHomeFeed(props: NeteaseHomeFeedProps) {
  const { t } = useTranslation();

  const [homeFeed] = createResource(
    () => (props.isLoggedIn && props.userId !== null ? props.userId : "anonymous"),
    (source) => loadHomeFeed(typeof source === "number" ? source : null)
  );

  const feed = createMemo(() => homeFeed() ?? EMPTY_HOME_FEED);

  const dailySongsCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = feed().dailySongCovers;
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const likedSongsCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = feed().likedSongCovers;
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const personalFmCoverPreview = createMemo<DailySongsCardCover[]>(() => {
    const all = feed().personalFmCovers;
    return all.filter((cover) => cover.url !== null).slice(0, 3);
  });

  const handlePlaylist = (item: FeedCardItem) =>
    props.onSelectPlaylist({
      id: item.id,
      name: item.title,
      creator: item.subtitle,
      coverUrl: item.coverUrl,
      trackCount: null,
      subscribed: false
    });

  const personalFmTitle = createMemo(() => feed().personalFmPreview?.title ?? t("ncm.fm.preview.title"));
  const personalFmArtist = createMemo(() => feed().personalFmPreview?.artist ?? t("ncm.fm.preview.artist"));
  const personalFmAlbum = createMemo(() => feed().personalFmPreview?.album ?? t("ncm.fm.preview.album"));
  const personalFmCoverUrl = createMemo(() => feed().personalFmPreview?.coverUrl ?? personalFmCoverPreview()[0]?.url ?? null);

  const uiSettings = useUISettings();

  const visibleSections = createMemo<HomeSectionKey[]>(() => {
    const sections = uiSettings.homeSections;
    return [...sections]
      .filter((s) => s.visible)
      .sort((a, b) => a.order - b.order)
      .map((s) => s.key);
  });

  const renderSection = (key: HomeSectionKey) => {
    switch (key) {
      case "dailyPicks":
        return (
          <Show when={feed().dailyPicks.length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.dailyPicks")}>
              <For each={feed().dailyPicks}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "playlists":
        return (
          <Show when={feed().recommendedPlaylists.length > 0}>
            <HorizontalCardRow title={t(props.isLoggedIn ? "ncm.home.section.personalPlaylists" : "ncm.home.section.recommendedPlaylists")}>
              <For each={feed().recommendedPlaylists}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "radar":
        return (
          <Show when={feed().radarPlaylists.length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.radar")}>
              <For each={feed().radarPlaylists}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "artists":
        return (
          <Show when={feed().featuredArtists.length > 0}>
            <HorizontalCardRow class="card-row-artists" title={t("ncm.home.section.topArtists")} onTitleClick={() => props.onNavigateToDiscover?.("artists")}>
              <For each={feed().featuredArtists}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    coverUrl={item.coverUrl}
                    shape="round"
                    size="sm"
                    onClick={() => props.onSelectArtist?.(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "mvs":
        return (
          <Show when={feed().recommendedMvs.length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.recommendedMv")}>
              <For each={feed().recommendedMvs}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => window.open(`https://music.163.com/#/mv?id=${item.id}`, "_blank")}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "podcasts":
        return (
          <Show when={feed().podcasts.length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.podcasts")}>
              <For each={feed().podcasts}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => window.open(`https://music.163.com/#/program?id=${item.id}`, "_blank")}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "albums":
        return (
          <Show when={feed().newAlbums.length > 0}>
            <HorizontalCardRow title={t("ncm.home.section.newAlbums")} onTitleClick={() => props.onNavigateToDiscover?.("new")}>
              <For each={feed().newAlbums}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    description={item.description}
                    onClick={() => props.onSelectAlbum?.(item)}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
    }
  };

  return (
    <div class="ncm-home-feed">
      <Show when={props.isLoggedIn && (props.onSelectDailySongs || props.onSelectLikedSongs || props.onPlayPersonalFm)}>
        <div class="ncm-home-feed-main-rec">
          <div class="ncm-home-feed-main-rec-list">
            <Show when={props.onSelectDailySongs}>
              <DailySongsCard
                title={t("ncm.daily.title")}
                description={t("ncm.daily.description")}
                covers={dailySongsCoverPreview()}
                variant="daily"
                onClick={() => props.onSelectDailySongs?.()}
              />
            </Show>
            <Show when={props.onSelectLikedSongs}>
              <DailySongsCard
                title={t("ncm.liked.title")}
                description={t("ncm.liked.description")}
                covers={likedSongsCoverPreview()}
                variant="liked"
                onClick={() => props.onSelectLikedSongs?.()}
              />
            </Show>
          </div>
          <Show when={props.onPlayPersonalFm}>
            <button type="button" class="ncm-home-feed-fm-card" onClick={() => props.onPlayPersonalFm?.()}>
              <Show when={personalFmCoverUrl()}>
                {(coverUrl) => (
                  <>
                    <img class="ncm-home-feed-fm-card-blur" src={coverUrl()} alt="" loading="lazy" />
                    <img class="ncm-home-feed-fm-card-cover" src={coverUrl()} alt="" loading="lazy" />
                  </>
                )}
              </Show>
              <div class="ncm-home-feed-fm-card-copy">
                <strong class="ncm-home-feed-fm-card-title">{personalFmTitle()}</strong>
                <Show when={personalFmArtist()}>
                  {(artist) => (
                    <span class="ncm-home-feed-fm-card-meta">
                      <IconArtist />
                      {artist()}
                    </span>
                  )}
                </Show>
                <Show when={personalFmAlbum()}>
                  {(album) => (
                    <span class="ncm-home-feed-fm-card-meta">
                      <IconAlbum />
                      {album()}
                    </span>
                  )}
                </Show>
                <div class="ncm-home-feed-fm-card-controls" aria-hidden="true">
                  <span class="ncm-home-feed-fm-card-control ncm-home-feed-fm-card-control--primary">
                    <IconPause />
                  </span>
                  <span class="ncm-home-feed-fm-card-control">
                    <IconPlay />
                  </span>
                  <span class="ncm-home-feed-fm-card-control">
                    <IconSkipNext />
                  </span>
                </div>
                <span class="ncm-home-feed-fm-card-badge">
                  <IconPlaylist />
                  {t("ncm.fm.title")}
                </span>
              </div>
            </button>
          </Show>
        </div>
      </Show>

      <For each={visibleSections()}>
        {(key) => renderSection(key)}
      </For>
    </div>
  );
}
