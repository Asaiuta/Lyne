import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";
import { MediaList } from "../../../components/media/MediaList";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaybackController } from "../shared/playback";
import type { OnlineTrackItem, SearchTab } from "../shared/types";

interface PlaylistBrowserCardProps {
  playlist: OnlinePlaylistSummary;
  active: boolean;
  coverVisible: boolean;
  onSelect: () => void;
}

function PlaylistBrowserCard(props: PlaylistBrowserCardProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      class={`online-playlist-card${props.active ? " is-active" : ""}${props.coverVisible ? "" : " is-cover-hidden"}`}
      onClick={props.onSelect}
    >
      <Show when={props.coverVisible}>
        <div class="online-playlist-art" aria-hidden="true">
          <Show when={props.playlist.coverUrl} fallback={<span>{props.playlist.name.slice(0, 1)}</span>}>
            {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
          </Show>
        </div>
      </Show>
      <div class="online-playlist-copy">
        <strong>{props.playlist.name}</strong>
        <span>
          {t("ncm.playlist.meta", {
            count: props.playlist.trackCount ?? 0,
            creator: props.playlist.creator ?? t("ncm.playlist.creatorUnknown")
          })}
        </span>
      </div>
    </button>
  );
}

export interface SearchModeProps {
  searchTab: SearchTab;
  songResults: OnlineTrackItem[];
  playlistResults: OnlinePlaylistSummary[];
  globalQuery: Accessor<string>;
  parentMode: "recommend" | "discover";
  selectedPlaylist: OnlinePlaylistSummary | null;
  playlistTracks: OnlineTrackItem[];
  isLoadingPlaylistTracks: boolean;
  onSelectPlaylist: (playlist: OnlinePlaylistSummary) => void | Promise<void>;
  discoverSectionSubtitle: string;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function SearchMode(props: SearchModeProps) {
  return (
    <Show when={props.searchTab === "songs"} fallback={<SearchPlaylistLayout {...props} />}>
      <SongsResultPanel {...props} />
    </Show>
  );
}

function SongsResultPanel(props: SearchModeProps) {
  const { t } = useTranslation();
  return (
    <section class="online-result-panel">
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{props.searchTab === "songs" ? t("ncm.results.songs") : t("ncm.results.playlists")}</strong>
          <span>
            {props.globalQuery().trim()
              ? t("ncm.results.keyword", { keyword: props.globalQuery().trim() })
              : props.parentMode === "recommend"
                ? t("ncm.results.idle.recommend")
                : t("ncm.results.idle.discover")}
          </span>
        </div>
      </div>

      <MediaList
        items={props.songResults}
        currentSourcePath={props.currentTrackPath}
        currentSongId={props.currentSongId}
        isPlayingNow={props.isPlaying}
        onPlay={(item) => void props.playback.playOnlineTrack(item)}
        onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
        emptyState={
          <div class="online-search-empty">
            <strong>
              {props.globalQuery().trim() ? t("ncm.empty.noSongs") : t("ncm.empty.searchPrompt")}
            </strong>
            <span>
              {props.globalQuery().trim()
                ? t("ncm.empty.noSongsHint")
                : props.parentMode === "recommend"
                  ? t("ncm.empty.searchPromptHint.recommend")
                  : t("ncm.empty.searchPromptHint.discover")}
            </span>
          </div>
        }
      />
    </section>
  );
}

function SearchPlaylistLayout(props: SearchModeProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  return (
    <section class="online-result-panel">
      <div class="online-result-panel-head">
        <div class="online-result-panel-copy">
          <strong>{t("ncm.results.playlists")}</strong>
          <span>{props.discoverSectionSubtitle}</span>
        </div>
      </div>
      <Show
        when={props.playlistResults.length > 0}
        fallback={
          <div class="online-search-empty">
            <strong>
              {props.globalQuery().trim() ? t("ncm.empty.noPlaylists") : t("ncm.empty.searchPrompt")}
            </strong>
            <span>
              {props.globalQuery().trim()
                ? t("ncm.empty.searchPromptHint.discover")
                : t("ncm.empty.searchPromptHint.discover")}
            </span>
          </div>
        }
      >
        <div class="online-playlist-layout is-search-results">
          <aside class="online-playlist-browser">
            <div class="online-playlist-browser-head">
              <div class="online-playlist-browser-copy">
                <strong>{t("ncm.results.playlists")}</strong>
                <span>{t("ncm.playlist.browserCount", { count: props.playlistResults.length })}</span>
              </div>
            </div>
            <div class="online-playlist-grid">
              <For each={props.playlistResults}>
                {(playlist) => (
                  <PlaylistBrowserCard
                    playlist={playlist}
                    active={props.selectedPlaylist?.id === playlist.id}
                    coverVisible={!uiSettings.hiddenCovers.playlist}
                    onSelect={() => void props.onSelectPlaylist(playlist)}
                  />
                )}
              </For>
            </div>
          </aside>
          <section class="online-playlist-tracks">
            <Show
              when={props.selectedPlaylist}
              fallback={<div class="online-search-empty"><strong>{t("ncm.discover.search.selectPlaylist")}</strong></div>}
            >
              {(playlist) => (
                <>
                  <header class={`online-playlist-tracks-head${uiSettings.hiddenCovers.playlist ? " is-cover-hidden" : ""}`}>
                    <Show when={!uiSettings.hiddenCovers.playlist}>
                      <div class="online-playlist-tracks-art" aria-hidden="true">
                        <Show when={playlist().coverUrl} fallback={<span>{playlist().name.slice(0, 1)}</span>}>
                          {(coverUrl) => <img src={coverUrl()} alt="" loading="lazy" />}
                        </Show>
                      </div>
                    </Show>
                    <div class="online-playlist-tracks-copy">
                      <span class="online-playlist-tracks-eyebrow">{t("ncm.discover.search.playlistEyebrow")}</span>
                      <h3>{playlist().name}</h3>
                      <p>
                        {t("ncm.playlist.meta", {
                          count: playlist().trackCount ?? 0,
                          creator: playlist().creator ?? t("ncm.playlist.creatorUnknown")
                        })}
                      </p>
                    </div>
                  </header>
                  <MediaList
                    items={props.playlistTracks}
                    currentSourcePath={props.currentTrackPath}
                    currentSongId={props.currentSongId}
                    isPlayingNow={props.isPlaying}
                    onPlay={(item) => void props.playback.playOnlineTrack(item)}
                    onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
                    isLoading={props.isLoadingPlaylistTracks}
                    emptyState={<div class="panel-note">{t("ncm.empty.noTracks")}</div>}
                  />
                </>
              )}
            </Show>
          </section>
        </div>
      </Show>
    </section>
  );
}
