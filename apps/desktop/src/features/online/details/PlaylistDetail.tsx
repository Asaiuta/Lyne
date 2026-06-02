import { For, Show, createMemo, createSignal } from "solid-js";
import {
  IconArtist,
  IconChevronLeft,
  IconClock,
  IconDots,
  IconHeart,
  IconHeartFilled,
  IconLink,
  IconList,
  IconPlay,
  IconRefresh,
  IconSearch,
  IconShare,
  IconTag
} from "../../../components/icons";
import type { MediaContextAction } from "../../../components/media/mediaContextActions";
import { NcmMediaList } from "../NcmMediaList";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageStickyHeader } from "../../../components/page/PageStickyHeader";
import { PageSurface } from "../../../components/page/PageSurface";
import { SImage } from "../../../components/SImage";
import { usePlayback } from "../../../app/PlaybackContext";
import { useTranslation } from "../../../shared/i18n";
import { copyToClipboard } from "../../../shared/utils/clipboard";
import { useUISettings } from "../../../shared/state/useUISettings";
import { coverSizeUrl } from "../../../shared/ui/coverSize";
import { NaiveDropdown, NaiveH2, NaiveP, NaiveSpin, type NaiveDropdownOption } from "../../../shared/ui/naive";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { PlaylistDetailInfo } from "../playlistParsers";
import type { FeedbackSetter } from "../shared/feedback";
import type { PlaybackController } from "../shared/playback";
import type { NcmProfile } from "../shared/types";
import type { OnlineTrackItem } from "../shared/types";
import { DailySongsBatchModal } from "./DailySongsBatchModal";
import { ResourceCommentsPanel } from "./ResourceCommentsPanel";
import { UpdatePlaylistModal } from "./UpdatePlaylistModal";

export interface PlaylistDetailProps {
  playlist: OnlinePlaylistSummary | null;
  detail: PlaylistDetailInfo | null;
  tracks: OnlineTrackItem[];
  trackCount: number;
  metaText: string;
  subtitleText: string;
  isLoadingTracks: boolean;
  isLoadingDetail: boolean;
  isTogglingSubscribe: boolean;
  isScrolled: boolean;
  filter: string;
  detailTab: "songs" | "comments";
  setFilter: (value: string) => void;
  setDetailTab: (tab: "songs" | "comments") => void;
  onBack?: () => void;
  onPlayAll: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onToggleSubscribe?: () => void | Promise<void>;
  onRemoveTracks?: (songIds: readonly number[]) => void | Promise<void>;
  onTracksRemovedLocally?: (songIds: readonly number[]) => void;
  onPlaylistUpdated?: (playlist: OnlinePlaylistSummary) => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void | Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onScroll: (event: Event) => void;
  showCommentsTab?: boolean;
  emptyStateText?: string;
  sourcePlaylistId?: number;
  lockPlaylistName?: boolean;
  loginProfile?: NcmProfile | null;
  setFeedback?: FeedbackSetter;
  playback: PlaybackController;
}

export function PlaylistDetail(props: PlaylistDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const playbackContext = usePlayback();
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
  const [batchOpen, setBatchOpen] = createSignal<boolean>(false);
  const [editOpen, setEditOpen] = createSignal<boolean>(false);
  const detailPlaylist = createMemo<PlaylistDetailInfo | OnlinePlaylistSummary | null>(() =>
    props.detail ?? props.playlist
  );
  const showCommentsTab = createMemo<boolean>(() => props.showCommentsTab ?? true);
  const showSongs = createMemo<boolean>(() => !showCommentsTab() || props.detailTab === "songs");
  const emptyStateText = createMemo<string>(() => {
    const query = props.filter.trim();
    return query
      ? t("ncm.playlist.searchEmpty", { query })
      : props.emptyStateText ?? t("ncm.empty.noTracks");
  });
  const isSubscribed = createMemo<boolean>(() => detailPlaylist()?.subscribed ?? false);
  const subscribeLabel = createMemo<string>(() => {
    if (props.isTogglingSubscribe) return t("ncm.playlist.subscribeWorking");
    return isSubscribed() ? t("ncm.playlist.unsubscribe") : t("ncm.playlist.subscribe");
  });
  const playlistPlayCount = createMemo<number | null>(() => detailPlaylist()?.playCount ?? null);
  const tags = createMemo<readonly string[]>(() => detailPlaylist()?.tags ?? []);
  const dateText = createMemo<string | null>(() => {
    const playlist = detailPlaylist();
    const timestamp = playlist?.updateTime ?? playlist?.createTime ?? null;
    if (timestamp === null) return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${month}-${day}`;
  });

  const formatPlayCount = (count: number): string => {
    if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
    if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
    return String(count);
  };
  const playlistUrl = () => {
    const playlist = detailPlaylist();
    return playlist ? `https://music.163.com/#/playlist?id=${playlist.id}` : "";
  };
  const canEditPlaylist = () => {
    const playlist = detailPlaylist();
    const userId = props.loginProfile?.userId;
    if (!playlist || userId === undefined) return false;
    return playlist.userId === userId || playlist.creatorId === userId;
  };
  const canToggleSubscribe = createMemo<boolean>(() =>
    Boolean(props.onToggleSubscribe) && !canEditPlaylist()
  );
  const menuItems = (): readonly NaiveDropdownOption[] => {
    const items: NaiveDropdownOption[] = [];
    if (props.onRefresh) {
      items.push({ key: "refresh", label: t("ncm.playlist.refreshCache"), icon: <IconRefresh /> });
    }
    if (props.onPlaylistUpdated && props.setFeedback && canEditPlaylist()) {
      items.push({ key: "edit", label: t("ncm.playlist.edit"), icon: <IconDots /> });
    }
    if (props.setFeedback) {
      items.push({ key: "batch", label: t("ncm.daily.batch"), icon: <IconList /> });
    }
    items.push(
      { key: "copy", label: t("ncm.playlist.copyShareLink"), icon: <IconShare /> },
      { key: "open", label: t("ncm.playlist.openSource"), icon: <IconLink /> }
    );
    return items;
  };
  const copyShareLink = async () => {
    const url = playlistUrl();
    if (!url) {
      props.setFeedback?.("error", t("media.copy.error"));
      return;
    }
    if (await copyToClipboard(url)) {
      props.setFeedback?.("success", t("ncm.playlist.shareCopied"));
    } else {
      props.setFeedback?.("error", t("media.copy.error"));
    }
  };
  const handleMenuSelect = (key: string) => {
    if (key === "refresh") {
      void props.onRefresh?.();
    } else if (key === "edit") {
      setEditOpen(true);
    } else if (key === "batch") {
      setBatchOpen(true);
    } else if (key === "copy") {
      void copyShareLink();
    } else if (key === "open") {
      const url = playlistUrl();
      if (url && typeof window !== "undefined") {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    }
  };
  const handleContextAction = (action: MediaContextAction, item: OnlineTrackItem) => {
    if (action === "delete-from-playlist") {
      void props.onRemoveTracks?.([item.songId]);
    } else if (action === "song-wiki") {
      props.onNavigateToSongWiki?.(item);
    } else if (action === "mv") {
      // TODO: Navigate to MV page
    } else if (action === "copy-song-info") {
      // TODO: Implement copy song info
    } else if (action === "download") {
      // TODO: Implement download — developer mode only
    }
  };
  const mediaContextActions = (): readonly MediaContextAction[] => {
    const actions: MediaContextAction[] = [
      "play",
      "enqueue",
      "add-to-playlist",
      "mv",
      "view-comments",
      "search",
      "copy-name",
      "copy-id",
      "copy-song-info",
      "share-link",
      "music-tag-editor",
      "song-wiki",
      "download"
    ];
    if (props.onRemoveTracks) {
      actions.push("delete-from-playlist");
    }
    return actions;
  };
  return (
    <Show when={detailPlaylist()}>
      {(playlist) => (
        <PageSurface
          class="playlist-detail playlist-detail-shell"
          floatingHero
          persistKey={`playlist:${playlist().id}`}
          resetKey={playlist().id}
        >
          <PageStickyHeader threshold={10}>
            {({ compact }) => (
              <>
                <PageHero size={uiSettings.hiddenCovers.list ? "md" : "lg"} compact={compact()} class={`playlist-detail-hero${uiSettings.hiddenCovers.list ? " is-cover-hidden" : ""}`}>
                  <header class={`playlist-detail-head${uiSettings.hiddenCovers.list ? " is-cover-hidden" : ""}`}>
                    <Show when={!uiSettings.hiddenCovers.list}>
                      <div class="playlist-detail-art" aria-hidden="true">
                        <Show when={playlist().coverUrl} fallback={<span>{playlist().name.slice(0, 1)}</span>}>
                          {(coverUrl) => (
                            <>
                              <SImage
                                src={coverSizeUrl(coverUrl(), "m")}
                                alt=""
                                class="playlist-detail-art-img"
                                observeVisibility={false}
                                shape="rect"
                                aspect="square"
                              />
                              <SImage
                                src={coverSizeUrl(coverUrl(), "s")}
                                alt=""
                                class="playlist-detail-art-shadow"
                                observeVisibility={false}
                                shape="rect"
                                aspect="square"
                                ariaHidden="true"
                              />
                            </>
                          )}
                        </Show>
                        <div class="playlist-detail-art-mask" />
                        <Show when={playlistPlayCount()}>
                          {(playCount) => (
                            <span class="playlist-detail-play-count">
                              <IconPlay />
                              {formatPlayCount(playCount())}
                            </span>
                          )}
                        </Show>
                      </div>
                    </Show>
                    <div class="playlist-detail-copy">
                      <div class="playlist-detail-title-row">
                        <Show when={props.onBack !== undefined}>
                          <button
                            type="button"
                            class="ghost-button playlist-detail-back"
                            aria-label={t("ncm.playlist.backToList")}
                            title={t("ncm.playlist.backToList")}
                            onClick={() => props.onBack?.()}
                          >
                            <IconChevronLeft />
                          </button>
                        </Show>
                        <NaiveH2 title={playlist().name}>{playlist().name}</NaiveH2>
                      </div>
                      <div class="playlist-detail-collapse">
                        <Show when={uiSettings.playlistPageElements.description && (playlist().description ?? props.subtitleText)}>
                          {(description) => <NaiveP class="playlist-detail-desc">{description()}</NaiveP>}
                        </Show>
                        <Show
                          when={
                            uiSettings.playlistPageElements.creator ||
                            uiSettings.playlistPageElements.time ||
                            uiSettings.playlistPageElements.tags
                          }
                        >
                          <div class="playlist-detail-meta">
                            <Show when={uiSettings.playlistPageElements.creator}>
                              <span>
                                <IconArtist />
                                {playlist().creator ?? t("ncm.playlist.creatorUnknown")}
                              </span>
                            </Show>
                            <Show when={uiSettings.playlistPageElements.time && dateText()}>
                              <span>
                                <IconClock />
                                {dateText()}
                              </span>
                            </Show>
                            <Show when={uiSettings.playlistPageElements.tags && tags().length > 0}>
                              <span class="playlist-detail-tags">
                                <IconTag />
                                <For each={tags()}>{(tag) => <span class="playlist-detail-tag">{tag}</span>}</For>
                              </span>
                            </Show>
                          </div>
                        </Show>
                      </div>
                      <div class="playlist-detail-menu">
                        <div class="playlist-detail-menu-left">
                          <button
                            type="button"
                            class="primary-button playlist-detail-play"
                            onClick={() => void props.onPlayAll()}
                            disabled={props.tracks.length === 0 || props.isLoadingTracks}
                          >
                            <IconPlay />
                            {props.isLoadingTracks ? t("ncm.playlist.loading") : t("ncm.playlist.play")}
                          </button>
                          <Show when={canToggleSubscribe()}>
                            <button
                              type="button"
                              class={`ghost-button playlist-detail-subscribe${isSubscribed() ? " is-active" : ""}`}
                              onClick={() => void props.onToggleSubscribe?.()}
                              disabled={props.isLoadingDetail || props.isTogglingSubscribe}
                            >
                              <Show when={props.isTogglingSubscribe} fallback={isSubscribed() ? <IconHeartFilled /> : <IconHeart />}>
                                <NaiveSpin size={18} ariaHidden />
                              </Show>
                              {subscribeLabel()}
                            </button>
                          </Show>
                          <NaiveDropdown
                            options={menuItems()}
                            triggerMode="click"
                            placement="bottom-start"
                            gutter={8}
                            open={menuOpen()}
                            onOpenChange={setMenuOpen}
                            onSelect={(option) => handleMenuSelect(option.key)}
                            ariaLabel={t("ncm.playlist.more")}
                          >
                            <button
                              type="button"
                              class="ghost-button playlist-detail-more"
                              aria-label={t("ncm.playlist.more")}
                              title={t("ncm.playlist.more")}
                              aria-haspopup="menu"
                              aria-expanded={menuOpen()}
                            >
                              <IconList />
                            </button>
                          </NaiveDropdown>
                        </div>
                        <div class="playlist-detail-menu-right">
                          <label class="playlist-detail-search">
                            <IconSearch />
                            <input
                              type="search"
                              value={props.filter}
                              placeholder={t("ncm.playlist.search")}
                              onInput={(event) => props.setFilter(event.currentTarget.value)}
                            />
                          </label>
                          <Show when={showCommentsTab()}>
                            <div class="playlist-detail-tabs" role="tablist" aria-label={t("ncm.playlist.tabs.aria")}>
                              <button
                                type="button"
                                class={props.detailTab === "songs" ? "is-active" : ""}
                                role="tab"
                                aria-selected={props.detailTab === "songs"}
                                onClick={() => props.setDetailTab("songs")}
                              >
                                {t("ncm.playlist.tab.songs")}
                                <span>{props.trackCount}</span>
                              </button>
                              <button
                                type="button"
                                class={props.detailTab === "comments" ? "is-active" : ""}
                                role="tab"
                                aria-selected={props.detailTab === "comments"}
                                onClick={() => props.setDetailTab("comments")}
                              >
                                {t("ncm.playlist.tab.comments")}
                                <Show when={props.detail?.commentCount !== null && props.detail?.commentCount !== undefined}>
                                  <span>{props.detail?.commentCount ?? 0}</span>
                                </Show>
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </div>
                  </header>
                </PageHero>
                <PageBody offset class="playlist-detail-body">
                  <Show
                    when={showSongs()}
                    fallback={
                      <ResourceCommentsPanel
                        class="playlist-detail-comments"
                        resourceId={playlist().id}
                        resourceType={2}
                        title={t("ncm.playlist.tab.comments")}
                        grouped
                        pageScrollRoot
                      />
                    }
                  >
                    <NcmMediaList
                      items={props.tracks}
                      currentSourcePath={playbackContext.currentTrackPath()}
                      currentSongId={playbackContext.currentSongId()}
                      isPlayingNow={playbackContext.isPlaying()}
                      onPlay={(item) => void props.playback.playOnlineTrack(item)}
                      onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
                      onContextAction={handleContextAction}
                      contextActions={mediaContextActions()}
                      onScroll={props.onScroll}
                      draggable={Boolean(props.onReorderTracks) && props.filter.trim().length === 0}
                      onReorder={(fromIndex, toIndex) => void props.onReorderTracks?.(fromIndex, toIndex)}
                      isLoading={props.isLoadingTracks}
                      emptyState={<NaiveP class="panel-note">{emptyStateText()}</NaiveP>}
                      hideSize
                      hideTopScrollTool
                    />
                  </Show>
                </PageBody>
              </>
            )}
          </PageStickyHeader>
          <BackToTop label={t("media.scroll.top")} />
          <Show when={props.setFeedback}>
            {(setFeedback) => (
              <>
                <DailySongsBatchModal
                  open={batchOpen()}
                  title={t("library.batch.title")}
                  items={props.tracks}
                  loginProfile={props.loginProfile ?? null}
                  playback={props.playback}
                  sourcePlaylistId={props.sourcePlaylistId ?? playlist().id}
                  setFeedback={setFeedback()}
                  onTracksRemoved={(songIds) => props.onTracksRemovedLocally?.(songIds)}
                  onClose={() => setBatchOpen(false)}
                />
                <UpdatePlaylistModal
                  open={editOpen()}
                  playlist={playlist()}
                  nameLocked={props.lockPlaylistName}
                  setFeedback={setFeedback()}
                  onUpdated={(updated) => props.onPlaylistUpdated?.(updated)}
                  onClose={() => setEditOpen(false)}
                />
              </>
            )}
          </Show>
        </PageSurface>
      )}
    </Show>
  );
}
