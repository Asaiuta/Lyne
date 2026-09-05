import { For, Show, createMemo, type JSX } from "solid-js";
import type { Resource } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { EmptyState } from "../../../components/EmptyState";
import { IconPlay } from "../../../components/icons";
import { VirtualizedGrid } from "../../../components/media/VirtualizedGrid";
import { NcmMediaList } from "../NcmMediaList";
import { CoverGridSkeleton } from "../../../components/page/CoverGridSkeleton";
import { LoadMoreButton } from "../../../components/page/LoadMoreButton";
import { SImage } from "../../../components/SImage";
import { usePlayback } from "../../../app/PlaybackContext";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import { coverSizeUrl } from "../../../shared/ui/coverSize";
import {
  NaiveDivider,
  NaiveGrid,
  NaiveGridItem,
  NaiveSkeleton,
  NaiveTabs,
  type NaiveTabItem
} from "../../../shared/ui/naive";
import { DISCOVER_PAGE_LIMIT, isTranslationKey } from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import type {
  DiscoverArtistArea,
  DiscoverArtistInitial,
  DiscoverCardItem,
  DiscoverMvFilter,
  DiscoverNewArea,
  DiscoverNewKind,
  DiscoverPlaylistKind,
  FeedCardItem,
  DiscoverToplistItem,
  OnlineTrackItem
} from "../shared/types";
import { playlistSummaryFromDiscoverCard, type OnlinePlaylistSummary } from "../ncmPlaylistSummary";

export interface DiscoverPlaylistShowcaseProps {
  catName: string;
  hasHqPlaylist: boolean;
  discoverPlaylistKind: DiscoverPlaylistKind;
  setDiscoverPlaylistKind: (kind: DiscoverPlaylistKind) => void;
  setCatModalOpen: (open: boolean) => void;
  setCatButtonRef: (element: HTMLButtonElement) => void;
  discoverSectionTitle: string;
  allPlaylists: DiscoverCardItem[];
  isLoadingPlaylists: boolean;
  hasMorePlaylists: boolean;
  onLoadPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  onLoadMore: () => void;
}

export function DiscoverPlaylistShowcase(props: DiscoverPlaylistShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const playlistKindTabs = createMemo<ReadonlyArray<NaiveTabItem<DiscoverPlaylistKind>>>(() => [
    { value: "normal", label: t("ncm.discover.playlists.recommend") },
    { value: "hq", label: t("ncm.discover.playlists.hq") }
  ]);
  return (
    <section class="online-discover-section online-discover-playlists online-catalog-context">
      <div class="online-discover-menu">
        <button
          ref={(element) => props.setCatButtonRef(element)}
          type="button"
          class="online-discover-cat-button"
          onClick={() => props.setCatModalOpen(true)}
        >
          <span class="online-discover-cat-button-label">{props.catName}</span>
          <span class="online-discover-cat-button-arrow" aria-hidden="true">›</span>
        </button>
        <Show when={props.hasHqPlaylist}>
          <NaiveTabs
            class="online-discover-mini-tabs"
            value={props.discoverPlaylistKind}
            onChange={props.setDiscoverPlaylistKind}
            items={playlistKindTabs()}
            type="segment"
            ariaLabel={t("ncm.discover.section.playlists")}
          />
        </Show>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.discoverSectionTitle}</strong>
        </div>
      </div>
      <Show
        when={props.allPlaylists.length > 0}
        fallback={
          props.isLoadingPlaylists ? (
            <CoverGridSkeleton count={20} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} />
          )
        }
      >
        <VirtualizedGrid
          class="album-grid cover-list-grid content-fade-in"
          items={props.allPlaylists}
          renderItem={(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              playCount={item.playCount}
              description={item.description}
              coverVisible={!uiSettings.hiddenCovers.playlist}
              onClick={() =>
                void props.onLoadPlaylist(playlistSummaryFromDiscoverCard(item))
              }
            />
          )}
        />
      </Show>
      <Show when={props.hasMorePlaylists && props.allPlaylists.length > 0}>
        <div class="load-more-button-row">
          <LoadMoreButton
            label={t("ncm.discover.loadMore")}
            loading={props.isLoadingPlaylists}
            loadingLabel={t("ncm.playlist.loading")}
            onClick={props.onLoadMore}
          />
        </div>
      </Show>
    </section>
  );
}

export interface DiscoverArtistShowcaseProps {
  artistInitials: readonly DiscoverArtistInitial[];
  artistAreas: readonly DiscoverArtistArea[];
  discoverArtistInitial: number | string;
  setDiscoverArtistInitial: (key: number | string) => void;
  discoverArtistAreaIndex: number;
  setDiscoverArtistAreaIndex: (index: number) => void;
  discoverSectionTitle: string;
  allArtists: DiscoverCardItem[];
  isLoadingArtists: boolean;
  hasMoreArtists: boolean;
  onLoadArtist: (artist: DiscoverCardItem) => void | Promise<void>;
  onLoadMore: () => void;
}

export function DiscoverArtistShowcase(props: DiscoverArtistShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  return (
    <section class="online-discover-section online-discover-artists online-catalog-context">
      <div class="online-discover-filter-menu">
        <For each={props.artistInitials}>
          {(item) => (
            <button type="button" class={props.discoverArtistInitial === item.key ? "is-active" : ""} onClick={() => props.setDiscoverArtistInitial(item.key)}>
              {isTranslationKey(item.label) ? t(item.label) : item.label}
            </button>
          )}
        </For>
      </div>
      <div class="online-discover-filter-menu online-discover-filter-menu--category">
        <For each={props.artistAreas}>
          {(item, index) => (
            <button type="button" class={props.discoverArtistAreaIndex === index() ? "is-active" : ""} onClick={() => props.setDiscoverArtistAreaIndex(index())}>
              {t(item.labelKey)}
            </button>
          )}
        </For>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.discoverSectionTitle}</strong>
        </div>
      </div>
      <Show
        when={props.allArtists.length > 0}
        fallback={
          props.isLoadingArtists ? (
            <CoverGridSkeleton count={20} shape="round" />
          ) : (
            <EmptyState description={t("ncm.home.empty")} />
          )
        }
      >
        <VirtualizedGrid
          class="album-grid cover-list-grid content-fade-in"
          items={props.allArtists}
          estimatedRowHeight={180}
          renderItem={(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={!uiSettings.hiddenCovers.artist}
              shape="round"
              size="sm"
              onClick={() => void props.onLoadArtist(item)}
            />
          )}
        />
      </Show>
      <Show when={props.hasMoreArtists && props.allArtists.length > 0}>
        <div class="load-more-button-row">
          <LoadMoreButton
            label={t("ncm.discover.loadMore")}
            loading={props.isLoadingArtists}
            loadingLabel={t("ncm.playlist.loading")}
            onClick={props.onLoadMore}
          />
        </div>
      </Show>
    </section>
  );
}

export interface DiscoverToplistShowcaseProps {
  discoverToplists: Resource<DiscoverToplistItem[]>;
  onLoadPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
}

interface OfficialToplistGridProps {
  children: JSX.Element;
  loading?: boolean;
}

function OfficialToplistGrid(props: OfficialToplistGridProps) {
  return (
    <NaiveGrid
      class={`online-toplist-grid${props.loading ? " online-toplist-grid--loading" : " content-fade-in"}`}
      cols="1 600:2 1000:3"
      xGap={20}
      yGap={20}
      role="presentation"
    >
      {props.children}
    </NaiveGrid>
  );
}

interface OfficialToplistCardProps {
  coverVisible: boolean;
  item: DiscoverToplistItem;
  onClick: () => void;
}

function OfficialToplistCard(props: OfficialToplistCardProps) {
  return (
    <button
      type="button"
      class={`online-toplist-card${props.coverVisible ? "" : " is-cover-hidden"}`}
      onClick={props.onClick}
    >
      <div class="online-toplist-title-row">
        <strong class="online-toplist-title">{props.item.title}</strong>
        <Show when={props.item.subtitle}>
          {(subtitle) => <span class="online-toplist-desc">{subtitle()}</span>}
        </Show>
      </div>
      <div class="online-toplist-content-row">
        <Show when={props.coverVisible}>
          <div class="online-toplist-cover" aria-hidden="true">
            <Show
              when={props.item.coverUrl}
              fallback={<span class="online-toplist-cover-fallback">{props.item.title.slice(0, 1)}</span>}
            >
              {(coverUrl) => (
                <SImage
                  src={coverSizeUrl(coverUrl(), "m")}
                  alt=""
                  observeVisibility={true}
                  shape="rect"
                  aspect="square"
                />
              )}
            </Show>
            <span class="online-toplist-cover-play" aria-hidden="true">
              <IconPlay />
            </span>
          </div>
        </Show>
        <div class="online-toplist-songs">
          <For each={props.item.tracks.slice(0, 3)}>
            {(track, index) => (
              <span class="online-toplist-song">
                <span>{index() + 1}. {track.title}</span>
                <Show when={track.artist}>
                  {(artist) => <small>{artist()}</small>}
                </Show>
              </span>
            )}
          </For>
        </div>
      </div>
    </button>
  );
}

interface OfficialToplistSkeletonProps {
  coverVisible: boolean;
}

function OfficialToplistSkeleton(props: OfficialToplistSkeletonProps) {
  return (
    <OfficialToplistGrid loading>
      <For each={Array.from({ length: 4 }, (_, index) => index)}>
        {() => (
          <NaiveGridItem>
            <div
              class={`online-toplist-card online-toplist-card--skeleton${props.coverVisible ? "" : " is-cover-hidden"}`}
              aria-hidden="true"
            >
              <div class="online-toplist-title-row">
                <NaiveSkeleton class="online-toplist-skeleton-title" shape="text" />
                <NaiveSkeleton class="online-toplist-skeleton-desc" shape="text" />
              </div>
              <div class="online-toplist-content-row">
                <Show when={props.coverVisible}>
                  <NaiveSkeleton class="online-toplist-cover" />
                </Show>
                <div class="online-toplist-songs">
                  <NaiveSkeleton class="online-toplist-skeleton-song" shape="text" />
                  <NaiveSkeleton class="online-toplist-skeleton-song" shape="text" />
                  <NaiveSkeleton class="online-toplist-skeleton-song" shape="text" />
                </div>
              </div>
            </div>
          </NaiveGridItem>
        )}
      </For>
    </OfficialToplistGrid>
  );
}

export function DiscoverToplistShowcase(props: DiscoverToplistShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const officialItems = () => (props.discoverToplists() ?? []).filter((item) => item.isOfficial);
  const selectedItems = () => (props.discoverToplists() ?? []).filter((item) => !item.isOfficial);
  const isLoading = () => props.discoverToplists.loading;
  return (
    <section class="online-discover-section online-discover-toplists online-catalog-context">
      <NaiveDivider class="online-discover-divider">
        {t("ncm.discover.toplists.official")}
      </NaiveDivider>
      <Show
        when={officialItems().length > 0}
        fallback={
          isLoading() ? (
            <OfficialToplistSkeleton coverVisible={!uiSettings.hiddenCovers.toplist} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} size="sm" />
          )
        }
      >
        <OfficialToplistGrid>
          <For each={officialItems()}>
            {(item) => (
              <NaiveGridItem>
                <OfficialToplistCard
                  item={item}
                  coverVisible={!uiSettings.hiddenCovers.toplist}
                  onClick={() => void props.onLoadPlaylist(playlistSummaryFromDiscoverCard(item))}
                />
              </NaiveGridItem>
            )}
          </For>
        </OfficialToplistGrid>
      </Show>

      <NaiveDivider class="online-discover-divider online-discover-divider--selected">
        {t("ncm.discover.toplists.selected")}
      </NaiveDivider>
      <Show
        when={selectedItems().length > 0}
        fallback={
          isLoading() ? (
            <CoverGridSkeleton count={12} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} size="sm" />
          )
        }
      >
        <div class="album-grid cover-list-grid content-fade-in">
          <For each={selectedItems()}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle ?? item.description}
                coverUrl={item.coverUrl}
                playCount={item.playCount}
                description={item.description}
                coverVisible={!uiSettings.hiddenCovers.toplist}
                onClick={() =>
                  void props.onLoadPlaylist(playlistSummaryFromDiscoverCard(item))
                }
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}

export interface DiscoverNewShowcaseProps {
  newAreas: readonly DiscoverNewArea[];
  discoverNewKind: DiscoverNewKind;
  setDiscoverNewKind: (kind: DiscoverNewKind) => void;
  discoverNewAreaIndex: number;
  setDiscoverNewAreaIndex: (index: number) => void;
  discoverSectionTitle: string;
  allAlbums: DiscoverCardItem[];
  discoverSongs: Resource<OnlineTrackItem[]>;
  isLoadingAlbums: boolean;
  hasMoreAlbums: boolean;
  onLoadMoreAlbums: () => void;
  onLoadAlbum: (album: DiscoverCardItem) => void | Promise<void>;
  playback: PlaybackController;
}

export interface DiscoverMvShowcaseProps {
  mvAreas: readonly DiscoverMvFilter[];
  mvTypes: readonly DiscoverMvFilter[];
  mvOrders: readonly DiscoverMvFilter[];
  discoverMvAreaIndex: number;
  setDiscoverMvAreaIndex: (index: number) => void;
  discoverMvTypeIndex: number;
  setDiscoverMvTypeIndex: (index: number) => void;
  discoverMvOrderIndex: number;
  setDiscoverMvOrderIndex: (index: number) => void;
  discoverSectionTitle: string;
  allVideos: FeedCardItem[];
  isLoadingVideos: boolean;
  hasMoreVideos: boolean;
  onLoadVideo: (video: FeedCardItem) => void | Promise<void>;
  onLoadMore: () => void;
}

export function DiscoverMvShowcase(props: DiscoverMvShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  return (
    <section class="online-discover-section online-discover-videos online-catalog-context">
      <div class="online-discover-menu online-discover-menu--stacked">
        <div class="online-discover-filter-menu">
          <For each={props.mvAreas}>
            {(item, index) => (
              <button type="button" class={props.discoverMvAreaIndex === index() ? "is-active" : ""} onClick={() => props.setDiscoverMvAreaIndex(index())}>
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
        <div class="online-discover-filter-menu online-discover-filter-menu--category">
          <For each={props.mvTypes}>
            {(item, index) => (
              <button type="button" class={props.discoverMvTypeIndex === index() ? "is-active" : ""} onClick={() => props.setDiscoverMvTypeIndex(index())}>
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
        <div class="online-discover-filter-menu online-discover-filter-menu--category">
          <For each={props.mvOrders}>
            {(item, index) => (
              <button type="button" class={props.discoverMvOrderIndex === index() ? "is-active" : ""} onClick={() => props.setDiscoverMvOrderIndex(index())}>
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.discoverSectionTitle}</strong>
        </div>
      </div>
      <Show
        when={props.allVideos.length > 0}
        fallback={
          props.isLoadingVideos ? (
            <CoverGridSkeleton count={20} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} />
          )
        }
      >
        <VirtualizedGrid
          class="album-grid cover-list-grid online-discover-video-grid content-fade-in"
          items={props.allVideos}
          estimatedRowHeight={220}
          renderItem={(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={!uiSettings.hiddenCovers.video}
              onClick={() => void props.onLoadVideo(item)}
            />
          )}
        />
      </Show>
      <Show when={props.hasMoreVideos && props.allVideos.length > 0}>
        <div class="load-more-button-row">
          <LoadMoreButton
            label={t("ncm.discover.loadMore")}
            loading={props.isLoadingVideos}
            loadingLabel={t("ncm.playlist.loading")}
            onClick={props.onLoadMore}
          />
        </div>
      </Show>
    </section>
  );
}

export function DiscoverNewShowcase(props: DiscoverNewShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const playbackContext = usePlayback();
  const songs = () => props.discoverSongs() ?? [];
  const hasVisibleItems = () => (props.discoverNewKind === "albums" ? props.allAlbums.length > 0 : songs().length > 0);

  return (
    <section class="online-discover-section online-discover-new online-catalog-context">
      <div class="online-discover-menu">
        <div class="online-discover-filter-menu">
          <button type="button" class={props.discoverNewKind === "albums" ? "is-active" : ""} onClick={() => props.setDiscoverNewKind("albums")}>
            {t("ncm.discover.new.albums")}
          </button>
          <button type="button" class={props.discoverNewKind === "songs" ? "is-active" : ""} onClick={() => props.setDiscoverNewKind("songs")}>
            {t("ncm.discover.new.songs")}
          </button>
        </div>
        <div class="online-discover-filter-menu">
          <For each={props.newAreas}>
            {(item, index) => (
              <button type="button" class={props.discoverNewAreaIndex === index() ? "is-active" : ""} onClick={() => props.setDiscoverNewAreaIndex(index())}>
                {t(item.labelKey)}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.discoverSectionTitle}</strong>
        </div>
      </div>
      <Show
        when={hasVisibleItems()}
        fallback={
          props.isLoadingAlbums ? (
            <CoverGridSkeleton count={20} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} />
          )
        }
      >
        <Show when={props.discoverNewKind === "albums"} fallback={
          <div class="online-discover-card-stack content-fade-in">
            <NcmMediaList
              items={songs()}
              currentSourcePath={playbackContext.currentTrackPath()}
              currentSongId={playbackContext.currentSongId()}
              isPlayingNow={playbackContext.isPlaying()}
              hideArtwork={uiSettings.hiddenCovers.new}
              onPlay={(item) => void props.playback.playOnlineTrack(item)}
              onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
              emptyState={<EmptyState description={t("ncm.empty.noSongs")} />}
            />
          </div>
        }>
          <div class="online-discover-card-stack content-fade-in">
            <VirtualizedGrid
              class="album-grid cover-list-grid"
              items={props.allAlbums}
              renderItem={(item) => (
                <AlbumCard
                  title={item.title}
                  subtitle={item.subtitle}
                  coverUrl={item.coverUrl}
                  coverVisible={!uiSettings.hiddenCovers.new}
                  onClick={() => void props.onLoadAlbum(item)}
                />
              )}
            />
            <Show when={props.hasMoreAlbums}>
              <div class="load-more-button-row">
                <LoadMoreButton
                  label={t("ncm.discover.loadMore")}
                  loading={props.isLoadingAlbums}
                  loadingLabel={t("ncm.playlist.loading")}
                  onClick={props.onLoadMoreAlbums}
                />
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}

export const DISCOVER_SHOWCASE_PAGE_LIMIT = DISCOVER_PAGE_LIMIT;
