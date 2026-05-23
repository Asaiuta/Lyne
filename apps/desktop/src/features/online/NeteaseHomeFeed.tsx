import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import { DailySongsCard, type DailySongsCardCover } from "../../components/DailySongsCard";
import { HorizontalCardRow } from "../../components/HorizontalCardRow";
import { IconAlbum, IconArtist, IconCopy, IconPause, IconPlay, IconPlaylist, IconSkipNext, IconThumbDown } from "../../components/icons";
import { ContextMenu, type ContextMenuItem } from "../../components/media/ContextMenu";
import { createApiClient, type NcmHomeFeed } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { cacheFetch } from "../../shared/state/cacheFetch";
import { useUISettings, type CoverHiddenKey, type HomeSectionKey } from "../../shared/state/useUISettings";
import { playlistSummaryFromFeedCard, type OnlinePlaylistSummary } from "./ncmPlaylistSummary";
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
  onPlay?: () => void;
  onPause?: () => void;
  onSkipNext?: () => void;
  onDislikePersonalFm?: (songId: number | null) => void;
  isPlaying?: boolean;
  onSelectAlbum?: (album: FeedCardItem) => void;
  onSelectArtist?: (artist: FeedCardItem) => void;
  onSelectVideo?: (video: FeedCardItem) => void;
  onSelectRadio?: (radio: FeedCardItem) => void;
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

function HomeFeedSkeleton() {
  return (
    <>
      <section class="card-row ncm-home-feed-skeleton" aria-hidden="true">
        <header class="card-row-head">
          <div class="card-row-copy">
            <span class="card-row-title ncm-home-feed-skeleton-title skeleton" />
          </div>
        </header>
        <div class="card-row-grid" role="list">
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
            {() => (
              <div class="album-card skeleton-card">
                <span class="album-card-art skeleton" />
                <span class="skeleton skeleton-line skeleton-line--title" />
                <span class="skeleton skeleton-line" />
              </div>
            )}
          </For>
        </div>
      </section>
      <section class="card-row ncm-home-feed-skeleton" aria-hidden="true">
        <header class="card-row-head">
          <div class="card-row-copy">
            <span class="card-row-title ncm-home-feed-skeleton-title skeleton" />
          </div>
        </header>
        <div class="card-row-grid" role="list">
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
            {() => (
              <div class="album-card album-card--round skeleton-card">
                <span class="album-card-art skeleton skeleton--circle" />
                <span class="skeleton skeleton-line skeleton-line--title" />
              </div>
            )}
          </For>
        </div>
      </section>
    </>
  );
}

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
    props.onSelectPlaylist(playlistSummaryFromFeedCard(item));

  type CardMenuKind = "playlist" | "album" | "artist" | "video" | "radio";
  interface MenuContext {
    open: boolean;
    x: number;
    y: number;
    item: FeedCardItem | null;
    kind: CardMenuKind;
  }
  const closedMenu: MenuContext = { open: false, x: 0, y: 0, item: null, kind: "playlist" };
  const [menu, setMenu] = createSignal<MenuContext>(closedMenu);
  const closeMenu = () => setMenu(closedMenu);

  const openCardMenu = (event: MouseEvent, item: FeedCardItem, kind: CardMenuKind) => {
    setMenu({ open: true, x: event.clientX, y: event.clientY, item, kind });
  };

  const menuItems = (): ContextMenuItem[] => {
    const ctx = menu();
    if (!ctx.item) return [];
    const items: ContextMenuItem[] = [
      { key: "open", label: t("media.context.play"), icon: <IconPlay /> }
    ];
    items.push({ key: "copy-name", label: t("media.context.copyName"), icon: <IconCopy /> });
    return items;
  };

  const handleMenuSelect = (key: string) => {
    const ctx = menu();
    if (!ctx.item) return;
    if (key === "open") {
      switch (ctx.kind) {
        case "playlist":
          handlePlaylist(ctx.item);
          break;
        case "album":
          props.onSelectAlbum?.(ctx.item);
          break;
        case "artist":
          props.onSelectArtist?.(ctx.item);
          break;
        case "video":
          props.onSelectVideo?.(ctx.item);
          break;
        case "radio":
          props.onSelectRadio?.(ctx.item);
          break;
      }
    } else if (key === "copy-name") {
      void navigator.clipboard?.writeText(ctx.item.title);
    }
  };

  const personalFmTitle = createMemo(() => feed().personalFmPreview?.title ?? t("ncm.fm.preview.title"));
  const personalFmArtist = createMemo(() => feed().personalFmPreview?.artist ?? t("ncm.fm.preview.artist"));
  const personalFmAlbum = createMemo(() => feed().personalFmPreview?.album ?? t("ncm.fm.preview.album"));
  const personalFmCoverUrl = createMemo(() => feed().personalFmPreview?.coverUrl ?? personalFmCoverPreview()[0]?.url ?? null);
  const personalFmSongId = createMemo(() => feed().personalFmCovers[0]?.id ?? null);

  const uiSettings = useUISettings();
  const showCover = (key: CoverHiddenKey) => !uiSettings.hiddenCovers[key];

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
                    coverVisible={showCover("home")}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "playlist")}
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
                    coverVisible={showCover("home")}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "playlist")}
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
                    coverVisible={showCover("home")}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => handlePlaylist(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "playlist")}
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
                    coverVisible={showCover("home")}
                    shape="round"
                    size="sm"
                    onClick={() => props.onSelectArtist?.(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "artist")}
                  />
                )}
              </For>
            </HorizontalCardRow>
          </Show>
        );
      case "mvs":
        return (
          <Show when={feed().recommendedMvs.length > 0}>
            <HorizontalCardRow class="card-row-videos" title={t("ncm.home.section.recommendedMv")}>
              <For each={feed().recommendedMvs}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    coverVisible={showCover("home")}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => props.onSelectVideo?.(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "video")}
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
                    coverVisible={showCover("home")}
                    playCount={item.playCount}
                    description={item.description}
                    onClick={() => props.onSelectRadio?.(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "radio")}
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
                    coverVisible={showCover("home")}
                    description={item.description}
                    onClick={() => props.onSelectAlbum?.(item)}
                    onContextMenu={(event) => openCardMenu(event, item, "album")}
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
                coverVisible={showCover("home")}
                variant="daily"
                onClick={() => props.onSelectDailySongs?.()}
              />
            </Show>
            <Show when={props.onSelectLikedSongs}>
              <DailySongsCard
                title={t("ncm.liked.title")}
                description={t("ncm.liked.description")}
                covers={likedSongsCoverPreview()}
                coverVisible={showCover("home")}
                variant="liked"
                onClick={() => props.onSelectLikedSongs?.()}
              />
            </Show>
          </div>
          <Show when={props.onPlayPersonalFm}>
            <div
              class={`ncm-home-feed-fm-card${showCover("personalFM") ? "" : " is-cover-hidden"}`}
              role="button"
              tabIndex={0}
              onClick={() => props.onPlayPersonalFm?.()}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  props.onPlayPersonalFm?.();
                }
              }}
            >
              <Show when={showCover("personalFM") ? personalFmCoverUrl() : null}>
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
                <div class="ncm-home-feed-fm-card-controls">
                  <button
                    type="button"
                    class="ncm-home-feed-fm-card-control"
                    aria-label={t("ncm.fm.aria.dislike")}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onDislikePersonalFm?.(personalFmSongId());
                    }}
                  >
                    <IconThumbDown />
                  </button>
                  <button
                    type="button"
                    class="ncm-home-feed-fm-card-control ncm-home-feed-fm-card-control--primary"
                    aria-label={props.isPlaying ? t("player.aria.pause") : t("player.aria.play")}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (props.isPlaying) props.onPause?.();
                      else props.onPlay?.();
                    }}
                  >
                    <Show when={props.isPlaying} fallback={<IconPlay />}>
                      <IconPause />
                    </Show>
                  </button>
                  <button
                    type="button"
                    class="ncm-home-feed-fm-card-control"
                    aria-label={t("player.aria.next")}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSkipNext?.();
                    }}
                  >
                    <IconSkipNext />
                  </button>
                </div>
                <span class="ncm-home-feed-fm-card-badge">
                  <IconPlaylist />
                  {t("ncm.fm.title")}
                </span>
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={homeFeed.loading && homeFeed() === undefined}>
        <HomeFeedSkeleton />
      </Show>

      <For each={visibleSections()}>
        {(key) => renderSection(key)}
      </For>

      <ContextMenu
        open={menu().open}
        x={menu().x}
        y={menu().y}
        items={menuItems()}
        onSelect={handleMenuSelect}
        onClose={closeMenu}
      />
    </div>
  );
}
