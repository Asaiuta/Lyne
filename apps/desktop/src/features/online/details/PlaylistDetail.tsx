import { For, Show, createMemo, createSignal } from "solid-js";
import {
  IconChat,
  IconChevronLeft,
  IconDots,
  IconEye,
  IconHeart,
  IconHeartFilled,
  IconList,
  IconMusic,
  IconPlay,
  IconSearch,
  IconShare,
  IconSpinner
} from "../../../components/icons";
import { ContextMenu, type ContextMenuItem } from "../../../components/media/ContextMenu";
import type { MediaContextAction } from "../../../components/media/MediaList";
import { MediaList } from "../../../components/media/MediaList";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageStickyHeader } from "../../../components/page/PageStickyHeader";
import { PageSurface } from "../../../components/page/PageSurface";
import { SImage } from "../../../components/SImage";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
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
  onBack: () => void;
  onPlayAll: () => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onToggleSubscribe?: () => void | Promise<void>;
  onRemoveTracks?: (songIds: readonly number[]) => void | Promise<void>;
  onTracksRemovedLocally?: (songIds: readonly number[]) => void;
  onPlaylistUpdated?: (playlist: OnlinePlaylistSummary) => void;
  onReorderTracks?: (fromIndex: number, toIndex: number) => void | Promise<void>;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onScroll: (event: Event) => void;
  backLabel?: string;
  showBackButton?: boolean;
  showCommentsTab?: boolean;
  emptyStateText?: string;
  sourcePlaylistId?: number;
  lockPlaylistName?: boolean;
  loginProfile?: NcmProfile | null;
  setFeedback?: FeedbackSetter;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function PlaylistDetail(props: PlaylistDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [menuOpen, setMenuOpen] = createSignal<boolean>(false);
  const [menuPosition, setMenuPosition] = createSignal<{ x: number; y: number }>({ x: 0, y: 0 });
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
  const hasDynamicCounts = createMemo<boolean>(() =>
    props.detail?.commentCount !== null && props.detail?.commentCount !== undefined ||
    props.detail?.shareCount !== null && props.detail?.shareCount !== undefined ||
    props.detail?.bookedCount !== null && props.detail?.bookedCount !== undefined
  );
  const subscribeLabel = createMemo<string>(() => {
    if (props.isTogglingSubscribe) return t("ncm.playlist.subscribeWorking");
    return isSubscribed() ? t("ncm.playlist.unsubscribe") : t("ncm.playlist.subscribe");
  });

  const formatTimestamp = (timestamp: number): string =>
    new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
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
  const menuItems = (): ContextMenuItem[] => {
    const items: ContextMenuItem[] = [];
    if (props.onRefresh) {
      items.push({ key: "refresh", label: t("ncm.playlist.refreshCache"), icon: <IconList /> });
    }
    if (props.onPlaylistUpdated && props.setFeedback && canEditPlaylist()) {
      items.push({ key: "edit", label: t("ncm.playlist.edit"), icon: <IconDots /> });
    }
    if (props.setFeedback) {
      items.push({ key: "batch", label: t("ncm.daily.batch"), icon: <IconList /> });
    }
    items.push(
      { key: "copy", label: t("ncm.playlist.copyShareLink"), icon: <IconDots /> },
      { key: "open", label: t("ncm.playlist.openSource"), icon: <IconChevronLeft /> }
    );
    return items;
  };
  const openMenu = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left, y: rect.bottom + 8 });
    setMenuOpen(true);
  };
  const copyShareLink = async () => {
    const url = playlistUrl();
    if (!url || typeof navigator === "undefined" || !navigator.clipboard) {
      props.setFeedback?.("error", t("media.copy.error"));
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      props.setFeedback?.("success", t("ncm.playlist.shareCopied"));
    } catch {
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
    }
  };
  const mediaContextActions = (): readonly MediaContextAction[] => {
    const actions: MediaContextAction[] = [
      "play",
      "enqueue",
      "add-to-playlist",
      "search",
      "copy-name",
      "copy-id",
      "share-link",
      "song-wiki",
      "view-comments"
    ];
    if (props.onRemoveTracks) {
      actions.push("delete-from-playlist");
    }
    return actions;
  };
  return (
    <Show when={detailPlaylist()}>
      {(playlist) => (
        <PageSurface class="playlist-detail playlist-detail-shell" floatingHero resetKey={playlist().id}>
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
                                src={coverUrl()}
                                alt=""
                                class="playlist-detail-art-img"
                                observeVisibility={false}
                                shape="rect"
                                aspect="square"
                              />
                              <SImage
                                src={coverUrl()}
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
                      </div>
                    </Show>
                    <div class="playlist-detail-copy">
                      <h2 title={playlist().name}>{playlist().name}</h2>
                      <div class="playlist-detail-collapse">
                        <Show when={uiSettings.playlistPageElements.description && (playlist().description ?? props.subtitleText)}>
                          {(description) => <p class="playlist-detail-desc">{description()}</p>}
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
                                <IconMusic />
                                {playlist().creator ?? t("ncm.playlist.creatorUnknown")}
                              </span>
                            </Show>
                            <Show when={uiSettings.playlistPageElements.time}>
                              <span>
                                <IconList />
                                {playlist().updateTime !== null || playlist().createTime !== null
                                  ? formatTimestamp(playlist().updateTime ?? playlist().createTime ?? 0)
                                  : t("ncm.playlist.trackCount", { count: props.trackCount })}
                              </span>
                            </Show>
                            <Show when={playlist().playCount !== null}>
                              <span>
                                <IconEye />
                                {playlist().playCount}
                              </span>
                            </Show>
                            <Show when={hasDynamicCounts()}>
                              <Show when={props.detail?.commentCount !== null && props.detail?.commentCount !== undefined}>
                                <span>
                                  <IconChat />
                                  {t("ncm.playlist.commentCount", { count: props.detail?.commentCount ?? 0 })}
                                </span>
                              </Show>
                              <Show when={props.detail?.shareCount !== null && props.detail?.shareCount !== undefined}>
                                <span>
                                  <IconShare />
                                  {t("ncm.playlist.shareCount", { count: props.detail?.shareCount ?? 0 })}
                                </span>
                              </Show>
                              <Show when={props.detail?.bookedCount !== null && props.detail?.bookedCount !== undefined}>
                                <span>
                                  <IconHeart />
                                  {t("ncm.playlist.bookedCount", { count: props.detail?.bookedCount ?? 0 })}
                                </span>
                              </Show>
                            </Show>
                            <Show when={uiSettings.playlistPageElements.tags}>
                              <span>
                                <IconDots />
                                <Show
                                  when={playlist().tags.length > 0}
                                  fallback={
                                    playlist().subscribed
                                      ? t("ncm.playlist.tag.subscribed")
                                      : t("ncm.playlist.tag.public")
                                  }
                                >
                                  <For each={playlist().tags}>
                                    {(tag, index) => (
                                      <>
                                        {index() > 0 ? " / " : ""}
                                        {tag}
                                      </>
                                    )}
                                  </For>
                                </Show>
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
                          <Show when={props.showBackButton ?? true}>
                            <button
                              type="button"
                              class="ghost-button playlist-detail-back"
                              onClick={props.onBack}
                            >
                              <IconChevronLeft />
                              {props.backLabel ?? t("ncm.playlist.backToList")}
                            </button>
                          </Show>
                          <Show when={canToggleSubscribe()}>
                            <button
                              type="button"
                              class={`ghost-button playlist-detail-subscribe${isSubscribed() ? " is-active" : ""}`}
                              onClick={() => void props.onToggleSubscribe?.()}
                              disabled={props.isLoadingDetail || props.isTogglingSubscribe}
                            >
                              <Show when={props.isTogglingSubscribe} fallback={isSubscribed() ? <IconHeartFilled /> : <IconHeart />}>
                                <IconSpinner />
                              </Show>
                              {subscribeLabel()}
                            </button>
                          </Show>
                          <button
                            type="button"
                            class="ghost-button playlist-detail-more"
                            aria-label={t("ncm.playlist.more")}
                            title={t("ncm.playlist.more")}
                            onClick={openMenu}
                          >
                            <IconList />
                          </button>
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
                    <MediaList
                      items={props.tracks}
                      currentSourcePath={props.currentTrackPath}
                      currentSongId={props.currentSongId}
                      isPlayingNow={props.isPlaying}
                      onPlay={(item) => void props.playback.playOnlineTrack(item)}
                      onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
                      onContextAction={handleContextAction}
                      contextActions={mediaContextActions()}
                      onScroll={props.onScroll}
                      draggable={Boolean(props.onReorderTracks) && props.filter.trim().length === 0}
                      onReorder={(fromIndex, toIndex) => void props.onReorderTracks?.(fromIndex, toIndex)}
                      isLoading={props.isLoadingTracks}
                      emptyState={<div class="panel-note">{emptyStateText()}</div>}
                      hideTopScrollTool
                    />
                  </Show>
                </PageBody>
              </>
            )}
          </PageStickyHeader>
          <BackToTop label={t("media.scroll.top")} />
          <ContextMenu
            open={menuOpen()}
            x={menuPosition().x}
            y={menuPosition().y}
            items={menuItems()}
            onSelect={handleMenuSelect}
            onClose={() => setMenuOpen(false)}
          />
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
