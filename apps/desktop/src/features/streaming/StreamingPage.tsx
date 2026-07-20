import { createMemo, createSignal } from "solid-js";
import {
  IconCloud,
  IconMusic,
  IconPlayFilled,
  IconRefreshFilled
} from "../../components/icons";
import { EmptyState } from "../../components/EmptyState";
import { PageToolbarButton } from "../../components/page/PageToolbarButton";
import { RouteContentTransition } from "../../components/RouteContentTransition";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import { NaiveNumberAnimation, NaiveTabs, type NaiveTabItem } from "../../shared/ui/naive";
import "../../shared/styles/pages/auxiliary.css";

type StreamingTab = "songs" | "artists" | "albums" | "playlists";

export function StreamingPage() {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [activeTab, setActiveTab] = createSignal<StreamingTab>("songs");
  const songCount = () => 0;
  const songCountSuffix = () =>
    t("streaming.status.songCount", { count: "" });
  const tabItems = createMemo<ReadonlyArray<NaiveTabItem<StreamingTab>>>(() => [
    { value: "songs", label: t("streaming.tab.songs"), disabled: true },
    { value: "artists", label: t("streaming.tab.artists"), disabled: true },
    { value: "albums", label: t("streaming.tab.albums"), disabled: true },
    { value: "playlists", label: t("streaming.tab.playlists"), disabled: true }
  ]);

  return (
    <section class="panel panel-page auxiliary-page auxiliary-page-streaming">
      <header class="auxiliary-page-head">
        <div class="auxiliary-page-title">
          <h1>{t("streaming.title")}</h1>
          <div class="auxiliary-page-status">
            <span class="auxiliary-page-status-item">
              <IconMusic />
              <NaiveNumberAnimation from={0} to={songCount()} />
              {songCountSuffix()}
            </span>
            <span class="auxiliary-page-status-item">
              <IconCloud />
              {t("streaming.status.disconnected")}
            </span>
          </div>
        </div>

        <div class="auxiliary-page-menu">
          <div class="auxiliary-page-menu-left">
            <PageToolbarButton variant="primary" class="auxiliary-page-play" disabled>
              <IconPlayFilled />
              <span>{t("streaming.action.play")}</span>
            </PageToolbarButton>
            <PageToolbarButton
              variant="icon"
              class="auxiliary-page-icon-button"
              disabled
              ariaLabel={t("streaming.action.refresh")}
              title={t("streaming.action.refresh")}
            >
              <IconRefreshFilled />
            </PageToolbarButton>
          </div>
          <NaiveTabs
            class="streaming-tabs"
            value={activeTab()}
            onChange={setActiveTab}
            items={tabItems()}
            type="segment"
            ariaLabel={t("streaming.title")}
          />
        </div>
      </header>

      <RouteContentTransition
        value={activeTab()}
        transitionKey={activeTab()}
        animation={uiSettings.routeAnimation}
        motionScope="streaming-content"
      >
        {(displayedStreamingTab) => (
          <div class="auxiliary-page-body" data-streaming-tab={displayedStreamingTab()}>
            <EmptyState
              size="lg"
              icon={<IconCloud />}
              description={t("streaming.empty.disconnected")}
            />
          </div>
        )}
      </RouteContentTransition>
    </section>
  );
}
