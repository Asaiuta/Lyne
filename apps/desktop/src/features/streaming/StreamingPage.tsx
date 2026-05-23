import { createSignal } from "solid-js";
import {
  IconCloud,
  IconMusic,
  IconPlayCircle,
  IconRefresh
} from "../../components/icons";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedTabs } from "../../components/page/SegmentedTabs";
import { useTranslation } from "../../shared/i18n";

type StreamingTab = "songs" | "artists" | "albums" | "playlists";

export function StreamingPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = createSignal<StreamingTab>("songs");

  return (
    <section class="panel panel-page auxiliary-page auxiliary-page-streaming">
      <header class="auxiliary-page-head">
        <div class="auxiliary-page-title">
          <h1>{t("streaming.title")}</h1>
          <div class="auxiliary-page-status">
            <span class="auxiliary-page-status-item">
              <IconMusic />
              {t("streaming.status.songCount", { count: 0 })}
            </span>
            <span class="auxiliary-page-status-item">
              <IconCloud />
              {t("streaming.status.disconnected")}
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
              <span>{t("streaming.action.play")}</span>
            </button>
            <button
              type="button"
              class="ghost-button page-action auxiliary-page-icon-button"
              disabled
              aria-label={t("streaming.action.refresh")}
              title={t("streaming.action.refresh")}
            >
              <IconRefresh />
            </button>
          </div>
          <SegmentedTabs
            value={activeTab()}
            onChange={(next) => setActiveTab(next as StreamingTab)}
            items={[
              { value: "songs", label: t("streaming.tab.songs"), disabled: true },
              { value: "artists", label: t("streaming.tab.artists"), disabled: true },
              { value: "albums", label: t("streaming.tab.albums"), disabled: true },
              { value: "playlists", label: t("streaming.tab.playlists"), disabled: true }
            ]}
            ariaLabel={t("streaming.title")}
          />
        </div>
      </header>

      <div class="auxiliary-page-body">
        <EmptyState
          size="lg"
          icon={<IconCloud />}
          description={t("streaming.empty.disconnected")}
        />
      </div>
    </section>
  );
}
