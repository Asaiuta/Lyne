import { For, Match, Show, Switch, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { MediaList } from "../../../components/media/MediaList";
import { SegmentedTabs } from "../../../components/page/SegmentedTabs";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem, SearchTab } from "../shared/types";

export interface SearchModeProps {
  searchTab: SearchTab;
  onSearchTabChange: (tab: SearchTab) => void;
  isSearching: boolean;
  songResults: OnlineTrackItem[];
  playlistResults: OnlinePlaylistSummary[];
  artistResults: FeedCardItem[];
  albumResults: FeedCardItem[];
  videoResults: FeedCardItem[];
  radioResults: FeedCardItem[];
  globalQuery: Accessor<string>;
  parentMode: "recommend" | "discover";
  onSelectPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  onSelectArtist: (artist: FeedCardItem) => void | Promise<void>;
  onSelectAlbum: (album: FeedCardItem) => void | Promise<void>;
  onSelectVideo: (video: FeedCardItem) => void | Promise<void>;
  onSelectRadio?: (radio: FeedCardItem) => void | Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  discoverSectionSubtitle: string;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function SearchMode(props: SearchModeProps) {
  const { t } = useTranslation();
  const tabItems = createMemo(() => [
    { value: "songs", label: t("ncm.tabs.songs") },
    { value: "playlists", label: t("ncm.tabs.playlists") },
    { value: "artists", label: t("ncm.tabs.artists") },
    { value: "albums", label: t("ncm.tabs.albums") },
    { value: "videos", label: t("ncm.tabs.videos") },
    { value: "radios", label: t("ncm.tabs.radios") }
  ]);
  const searchKeyword = createMemo(() => props.globalQuery().trim());

  return (
    <section class="online-search-page">
      <div class="online-search-title">
        <h1>{searchKeyword() || t("ncm.search.title")}</h1>
        <span>
          {searchKeyword()
            ? t("ncm.search.relatedSuffix")
            : props.parentMode === "recommend"
              ? t("ncm.results.idle.recommend")
              : t("ncm.results.idle.discover")}
        </span>
      </div>
      <div class="online-search-tabs">
        <SegmentedTabs
          value={props.searchTab}
          onChange={(next) => props.onSearchTabChange(next as SearchTab)}
          items={tabItems()}
          ariaLabel={t("ncm.tabs.aria")}
        />
      </div>

      <div class="online-search-router">
        <Switch>
          <Match when={props.searchTab === "songs"}>
            <SongsResultPanel {...props} />
          </Match>
          <Match when={props.searchTab === "playlists"}>
            <PlaylistResultsPanel {...props} />
          </Match>
          <Match when={props.searchTab === "artists"}>
            <FeedCardResultsPanel
              items={props.artistResults}
              tab="artists"
              isSearching={props.isSearching}
              onSelect={props.onSelectArtist}
            />
          </Match>
          <Match when={props.searchTab === "albums"}>
            <FeedCardResultsPanel
              items={props.albumResults}
              tab="albums"
              isSearching={props.isSearching}
              onSelect={props.onSelectAlbum}
            />
          </Match>
          <Match when={props.searchTab === "videos"}>
            <FeedCardResultsPanel
              items={props.videoResults}
              tab="videos"
              isSearching={props.isSearching}
              onSelect={props.onSelectVideo}
            />
          </Match>
          <Match when={props.searchTab === "radios"}>
            <FeedCardResultsPanel
              items={props.radioResults}
              tab="radios"
              isSearching={props.isSearching}
              onSelect={(item) => void props.onSelectRadio?.(item)}
            />
          </Match>
        </Switch>
      </div>
    </section>
  );
}

function SongsResultPanel(props: SearchModeProps) {
  const { t } = useTranslation();
  return (
    <MediaList
      items={props.songResults}
      currentSourcePath={props.currentTrackPath}
      currentSongId={props.currentSongId}
      isPlayingNow={props.isPlaying}
      onPlay={(item) => void props.playback.playOnlineTrack(item)}
      onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
      onContextAction={(action, item) => {
        if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
      }}
      isLoading={props.isSearching}
      emptyState={
        <SearchEmptyState
          title={props.globalQuery().trim() ? t("ncm.empty.noSongs") : t("ncm.empty.searchPrompt")}
          hint={
            props.globalQuery().trim()
              ? t("ncm.empty.noSongsHint")
              : props.parentMode === "recommend"
                ? t("ncm.empty.searchPromptHint.recommend")
                : t("ncm.empty.searchPromptHint.discover")
          }
        />
      }
    />
  );
}

function PlaylistResultsPanel(props: SearchModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  return (
    <Show
      when={props.playlistResults.length > 0}
      fallback={
        <SearchEmptyState
          title={props.isSearching ? t("ncm.search.searching") : t("ncm.empty.noPlaylists")}
          hint={props.discoverSectionSubtitle}
        />
      }
    >
      <div class="album-grid content-fade-in online-search-card-grid">
        <For each={props.playlistResults}>
          {(playlist) => (
            <AlbumCard
              title={playlist.name}
              subtitle={t("ncm.playlist.meta", {
                count: playlist.trackCount ?? 0,
                creator: playlist.creator ?? t("ncm.playlist.creatorUnknown")
              })}
              coverUrl={playlist.coverUrl}
              coverVisible={!uiSettings.hiddenCovers.playlist}
              playCount={playlist.playCount}
              description={playlist.description}
              onClick={() => void props.onSelectPlaylist(playlist)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

interface FeedCardResultsPanelProps {
  items: FeedCardItem[];
  tab: Exclude<SearchTab, "songs" | "playlists">;
  isSearching: boolean;
  onSelect: (item: FeedCardItem) => void | Promise<void>;
}

function FeedCardResultsPanel(props: FeedCardResultsPanelProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const emptyTitle = () => {
    if (props.isSearching) return t("ncm.search.searching");
    const tab = props.tab;
    switch (tab) {
      case "artists": return t("ncm.empty.noArtists");
      case "albums": return t("ncm.empty.noAlbums");
      case "videos": return t("ncm.empty.noVideos");
      case "radios": return t("ncm.empty.noRadios");
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  };
  const emptyHint = () => {
    const tab = props.tab;
    switch (tab) {
      case "artists": return t("ncm.empty.noArtistsHint");
      case "albums": return t("ncm.empty.noAlbumsHint");
      case "videos": return t("ncm.empty.noVideosHint");
      case "radios": return t("ncm.empty.noRadiosHint");
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  };
  const coverVisible = () => {
    const tab = props.tab;
    switch (tab) {
      case "artists": return !uiSettings.hiddenCovers.artist;
      case "albums": return !uiSettings.hiddenCovers.album;
      case "videos": return !uiSettings.hiddenCovers.video;
      case "radios": return !uiSettings.hiddenCovers.radio;
      default: { const _exhaustive: never = tab; return _exhaustive; }
    }
  };
  return (
    <Show
      when={props.items.length > 0}
      fallback={<SearchEmptyState title={emptyTitle()} hint={emptyHint()} />}
    >
      <div class={`album-grid content-fade-in online-search-card-grid online-search-card-grid--${props.tab}`}>
        <For each={props.items}>
          {(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={coverVisible()}
              shape={props.tab === "artists" ? "round" : "square"}
              size={props.tab === "artists" ? "sm" : "md"}
              playCount={item.playCount}
              description={item.description}
              onClick={() => void props.onSelect(item)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

interface SearchEmptyStateProps {
  title: string;
  hint: string;
}

function SearchEmptyState(props: SearchEmptyStateProps) {
  return (
    <div class="online-search-empty">
      <strong>{props.title}</strong>
      <span>{props.hint}</span>
    </div>
  );
}
