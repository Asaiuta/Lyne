import { useTranslation } from "../../../shared/i18n";
import { ButtonSettingItem } from "../components/SettingControls";
import { SettingItem, settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";

interface AboutSectionProps {
  highlightId: string | null;
}

const APP_VERSION = "v0.1.0";

export function AboutSection(props: AboutSectionProps) {
  const { t } = useTranslation();

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.about.app.title")}>
        <SettingItem
          id="appVersion"
          label="Lyne"
          description={t("settings.about.appVersion.desc")}
          highlighted={isHi("appVersion")}
          index={nextIndex()}
        >
          <span class="text-text-soft font-600">{APP_VERSION}</span>
        </SettingItem>
        <ButtonSettingItem
          id="checkUpdate"
          label={t("settings.about.checkUpdate")}
          description={t("settings.about.checkUpdate.desc")}
          highlighted={isHi("checkUpdate")}
          index={nextIndex()}
          buttonLabel={t("settings.about.checkUpdate.action")}
          wip
        />
        <ButtonSettingItem
          id="changelog"
          label={t("settings.about.changelog")}
          highlighted={isHi("changelog")}
          index={nextIndex()}
          buttonLabel={t("settings.about.changelog.action")}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.about.project.title")}>
        <ButtonSettingItem
          id="projectRepo"
          label={t("settings.about.projectRepo")}
          highlighted={isHi("projectRepo")}
          index={nextIndex()}
          buttonLabel={t("settings.about.projectRepo.action")}
          wip
        />
        <ButtonSettingItem
          id="reportIssue"
          label={t("settings.about.reportIssue")}
          highlighted={isHi("reportIssue")}
          index={nextIndex()}
          buttonLabel={t("settings.about.reportIssue.action")}
          wip
        />
        <ButtonSettingItem
          id="contributors"
          label={t("settings.about.contributors")}
          highlighted={isHi("contributors")}
          index={nextIndex()}
          buttonLabel={t("settings.about.contributors.action")}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.about.credits.title")}>
        <ButtonSettingItem
          id="references"
          label={t("settings.about.references")}
          description={t("settings.about.references.desc")}
          highlighted={isHi("references")}
          index={nextIndex()}
          buttonLabel={t("settings.about.references.action")}
          wip
        />
      </SettingGroup>
    </section>
  );
}
