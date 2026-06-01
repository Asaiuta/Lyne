import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { IconAlbum, IconChevronLeft, IconHeart, IconHeartFilled, IconMusic, IconVideo } from "../../../components/icons";
import { NcmMediaList } from "../NcmMediaList";
import { SegmentedTabs, type SegmentedTabItem } from "../../../components/page/SegmentedTabs";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageStickyHeader } from "../../../components/page/PageStickyHeader";
import { PageSurface } from "../../../components/page/PageSurface";
import { useTranslation } from "../../../shared/i18n";
import type { TranslationKey } from "../../../shared/i18n";
import type { NcmArtistTrackOrder } from "../../../shared/api/ncmDomainTypes";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveP, NaiveSpin } from "../../../shared/ui/naive";
import type { ArtistDetailInfo } from "../artistParsers";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem } from "../shared/types";
import { NcmListDetail } from "./NcmListDetail";

type ArtistDetailTab = "songs" | "albums" | "videos";
type ArtistCountKey = "songs" | "albums" | "videos";

export interface ArtistDetailProps {
  artist: FeedCardItem | null;
  detail: ArtistDetailInfo | null;
  tracks: OnlineTrackItem[];
  isLoading: boolean;
  trackOrder: NcmArtistTrackOrder;
  hasMoreTracks: boolean;
  isLoadingDetail: boolean;
  isTogglingSubscribe: boolean;
  albums: FeedCardItem[];
  videos: FeedCardItem[];
  isLoadingAlbums: boolean;
  isLoadingVideos: boolean;
  hasMoreAlbums: boolean;
  hasMoreVideos: boolean;
  onLoadAlbums: () => void | Promise<void>;
  onLoadVideos: () => void | Promise<void>;
  onChangeTrackOrder: (order: NcmArtistTrackOrder) => void | Promise<void>;
  onLoadMoreTracks: () => void | Promise<void>;
  onLoadMoreAlbums: () => void | Promise<void>;
  onLoadMoreVideos: () => void | Promise<void>;
  onSelectAlbum: (album: FeedCardItem) => void | Promise<void>;
  onSelectVideo: (video: FeedCardItem) => void | Promise<void>;
  onToggleSubscribe: () => void | Promise<void>;
  onBack: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function ArtistDetail(props: ArtistDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [detailTab, setDetailTab] = createSignal<ArtistDetailTab>("songs");
  const artist = () => props.detail ?? props.artist;
  const artistId = createMemo<number | null>(() => artist()?.id ?? null);
  const detailTabItems = createMemo<SegmentedTabItem[]>(() => [
    { value: "songs", label: t("ncm.artist.tab.songs") },
    { value: "albums", label: t("ncm.artist.tab.albums") },
    { value: "videos", label: t("ncm.artist.tab.videos") }
  ]);
  const trackOrderItems = createMemo<SegmentedTabItem[]>(() => [
    { value: "hot", label: t("ncm.artist.songs.hot") },
    { value: "time", label: t("ncm.artist.songs.time") }
  ]);
  const countItems = createMemo<Array<{ key: ArtistCountKey; labelKey: TranslationKey; value: number | null }>>(() => [
    {
      key: "songs",
      labelKey: "ncm.artist.count.songs",
      value: props.detail?.musicSize ?? (props.tracks.length > 0 ? props.tracks.length : null)
    },
    { key: "albums", labelKey: "ncm.artist.count.albums", value: props.detail?.albumSize ?? null },
    { key: "videos", labelKey: "ncm.artist.count.videos", value: props.detail?.mvSize ?? null }
  ]);
  const subscribeLabel = createMemo<string>(() =>
    props.detail?.followed === true ? t("ncm.artist.unsubscribe") : t("ncm.artist.subscribe")
  );
  const metaText = createMemo<string>(() =>
    props.detail?.identify ??
    props.detail?.alias ??
    props.artist?.subtitle ??
    (props.tracks.length > 0 ? t("ncm.artist.metaCount", { count: props.tracks.length }) : "")
  );
  const metaItems = createMemo(() =>
    countItems()
      .filter((item) => item.value !== null)
      .map((item) => ({
        icon: <ArtistCountIcon kind={item.key} />,
        text: t(item.labelKey, { count: item.value ?? 0 }),
        onClick: () => setTab(item.key)
      }))
  );
  createEffect(() => {
    artistId();
    setDetailTab("songs");
  });
  const setTab = (next: string) => {
    const tab: ArtistDetailTab =
      next === "albums" ? "albums" : next === "videos" ? "videos" : "songs";
    setDetailTab(tab);
    if (tab === "albums" && props.albums.length === 0) {
      void props.onLoadAlbums();
    } else if (tab === "videos" && props.videos.length === 0) {
      void props.onLoadVideos();
    }
  };
  if (!artist()) return null;
  return (
    <PageSurface class="ncm-daily-detail" persistKey={`discover:artist:${artistId()}`} resetKey={artistId()}>
      <PageStickyHeader threshold={10}>
        {({ compact }) => (
          <>
            <PageHero size="lg" compact={compact()}>
              <button
                type="button"
                class="ghost-button ncm-daily-detail-back"
                onClick={props.onBack}
              >
                <IconChevronLeft />
                {t("ncm.artist.backToFeed")}
              </button>
              <NcmListDetail
                title={artist()?.title ?? ""}
                coverUrl={artist()?.coverUrl}
                hiddenCover={uiSettings.hiddenCovers.artistDetail}
                compact={compact()}
                coverShape="round"
                description={artist()?.description ?? metaText()}
                metaItems={metaItems()}
                playLabel={t("ncm.daily.playAll")}
                playDisabled={props.tracks.length === 0}
                loading={props.isLoading}
                onPlay={() => {
                  void props.playback.playAll(props.tracks);
                }}
                actionButtons={
                  <button
                    type="button"
                    class={`ghost-button page-action ncm-artist-subscribe${props.detail?.followed === true ? " is-active" : ""}`}
                    disabled={props.isLoadingDetail || props.isTogglingSubscribe}
                    onClick={() => void props.onToggleSubscribe()}
                  >
                    <Show when={props.isTogglingSubscribe} fallback={props.detail?.followed === true ? <IconHeartFilled /> : <IconHeart />}>
                      <NaiveSpin size={18} ariaHidden />
                    </Show>
                    {props.isTogglingSubscribe ? t("ncm.artist.subscribeWorking") : subscribeLabel()}
                  </button>
                }
              />
              <div class="ncm-detail-tabs">
                <SegmentedTabs
                  value={detailTab()}
                  onChange={setTab}
                  items={detailTabItems()}
                  ariaLabel={t("ncm.artist.tabs.aria")}
                />
              </div>
            </PageHero>
            <PageBody class="ncm-detail-page-body">
              <Show when={detailTab() === "songs"}>
                <div class="ncm-artist-song-panel">
                  <div class="ncm-artist-song-toolbar">
                    <SegmentedTabs
                      value={props.trackOrder}
                      onChange={(next) => void props.onChangeTrackOrder(next === "time" ? "time" : "hot")}
                      items={trackOrderItems()}
                      ariaLabel={t("ncm.artist.songs.orderAria")}
                    />
                  </div>
                  <NcmMediaList
                    items={props.tracks}
                    currentSourcePath={props.currentTrackPath}
                    currentSongId={props.currentSongId}
                    isPlayingNow={props.isPlaying}
                    onPlay={(item) => void props.playback.playOnlineTrack(item)}
                    onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
                    onContextAction={(action, item) => {
                      if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
                    }}
                    isLoading={props.isLoading}
                    emptyState={<NaiveP class="panel-note">{t("ncm.artist.empty")}</NaiveP>}
                    hideTopScrollTool
                  />
                  <Show when={props.hasMoreTracks && props.tracks.length > 0}>
                    <div class="online-discover-load-more">
                      <button
                        type="button"
                        class="ghost-button"
                        disabled={props.isLoading}
                        onClick={() => void props.onLoadMoreTracks()}
                      >
                        {props.isLoading ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
              <Show when={detailTab() === "albums"}>
                <ArtistResourceGrid
                  items={props.albums}
                  isLoading={props.isLoadingAlbums}
                  hasMore={props.hasMoreAlbums}
                  emptyText={t("ncm.artist.albums.empty")}
                  loadingText={t("ncm.playlist.loading")}
                  loadMoreText={t("ncm.discover.loadMore")}
                  coverHidden={uiSettings.hiddenCovers.album}
                  onLoadMore={props.onLoadMoreAlbums}
                  onSelect={props.onSelectAlbum}
                />
              </Show>
              <Show when={detailTab() === "videos"}>
                <ArtistResourceGrid
                  items={props.videos}
                  isLoading={props.isLoadingVideos}
                  hasMore={props.hasMoreVideos}
                  emptyText={t("ncm.artist.videos.empty")}
                  loadingText={t("ncm.playlist.loading")}
                  loadMoreText={t("ncm.discover.loadMore")}
                  coverHidden={uiSettings.hiddenCovers.video}
                  variant="videos"
                  onLoadMore={props.onLoadMoreVideos}
                  onSelect={props.onSelectVideo}
                />
              </Show>
            </PageBody>
            <BackToTop label={t("media.scroll.top")} />
          </>
        )}
      </PageStickyHeader>
    </PageSurface>
  );
}

interface ArtistCountIconProps {
  kind: ArtistCountKey;
}

function ArtistCountIcon(props: ArtistCountIconProps) {
  return (
    <Show
      when={props.kind === "albums"}
      fallback={
        <Show when={props.kind === "videos"} fallback={<IconMusic />}>
          <IconVideo />
        </Show>
      }
    >
      <IconAlbum />
    </Show>
  );
}

interface ArtistResourceGridProps {
  items: FeedCardItem[];
  isLoading: boolean;
  hasMore: boolean;
  emptyText: string;
  loadingText: string;
  loadMoreText: string;
  coverHidden: boolean;
  variant?: "albums" | "videos";
  onLoadMore: () => void | Promise<void>;
  onSelect: (item: FeedCardItem) => void | Promise<void>;
}

function ArtistResourceGrid(props: ArtistResourceGridProps) {
  return (
    <div class="ncm-artist-resource-panel">
      <Show
        when={props.items.length > 0}
        fallback={<NaiveP class="panel-note">{props.isLoading ? props.loadingText : props.emptyText}</NaiveP>}
      >
        <div class={`album-grid content-fade-in ncm-artist-resource-grid${props.variant === "videos" ? " ncm-artist-resource-grid--videos" : ""}`}>
          <For each={props.items}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle}
                coverUrl={item.coverUrl}
                coverVisible={!props.coverHidden}
                playCount={item.playCount}
                description={item.description}
                onClick={() => void props.onSelect(item)}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.hasMore && props.items.length > 0}>
        <div class="online-discover-load-more">
          <button
            type="button"
            class="ghost-button"
            disabled={props.isLoading}
            onClick={() => void props.onLoadMore()}
          >
            {props.isLoading ? props.loadingText : props.loadMoreText}
          </button>
        </div>
      </Show>
    </div>
  );
}
