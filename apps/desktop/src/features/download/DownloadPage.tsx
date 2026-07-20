import { createMemo, createSignal } from "solid-js";
import {
  IconDownload,
  IconList,
  IconMusic,
  IconPlayFilled,
  IconRefreshFilled
} from "../../components/icons";
import { EmptyState } from "../../components/EmptyState";
import { PageToolbarButton } from "../../components/page/PageToolbarButton";
import { RouteContentTransition } from "../../components/RouteContentTransition";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { NaiveTabs, type NaiveTabItem } from "../../shared/ui/naive";
import "../../shared/styles/pages/auxiliary.css";

type DownloadTab = "downloaded" | "downloading";

export function DownloadPage() {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [activeTab, setActiveTab] = createSignal<DownloadTab>("downloaded");

  const downloadedCount = () => 0;
  const downloadingCount = () => 0;
  const currentCount = () =>
    activeTab() === "downloaded" ? downloadedCount() : downloadingCount();
  const tabItems = createMemo<ReadonlyArray<NaiveTabItem<DownloadTab>>>(() => [
    { value: "downloaded", label: t("download.tab.downloaded") },
    { value: "downloading", label: t("download.tab.downloading") }
  ]);

  return (
    <section class="panel panel-page auxiliary-page auxiliary-page-download">
      <header class="auxiliary-page-head">
        <div class="auxiliary-page-title">
          <h1>{t("download.title")}</h1>
          <div class="auxiliary-page-status">
            <span class="auxiliary-page-status-item">
              <IconMusic />
              {t("download.status.songCount", { count: currentCount() })}
            </span>
            <span class="auxiliary-page-status-item">
              <IconDownload />
              {activeTab() === "downloaded"
                ? t("download.status.downloading", { count: downloadingCount() })
                : t("download.status.completed", { count: downloadedCount() })}
            </span>
          </div>
        </div>

        <div class="auxiliary-page-menu">
          <div class="auxiliary-page-menu-left">
            <PageToolbarButton variant="primary" class="auxiliary-page-play" disabled>
              <IconPlayFilled />
              <span>{t("download.action.playAll")}</span>
            </PageToolbarButton>
            <PageToolbarButton
              variant="icon"
              class="auxiliary-page-icon-button"
              disabled
              ariaLabel={t("download.action.refresh")}
              title={t("download.action.refresh")}
            >
              <IconRefreshFilled />
            </PageToolbarButton>
          </div>
          <NaiveTabs
            value={activeTab()}
            onChange={setActiveTab}
            items={tabItems()}
            type="segment"
            class="tabs"
            ariaLabel={t("download.title")}
          />
        </div>
      </header>

      <RouteContentTransition
        value={activeTab()}
        transitionKey={activeTab()}
        animation={uiSettings.routeAnimation}
        motionScope="download-content"
      >
        {(displayedDownloadTab) => (
          <div class="auxiliary-page-body" data-download-tab={displayedDownloadTab()}>
            <EmptyState
              size="lg"
              icon={<IconList />}
              description={
                displayedDownloadTab() === "downloaded"
                  ? t("download.empty.downloaded")
                  : t("download.empty.downloading")
              }
            />
          </div>
        )}
      </RouteContentTransition>
    </section>
  );
}
