import { For, Show, createEffect, createMemo, createResource, createSignal } from "solid-js";
import { AlbumCard } from "../../components/AlbumCard";
import { IconChevronLeft } from "../../components/icons";
import { PageHeader } from "../../components/page/PageHeader";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import {
  radioCategoryHot,
  radioCategoryRecommend,
  radioCatList,
  radioRecommendType,
  radioToplist
} from "../../shared/api/ncm/radio";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import {
  type RadioCategory,
  type RadioCategorySection,
  parseRadioCardsFromKey,
  parseRadioCategories,
  parseRadioCategorySections
} from "./radioParsers";
import type { FeedCardItem } from "./shared/types";

type RadioTab = "hot" | "recommend";

const CARD_LIMIT = 20;

const safeLoad = async <T,>(load: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await load();
  } catch (error) {
    console.warn("[NeteaseRadioPage] radio fetch failed", error);
    return fallback;
  }
};

const openRadioSource = (id: number) => {
  window.open(`https://music.163.com/#/djradio?id=${id}`, "_blank");
};

function RadioCardGrid(props: { items: FeedCardItem[]; hiddenCover: boolean; emptyText: string }) {
  return (
    <Show when={props.items.length > 0} fallback={<div class="panel-note">{props.emptyText}</div>}>
      <div class="album-grid">
        <For each={props.items}>
          {(item) => (
            <AlbumCard
              title={item.title}
              subtitle={item.subtitle}
              coverUrl={item.coverUrl}
              coverVisible={!props.hiddenCover}
              playCount={item.playCount}
              description={item.description}
              onClick={() => openRadioSource(item.id)}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

export function NeteaseRadioPage() {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [categoriesExpanded, setCategoriesExpanded] = createSignal<boolean>(false);
  const [selectedCategory, setSelectedCategory] = createSignal<RadioCategory | null>(null);
  const [categoryTab, setCategoryTab] = createSignal<RadioTab>("hot");

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

  createEffect(() => {
    if (selectedCategory() !== null) setCategoryTab("hot");
  });

  return (
    <div class="panel panel-page online-page is-discover-page radio-page">
      <Show
        when={selectedCategory()}
        fallback={
          <>
            <PageHeader title={t("ncm.radio.title")} meta={<span>{t("ncm.radio.meta")}</span>} />

            <section class="radio-type">
              <Show when={visibleCategories().length > 0} fallback={<div class="radio-category-grid is-loading" />}>
                <div class="radio-category-grid">
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
              <RadioCardGrid items={hotRadios() ?? []} hiddenCover={uiSettings.hiddenCovers.radio} emptyText={emptyText()} />
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
                    <span aria-hidden="true">›</span>
                  </button>
                  <RadioCardGrid items={section.radios} hiddenCover={uiSettings.hiddenCovers.radio} emptyText={emptyText()} />
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
              />
              <Show when={isLoadingCategory()}>
                <div class="panel-note">{t("ncm.radio.loading")}</div>
              </Show>
            </section>
          </>
        )}
      </Show>
    </div>
  );
}
