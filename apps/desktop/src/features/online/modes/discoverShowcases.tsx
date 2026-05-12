import { For, Show } from "solid-js";
import type { Resource } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { MediaList } from "../../../components/media/MediaList";
import { useTranslation } from "../../../shared/i18n";
import { isTranslationKey } from "../shared/parsers";
import type { PlaybackController } from "../shared/playback";
import type {
  DiscoverArtistArea,
  DiscoverArtistInitial,
  DiscoverCardItem,
  DiscoverNewArea,
  DiscoverNewKind,
  DiscoverPlaylistKind,
  DiscoverToplistItem,
  OnlineTrackItem
} from "../shared/types";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";

const DISCOVER_PAGE_LIMIT = 50;

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
      <Show when={props.allPlaylists.length > 0} fallback={<div class="panel-note">{props.isLoadingPlaylists ? t("ncm.playlist.loading") : t("ncm.home.empty")}</div>}>
        <div class="album-grid">
          <For each={props.allPlaylists}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle}
                coverUrl={item.coverUrl}
                onClick={() =>
                  void props.onLoadPlaylist({
                    id: item.id,
                    name: item.title,
                    creator: item.subtitle,
                    coverUrl: item.coverUrl,
                    trackCount: null,
                    subscribed: false
                  })
                }
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.hasMorePlaylists && props.allPlaylists.length > 0}>
        <div class="online-discover-load-more">
          <button
            type="button"
            class="ghost-button"
            disabled={props.isLoadingPlaylists}
            onClick={props.onLoadMore}
          >
            {props.isLoadingPlaylists ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
          </button>
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
  discoverSectionSubtitle: string;
  discoverArtists: Resource<DiscoverCardItem[]>;
}

export function DiscoverArtistShowcase(props: DiscoverArtistShowcaseProps) {
  const { t } = useTranslation();
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
      <Show when={(props.discoverArtists() ?? []).length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
        <div class="album-grid">
          <For each={props.discoverArtists() ?? []}>
            {(item) => <AlbumCard title={item.title} subtitle={item.subtitle} coverUrl={item.coverUrl} shape="round" size="sm" />}
          </For>
        </div>
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
  const officialItems = () => (props.discoverToplists() ?? []).filter((item) => item.isOfficial);
  const selectedItems = () => (props.discoverToplists() ?? []).filter((item) => !item.isOfficial);
  return (
    <section class="online-discover-section online-discover-toplists">
      <div class="online-discover-divider"><span>{t("ncm.discover.toplists.official")}</span></div>
      <Show when={officialItems().length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
        <div class="online-toplist-grid">
          <For each={officialItems()}>
            {(item) => (
              <button
                type="button"
                class="online-toplist-card"
                onClick={() =>
                  void props.onLoadPlaylist({
                    id: item.id,
                    name: item.title,
                    creator: item.subtitle,
                    coverUrl: item.coverUrl,
                    trackCount: null,
                    subscribed: false
                  })
                }
              >
                <div class="online-toplist-cover" aria-hidden="true">
                  <Show when={item.coverUrl} fallback={<span>{item.title.slice(0, 1)}</span>}>
                    {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
                  </Show>
                </div>
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
      <Show when={selectedItems().length > 0} fallback={<div class="panel-note">{t("ncm.home.empty")}</div>}>
        <div class="album-grid">
          <For each={selectedItems()}>
            {(item) => (
              <AlbumCard
                title={item.title}
                subtitle={item.subtitle ?? item.description}
                coverUrl={item.coverUrl}
                onClick={() =>
                  void props.onLoadPlaylist({
                    id: item.id,
                    name: item.title,
                    creator: item.subtitle,
                    coverUrl: item.coverUrl,
                    trackCount: null,
                    subscribed: false
                  })
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
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function DiscoverNewShowcase(props: DiscoverNewShowcaseProps) {
  const { t } = useTranslation();
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
      <Show when={hasVisibleItems()} fallback={<div class="panel-note">{props.isLoadingAlbums ? t("ncm.playlist.loading") : t("ncm.home.empty")}</div>}>
        <Show when={props.discoverNewKind === "albums"} fallback={
          <div class="online-discover-card-stack">
            <MediaList
              items={songs().slice(0, 50)}
              currentSourcePath={props.currentTrackPath}
              currentSongId={props.currentSongId}
              isPlayingNow={props.isPlaying}
              onPlay={(item) => void props.playback.playOnlineTrack(item)}
              onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
              emptyState={<div class="panel-note">{t("ncm.empty.noSongs")}</div>}
            />
          </div>
        }>
          <div class="online-discover-card-stack">
            <div class="album-grid">
              <For each={props.allAlbums}>
                {(item) => <AlbumCard title={item.title} subtitle={item.subtitle} coverUrl={item.coverUrl} />}
              </For>
            </div>
            <Show when={props.hasMoreAlbums}>
              <div class="online-discover-load-more">
                <button
                  type="button"
                  class="ghost-button"
                  disabled={props.isLoadingAlbums}
                  onClick={props.onLoadMoreAlbums}
                >
                  {props.isLoadingAlbums ? t("ncm.playlist.loading") : t("ncm.discover.loadMore")}
                </button>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    </section>
  );
}

export const DISCOVER_SHOWCASE_PAGE_LIMIT = DISCOVER_PAGE_LIMIT;
