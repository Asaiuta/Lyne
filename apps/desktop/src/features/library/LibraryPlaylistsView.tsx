import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import {
  IconChevronLeft,
  IconDelete,
  IconMusic,
  IconPlaylist,
  IconPlay,
  IconPlus,
  IconSearch
} from "../../components/icons";
import {
  MediaList,
  type MediaContextAction,
  type MediaSortField,
  type MediaSortOrder,
  type MediaSortState
} from "../../components/media/MediaList";
import { CoverGridSkeleton } from "../../components/page/Skeleton";
import type { LocalPlaylist } from "../../shared/api/types";
import { createApiClient } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { resolveArtworkUrl } from "../../shared/ui/artwork";
import type { LibraryListItem } from "./libraryViewTypes";

interface LibraryPlaylistsViewProps {
  playlists: readonly LocalPlaylist[];
  selectedPlaylistId: string | null;
  items: LibraryListItem[];
  currentTrackPath: string | null;
  currentMediaId: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  sort: MediaSortState;
  onSortChange: (field: MediaSortField) => void;
  onSortOrderChange: (order: MediaSortOrder) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onCreatePlaylist: () => void;
  onDeletePlaylist: (playlist: LocalPlaylist) => void;
  onPlay: (item: LibraryListItem, contextItems: readonly LibraryListItem[]) => void;
  onEnqueue: (item: LibraryListItem) => void;
  onContextAction: (action: MediaContextAction, item: LibraryListItem) => void;
  onActiveItemsChange: (items: LibraryListItem[]) => void;
}

export function LibraryPlaylistsView(props: LibraryPlaylistsViewProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const api = createApiClient();
  const [filter, setFilter] = createSignal<string>("");
  const [isScrolled, setIsScrolled] = createSignal<boolean>(false);

  const selectedPlaylist = createMemo<LocalPlaylist | null>(() => {
    const selected = props.selectedPlaylistId;
    return props.playlists.find((playlist) => playlist.playlist_id === selected) ?? null;
  });
  const selectedPlaylistItems = createMemo<LibraryListItem[]>(() => {
    const query = filter().trim().toLowerCase();
    if (!query) return props.items;
    return props.items.filter((item) =>
      [item.title, item.artist, item.album, item.source_path]
        .some((value) => value?.toLowerCase().includes(query))
    );
  });
  const playlistCover = (playlist: LocalPlaylist): string | null =>
    resolveArtworkUrl({
      externalArtworkUrl: playlist.cover_external_artwork_url,
      mediaId: playlist.cover_media_id,
      hasCoverArt: playlist.cover_has_cover_art,
      urls: api
    });
  const playlistSubtitle = (playlist: LocalPlaylist): string =>
    t("library.group.songCount", { count: playlist.track_count });
  const playSelectedPlaylist = () => {
    const first = selectedPlaylistItems()[0];
    if (first) {
      props.onPlay(first, selectedPlaylistItems());
    }
  };
  const handlePlaylistScroll = (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    if (target.scrollHeight - target.clientHeight < 150) {
      setIsScrolled(false);
      return;
    }
    setIsScrolled(target.scrollTop > 80);
  };

  createEffect(() => {
    void props.selectedPlaylistId;
    setIsScrolled(false);
  });

  createEffect(() => {
    props.onActiveItemsChange(selectedPlaylistItems());
  });

  return (
    <Show
      when={props.playlists.length > 0}
      fallback={
        props.isLoading ? (
          <CoverGridSkeleton count={12} />
        ) : (
          <div class="local-playlist-placeholder" role="status">
            <span class="empty-tab-icon" aria-hidden="true">
              <IconPlaylist />
            </span>
            <div class="local-playlist-placeholder-copy">
              <strong>{t("library.tabs.playlists")}</strong>
              <span>{t("library.playlists.empty")}</span>
            </div>
            <button type="button" class="primary-button page-action" onClick={props.onCreatePlaylist}>
              <IconPlus />
              <span>{t("library.action.createPlaylist")}</span>
            </button>
          </div>
        )
      }
    >
      <Show
        when={selectedPlaylist()}
        fallback={
          <div class="local-playlist-grid-view">
            <div class="album-grid local-playlist-grid content-fade-in">
              <For each={props.playlists}>
                {(playlist) => (
                  <AlbumCard
                    title={playlist.name}
                    subtitle={playlistSubtitle(playlist)}
                    coverUrl={playlistCover(playlist)}
                    description={playlist.description}
                    coverVisible={!uiSettings.hiddenCovers.playlist}
                    active={props.selectedPlaylistId === playlist.playlist_id}
                    onClick={() => {
                      setFilter("");
                      props.onSelectPlaylist(playlist.playlist_id);
                    }}
                  />
                )}
              </For>
            </div>
          </div>
        }
      >
        {(playlist) => (
          <section class="playlist-detail local-playlist-detail">
            <div class={`playlist-detail-shell${isScrolled() ? " is-local-scrolled" : ""}`}>
              <header class={`playlist-detail-head${uiSettings.hiddenCovers.list ? " is-cover-hidden" : ""}`}>
                <Show when={!uiSettings.hiddenCovers.list}>
                  <div class="playlist-detail-art" aria-hidden="true">
                    <Show when={playlistCover(playlist())} fallback={<span>{playlist().name.slice(0, 1)}</span>}>
                      {(coverUrl) => (
                        <>
                          <img class="playlist-detail-art-img" src={coverUrl()} alt="" />
                          <img class="playlist-detail-art-shadow" src={coverUrl()} alt="" />
                        </>
                      )}
                    </Show>
                    <div class="playlist-detail-art-mask" />
                  </div>
                </Show>
                <div class="playlist-detail-copy">
                  <div class="playlist-detail-title-row">
                    <button
                      type="button"
                      class="ghost-button playlist-detail-back"
                      onClick={() => props.onSelectPlaylist("")}
                      aria-label={t("library.action.backToList")}
                      title={t("library.action.backToList")}
                    >
                      <IconChevronLeft />
                    </button>
                    <h2 title={playlist().name}>{playlist().name}</h2>
                  </div>
                  <div class="playlist-detail-collapse">
                    <Show when={uiSettings.playlistPageElements.description && playlist().description}>
                      {(description) => <p class="playlist-detail-desc">{description()}</p>}
                    </Show>
                    <div class="playlist-detail-meta">
                      <Show when={uiSettings.playlistPageElements.creator}>
                        <span>
                          <IconPlaylist />
                          {t("library.tabs.playlists")}
                        </span>
                      </Show>
                      <Show when={uiSettings.playlistPageElements.time}>
                        <span>
                          <IconMusic />
                          {t("library.group.songCount", { count: playlist().track_count })}
                        </span>
                      </Show>
                    </div>
                  </div>
                  <div class="playlist-detail-menu">
                    <div class="playlist-detail-menu-left">
                      <button
                        type="button"
                        class="primary-button playlist-detail-play"
                        onClick={playSelectedPlaylist}
                        disabled={selectedPlaylistItems().length === 0 || props.isLoading}
                      >
                        <IconPlay />
                        {t("library.action.playAll")}
                      </button>
                      <button
                        type="button"
                        class="ghost-button playlist-detail-icon-button"
                        onClick={() => props.onDeletePlaylist(playlist())}
                        aria-label={t("library.action.deletePlaylist")}
                        title={t("library.action.deletePlaylist")}
                      >
                        <IconDelete />
                      </button>
                    </div>
                    <div class="playlist-detail-menu-right">
                      <label class="playlist-detail-search">
                        <IconSearch />
                        <input
                          type="search"
                          value={filter()}
                          placeholder={t("library.tracks.fuzzySearch")}
                          onInput={(event) => setFilter(event.currentTarget.value)}
                        />
                      </label>
                      <div class="playlist-detail-tabs" role="tablist" aria-label={t("library.playlists.title")}>
                        <button type="button" class="is-active" role="tab" aria-selected="true">
                          {t("ncm.playlist.tab.songs")}
                          <span>{playlist().track_count}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </header>
              <MediaList
                items={selectedPlaylistItems()}
                currentSourcePath={props.currentTrackPath}
                currentMediaId={props.currentMediaId}
                isPlayingNow={props.isPlaying}
                onPlay={(item) => props.onPlay(item, selectedPlaylistItems())}
                onEnqueue={props.onEnqueue}
                onContextAction={props.onContextAction}
                onScroll={handlePlaylistScroll}
                isLoading={props.isLoading}
                emptyState={t("library.playlists.emptyTracks")}
                  contextActions={["play", "enqueue", "search", "copy-name", "show-in-folder", "delete-from-playlist"]}
                deleteActionLabel={t("library.action.removeFromPlaylist")}
                sort={props.sort}
                onSortChange={props.onSortChange}
                onSortOrderChange={props.onSortOrderChange}
              />
            </div>
          </section>
        )}
      </Show>
    </Show>
  );
}
