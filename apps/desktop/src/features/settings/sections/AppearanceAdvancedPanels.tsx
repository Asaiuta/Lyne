import { For, Show, createMemo, createSignal } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { GlobalFont } from "../../../shared/state/useUISettings";
import {
  BooleanSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { SettingItem } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import type { ManagerConfig } from "./appearanceConfig";
import type { AppearanceSettings } from "./useAppearanceSettings";

interface AppearanceAdvancedPanelProps {
  manager: ManagerConfig;
  settings: AppearanceSettings;
  highlightId: string | null;
  nextIndex: () => number;
  onBack: () => void;
}

const PRESET_COLORS = ["#fe7971", "#ffb454", "#57c785", "#56a8ff", "#c084fc"] as const;

type FeedbackTone = "success" | "error";

function PanelHeader(props: { manager: ManagerConfig; onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <div class="settings-subpage-head">
      <button type="button" class="ghost-button settings-subpage-back" onClick={props.onBack}>
        {t("settings.appearance.back")}
      </button>
      <div class="settings-subpage-copy">
        <h2>{t(props.manager.labelKey)}</h2>
        <p>{t(props.manager.descriptionKey)}</p>
      </div>
    </div>
  );
}

export function ThemeConfigPanel(props: AppearanceAdvancedPanelProps) {
  const { t } = useTranslation();
  const isHi = (id: string) => props.highlightId === id;

  return (
    <>
      <PanelHeader manager={props.manager} onBack={props.onBack} />
      <SettingGroup title={t("settings.appearance.themeConfig")}>
        <BooleanSettingItem
          id="themeGlobalColor"
          label={t("settings.appearance.themeGlobalColor")}
          description={t("settings.appearance.themeGlobalColor.desc")}
          highlighted={isHi("themeGlobalColor")}
          index={props.nextIndex()}
          checked={props.settings.themeGlobalColor()}
          onChange={props.settings.handleThemeGlobalColor}
        />

        <BooleanSettingItem
          id="themeFollowCover"
          label={t("settings.appearance.themeFollowCover")}
          description={t("settings.appearance.themeFollowCover.desc")}
          highlighted={isHi("themeFollowCover")}
          index={props.nextIndex()}
          checked={props.settings.themeFollowCover()}
          onChange={props.settings.handleThemeFollowCover}
        />

        <SettingItem
          id="customAccentColor"
          label={t("settings.appearance.customAccentColor")}
          description={t("settings.appearance.customAccentColor.desc")}
          highlighted={isHi("customAccentColor")}
          index={props.nextIndex()}
        >
          <div class="settings-color-control">
            <For each={PRESET_COLORS}>
              {(color) => (
                <button
                  type="button"
                  class={`settings-color-swatch${props.settings.customAccentColor().toLowerCase() === color ? " is-active" : ""}`}
                  style={{ "--swatch-color": color }}
                  onClick={() => props.settings.handleCustomAccentColor(color)}
                  aria-label={color}
                  disabled={props.settings.themeFollowCover()}
                />
              )}
            </For>
            <input
              type="color"
              class="settings-color-picker"
              value={props.settings.customAccentColor()}
              onInput={(event) => props.settings.setCustomAccentColor(event.currentTarget.value)}
              onChange={(event) => props.settings.handleCustomAccentColor(event.currentTarget.value)}
              disabled={props.settings.themeFollowCover()}
              aria-label={t("settings.appearance.customAccentColor")}
            />
          </div>
        </SettingItem>
      </SettingGroup>
    </>
  );
}

export function FontConfigPanel(props: AppearanceAdvancedPanelProps) {
  const { t } = useTranslation();
  const isHi = (id: string) => props.highlightId === id;
  const fontOptions = createMemo<SelectOption[]>(() => [
    { value: "default", label: t("settings.appearance.font.default") },
    { value: "system", label: t("settings.appearance.font.system") },
    { value: "serif", label: t("settings.appearance.font.serif") },
    { value: "mono", label: t("settings.appearance.font.mono") },
    { value: "custom", label: t("settings.appearance.font.custom") }
  ]);

  return (
    <>
      <PanelHeader manager={props.manager} onBack={props.onBack} />
      <SettingGroup title={t("settings.appearance.fontConfig")}>
        <SelectSettingItem
          id="globalFont"
          label={t("settings.appearance.globalFont")}
          description={t("settings.appearance.globalFont.desc")}
          highlighted={isHi("globalFont")}
          index={props.nextIndex()}
          value={props.settings.globalFont()}
          options={fontOptions()}
          onChange={(value) => props.settings.handleGlobalFont(value as GlobalFont)}
        />

        <SettingItem
          id="customFontFamily"
          label={t("settings.appearance.customFontFamily")}
          description={t("settings.appearance.customFontFamily.desc")}
          highlighted={isHi("customFontFamily")}
          index={props.nextIndex()}
        >
          <input
            class="settings-text-input"
            type="text"
            value={props.settings.customFontFamily()}
            onInput={(event) => props.settings.setCustomFontFamily(event.currentTarget.value)}
            onChange={(event) => props.settings.handleCustomFontFamily(event.currentTarget.value)}
            disabled={props.settings.globalFont() !== "custom"}
            placeholder={t("settings.appearance.customFontFamily.placeholder")}
          />
        </SettingItem>
      </SettingGroup>
    </>
  );
}

export function CustomCodePanel(props: AppearanceAdvancedPanelProps) {
  const { t } = useTranslation();
  const isHi = (id: string) => props.highlightId === id;
  const [feedback, setFeedback] = createSignal<{ tone: FeedbackTone; message: string } | null>(
    null
  );

  const commitCustomCss = () => {
    const ok = props.settings.handleCustomCss(props.settings.customCss());
    setFeedback({
      tone: ok ? "success" : "error",
      message: ok
        ? t("settings.appearance.customCss.saved")
        : t("settings.appearance.customCode.saveFailed")
    });
  };

  const commitCustomJs = () => {
    const ok = props.settings.handleCustomJs(props.settings.customJs());
    setFeedback({
      tone: ok ? "success" : "error",
      message: ok
        ? t("settings.appearance.customJs.saved")
        : t("settings.appearance.customCode.saveFailed")
    });
  };

  const runCustomJs = () => {
    const saved = props.settings.handleCustomJs(props.settings.customJs());
    if (!saved) {
      setFeedback({ tone: "error", message: t("settings.appearance.customCode.saveFailed") });
      return;
    }
    const ok = props.settings.handleRunCustomJs();
    setFeedback({
      tone: ok ? "success" : "error",
      message: ok
        ? t("settings.appearance.customJs.ran")
        : t("settings.appearance.customJs.failed")
    });
  };

  return (
    <>
      <PanelHeader manager={props.manager} onBack={props.onBack} />
      <SettingGroup title={t("settings.appearance.customCode")}>
        <div class="settings-danger-note" role="note">
          <strong>{t("settings.appearance.customCode.warningTitle")}</strong>
          <span>{t("settings.appearance.customCode.warningBody")}</span>
        </div>

        <SettingItem
          id="customCss"
          label={t("settings.appearance.customCss")}
          description={t("settings.appearance.customCss.desc")}
          highlighted={isHi("customCss")}
          index={props.nextIndex()}
        >
          <div class="settings-code-stack">
            <textarea
              class="settings-code-input"
              spellcheck={false}
              value={props.settings.customCss()}
              onInput={(event) => props.settings.setCustomCss(event.currentTarget.value)}
              onBlur={commitCustomCss}
              placeholder={t("settings.appearance.customCss.placeholder")}
            />
          </div>
        </SettingItem>

        <SettingItem
          id="customJs"
          label={t("settings.appearance.customJs")}
          description={t("settings.appearance.customJs.desc")}
          highlighted={isHi("customJs")}
          index={props.nextIndex()}
        >
          <div class="settings-code-stack">
            <textarea
              class="settings-code-input"
              spellcheck={false}
              value={props.settings.customJs()}
              onInput={(event) => props.settings.setCustomJs(event.currentTarget.value)}
              onBlur={commitCustomJs}
              placeholder={t("settings.appearance.customJs.placeholder")}
            />
            <div class="settings-code-actions">
              <button type="button" class="ghost-button" onClick={runCustomJs}>
                {t("settings.appearance.customJs.run")}
              </button>
            </div>
          </div>
        </SettingItem>

        <Show when={feedback()}>
          {(current) => (
            <div
              class={`settings-code-feedback is-${current().tone}`}
              role="status"
              aria-live="polite"
            >
              {current().message}
            </div>
          )}
        </Show>
      </SettingGroup>
    </>
  );
}
