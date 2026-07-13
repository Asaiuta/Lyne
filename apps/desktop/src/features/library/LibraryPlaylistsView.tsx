import { For, Show, createEffect, createMemo } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import { IconPlaylist, IconPlus } from "../../components/icons";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import type {
  MediaSortField,
  MediaSortOrder,
  MediaSortState
} from "../../components/media/mediaListTypes";
import { CoverGridSkeleton } from "../../components/page/Skeleton";
import { PageToolbarButton } from "../../components/page/PageToolbarButton";
import type { LocalPlaylist } from "../../shared/api/types";
import { createApiClient } from "../../shared/api/client";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { resolveArtworkUrl } from "../../shared/ui/artwork";
import type { LibraryListItem } from "./libraryViewTypes";

type LocalPlaylistWithOptionalStats = LocalPlaylist & {
  play_count?: unknown;
  playCount?: unknown;
};

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

  const selectedPlaylistItems = createMemo<LibraryListItem[]>(() => props.items);
  const playlistCover = (playlist: LocalPlaylist): string | null =>
    resolveArtworkUrl({
      externalArtworkUrl: playlist.cover_external_artwork_url,
      mediaId: playlist.cover_media_id,
      hasCoverArt: playlist.cover_has_cover_art,
      urls: api
    });
  const playlistSubtitle = (playlist: LocalPlaylist): string =>
    t("library.group.songCount", { count: playlist.track_count });
  const playlistPlayCount = (playlist: LocalPlaylist): number | null => {
    const stats = playlist as LocalPlaylistWithOptionalStats;
    const value = stats.play_count ?? stats.playCount;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
  };
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
            <PageToolbarButton variant="primary" onClick={props.onCreatePlaylist}>
              <IconPlus />
              <span>{t("library.action.createPlaylist")}</span>
            </PageToolbarButton>
          </div>
        )
      }
    >
      <div class="local-playlist-grid-view">
        <div class="album-grid local-playlist-grid content-fade-in">
          <For each={props.playlists}>
            {(playlist) => (
              <AlbumCard
                title={playlist.name}
                subtitle={playlistSubtitle(playlist)}
                coverUrl={playlistCover(playlist)}
                description={playlist.description}
                playCount={playlistPlayCount(playlist)}
                coverVisible={!uiSettings.hiddenCovers.playlist}
                onClick={() => props.onSelectPlaylist(playlist.playlist_id)}
              />
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
