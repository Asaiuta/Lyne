import { For, Match, Show, Switch, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { AlbumCard } from "../../../components/AlbumCard";
import { RouteContentTransition } from "../../../components/RouteContentTransition";
import {
  SegmentedTabs,
  type SegmentedTabItem
} from "../../../components/page/SegmentedTabs";
import { NcmMediaList } from "../NcmMediaList";
import { usePlayback } from "../../../app/PlaybackContext";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveH1 } from "../../../shared/ui/naive";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem, SearchTab } from "../shared/types";
import "../../../shared/styles/pages/online-search.css";
import "../../../shared/styles/pages/online-shared.css";

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
  searchQuery: Accessor<string>;
  onSelectPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  onSelectArtist: (artist: FeedCardItem) => void | Promise<void>;
  onSelectAlbum: (album: FeedCardItem) => void | Promise<void>;
  onSelectVideo: (video: FeedCardItem) => void | Promise<void>;
  onSelectRadio?: (radio: FeedCardItem) => void | Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  playlistEmptyHint: string;
  playback: PlaybackController;
}

export function SearchMode(props: SearchModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const tabItems = createMemo<ReadonlyArray<SegmentedTabItem<SearchTab>>>(() => [
    { value: "songs", label: t("ncm.tabs.songs") },
    { value: "playlists", label: t("ncm.tabs.playlists") },
    { value: "artists", label: t("ncm.tabs.artists") },
    { value: "albums", label: t("ncm.tabs.albums") },
    { value: "videos", label: t("ncm.tabs.videos") },
    { value: "radios", label: t("ncm.tabs.radios") }
  ]);
  const searchKeyword = createMemo(() => props.searchQuery().trim());

  return (
    <section class="online-search-page">
      <div class="online-search-title">
        <NaiveH1>{searchKeyword() || t("ncm.search.title")}</NaiveH1>
        <span>
          {searchKeyword()
            ? t("ncm.search.relatedSuffix")
            : t("ncm.results.idle.search")}
        </span>
      </div>
      <div class="online-search-tabs">
        <SegmentedTabs
          class="online-search-segment-tabs"
          value={props.searchTab}
          onChange={props.onSearchTabChange}
          items={tabItems()}
          variant="surface"
          ariaLabel={t("ncm.tabs.aria")}
        />
      </div>

      <RouteContentTransition
        value={props.searchTab}
        transitionKey={props.searchTab}
        animation={uiSettings.routeAnimation}
        motionScope="search-content"
      >
        {(displayedSearchTab) => (
          <div class="online-search-router" data-search-tab={displayedSearchTab()}>
            <Switch>
              <Match when={displayedSearchTab() === "songs"}>
                <SongsResultPanel {...props} />
              </Match>
              <Match when={displayedSearchTab() === "playlists"}>
                <PlaylistResultsPanel {...props} />
              </Match>
              <Match when={displayedSearchTab() === "artists"}>
                <FeedCardResultsPanel
                  items={props.artistResults}
                  tab="artists"
                  isSearching={props.isSearching}
                  onSelect={props.onSelectArtist}
                />
              </Match>
              <Match when={displayedSearchTab() === "albums"}>
                <FeedCardResultsPanel
                  items={props.albumResults}
                  tab="albums"
                  isSearching={props.isSearching}
                  onSelect={props.onSelectAlbum}
                />
              </Match>
              <Match when={displayedSearchTab() === "videos"}>
                <FeedCardResultsPanel
                  items={props.videoResults}
                  tab="videos"
                  isSearching={props.isSearching}
                  onSelect={props.onSelectVideo}
                />
              </Match>
              <Match when={displayedSearchTab() === "radios"}>
                <FeedCardResultsPanel
                  items={props.radioResults}
                  tab="radios"
                  isSearching={props.isSearching}
                  onSelect={(item) => void props.onSelectRadio?.(item)}
                />
              </Match>
            </Switch>
          </div>
        )}
      </RouteContentTransition>
    </section>
  );
}

function SongsResultPanel(props: SearchModeProps) {
  const { t } = useTranslation();
  const playbackContext = usePlayback();
  return (
    <NcmMediaList
      items={props.songResults}
      currentSourcePath={playbackContext.currentTrackPath()}
      currentSongId={playbackContext.currentSongId()}
      isPlayingNow={playbackContext.isPlaying()}
      onPlay={(item) => void props.playback.playOnlineTrack(item)}
      onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
      onContextAction={(action, item) => {
        if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
      }}
      isLoading={props.isSearching}
      emptyState={
        <SearchEmptyState
          title={props.searchQuery().trim() ? t("ncm.empty.noSongs") : t("ncm.empty.searchPrompt")}
          hint={
            props.searchQuery().trim()
              ? t("ncm.empty.noSongsHint")
              : t("ncm.empty.searchPromptHint.search")
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
          hint={props.playlistEmptyHint}
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
    <div class="online-empty-state">
      <strong>{props.title}</strong>
      <span>{props.hint}</span>
    </div>
  );
}
