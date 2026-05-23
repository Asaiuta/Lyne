import {
  For,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup
} from "solid-js";
import { createApiClient } from "../../shared/api/client";
import { ncmSongPageUrl } from "../../shared/api/ncm/urls";
import { songDetail } from "../../shared/api/ncm/search";
import {
  songFirstListenInfo,
  songSheetList,
  songSheetPreview,
  songWikiSummary
} from "../../shared/api/ncm/song";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import {
  IconAlbum,
  IconArtist,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconList,
  IconPlay,
  IconSpinner,
  IconStar
} from "../../components/icons";
import { MediaList } from "../../components/media/MediaList";
import { createErrorMessageReader, type FeedbackSetter } from "./shared/feedback";
import { createPlaybackController, type PlaybackController } from "./shared/playback";
import type { NcmTrackReference } from "./ncmPlayback";
import type { FeedCardItem, Feedback, OnlineTrackItem } from "./shared/types";
import {
  normalizeSongWikiData,
  parseSongWikiSongMeta,
  readSongSheetPreviewImages,
  type SongWikiSheet,
  type SongWikiSongMeta,
  type SongWikiViewModel
} from "./songWikiParsers";

const api = createApiClient();

export interface SongWikiRequest {
  track: OnlineTrackItem | null;
  version: number;
}

interface SongWikiPageProps {
  request: SongWikiRequest;
  onBack: () => void;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  onRegisterPlayback: (track: NcmTrackReference) => void;
  onNavigateToArtistDetail: (artist: FeedCardItem) => void;
  onNavigateToAlbumDetail: (album: FeedCardItem) => void;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
}

interface SheetPreviewState {
  status: "idle" | "loading" | "success" | "error";
  images: string[];
  error: string | null;
}

const formatPublishDate = (timestamp: number | null): string | null => {
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const hasWikiContent = (model: SongWikiViewModel | null): boolean =>
  Boolean(
    model &&
      (model.story ||
        model.basicInfo.length > 0 ||
        model.sheets.length > 0 ||
        model.achievements.length > 0 ||
        model.similarSongIds.length > 0)
  );

const initialFeedback = (message: string): Feedback => ({
  tone: "neutral",
  message
});

export function SongWikiPage(props: SongWikiPageProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const readErrorMessage = createErrorMessageReader(t);
  const [status, setStatus] = createSignal<"idle" | "loading" | "success" | "error">("idle");
  const [feedback, setFeedback] = createSignal<Feedback>(initialFeedback(t("ncm.songWiki.feedback.initial")));
  const [songMeta, setSongMeta] = createSignal<SongWikiSongMeta | null>(null);
  const [viewModel, setViewModel] = createSignal<SongWikiViewModel | null>(null);
  const [similarSongs, setSimilarSongs] = createSignal<OnlineTrackItem[]>([]);
  const [expandedSheets, setExpandedSheets] = createSignal<Set<number>>(new Set());
  const [sheetPreviews, setSheetPreviews] = createSignal<Record<number, SheetPreviewState>>({});

  const setRawFeedback: FeedbackSetter = (tone, message) => setFeedback({ tone, message });
  const playback: PlaybackController = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: setRawFeedback
  });

  const activeTrack = createMemo<OnlineTrackItem | null>(() => props.request.track);
  const activeSongId = createMemo<number | null>(() => activeTrack()?.songId ?? null);
  const publishDate = createMemo<string | null>(() => formatPublishDate(songMeta()?.publishTime ?? null));
  const currentTitle = createMemo<string>(() => songMeta()?.title ?? activeTrack()?.title ?? t("ncm.songWiki.title"));
  const currentArtist = createMemo<string | null>(() => songMeta()?.artist ?? activeTrack()?.artist ?? null);
  const currentAlbum = createMemo<string | null>(() => songMeta()?.album ?? activeTrack()?.album ?? null);
  const currentCover = createMemo<string | null>(() => songMeta()?.coverUrl ?? activeTrack()?.artworkUrl ?? null);

  const playCurrent = async () => {
    const track = songMeta()?.track ?? activeTrack();
    if (!track) return;
    await playback.playOnlineTrack(track);
  };

  const openSource = () => {
    const songId = activeSongId();
    if (songId === null || typeof window === "undefined") return;
    window.open(ncmSongPageUrl(songId), "_blank", "noopener,noreferrer");
  };

  const setSheetPreview = (id: number, preview: SheetPreviewState) => {
    setSheetPreviews((current) => ({ ...current, [id]: preview }));
  };

  const toggleSheet = (sheet: SongWikiSheet) => {
    const isExpanded = expandedSheets().has(sheet.id);
    setExpandedSheets((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(sheet.id);
      else next.add(sheet.id);
      return next;
    });

    if (isExpanded || sheetPreviews()[sheet.id]?.status === "success" || sheetPreviews()[sheet.id]?.status === "loading") {
      return;
    }

    setSheetPreview(sheet.id, { status: "loading", images: [], error: null });
    void songSheetPreview(sheet.id)
      .then((payload) => {
        setSheetPreview(sheet.id, {
          status: "success",
          images: readSongSheetPreviewImages(payload),
          error: null
        });
      })
      .catch((error) => {
        setSheetPreview(sheet.id, {
          status: "error",
          images: [],
          error: readErrorMessage(error)
        });
      });
  };

  createEffect(
    on(
      () => props.request.version,
      () => {
        const track = activeTrack();
        if (!track) {
          setStatus("idle");
          setSongMeta(null);
          setViewModel(null);
          setSimilarSongs([]);
          return;
        }

        let cancelled = false;
        setStatus("loading");
        setSongMeta(null);
        setViewModel(null);
        setSimilarSongs([]);
        setExpandedSheets(new Set<number>());
        setSheetPreviews({});
        setFeedback(initialFeedback(t("ncm.songWiki.feedback.loading")));

        void (async () => {
          try {
            const detailPayload = await songDetail(track.songId);
            if (cancelled) return;
            const meta = parseSongWikiSongMeta(detailPayload, track);
            setSongMeta(meta);

            const [wikiResult, listenResult, sheetResult] = await Promise.allSettled([
              songWikiSummary(track.songId),
              songFirstListenInfo(track.songId),
              songSheetList(track.songId)
            ]);
            if (cancelled) return;
            const model = normalizeSongWikiData(
              wikiResult.status === "fulfilled" ? wikiResult.value : null,
              listenResult.status === "fulfilled" ? listenResult.value : null,
              sheetResult.status === "fulfilled" ? sheetResult.value : null
            );
            setViewModel(model);

            if (model.similarSongIds.length > 0) {
              try {
                const similar = await api.listNcmSongDetailTracks(model.similarSongIds);
                if (!cancelled) setSimilarSongs(similar);
              } catch (error) {
                console.warn("[SongWikiPage] failed to load similar songs", error);
              }
            }

            setStatus("success");
            setFeedback(initialFeedback(t("ncm.songWiki.feedback.ready")));
          } catch (error) {
            if (cancelled) return;
            setStatus("error");
            setSongMeta(null);
            setViewModel(null);
            setSimilarSongs([]);
            setFeedback({ tone: "error", message: readErrorMessage(error) });
          }
        })();

        onCleanup(() => {
          cancelled = true;
        });
      },
      { defer: false }
    )
  );

  return (
    <section class="panel panel-page song-wiki-page">
      <Switch>
        <Match when={status() === "loading"}>
          <SongWikiSkeleton />
        </Match>
        <Match when={status() === "error"}>
          <div class="song-wiki-empty content-fade-in">
            <button type="button" class="ghost-button song-wiki-back" onClick={props.onBack}>
              <IconChevronLeft />
              {t("ncm.songWiki.back")}
            </button>
            <strong>{t("ncm.songWiki.errorTitle")}</strong>
            <span>{feedback().message}</span>
          </div>
        </Match>
        <Match when={activeTrack() !== null}>
          <div class="song-wiki-scroll content-fade-in">
            <header class={`song-wiki-head${uiSettings.hiddenCovers.list ? " is-cover-hidden" : ""}`}>
              <Show when={!uiSettings.hiddenCovers.list}>
                <div class="song-wiki-cover" aria-hidden="true">
                  <Show when={currentCover()} fallback={<span>{currentTitle().slice(0, 1)}</span>}>
                    {(cover) => (
                      <>
                        <img class="song-wiki-cover-img" src={cover()} alt="" />
                        <img class="song-wiki-cover-shadow" src={cover()} alt="" />
                      </>
                    )}
                  </Show>
                </div>
              </Show>
              <div class="song-wiki-copy">
                <h2 title={currentTitle()}>{currentTitle()}</h2>
                <div class="song-wiki-meta">
                  <Show when={songMeta()?.artists.length}>
                    <span>
                      <IconArtist />
                      <For each={songMeta()?.artists ?? []}>
                        {(artist, index) => (
                          <>
                            {index() > 0 ? " / " : ""}
                            <button type="button" onClick={() => props.onNavigateToArtistDetail(artist)}>
                              {artist.title}
                            </button>
                          </>
                        )}
                      </For>
                    </span>
                  </Show>
                  <Show when={!songMeta()?.artists.length && currentArtist()}>
                    {(artist) => (
                      <span>
                        <IconArtist />
                        {artist()}
                      </span>
                    )}
                  </Show>
                  <Show when={songMeta()?.albumItem} fallback={
                    <Show when={currentAlbum()}>
                      {(album) => (
                        <span>
                          <IconAlbum />
                          {album()}
                        </span>
                      )}
                    </Show>
                  }>
                    {(album) => (
                      <span>
                        <IconAlbum />
                        <button type="button" onClick={() => props.onNavigateToAlbumDetail(album())}>
                          {album().title}
                        </button>
                      </span>
                    )}
                  </Show>
                  <Show when={publishDate()}>
                    {(date) => (
                      <span>
                        <IconClock />
                        {date()}
                      </span>
                    )}
                  </Show>
                </div>
                <div class="song-wiki-actions">
                  <button type="button" class="primary-button song-wiki-play" onClick={() => void playCurrent()}>
                    <IconPlay />
                    {t("ncm.songWiki.play")}
                  </button>
                  <button
                    type="button"
                    class="ghost-button song-wiki-back"
                    onClick={props.onBack}
                  >
                    <IconChevronLeft />
                    {t("ncm.songWiki.back")}
                  </button>
                  <button
                    type="button"
                    class="ghost-button song-wiki-more"
                    aria-label={t("ncm.songWiki.openSource")}
                    title={t("ncm.songWiki.openSource")}
                    onClick={openSource}
                  >
                    <IconList />
                  </button>
                </div>
              </div>
            </header>

            <Show when={hasWikiContent(viewModel())} fallback={
              <div class="song-wiki-empty">
                <strong>{t("ncm.songWiki.emptyTitle")}</strong>
                <span>{t("ncm.songWiki.emptyBody")}</span>
              </div>
            }>
              <div class="song-wiki-content">
                <SongWikiStorySection model={viewModel()} />
                <SongWikiBasicSection model={viewModel()} />
                <SongWikiSheetSection
                  model={viewModel()}
                  expandedSheets={expandedSheets()}
                  previews={sheetPreviews()}
                  onToggleSheet={toggleSheet}
                />
                <SongWikiAchievementsSection model={viewModel()} />
                <Show when={(viewModel()?.similarSongIds.length ?? 0) > 0}>
                  <section class="song-wiki-section song-wiki-similar">
                    <div class="song-wiki-section-title">
                      <h3>{t("ncm.songWiki.sections.similar")}</h3>
                    </div>
                    <MediaList
                      items={similarSongs()}
                      currentSourcePath={props.currentTrackPath}
                      currentSongId={props.currentSongId}
                      isPlayingNow={props.isPlaying}
                      onPlay={(item) => void playback.playOnlineTrack(item)}
                      onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
                      isLoading={similarSongs().length === 0}
                      emptyState={<div class="panel-note">{t("ncm.songWiki.similarLoading")}</div>}
                    />
                  </section>
                </Show>
              </div>
            </Show>
            <Show when={feedback().tone === "error"}>
              <div class="song-wiki-feedback status-error">{feedback().message}</div>
            </Show>
          </div>
        </Match>
        <Match when={true}>
          <div class="song-wiki-empty content-fade-in">
            <strong>{t("ncm.songWiki.emptyTitle")}</strong>
            <span>{t("ncm.songWiki.noSelection")}</span>
          </div>
        </Match>
      </Switch>
    </section>
  );
}

function SongWikiStorySection(props: { model: SongWikiViewModel | null }) {
  const { t } = useTranslation();
  const story = () => props.model?.story ?? null;
  return (
    <Show when={story()}>
      {(item) => (
        <section class="song-wiki-section">
          <div class="song-wiki-section-title">
            <h3>{t("ncm.songWiki.sections.story")}</h3>
          </div>
          <div class="song-wiki-card-grid is-story">
            <Show when={item().firstListen}>
              {(first) => (
                <article class="song-wiki-info-card">
                  <span>{t("ncm.songWiki.story.firstListen")}</span>
                  <strong>{[first().period, first().date].filter(Boolean).join(" · ") || "-"}</strong>
                  <small>{first().meetDurationDesc ?? first().season ?? ""}</small>
                </article>
              )}
            </Show>
            <Show when={item().totalPlay}>
              {(total) => (
                <article class="song-wiki-info-card">
                  <span>{t("ncm.songWiki.story.totalPlay")}</span>
                  <strong>{t("ncm.songWiki.story.playCount", { count: total().playCount ?? 0 })}</strong>
                  <small>{total().text ?? ""}</small>
                </article>
              )}
            </Show>
            <Show when={item().likeSong?.like}>
              <article class="song-wiki-info-card">
                <span>{t("ncm.songWiki.story.liked")}</span>
                <strong>{item().likeSong?.text ?? t("ncm.songWiki.story.likedText")}</strong>
                <small>{item().likeSong?.redDesc ?? ""}</small>
              </article>
            </Show>
          </div>
        </section>
      )}
    </Show>
  );
}

function SongWikiBasicSection(props: { model: SongWikiViewModel | null }) {
  const { t } = useTranslation();
  return (
    <Show when={(props.model?.basicInfo.length ?? 0) > 0}>
      <section class="song-wiki-section">
        <div class="song-wiki-section-title">
          <h3>{t("ncm.songWiki.sections.basic")}</h3>
        </div>
        <div class="song-wiki-card-grid">
          <For each={props.model?.basicInfo ?? []}>
            {(item) => (
              <article class="song-wiki-info-card">
                <span>{item.label}</span>
                <Show when={item.type === "tags"} fallback={<strong>{item.value ?? "-"}</strong>}>
                  <div class="song-wiki-tags">
                    <For each={item.tags}>{(tag) => <em>{tag}</em>}</For>
                  </div>
                </Show>
              </article>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function SongWikiSheetSection(props: {
  model: SongWikiViewModel | null;
  expandedSheets: Set<number>;
  previews: Record<number, SheetPreviewState>;
  onToggleSheet: (sheet: SongWikiSheet) => void;
}) {
  const { t } = useTranslation();
  return (
    <Show when={(props.model?.sheets.length ?? 0) > 0}>
      <section class="song-wiki-section">
        <div class="song-wiki-section-title">
          <h3>{t("ncm.songWiki.sections.sheets")}</h3>
        </div>
        <div class="song-wiki-sheets">
          <For each={props.model?.sheets ?? []}>
            {(sheet) => {
              const preview = () => props.previews[sheet.id] ?? { status: "idle", images: [], error: null };
              const expanded = () => props.expandedSheets.has(sheet.id);
              return (
                <article class={`song-wiki-sheet${expanded() ? " is-expanded" : ""}`}>
                  <button type="button" class="song-wiki-sheet-head" onClick={() => props.onToggleSheet(sheet)}>
                    <Show when={sheet.coverImageUrl}>
                      {(cover) => <img src={cover()} alt="" />}
                    </Show>
                    <span>
                      <strong>{sheet.name}</strong>
                      <small>
                        <For each={sheet.meta.slice(0, 4)}>
                          {(meta, index) => (
                            <>
                              {index() > 0 ? " · " : ""}
                              {meta}
                            </>
                          )}
                        </For>
                      </small>
                    </span>
                    <IconChevronDown />
                  </button>
                  <Show when={expanded()}>
                    <div class="song-wiki-sheet-body">
                      <Switch>
                        <Match when={preview().status === "loading"}>
                          <div class="song-wiki-sheet-state">
                            <IconSpinner />
                            {t("ncm.songWiki.sheets.loading")}
                          </div>
                        </Match>
                        <Match when={preview().status === "error"}>
                          <div class="song-wiki-sheet-state">{preview().error ?? t("common.error.requestFailed")}</div>
                        </Match>
                        <Match when={preview().images.length > 0}>
                          <div class="song-wiki-sheet-images">
                            <For each={preview().images}>
                              {(image, index) => <img src={image} alt={t("ncm.songWiki.sheets.pageAlt", { page: index() + 1 })} loading="lazy" />}
                            </For>
                          </div>
                        </Match>
                        <Match when={true}>
                          <div class="song-wiki-sheet-state">{t("ncm.songWiki.sheets.empty")}</div>
                        </Match>
                      </Switch>
                    </div>
                  </Show>
                </article>
              );
            }}
          </For>
        </div>
      </section>
    </Show>
  );
}

function SongWikiAchievementsSection(props: { model: SongWikiViewModel | null }) {
  const { t } = useTranslation();
  return (
    <Show when={(props.model?.achievements.length ?? 0) > 0}>
      <section class="song-wiki-section">
        <div class="song-wiki-section-title">
          <h3>{t("ncm.songWiki.sections.achievements")}</h3>
        </div>
        <div class="song-wiki-achievements">
          <For each={props.model?.achievements ?? []}>
            {(item) => (
              <article class="song-wiki-achievement">
                <Show when={item.image} fallback={<span class="song-wiki-achievement-icon"><IconStar /></span>}>
                  {(image) => <img src={image()} alt="" loading="lazy" />}
                </Show>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.subtitle ?? ""}</small>
                </span>
              </article>
            )}
          </For>
        </div>
      </section>
    </Show>
  );
}

function SongWikiSkeleton() {
  return (
    <div class="song-wiki-skeleton">
      <div class="song-wiki-skeleton-head">
        <div class="skeleton song-wiki-skeleton-cover" />
        <div class="song-wiki-skeleton-copy">
          <div class="skeleton skeleton-line skeleton-line--title" />
          <div class="skeleton skeleton-line" />
          <div class="skeleton skeleton-line" />
          <div class="skeleton song-wiki-skeleton-button" />
        </div>
      </div>
      <div class="song-wiki-card-grid is-story">
        <div class="skeleton song-wiki-skeleton-card" />
        <div class="skeleton song-wiki-skeleton-card" />
        <div class="skeleton song-wiki-skeleton-card" />
      </div>
    </div>
  );
}
