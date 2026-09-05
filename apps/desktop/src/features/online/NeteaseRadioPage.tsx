import { For, Show, createEffect, createMemo, createResource, createSignal, on } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import {
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconFavoriteBorderFilled,
  IconFavoriteFilled,
  IconFormatListFilled
} from "../../components/icons";
import { NcmMediaList } from "./NcmMediaList";
import { BackToTop } from "../../components/page/BackToTop";
import { PageBackButton } from "../../components/page/PageBackButton";
import { PageBody } from "../../components/page/PageBody";
import { PageStickyHeader } from "../../components/page/PageStickyHeader";
import { PageSurface } from "../../components/page/PageSurface";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { PageToolbarButton } from "../../components/page/PageToolbarButton";
import { createApiClient } from "../../shared/api/client";
import { usePlayback } from "../../app/PlaybackContext";
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
  NaiveButton,
  NaiveGrid,
  NaiveGridItem,
  NaiveH1,
  NaiveH3,
  NaiveSkeleton,
  NaiveSpin,
  NaiveTabs,
  type NaiveTabItem
} from "../../shared/ui/naive";
import "../../shared/styles/pages/online-catalog-cards.css";
import "../../shared/styles/pages/online-page.css";
import "../../shared/styles/pages/radio.css";
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
  window.open(ncmDjRadioPageUrl(id), "_blank", "noopener,noreferrer");
};

export interface RadioDetailRequest {
  radio: FeedCardItem | null;
  version: number;
}

export interface NeteaseRadioPageProps {
  isDetailRoute?: boolean;
  radioDetailRequest?: RadioDetailRequest;
  loginProfile: NcmProfile | null;
  onRequireNcmLogin: () => void;
  onSubscribeChange?: (radio: FeedCardItem, subscribed: boolean) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
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

function RadioCategorySkeleton() {
  return (
    <NaiveGrid
      class="radio-category-grid is-loading"
      cols="3 400:4 600:5 800:6 1000:7"
      xGap={20}
      yGap={20}
      collapsed
      role="presentation"
    >
      <For each={Array.from({ length: 20 }, (_, index) => index)}>
        {() => (
          <NaiveGridItem>
            <div class="radio-category-card radio-category-card--skeleton">
              <NaiveSkeleton shape="text" />
            </div>
          </NaiveGridItem>
        )}
      </For>
    </NaiveGrid>
  );
}

export function NeteaseRadioPage(props: NeteaseRadioPageProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const playbackContext = usePlayback();
  const [categoriesExpanded, setCategoriesExpanded] = createSignal<boolean>(false);
  const [selectedCategory, setSelectedCategory] = createSignal<RadioCategory | null>(null);
  const [selectedRadio, setSelectedRadio] = createSignal<FeedCardItem | null>(null);
  const [radioDetailInfo, setRadioDetailInfo] = createSignal<RadioDetailInfo | null>(null);
  const [radioTracks, setRadioTracks] = createSignal<OnlineTrackItem[]>([]);
  const [isLoadingRadioTracks, setIsLoadingRadioTracks] = createSignal<boolean>(false);
  const [radioProgramLoadCount, setRadioProgramLoadCount] = createSignal<number>(0);
  const [isTogglingRadioSub, setIsTogglingRadioSub] = createSignal<boolean>(false);
  const [feedback, setFeedback] = createSignal<Feedback>({ tone: "neutral", message: "" });
  const [categoryTab, setCategoryTab] = createSignal<RadioTab>("hot");
  const [radioDetailTab, setRadioDetailTab] = createSignal<RadioDetailTab>("programs");
  const [categoryLoadFailed, setCategoryLoadFailed] = createSignal<boolean>(false);

  const playback = createPlaybackController({
    api,
    t,
    onRegisterPlayback: playbackContext.registerNcmPlayback,
    onApplyPlayerState: playbackContext.applyPlayerState,
    onStateRefresh: playbackContext.refreshState,
    setFeedback: (tone, message) => setFeedback({ tone, message })
  });

  const [categories] = createResource(async () => {
    try {
      setCategoryLoadFailed(false);
      return parseRadioCategories(await radioCatList());
    } catch (error) {
      console.warn("[NeteaseRadioPage] radio categories fetch failed", error);
      setCategoryLoadFailed(true);
      return [];
    }
  });

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
  const sections = createMemo<RadioCategorySection[]>(() => categorySections() ?? []);
  const categoryTabs = createMemo<ReadonlyArray<NaiveTabItem<RadioTab>>>(() => [
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
        icon: <IconFormatListFilled />,
        text: t("ncm.radio.programCount", { count: detail.programCount })
      });
    }
    if (detail?.subscriberCount != null) {
      items.push({
        icon: <IconFavoriteBorderFilled />,
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

  const openRadioDetail = (radio: FeedCardItem) => {
    if (props.isDetailRoute === true || !props.onNavigateToRadioDetail) {
      void loadRadioDetail(radio);
      return;
    }
    props.onNavigateToRadioDetail(radio);
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
  };

  return (
    <div
      class="panel panel-page online-page is-radio-page radio-page"
      classList={{ "is-radio-detail-view": selectedRadio() !== null }}
    >
      <Show
        when={selectedRadio()}
        fallback={
          <Show
            when={!props.isDetailRoute}
            fallback={
              <div class="panel-note">
                {isLoadingRadioTracks() || props.radioDetailRequest?.radio
                  ? t("ncm.radio.loading")
                  : emptyText()}
              </div>
            }
          >
            <Show
              when={selectedCategory()}
              fallback={
                <div class="radio-home-view">
                  <section class="radio-type">
                    <Show
                      when={categoryItems().length > 0}
                      fallback={
                        categories.loading ? (
                          <RadioCategorySkeleton />
                        ) : categoryLoadFailed() ? (
                          <div class="panel-note status-error">{t("common.error.requestFailed")}</div>
                        ) : (
                          <div class="panel-note">{emptyText()}</div>
                        )
                      }
                    >
                      <NaiveGrid
                        class="radio-category-grid content-fade-in"
                        cols="3 400:4 600:5 800:6 1000:7"
                        xGap={20}
                        yGap={20}
                        collapsed={!categoriesExpanded()}
                      >
                        <For each={categoryItems()}>
                          {(item) => (
                            <NaiveGridItem>
                              <button
                                type="button"
                                class="radio-category-card radio-category-card--item"
                                onClick={() => setSelectedCategory(item)}
                              >
                                <span>{item.name}</span>
                              </button>
                            </NaiveGridItem>
                          )}
                        </For>
                        <NaiveGridItem class="radio-category-grid-suffix" suffix>
                          {({ overflow }) => (
                            <button
                              type="button"
                              class="radio-category-card radio-category-card--toggle"
                              onClick={() => setCategoriesExpanded((expanded) => !expanded)}
                            >
                              {overflow ? <IconChevronDown /> : <IconChevronUp />}
                              <span>
                                {overflow
                                  ? t("ncm.radio.categories.expand")
                                  : t("ncm.radio.categories.collapse")}
                              </span>
                            </button>
                          )}
                        </NaiveGridItem>
                      </NaiveGrid>
                    </Show>
                  </section>

                  <div class="radio-home-recommendations">
                    <section class="radio-rec online-catalog-context">
                      <NaiveH3 class="radio-section-title" prefix="bar">
                        {t("ncm.radio.section.hot")}
                      </NaiveH3>
                      <RadioCardGrid
                        items={hotRadios() ?? []}
                        hiddenCover={uiSettings.hiddenCovers.radio}
                        emptyText={emptyText()}
                        onSelectRadio={openRadioDetail}
                      />
                    </section>

                    <For each={sections()}>
                      {(section) => (
                        <section class="radio-rec online-catalog-context">
                          <button
                            type="button"
                            class="radio-section-title-action"
                            onClick={() => setSelectedCategory({ id: section.id, name: section.name })}
                          >
                            <NaiveH3 class="radio-section-title" prefix="bar">
                              <span>{section.name}</span>
                              <IconChevronRight />
                            </NaiveH3>
                          </button>
                          <RadioCardGrid
                            items={section.radios}
                            hiddenCover={uiSettings.hiddenCovers.radio}
                            emptyText={emptyText()}
                            onSelectRadio={openRadioDetail}
                          />
                        </section>
                      )}
                    </For>
                  </div>
                </div>
              }
            >
              {(category) => (
                <div class="radio-category-view">
                  <header class="radio-category-heading">
                    <NaiveButton
                      class="radio-category-back-button"
                      onClick={() => setSelectedCategory(null)}
                      round
                      secondary
                      size="medium"
                      strong
                    >
                      <IconChevronLeft />
                      {t("ncm.radio.back")}
                    </NaiveButton>
                    <NaiveH1 class="radio-category-title">{category().name}</NaiveH1>
                  </header>
                  <NaiveTabs
                    class="radio-category-tabs"
                    value={categoryTab()}
                    onChange={setCategoryTab}
                    items={categoryTabs()}
                    type="segment"
                    ariaLabel={t("ncm.radio.tabs.aria")}
                  />
                  <section class="radio-rec radio-category-results online-catalog-context">
                    <RadioCardGrid
                      items={activeCategoryItems()}
                      hiddenCover={uiSettings.hiddenCovers.radio}
                      emptyText={emptyText()}
                      onSelectRadio={openRadioDetail}
                    />
                    <Show when={isLoadingCategory()}>
                      <div class="panel-note">{t("ncm.radio.loading")}</div>
                    </Show>
                  </section>
                </div>
              )}
            </Show>
          </Show>
        }
      >
        {(radio) => (
          <PageSurface
            class="radio-detail-view"
            persistKey={`radio:${radio().id}`}
            resetKey={radio().id}
          >
            <PageStickyHeader threshold={10}>
              {({ compact }) => (
                <>
                  <Show when={!props.isDetailRoute}>
                    <PageBackButton
                      ariaLabel={t("ncm.radio.back")}
                      class="radio-inline-back-button"
                      onClick={() => {
                        setSelectedRadio(null);
                        setRadioDetailInfo(null);
                        setRadioTracks([]);
                        setRadioProgramLoadCount(0);
                        setRadioDetailTabWithReset("programs");
                      }}
                    />
                  </Show>
                  <section class="radio-detail-content">
                    <NcmListDetail
                      title={radio().title}
                      coverUrl={radio().coverUrl}
                      hiddenCover={uiSettings.hiddenCovers.radio}
                      compact={compact()}
                      showCoverMask
                      playCount={radio().playCount}
                      description={radio().description ?? radio().subtitle ?? radioDetailMeta()}
                      metaItems={radioDetailMetaItems()}
                      playLabel={radioPlayLabel()}
                      playDisabled={radioTracks().length === 0}
                      loading={isLoadingRadioTracks()}
                      onPlay={() => {
                        void playback.playAll(radioTracks());
                      }}
                      activeTab={radioDetailTab()}
                      onTabChange={(next) => setRadioDetailTabWithReset(next === "comments" ? "comments" : "programs")}
                      tabs={[
                        { value: "programs", label: t("ncm.radio.tab.programs"), count: radioDetailInfo()?.programCount },
                        { value: "comments", label: t("ncm.playlist.tab.comments") }
                      ]}
                      actionButtons={
                        <>
                          <PageToolbarButton
                            variant="secondary"
                            class="radio-subscribe-button"
                            active={isRadioSubscribed()}
                            disabled={isTogglingRadioSub()}
                            onClick={() => void toggleRadioSub()}
                          >
                            <Show when={isTogglingRadioSub()} fallback={isRadioSubscribed() ? <IconFavoriteFilled /> : <IconFavoriteBorderFilled />}>
                              <NaiveSpin size={17} ariaHidden />
                            </Show>
                            {radioSubLabel()}
                          </PageToolbarButton>
                          <PageToolbarButton variant="secondary" class="radio-source-button" onClick={() => openRadioSource(radio().id)}>
                            <IconFormatListFilled />
                            {t("ncm.playlist.openSource")}
                          </PageToolbarButton>
                        </>
                      }
                    />
                    <SegmentedTabs
                      class="radio-detail-tabs radio-detail-tabs--mobile"
                      density={compact() ? "compact" : "regular"}
                      variant="surface"
                      value={radioDetailTab()}
                      onChange={(next) => setRadioDetailTabWithReset(next === "comments" ? "comments" : "programs")}
                      items={[
                        { value: "programs", label: t("ncm.radio.tab.programs") },
                        { value: "comments", label: t("ncm.playlist.tab.comments") }
                      ]}
                      ariaLabel={t("ncm.radio.detailTabs.aria")}
                    />
                    <PageBody class="radio-detail-body">
                      <Show
                        when={radioDetailTab() === "programs"}
                        fallback={
                          <ResourceCommentsPanel
                            class="radio-detail-comments"
                            resourceId={radio().id}
                            resourceType={7}
                            title={t("ncm.playlist.tab.comments")}
                            grouped
                            pageScrollRoot
                          />
                        }
                      >
                        <NcmMediaList
                          items={radioTracks()}
                          currentSourcePath={playbackContext.currentTrackPath()}
                          currentSongId={playbackContext.currentSongId()}
                          isPlayingNow={playbackContext.isPlaying()}
                          hideArtwork={uiSettings.hiddenCovers.radio}
                          onPlay={(item) => void playback.playOnlineTrack(item)}
                          onEnqueue={(item) => void playback.enqueueOnlineTrack(item)}
                          onContextAction={(action, item) => {
                            if (action === "song-wiki") props.onNavigateToSongWiki?.(item);
                          }}
                          isLoading={isLoadingRadioTracks()}
                          emptyState={<div class="panel-note">{emptyText()}</div>}
                        />
                      </Show>
                    </PageBody>
                    <Show when={feedback().tone === "error"}>
                      <div class="panel-note radio-detail-feedback">{feedback().message}</div>
                    </Show>
                    <Show when={feedback().tone === "success"}>
                      <div class="panel-note radio-detail-feedback">{feedback().message}</div>
                    </Show>
                  </section>
                </>
              )}
            </PageStickyHeader>
            <BackToTop label={t("media.scroll.top")} />
          </PageSurface>
        )}
      </Show>
    </div>
  );
}
