import { For, Show } from "solid-js";
import type { Resource } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { EmptyState } from "../../../components/EmptyState";
import { IconPlay, IconSpinner } from "../../../components/icons";
import { MediaList } from "../../../components/media/MediaList";
import { CoverGridSkeleton } from "../../../components/page/Skeleton";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
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

interface LoadMoreButtonProps {
  isLoading: boolean;
  onClick: () => void;
}

function LoadMoreButton(props: LoadMoreButtonProps) {
  const { t } = useTranslation();
  return (
    <div class="online-discover-load-more">
      <button
        type="button"
        class="ghost-button"
        disabled={props.isLoading}
        onClick={props.onClick}
      >
        <Show when={props.isLoading}>
          <span class="button-spinner" aria-hidden="true">
            <IconSpinner />
          </span>
        </Show>
        {props.isLoading ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
      </button>
    </div>
  );
}

export interface DiscoverPlaylistShowcaseProps {
  catName: string;
  hasHqPlaylist: boolean;
  discoverPlaylistKind: DiscoverPlaylistKind;
  setDiscoverPlaylistKind: (kind: DiscoverPlaylistKind) => void;
  setCatModalOpen: (open: boolean) => void;
  discoverSectionTitle: string;
  discoverSectionSubtitle: string;
  allPlaylists: DiscoverCardItem[];
  isLoadingPlaylists: boolean;
  hasMorePlaylists: boolean;
  onLoadPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  onLoadMore: () => void;
}

export function DiscoverPlaylistShowcase(props: DiscoverPlaylistShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  return (
    <section class="online-discover-section online-discover-playlists">
      <div class="online-discover-menu">
        <button type="button" class="online-discover-cat-button" onClick={() => props.setCatModalOpen(true)}>
          {props.catName}
          <span aria-hidden="true">›</span>
        </button>
        <Show when={props.hasHqPlaylist}>
          <div class="online-discover-mini-tabs">
            <button type="button" class={props.discoverPlaylistKind === "normal" ? "is-active" : ""} onClick={() => props.setDiscoverPlaylistKind("normal")}>
              {t("ncm.discover.playlists.recommend")}
            </button>
            <button type="button" class={props.discoverPlaylistKind === "hq" ? "is-active" : ""} onClick={() => props.setDiscoverPlaylistKind("hq")}>
              {t("ncm.discover.playlists.hq")}
            </button>
          </div>
        </Show>
      </div>
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.discoverSectionTitle}</strong>
          <span>{props.discoverSectionSubtitle}</span>
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
        <div class="album-grid content-fade-in">
          <For each={props.allPlaylists}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle}
                coverUrl={item.coverUrl}
                coverVisible={!uiSettings.hiddenCovers.playlist}
                onClick={() =>
                  void props.onLoadPlaylist(playlistSummaryFromDiscoverCard(item))
                }
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.hasMorePlaylists && props.allPlaylists.length > 0}>
        <LoadMoreButton
          isLoading={props.isLoadingPlaylists}
          onClick={props.onLoadMore}
        />
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
  discoverSectionSubtitle: string;
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
    <section class="online-discover-section online-discover-artists">
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
          <span>{props.discoverSectionSubtitle}</span>
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
        <div class="album-grid content-fade-in">
          <For each={props.allArtists}>
            {(item) => (
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
          </For>
        </div>
      </Show>
      <Show when={props.hasMoreArtists && props.allArtists.length > 0}>
        <LoadMoreButton
          isLoading={props.isLoadingArtists}
          onClick={props.onLoadMore}
        />
      </Show>
    </section>
  );
}

export interface DiscoverToplistShowcaseProps {
  discoverToplists: Resource<DiscoverToplistItem[]>;
  onLoadPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
}

export function DiscoverToplistShowcase(props: DiscoverToplistShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const officialItems = () => (props.discoverToplists() ?? []).filter((item) => item.isOfficial);
  const selectedItems = () => (props.discoverToplists() ?? []).filter((item) => !item.isOfficial);
  const isLoading = () => props.discoverToplists.loading;
  return (
    <section class="online-discover-section online-discover-toplists">
      <div class="online-discover-divider"><span>{t("ncm.discover.toplists.official")}</span></div>
      <Show
        when={officialItems().length > 0}
        fallback={
          isLoading() ? (
            <CoverGridSkeleton count={6} />
          ) : (
            <EmptyState description={t("ncm.home.empty")} size="sm" />
          )
        }
      >
        <div class="online-toplist-grid content-fade-in">
          <For each={officialItems()}>
            {(item) => (
              <button
                type="button"
                class={`online-toplist-card${uiSettings.hiddenCovers.toplist ? " is-cover-hidden" : ""}`}
                onClick={() =>
                  void props.onLoadPlaylist(playlistSummaryFromDiscoverCard(item))
                }
              >
                <Show when={!uiSettings.hiddenCovers.toplist}>
                  <div class="online-toplist-cover" aria-hidden="true">
                    <Show when={item.coverUrl} fallback={<span>{item.title.slice(0, 1)}</span>}>
                      {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
                    </Show>
                    <span class="online-toplist-cover-play" aria-hidden="true">
                      <IconPlay />
                    </span>
                  </div>
                </Show>
                <div class="online-toplist-copy">
                  <strong>{item.title}</strong>
                  <Show when={item.subtitle}>
                    {(subtitle) => <span class="online-toplist-desc">{subtitle()}</span>}
                  </Show>
                  <div class="online-toplist-songs">
                    <For each={item.tracks.slice(0, 3)}>
                      {(track, index) => (
                        <span class="online-toplist-song">
                          <span>{index() + 1}. {track.title}</span>
                          <small>{track.artist ?? ""}</small>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class="online-discover-divider"><span>{t("ncm.discover.toplists.selected")}</span></div>
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
        <div class="album-grid content-fade-in">
          <For each={selectedItems()}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle ?? item.description}
                coverUrl={item.coverUrl}
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
  discoverSectionSubtitle: string;
  allAlbums: DiscoverCardItem[];
  discoverSongs: Resource<OnlineTrackItem[]>;
  isLoadingAlbums: boolean;
  hasMoreAlbums: boolean;
  onLoadMoreAlbums: () => void;
  onLoadAlbum: (album: DiscoverCardItem) => void | Promise<void>;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
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
  discoverSectionSubtitle: string;
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
    <section class="online-discover-section online-discover-videos">
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
          <span>{props.discoverSectionSubtitle}</span>
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
        <div class="album-grid online-search-card-grid--videos content-fade-in">
          <For each={props.allVideos}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle}
                coverUrl={item.coverUrl}
                coverVisible={!uiSettings.hiddenCovers.video}
                onClick={() => void props.onLoadVideo(item)}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.hasMoreVideos && props.allVideos.length > 0}>
        <LoadMoreButton
          isLoading={props.isLoadingVideos}
          onClick={props.onLoadMore}
        />
      </Show>
    </section>
  );
}

export function DiscoverNewShowcase(props: DiscoverNewShowcaseProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const songs = () => props.discoverSongs() ?? [];
  const hasVisibleItems = () => (props.discoverNewKind === "albums" ? props.allAlbums.length > 0 : songs().length > 0);

  return (
    <section class="online-discover-section online-discover-new">
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
          <span>{props.discoverSectionSubtitle}</span>
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
            <MediaList
              items={songs().slice(0, 50)}
              currentSourcePath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlayingNow={props.isPlaying}
              hideArtwork={uiSettings.hiddenCovers.new}
              onPlay={(item) => void props.playback.playOnlineTrack(item)}
              onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
              emptyState={<EmptyState description={t("ncm.empty.noSongs")} />}
            />
          </div>
        }>
          <div class="online-discover-card-stack content-fade-in">
            <div class="album-grid">
              <For each={props.allAlbums}>
                {(item) => (
                  <AlbumCard
                    title={item.title}
                    subtitle={item.subtitle}
                    coverUrl={item.coverUrl}
                    coverVisible={!uiSettings.hiddenCovers.new}
                    onClick={() => void props.onLoadAlbum(item)}
                  />
                )}
              </For>
            </div>
            <Show when={props.hasMoreAlbums}>
              <LoadMoreButton
                isLoading={props.isLoadingAlbums}
                onClick={props.onLoadMoreAlbums}
              />
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}

export const DISCOVER_SHOWCASE_PAGE_LIMIT = DISCOVER_PAGE_LIMIT;
