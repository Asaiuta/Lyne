import { createSignal } from "solid-js";
import {
  IconDownload,
  IconList,
  IconMusic,
  IconPlayCircle,
  IconRefresh
} from "../../components/icons";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { useTranslation } from "../../shared/i18n";

type DownloadTab = "downloaded" | "downloading";

export function DownloadPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = createSignal<DownloadTab>("downloaded");

  const downloadedCount = () => 0;
  const downloadingCount = () => 0;
  const currentCount = () =>
    activeTab() === "downloaded" ? downloadedCount() : downloadingCount();

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
            <button
              type="button"
              class="primary-button page-action auxiliary-page-play"
              disabled
            >
              <IconPlayCircle />
              <span>{t("download.action.playAll")}</span>
            </button>
            <button
              type="button"
              class="ghost-button page-action auxiliary-page-icon-button"
              disabled
              aria-label={t("download.action.refresh")}
              title={t("download.action.refresh")}
            >
              <IconRefresh />
            </button>
          </div>
          <SegmentedTabs
            value={activeTab()}
            onChange={(next) => setActiveTab(next as DownloadTab)}
            items={[
              { value: "downloaded", label: t("download.tab.downloaded") },
              { value: "downloading", label: t("download.tab.downloading") }
            ]}
            ariaLabel={t("download.title")}
          />
        </div>
      </header>

      <div class="auxiliary-page-body">
        <EmptyState
          size="lg"
          icon={<IconList />}
          description={
            activeTab() === "downloaded"
              ? t("download.empty.downloaded")
              : t("download.empty.downloading")
          }
        />
      </div>
    </section>
  );
}
