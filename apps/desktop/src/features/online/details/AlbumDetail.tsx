import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { IconChat, IconChevronLeft, IconHeart, IconHeartFilled, IconMusic, IconShare } from "../../../components/icons";
import { NcmMediaList } from "../NcmMediaList";
import { SegmentedTabs, type SegmentedTabItem } from "../../../components/page/SegmentedTabs";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageStickyHeader } from "../../../components/page/PageStickyHeader";
import { PageSurface } from "../../../components/page/PageSurface";
import { useTranslation } from "../../../shared/i18n";
import { useUISettings } from "../../../shared/state/useUISettings";
import { NaiveP, NaiveSpin } from "../../../shared/ui/naive";
import type { AlbumDetailInfo } from "../albumParsers";
import type { PlaybackController } from "../shared/playback";
import type { FeedCardItem, OnlineTrackItem } from "../shared/types";
import { NcmListDetail, type NcmListDetailMetaItem } from "./NcmListDetail";
import { ResourceCommentsPanel } from "./ResourceCommentsPanel";

export interface AlbumDetailProps {
  album: FeedCardItem | null;
  detail: AlbumDetailInfo | null;
  tracks: OnlineTrackItem[];
  isLoading: boolean;
  isLoadingDetail: boolean;
  isTogglingSubscribe: boolean;
  onToggleSubscribe: () => void | Promise<void>;
  onBack: () => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  playback: PlaybackController;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

export function AlbumDetail(props: AlbumDetailProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [detailTab, setDetailTab] = createSignal<"songs" | "comments">("songs");
  const album = () => props.detail ?? props.album;
  const albumId = createMemo<number | null>(() => album()?.id ?? null);
  const detailTabItems = createMemo<SegmentedTabItem[]>(() => [
    { value: "songs", label: t("ncm.playlist.tab.songs") },
    { value: "comments", label: t("ncm.playlist.tab.comments") }
  ]);
  const subscribeLabel = createMemo<string>(() =>
    props.detail?.subscribed === true ? t("ncm.album.unsubscribe") : t("ncm.album.subscribe")
  );
  const metaItems = createMemo<NcmListDetailMetaItem[]>(() => {
    const items: NcmListDetailMetaItem[] = [
      {
        icon: <IconMusic />,
        text: props.tracks.length > 0
          ? t("ncm.album.metaCount", { count: props.tracks.length })
          : album()?.subtitle ?? ""
      }
    ];
    if (props.detail?.commentCount != null) {
      items.push({
        icon: <IconChat />,
        text: t("ncm.album.commentCount", { count: props.detail.commentCount })
      });
    }
    if (props.detail?.shareCount != null) {
      items.push({
        icon: <IconShare />,
        text: t("ncm.album.shareCount", { count: props.detail.shareCount })
      });
    }
    return items.filter((item) => item.text.trim().length > 0);
  });
  createEffect(() => {
    albumId();
    setDetailTab("songs");
  });
  if (!album()) return null;
  return (
    <PageSurface class="ncm-daily-detail" persistKey={`discover:album:${albumId()}`} resetKey={albumId()}>
      <PageStickyHeader threshold={10}>
        {({ compact }) => (
          <>
            <PageHero size="lg" compact={compact()}>
              <button
                type="button"
                class="ghost-button ncm-daily-detail-back"
                onClick={props.onBack}
              >
                <IconChevronLeft />
                {t("ncm.album.backToFeed")}
              </button>
              <NcmListDetail
                title={album()?.title ?? ""}
                coverUrl={album()?.coverUrl}
                hiddenCover={uiSettings.hiddenCovers.album}
                compact={compact()}
                description={album()?.description ?? album()?.subtitle}
                metaItems={metaItems()}
                playLabel={props.isLoading ? t("ncm.playlist.loading") : t("ncm.playlist.play")}
                playDisabled={props.tracks.length === 0}
                loading={props.isLoading}
                onPlay={() => {
                  void props.playback.playAll(props.tracks);
                }}
                activeTab={detailTab()}
                onTabChange={(next) => setDetailTab(next === "comments" ? "comments" : "songs")}
                tabs={[
                  { value: "songs", label: t("ncm.playlist.tab.songs"), count: props.tracks.length },
                  { value: "comments", label: t("ncm.playlist.tab.comments"), count: props.detail?.commentCount }
                ]}
                actionButtons={
                  <button
                    type="button"
                    class={`ghost-button page-action ncm-artist-subscribe${props.detail?.subscribed === true ? " is-active" : ""}`}
                    disabled={props.isLoadingDetail || props.isTogglingSubscribe}
                    onClick={() => void props.onToggleSubscribe()}
                  >
                    <Show when={props.isTogglingSubscribe} fallback={props.detail?.subscribed === true ? <IconHeartFilled /> : <IconHeart />}>
                      <NaiveSpin size={18} ariaHidden />
                    </Show>
                    {props.isTogglingSubscribe ? t("ncm.album.subscribeWorking") : subscribeLabel()}
                  </button>
                }
              />
              <div class="ncm-detail-tabs ncm-detail-tabs--mobile">
                <SegmentedTabs
                  value={detailTab()}
                  onChange={(next) => setDetailTab(next === "comments" ? "comments" : "songs")}
                  items={detailTabItems()}
                  ariaLabel={t("ncm.playlist.tabs.aria")}
                />
              </div>
            </PageHero>
            <PageBody class="ncm-detail-page-body">
              <Show
                when={detailTab() === "songs"}
                fallback={
                  <ResourceCommentsPanel
                    class="ncm-album-comments"
                    resourceId={album()?.id ?? 0}
                    resourceType={3}
                    title={t("ncm.playlist.tab.comments")}
                    grouped
                    pageScrollRoot
                  />
                }
              >
                <NcmMediaList
                  items={props.tracks}
                  currentSourcePath={props.currentTrackPath}
                  currentSongId={props.currentSongId}
                  isPlayingNow={props.isPlaying}
                  onPlay={(item) => void props.playback.playOnlineTrack(item)}
                  onEnqueue={(item) => void props.playback.enqueueOnlineTrack(item)}
                  onContextAction={(action, item) => {
                    if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
                  }}
                  isLoading={props.isLoading}
                  emptyState={<NaiveP class="panel-note">{t("ncm.album.empty")}</NaiveP>}
                  hideTopScrollTool
                />
              </Show>
            </PageBody>
            <BackToTop label={t("media.scroll.top")} />
          </>
        )}
      </PageStickyHeader>
    </PageSurface>
  );
}
