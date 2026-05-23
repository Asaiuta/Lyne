import { For, Show, createEffect, createMemo, createResource, createSignal, on } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconHeart,
  IconHeartFilled,
  IconList,
  IconSpinner
} from "../../components/icons";
import { MediaList } from "../../components/media/MediaList";
import { PageHeader } from "../../components/page/PageHeader";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { createApiClient } from "../../shared/api/client";
import {
  radioDetail,
  radioCategoryHot,
  radioCategoryRecommend,
  radioCatList,
  radioPrograms,
  radioRecommendType,
  radioSub,
  radioToplist
} from "../../shared/api/ncm/radio";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { ncmDjRadioPageUrl } from "../../shared/api/ncm/urls";
import {
  type RadioCategory,
  type RadioCategorySection,
  parseRadioCardsFromKey,
  parseRadioCategories,
  parseRadioCategorySections,
  parseRadioDetailCard,
  parseRadioDetailInfo,
  parseRadioProgramTracks
} from "./radioParsers";
import { createPlaybackController } from "./shared/playback";
import type { FeedCardItem, Feedback, NcmProfile, OnlineTrackItem } from "./shared/types";
import type { RadioDetailInfo } from "./radioParsers";
import { NcmListDetail, type NcmListDetailMetaItem } from "./details/NcmListDetail";
import { ResourceCommentsPanel } from "./details/ResourceCommentsPanel";

type RadioTab = "hot" | "recommend";
type RadioDetailTab = "programs" | "comments";

const CARD_LIMIT = 20;
const PROGRAM_LIMIT = 500;
const api = createApiClient();

const safeLoad = async <T,>(load: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await load();
  } catch (error) {
    console.warn("[NeteaseRadioPage] radio fetch failed", error);
    return fallback;
  }
};

const openRadioSource = (id: number) => {
  window.open(ncmDjRadioPageUrl(id), "_blank");
};

export interface RadioDetailRequest {
  radio: FeedCardItem | null;
  version: number;
}

export interface NeteaseRadioPageProps {
  radioDetailRequest?: RadioDetailRequest;
  loginProfile: NcmProfile | null;
  onRequireNcmLogin: () => void;
  onSubscribeChange?: (radio: FeedCardItem, subscribed: boolean) => void;
  onStateRefresh: (expectedPath?: string | null) => Promise<void>;
  currentTrackPath: string | null;
  currentSongId: number | null;
  isPlaying: boolean;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onRegisterPlayback: (track: {
    songId: number;
    streamUrl: string;
    sourcePageUrl: string;
    title: string | null;
    artist: string | null;
    album: string | null;
    coverUrl: string | null;
    durationSecs: number | null;
  }) => void;
}

function RadioCardGrid(props: {
  items: FeedCardItem[];
  hiddenCover: boolean;
  emptyText: string;
  onSelectRadio: (radio: FeedCardItem) => void | Promise<void>;
}) {
  return (
    <Show when={props.items.length > 0} fallback={<div class="panel-note">{props.emptyText}</div>}>
      <div class="album-grid content-fade-in">
        <For each={props.items}>
          {(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={!props.hiddenCover}
              playCount={item.playCount}
              description={item.description}
              onClick={() => void props.onSelectRadio(item)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

export function NeteaseRadioPage(props: NeteaseRadioPageProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [categoriesExpanded, setCategoriesExpanded] = createSignal<boolean>(false);
  const [selectedCategory, setSelectedCategory] = createSignal<RadioCategory | null>(null);
  const [selectedRadio, setSelectedRadio] = createSignal<FeedCardItem | null>(null);
  const [radioDetailInfo, setRadioDetailInfo] = createSignal<RadioDetailInfo | null>(null);
  const [radioTracks, setRadioTracks] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingRadioTracks, setIsLoadingRadioTracks] = createSignal<boolean>(false);
  const [radioProgramLoadCount, setRadioProgramLoadCount] = createSignal<number>(0);
  const [isTogglingRadioSub, setIsTogglingRadioSub] = createSignal<boolean>(false);
  const [isRadioListScrolled, setIsRadioListScrolled] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<Feedback>({ tone: "neutral", message: "" });
  const [categoryTab, setCategoryTab] = createSignal<RadioTab>("hot");
  const [radioDetailTab, setRadioDetailTab] = createSignal<RadioDetailTab>("programs");

  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: props.onRegisterPlayback,
    onStateRefresh: props.onStateRefresh,
    setFeedback: (tone, message) => setFeedback({ tone, message })
  });

  const [categories] = createResource(() =>
    safeLoad(async () => parseRadioCategories(await radioCatList()), [])
  );

  const [hotRadios] = createResource(() =>
    safeLoad(async () => parseRadioCardsFromKey(await radioToplist({ type: "hot", limit: CARD_LIMIT }), "toplist"), [])
  );

  const [categorySections] = createResource(() =>
    safeLoad(async () => parseRadioCategorySections(await radioCategoryRecommend()), [])
  );

  const [categoryHotRadios] = createResource(
    () => selectedCategory()?.id ?? null,
    (categoryId) =>
      categoryId === null
        ? Promise.resolve<FeedCardItem[]>([])
        : safeLoad(
            async () =>
              parseRadioCardsFromKey(
                await radioCategoryHot({ cateId: categoryId, limit: 50, offset: 0 }),
                "djRadios"
              ),
            []
          )
  );

  const [categoryRecommendRadios] = createResource(
    () => selectedCategory()?.id ?? null,
    (categoryId) =>
      categoryId === null
        ? Promise.resolve<FeedCardItem[]>([])
        : safeLoad(async () => parseRadioCardsFromKey(await radioRecommendType(categoryId), "djRadios"), [])
  );

  const categoryItems = createMemo(() => categories() ?? []);
  const visibleCategories = createMemo(() =>
    categoriesExpanded() ? categoryItems() : categoryItems().slice(0, 20)
  );
  const sections = createMemo<RadioCategorySection[]>(() => categorySections() ?? []);
  const categoryTabs = createMemo(() => [
    { value: "hot", label: t("ncm.radio.tab.hot") },
    { value: "recommend", label: t("ncm.radio.tab.recommend") }
  ]);
  const activeCategoryItems = createMemo(() =>
    categoryTab() === "hot" ? categoryHotRadios() ?? [] : categoryRecommendRadios() ?? []
  );
  const isLoadingCategory = createMemo(() =>
    categoryTab() === "hot" ? categoryHotRadios.loading : categoryRecommendRadios.loading
  );
  const emptyText = () => t("ncm.radio.empty");
  const currentRadioDetail = createMemo<RadioDetailInfo | FeedCardItem | null>(() =>
    radioDetailInfo() ?? selectedRadio()
  );
  const isRadioSubscribed = createMemo<boolean>(() =>
    radioDetailInfo()?.subscribed ?? false
  );
  const radioDetailMeta = createMemo<string>(() => {
    const detail = currentRadioDetail();
    const pieces = [
      detail?.subtitle ?? t("ncm.radio.meta"),
      radioDetailInfo()?.programCount !== null && radioDetailInfo()?.programCount !== undefined
        ? t("ncm.radio.programCount", { count: radioDetailInfo()?.programCount ?? 0 })
        : null,
      radioDetailInfo()?.subscriberCount !== null && radioDetailInfo()?.subscriberCount !== undefined
        ? t("ncm.radio.subscriberCount", { count: radioDetailInfo()?.subscriberCount ?? 0 })
        : null
    ].filter((item): item is string => item !== null && item.trim().length > 0);
    return pieces.join(" · ");
  });
  const radioDetailMetaItems = createMemo<NcmListDetailMetaItem[]>(() => {
    const detail = radioDetailInfo();
    const items: NcmListDetailMetaItem[] = [];
    if (detail?.programCount != null) {
      items.push({
        icon: <IconList />,
        text: t("ncm.radio.programCount", { count: detail.programCount })
      });
    }
    if (detail?.subscriberCount != null) {
      items.push({
        icon: <IconHeart />,
        text: t("ncm.radio.subscriberCount", { count: detail.subscriberCount })
      });
    }
    return items;
  });
  const radioSubLabel = createMemo<string>(() => {
    if (isTogglingRadioSub()) return t("ncm.radio.subscribeWorking");
    return isRadioSubscribed() ? t("ncm.radio.unsubscribe") : t("ncm.radio.subscribe");
  });
  const radioPlayLabel = createMemo<string>(() => {
    if (!isLoadingRadioTracks()) return t("ncm.playlist.play");
    const total = radioDetailInfo()?.programCount ?? 0;
    return total > 0
      ? t("ncm.radio.loadingProgress", { loaded: radioProgramLoadCount(), total })
      : t("ncm.radio.loading");
  });

  const loadRadioPrograms = async (radioId: number, expectedCount: number | null) => {
    const tracks: OnlineTrackItem[] = [];
    setRadioTracks([]);
    setRadioProgramLoadCount(0);
    let offset = 0;
    do {
      if (selectedRadio()?.id !== radioId) return;
      const programsPayload = await radioPrograms({ rid: radioId, limit: PROGRAM_LIMIT, offset });
      if (selectedRadio()?.id !== radioId) return;
      const page = parseRadioProgramTracks(programsPayload);
      if (page.length === 0) break;
      tracks.push(...page);
      setRadioTracks([...tracks]);
      setRadioProgramLoadCount(tracks.length);
      offset += PROGRAM_LIMIT;
      if (page.length < PROGRAM_LIMIT) break;
    } while (expectedCount !== null && offset < expectedCount);
  };

  const loadRadioDetail = async (radio: FeedCardItem) => {
    setSelectedCategory(null);
    setSelectedRadio(radio);
    setRadioDetailInfo(null);
    setRadioTracks([]);
    setRadioProgramLoadCount(0);
    setIsRadioListScrolled(false);
    setRadioDetailTab("programs");
    setIsLoadingRadioTracks(true);
    try {
      const detailPayload = await radioDetail({ rid: radio.id });
      if (selectedRadio()?.id !== radio.id) return;
      const nextRadio = parseRadioDetailCard(detailPayload) ?? radio;
      const nextDetail = parseRadioDetailInfo(detailPayload, nextRadio);
      setSelectedRadio(nextRadio);
      setRadioDetailInfo(nextDetail);
      await loadRadioPrograms(nextRadio.id, nextDetail.programCount);
    } catch (error) {
      console.warn("[NeteaseRadioPage] radio detail fetch failed", error);
      setFeedback({ tone: "error", message: t("ncm.radio.empty") });
    } finally {
      setIsLoadingRadioTracks(false);
    }
  };

  const toggleRadioSub = async () => {
    const radio = currentRadioDetail();
    if (radio === null || isTogglingRadioSub()) return;
    if (props.loginProfile === null) {
      setFeedback({ tone: "error", message: t("ncm.radio.loginRequired") });
      props.onRequireNcmLogin();
      return;
    }
    const nextSubscribed = !isRadioSubscribed();
    setIsTogglingRadioSub(true);
    try {
      await radioSub(radio.id, nextSubscribed);
      setRadioDetailInfo((current) => ({
        ...(current ?? {
          id: radio.id,
          title: radio.title,
          subtitle: radio.subtitle,
          coverUrl: radio.coverUrl,
          playCount: radio.playCount,
          description: radio.description,
          programCount: null,
          subscriberCount: null,
          subscribed: null
        }),
        subscriberCount:
          current?.subscriberCount === null || current?.subscriberCount === undefined
            ? null
            : Math.max(0, current.subscriberCount + (nextSubscribed ? 1 : -1)),
        subscribed: nextSubscribed
      }));
      setFeedback({
        tone: "success",
        message: nextSubscribed ? t("ncm.radio.subscribeSuccess") : t("ncm.radio.unsubscribeSuccess")
      });
      props.onSubscribeChange?.(
        {
          id: radio.id,
          title: radio.title,
          subtitle: radio.subtitle,
          coverUrl: radio.coverUrl,
          playCount: radio.playCount,
          description: radio.description
        },
        nextSubscribed
      );
    } catch (error) {
      console.warn("[NeteaseRadioPage] radio subscribe failed", error);
      setFeedback({ tone: "error", message: t("ncm.radio.subscribeFailed") });
    } finally {
      setIsTogglingRadioSub(false);
    }
  };

  createEffect(() => {
    if (selectedCategory() !== null) setCategoryTab("hot");
  });

  createEffect(
    on(
      () => props.radioDetailRequest?.version,
      (version) => {
        if (version === undefined || version === 0) return;
        const radio = props.radioDetailRequest?.radio;
        if (!radio) return;
        void loadRadioDetail(radio);
      }
    )
  );
  const setRadioDetailTabWithReset = (next: RadioDetailTab) => {
    setRadioDetailTab(next);
    setIsRadioListScrolled(false);
  };
  const handleRadioTrackScroll = (event: Event) => {
    const target = event.currentTarget as HTMLElement;
    setIsRadioListScrolled(target.scrollTop > 10);
  };

  return (
    <div class="panel panel-page online-page is-discover-page radio-page">
      <Show
        when={selectedRadio()}
        fallback={
          <Show
            when={selectedCategory()}
            fallback={
              <>
                <PageHeader title={t("ncm.radio.title")} meta={<span>{t("ncm.radio.meta")}</span>} />

                <section class="radio-type">
                  <Show when={visibleCategories().length > 0} fallback={<div class="radio-category-grid is-loading" />}>
                    <div class="radio-category-grid content-fade-in">
                      <For each={visibleCategories()}>
                        {(item) => (
                          <button type="button" class="radio-category-card" onClick={() => setSelectedCategory(item)}>
                            <span>{item.name}</span>
                          </button>
                        )}
                      </For>
                      <Show when={categoryItems().length > 20}>
                        <button
                          type="button"
                          class="radio-category-card radio-category-card--toggle"
                          onClick={() => setCategoriesExpanded(!categoriesExpanded())}
                        >
                          {categoriesExpanded() ? <IconChevronUp /> : <IconChevronDown />}
                          <span>{categoriesExpanded() ? t("ncm.radio.categories.collapse") : t("ncm.radio.categories.expand")}</span>
                        </button>
                      </Show>
                    </div>
                  </Show>
                </section>

                <section class="online-discover-section radio-rec">
                  <div class="radio-section-title">
                    <h2>{t("ncm.radio.section.hot")}</h2>
                  </div>
                  <RadioCardGrid items={hotRadios() ?? []} hiddenCover={uiSettings.hiddenCovers.radio} emptyText={emptyText()} onSelectRadio={(radio) => void loadRadioDetail(radio)} />
                </section>

                <For each={sections()}>
                  {(section) => (
                    <section class="online-discover-section radio-rec">
                      <button
                        type="button"
                        class="radio-section-title radio-section-title--clickable"
                        onClick={() => setSelectedCategory({ id: section.id, name: section.name })}
                      >
                        <h2>{section.name}</h2>
                        <span aria-hidden="true"><IconChevronRight /></span>
                      </button>
                      <RadioCardGrid items={section.radios} hiddenCover={uiSettings.hiddenCovers.radio} emptyText={emptyText()} onSelectRadio={(radio) => void loadRadioDetail(radio)} />
                    </section>
                  )}
                </For>
              </>
            }
          >
            {(category) => (
              <>
                <PageHeader
                  title={category().name}
                  actions={
                    <button type="button" class="ghost-button radio-back-button" onClick={() => setSelectedCategory(null)}>
                      <IconChevronLeft />
                      {t("ncm.radio.back")}
                    </button>
                  }
                  tabs={
                    <SegmentedTabs
                      value={categoryTab()}
                      onChange={(next) => setCategoryTab(next as RadioTab)}
                      items={categoryTabs()}
                      ariaLabel={t("ncm.radio.tabs.aria")}
                    />
                  }
                />
                <section class="online-discover-section radio-rec">
                  <RadioCardGrid
                    items={activeCategoryItems()}
                    hiddenCover={uiSettings.hiddenCovers.radio}
                    emptyText={emptyText()}
                    onSelectRadio={(radio) => void loadRadioDetail(radio)}
                  />
                  <Show when={isLoadingCategory()}>
                    <div class="panel-note">{t("ncm.radio.loading")}</div>
                  </Show>
                </section>
              </>
            )}
          </Show>
        }
      >
        {(radio) => (
          <>
            <button type="button" class="ghost-button radio-back-button" onClick={() => {
              setSelectedRadio(null);
              setRadioDetailInfo(null);
              setRadioTracks([]);
              setRadioProgramLoadCount(0);
              setRadioDetailTabWithReset("programs");
            }}>
              <IconChevronLeft />
              {t("ncm.radio.back")}
            </button>
            <section class="online-discover-section radio-rec">
              <NcmListDetail
                title={radio().title}
                coverUrl={radio().coverUrl}
                hiddenCover={uiSettings.hiddenCovers.radio}
                compact={isRadioListScrolled()}
                showCoverMask
                playCount={radio().playCount}
                description={radio().description ?? radio().subtitle ?? radioDetailMeta()}
                metaItems={radioDetailMetaItems()}
                playLabel={radioPlayLabel()}
                playDisabled={radioTracks().length === 0}
                loading={isLoadingRadioTracks()}
                onPlay={() => {
                  const [first, ...rest] = radioTracks();
                  if (!first) return;
                  void (async () => {
                    await playback.playOnlineTrack(first);
                    for (const item of rest) {
                      await playback.enqueueOnlineTrack(item);
                    }
                  })();
                }}
                activeTab={radioDetailTab()}
                onTabChange={(next) => setRadioDetailTabWithReset(next === "comments" ? "comments" : "programs")}
                tabs={[
                  { value: "programs", label: t("ncm.radio.tab.programs"), count: radioDetailInfo()?.programCount },
                  { value: "comments", label: t("ncm.playlist.tab.comments") }
                ]}
                actionButtons={
                  <>
                    <button
                      type="button"
                      class={`ghost-button radio-subscribe-button${isRadioSubscribed() ? " is-active" : ""}`}
                      disabled={isTogglingRadioSub()}
                      onClick={() => void toggleRadioSub()}
                    >
                      <Show when={isTogglingRadioSub()} fallback={isRadioSubscribed() ? <IconHeartFilled /> : <IconHeart />}>
                        <IconSpinner />
                      </Show>
                      {radioSubLabel()}
                    </button>
                    <button type="button" class="ghost-button radio-back-button" onClick={() => openRadioSource(radio().id)}>
                      <IconList />
                      {t("ncm.playlist.openSource")}
                    </button>
                  </>
                }
              />
              <div class="radio-detail-tabs radio-detail-tabs--mobile">
                <SegmentedTabs
                  value={radioDetailTab()}
                  onChange={(next) => setRadioDetailTabWithReset(next === "comments" ? "comments" : "programs")}
                  items={[
                    { value: "programs", label: t("ncm.radio.tab.programs") },
                    { value: "comments", label: t("ncm.playlist.tab.comments") }
                  ]}
                  ariaLabel={t("ncm.radio.detailTabs.aria")}
                />
              </div>
              <Show
                when={radioDetailTab() === "programs"}
                fallback={
                  <ResourceCommentsPanel
                    class="radio-detail-comments"
                    resourceId={radio().id}
                    resourceType={7}
                    title={t("ncm.playlist.tab.comments")}
                    grouped
                  />
                }
              >
                <MediaList
                  items={radioTracks()}
                  currentSourcePath={props.currentTrackPath}
                  currentSongId={props.currentSongId}
                  isPlayingNow={props.isPlaying}
                  hideArtwork={uiSettings.hiddenCovers.radio}
                  onPlay={(item) => void playback.playOnlineTrack(item)}
                  onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
                  onContextAction={(action, item) => {
                    if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
                  }}
                  onScroll={handleRadioTrackScroll}
                  isLoading={isLoadingRadioTracks()}
                  emptyState={<div class="panel-note">{emptyText()}</div>}
                />
              </Show>
              <Show when={feedback().tone === "error"}>
                <div class="panel-note">{feedback().message}</div>
              </Show>
              <Show when={feedback().tone === "success"}>
                <div class="panel-note">{feedback().message}</div>
              </Show>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}
