import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js";
import { IconChevronLeft, IconChat, IconClock, IconEye, IconHeart, IconLink, IconShare } from "../../../components/icons";
import { BackToTop } from "../../../components/page/BackToTop";
import { PageBody } from "../../../components/page/PageBody";
import { PageHero } from "../../../components/page/PageHero";
import { PageSurface } from "../../../components/page/PageSurface";
import { SImage } from "../../../components/SImage";
import { mvDetail, mvDetailInfo, mvUrl, videoDetail, videoDetailInfo, videoUrl } from "../../../shared/api/ncm/video";
import { ncmMvPageUrl, ncmVideoPageUrl } from "../../../shared/api/ncm/urls";
import { useTranslation } from "../../../shared/i18n";
import type { FeedCardItem } from "../shared/types";
import { parseVideoDetail, parseVideoSource, type VideoDetailInfo, type VideoSource } from "../videoParsers";
import { ResourceCommentsPanel } from "./ResourceCommentsPanel";

export interface VideoDetailProps {
  video: FeedCardItem | null;
  onBack: () => void;
  onPauseAudio: () => void | Promise<void>;
  onSelectArtist?: (artist: FeedCardItem) => void | Promise<void>;
}

interface VideoDetailPayload {
  detail: VideoDetailInfo | null;
  sources: VideoSource[];
}

const EMPTY_VIDEO_PAYLOAD: VideoDetailPayload = {
  detail: null,
  sources: []
};

const formatNumber = (value: number | null): string => {
  if (value === null) return "0";
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(Math.round(value));
};

const formatQuality = (quality: number | null): string => (quality === null ? "AUTO" : `${quality}P`);

const formatDate = (timestamp: number | null): string | null => {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
};

const videoKind = (video: FeedCardItem): "mv" | "video" => video.videoKind ?? "mv";
const upstreamVideoId = (video: FeedCardItem): number | string => video.videoId ?? video.id;

const loadVideoDetail = async (video: FeedCardItem): Promise<VideoDetailPayload> => {
  const kind = videoKind(video);
  const id = upstreamVideoId(video);
  const [detailPayload, infoPayload] = await Promise.all([
    kind === "mv" ? mvDetail({ mvid: video.id }) : videoDetail({ id }),
    kind === "mv" ? mvDetailInfo({ mvid: video.id }) : videoDetailInfo({ id })
  ]);
  const detail = parseVideoDetail(detailPayload, infoPayload);
  const qualities = detail?.qualities.length ? detail.qualities : [1080];
  const sources = (await Promise.all(
    qualities.map(async (quality) => parseVideoSource(
      await (kind === "mv" ? mvUrl({ id: video.id, r: quality }) : videoUrl({ id, r: quality }))
    ))
  )).filter((item): item is VideoSource => item !== null);
  return { detail, sources };
};

export function VideoDetail(props: VideoDetailProps) {
  const { t } = useTranslation();
  const [playError, setPlayError] = createSignal<string | null>(null);
  const [selectedQuality, setSelectedQuality] = createSignal<number | null>(null);
  const [payload, setPayload] = createSignal<VideoDetailPayload>(EMPTY_VIDEO_PAYLOAD);
  let videoRef: HTMLVideoElement | undefined;

  const detail = createMemo(() => payload()?.detail ?? null);
  const sources = createMemo(() => payload()?.sources ?? []);
  const source = createMemo(() => {
    const quality = selectedQuality();
    return sources().find((item) => item.quality === quality) ?? sources()[0] ?? null;
  });
  const displayTitle = createMemo(() => detail()?.title ?? props.video?.title ?? t("ncm.video.title"));
  const displayCover = createMemo(() => detail()?.coverUrl ?? props.video?.coverUrl ?? null);
  const currentVideoKind = createMemo<"mv" | "video">(() => props.video ? videoKind(props.video) : "mv");
  const currentVideoId = createMemo<number | string | null>(() => props.video ? upstreamVideoId(props.video) : detail()?.id ?? null);
  const commentsResourceType = createMemo<1 | 5>(() => currentVideoKind() === "mv" ? 1 : 5);

  createEffect(() => {
    const video = props.video;
    let cancelled = false;
    setPayload(EMPTY_VIDEO_PAYLOAD);
    setSelectedQuality(null);
    if (!video) return;
    void loadVideoDetail(video).then((nextPayload) => {
      if (cancelled) return;
      setPayload(nextPayload);
    });
    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    const media = videoRef;
    const nextSource = source();
    if (!media || !nextSource) return;
    setPlayError(null);
    media.load();
  });

  createEffect(on(sources, (items) => {
    setSelectedQuality(items[0]?.quality ?? null);
  }));

  return (
    <PageSurface class="ncm-video-detail" resetKey={currentVideoId()}>
      <PageHero size="md">
        <button type="button" class="ghost-button ncm-daily-detail-back" onClick={props.onBack}>
          <IconChevronLeft />
          {t("ncm.video.backToFeed")}
        </button>

        <header class="ncm-video-detail-head">
          <div class="ncm-video-detail-title">
            <h2>{displayTitle()}</h2>
            <div class="ncm-video-detail-meta">
              <span><IconEye /> {formatNumber(detail()?.playCount ?? props.video?.playCount ?? null)}</span>
              <Show when={detail()?.commentCount !== null && detail()?.commentCount !== undefined}>
                <span><IconChat /> {formatNumber(detail()?.commentCount ?? null)}</span>
              </Show>
              <Show when={formatDate(detail()?.publishTime ?? null)}>
                {(date) => <span><IconClock /> {date()}</span>}
              </Show>
            </div>
          </div>
        </header>
      </PageHero>

      <PageBody class="ncm-video-detail-body" scrollable>
        <div class="ncm-video-player-shell">
          <video
            ref={videoRef}
            class="ncm-video-player"
            controls
            poster={displayCover() ?? undefined}
            onPlay={() => void props.onPauseAudio()}
            onError={() => setPlayError(t("ncm.video.playbackError"))}
          >
            <Show when={source()}>
              {(item) => <source src={item().url} type="video/mp4" />}
            </Show>
          </video>
        </div>

        <Show when={sources().length > 1}>
          <div class="ncm-video-quality" aria-label={t("ncm.video.quality")}>
            <For each={sources()}>
              {(item) => (
                <button
                  type="button"
                  class={item.quality === selectedQuality() ? "is-active" : ""}
                  onClick={() => setSelectedQuality(item.quality)}
                >
                  {formatQuality(item.quality)}
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={playError()}>
          {(message) => <div class="panel-note">{message()}</div>}
        </Show>

        <div class="ncm-video-menu">
          <Show when={detail()?.artist}>
            {(artist) => (
              <button type="button" class="ncm-video-artist" onClick={() => void props.onSelectArtist?.(artist())}>
                <Show when={artist().coverUrl}>
                  {(coverUrl) => (
                    <SImage
                      src={coverUrl()}
                      alt=""
                      class="ncm-video-artist-avatar"
                      observeVisibility={true}
                      shape="circle"
                      aspect="square"
                    />
                  )}
                </Show>
                <span>
                  <strong>{artist().title}</strong>
                </span>
              </button>
            )}
          </Show>
          <div class="ncm-video-actions">
            <span><IconHeart /> {formatNumber(detail()?.likedCount ?? null)}</span>
            <span><IconShare /> {formatNumber(detail()?.shareCount ?? null)}</span>
            <button type="button" class="ghost-button" onClick={() => {
              const id = currentVideoId() ?? 0;
              window.open(currentVideoKind() === "mv" ? ncmMvPageUrl(id) : ncmVideoPageUrl(id), "_blank");
            }}>
              <IconLink />
              {t("ncm.playlist.openSource")}
            </button>
          </div>
        </div>

        <Show when={detail()?.description}>
          {(description) => <p class="ncm-video-description">{description()}</p>}
        </Show>

        <Show when={(detail()?.tags ?? []).length > 0}>
          <div class="ncm-video-tags">
            <For each={detail()?.tags ?? []}>{(tag) => <span>{tag}</span>}</For>
          </div>
        </Show>

        <ResourceCommentsPanel
          resourceId={currentVideoId()}
          resourceType={commentsResourceType()}
          class="ncm-video-comments"
          title={t("ncm.video.comments")}
        />
      </PageBody>
      <BackToTop label={t("media.scroll.top")} />
    </PageSurface>
  );
}
