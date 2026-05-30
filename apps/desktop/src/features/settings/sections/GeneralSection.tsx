import { createMemo, createSignal, type Accessor, type Setter } from "solid-js";
import { getCurrentWindow, ProgressBarStatus } from "@tauri-apps/api/window";
import { createApiClient } from "../../../shared/api/client";
import { useTranslation } from "../../../shared/i18n";
import type {
  CloseAppMethod,
  SearchInputBehavior,
  ShareUrlFormat,
  UISettings,
  UISettingsBooleanFieldName,
  UpdateChannel
} from "../../../shared/state/useUISettings";
import {
  commitUISettingField,
  readUISettingsSnapshot
} from "../../../shared/state/useUISettings";
import { dialog, message } from "../../../shared/ui/naive";
import {
  BooleanSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import { setPersistedBooleanField } from "../storage";
import {
  clearBrowserSessionCacheByPrefix,
  requestOnlineServiceModeChange,
  setTaskbarProgressPreference,
  setUpdateChannelPreference
} from "../generalSettingsRuntime";

interface GeneralSectionProps {
  highlightId: string | null;
}

const api = createApiClient();

const reloadApp = () => {
  if (typeof window !== "undefined") {
    window.location.reload();
  }
};

const confirmOnlineServiceChange = (
  copy: {
    title: string;
    content: string;
    positiveText: string;
    negativeText: string;
  }
): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      resolve(value);
    };

    const handle = dialog.warning({
      closable: false,
      title: copy.title,
      content: copy.content,
      positiveText: copy.positiveText,
      negativeText: copy.negativeText,
      onPositiveClick: () => settle(true),
      onNegativeClick: () => settle(false)
    });

    timeoutId = window.setTimeout(() => {
      if (!settled) {
        handle.destroy();
        settle(false);
      }
    }, 5 * 60 * 1000);
  });

const resetOnlineRuntimeState = async () => {
  clearBrowserSessionCacheByPrefix("ncm.");
  const results = await Promise.allSettled([
    api.stop(),
    api.clearPersistentQueue()
  ]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejected) {
    throw rejected.reason;
  }
};

const clearTaskbarProgress = async () => {
  await getCurrentWindow().setProgressBar({ status: ProgressBarStatus.None });
};

export function GeneralSection(props: GeneralSectionProps) {
  const { t } = useTranslation();
  const initialSettings = readUISettingsSnapshot();
  const [useOnlineService, setUseOnlineService] =
    createSignal<boolean>(initialSettings.useOnlineService);
  const [closeAppMethod, setCloseAppMethod] =
    createSignal<CloseAppMethod>(initialSettings.closeAppMethod);
  const [showCloseAppTip, setShowCloseAppTip] =
    createSignal<boolean>(initialSettings.showCloseAppTip);
  const [showTaskbarProgress, setShowTaskbarProgress] =
    createSignal<boolean>(initialSettings.showTaskbarProgress);
  const [checkUpdateOnStart, setCheckUpdateOnStart] =
    createSignal<boolean>(initialSettings.checkUpdateOnStart);
  const [updateChannel, setUpdateChannel] =
    createSignal<UpdateChannel>(initialSettings.updateChannel);
  const [showSearchHistory, setShowSearchHistory] =
    createSignal<boolean>(initialSettings.showSearchHistory);
  const [showHotSearch, setShowHotSearch] =
    createSignal<boolean>(initialSettings.showHotSearch);
  const [enableSearchKeyword, setEnableSearchKeyword] =
    createSignal<boolean>(initialSettings.enableSearchKeyword);
  const [searchInputBehavior, setSearchInputBehavior] =
    createSignal<SearchInputBehavior>(initialSettings.searchInputBehavior);
  const [shareUrlFormat, setShareUrlFormat] =
    createSignal<ShareUrlFormat>(initialSettings.shareUrlFormat);

  const closeAppOptions = createMemo<SelectOption[]>(() => [
    { value: "hide", label: t("settings.general.closeAppMethod.hide") },
    { value: "exit", label: t("settings.general.closeAppMethod.exit") }
  ]);
  const updateChannelOptions = createMemo<SelectOption[]>(() => [
    { value: "stable", label: t("settings.general.updateChannel.stable") },
    { value: "nightly", label: t("settings.general.updateChannel.nightly") }
  ]);
  const searchInputBehaviorOptions = createMemo<SelectOption[]>(() => [
    { value: "normal", label: t("settings.general.searchInputBehavior.normal") },
    { value: "clear", label: t("settings.general.searchInputBehavior.clear") },
    { value: "sync", label: t("settings.general.searchInputBehavior.sync") }
  ]);
  const shareUrlFormatOptions = createMemo<SelectOption[]>(() => [
    { value: "web", label: t("settings.general.shareUrlFormat.web") },
    { value: "mobile", label: t("settings.general.shareUrlFormat.mobile") }
  ]);
  const onlineSearchControlsDisabled = createMemo(() => !useOnlineService());

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  const setBooleanField = <K extends UISettingsBooleanFieldName>(
    field: K,
    nextValue: UISettings[K],
    value: Accessor<UISettings[K]>,
    setValue: Setter<UISettings[K]>
  ) => {
    setPersistedBooleanField(field, nextValue, value, setValue);
  };

  const handleOnlineServiceChange = (nextEnabled: boolean) => {
    void requestOnlineServiceModeChange(nextEnabled, {
      confirmChange: () =>
        confirmOnlineServiceChange({
          title: t("settings.general.useOnlineService.confirm.title"),
          content: t("settings.general.useOnlineService.confirm.content"),
          positiveText: t("settings.general.useOnlineService.confirm.positive"),
          negativeText: t("settings.general.useOnlineService.confirm.negative")
        }),
      currentValue: useOnlineService,
      persistValue: (value) =>
        commitUISettingField("useOnlineService", value, useOnlineService, setUseOnlineService),
      resetOnlineRuntimeState,
      reportResetError: (error) => {
        console.warn("[settings] failed to reset online runtime state", error);
      },
      reloadApp
    }).then((result) => {
      if (result.status === "failed") {
        message.error(t("settings.general.persistFailed"));
      }
      if (result.resetError) {
        message.warning(t("settings.general.useOnlineService.resetFailed"));
      }
    });
  };

  const handleTaskbarProgressChange = (nextEnabled: boolean) => {
    setTaskbarProgressPreference(nextEnabled, {
      persistValue: (value) =>
        commitUISettingField(
          "showTaskbarProgress",
          value,
          showTaskbarProgress,
          setShowTaskbarProgress
        ),
      clearTaskbarProgress,
      reportError: (error) => {
        console.warn("[settings] failed to clear taskbar progress", error);
      }
    });
  };

  const handleUpdateChannelChange = (value: string) => {
    setUpdateChannelPreference(value as UpdateChannel, {
      persistValue: (channel) =>
        commitUISettingField("updateChannel", channel, updateChannel, setUpdateChannel),
      requestUpdateCheck: () => {
        message.info(t("settings.general.updateChannel.checkUnavailable"));
      }
    });
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.general.behavior.title")}>
        <BooleanSettingItem
          id="useOnlineService"
          label={t("settings.general.useOnlineService")}
          description={t("settings.general.useOnlineService.desc")}
          highlighted={isHi("useOnlineService")}
          index={nextIndex()}
          checked={useOnlineService()}
          onChange={handleOnlineServiceChange}
        />
        <SelectSettingItem
          id="closeAppMethod"
          label={t("settings.general.closeAppMethod")}
          description={t("settings.general.closeAppMethod.desc")}
          highlighted={isHi("closeAppMethod")}
          index={nextIndex()}
          value={closeAppMethod()}
          options={closeAppOptions()}
          disabled={showCloseAppTip()}
          onChange={(value) =>
            commitUISettingField(
              "closeAppMethod",
              value as CloseAppMethod,
              closeAppMethod,
              setCloseAppMethod
            )
          }
        />
        <BooleanSettingItem
          id="showCloseAppTip"
          label={t("settings.general.showCloseAppTip")}
          description={t("settings.general.showCloseAppTip.desc")}
          highlighted={isHi("showCloseAppTip")}
          index={nextIndex()}
          checked={showCloseAppTip()}
          onChange={(checked) =>
            setBooleanField("showCloseAppTip", checked, showCloseAppTip, setShowCloseAppTip)
          }
        />
        <BooleanSettingItem
          id="showTaskbarProgress"
          label={t("settings.general.showTaskbarProgress")}
          description={t("settings.general.showTaskbarProgress.desc")}
          highlighted={isHi("showTaskbarProgress")}
          index={nextIndex()}
          checked={showTaskbarProgress()}
          onChange={handleTaskbarProgressChange}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.general.update.title")}>
        <BooleanSettingItem
          id="checkUpdateOnStart"
          label={t("settings.general.checkUpdateOnStart")}
          description={t("settings.general.checkUpdateOnStart.desc")}
          highlighted={isHi("checkUpdateOnStart")}
          index={nextIndex()}
          checked={checkUpdateOnStart()}
          onChange={(checked) =>
            setBooleanField(
              "checkUpdateOnStart",
              checked,
              checkUpdateOnStart,
              setCheckUpdateOnStart
            )
          }
        />
        <SelectSettingItem
          id="updateChannel"
          label={t("settings.general.updateChannel")}
          description={t("settings.general.updateChannel.desc")}
          highlighted={isHi("updateChannel")}
          index={nextIndex()}
          value={updateChannel()}
          options={updateChannelOptions()}
          onChange={handleUpdateChannelChange}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.general.search.title")}>
        <BooleanSettingItem
          id="showSearchHistory"
          label={t("settings.general.showSearchHistory")}
          description={t("settings.general.showSearchHistory.desc")}
          highlighted={isHi("showSearchHistory")}
          index={nextIndex()}
          checked={showSearchHistory()}
          onChange={(checked) =>
            setBooleanField("showSearchHistory", checked, showSearchHistory, setShowSearchHistory)
          }
        />
        <BooleanSettingItem
          id="showHotSearch"
          label={t("settings.general.showHotSearch")}
          description={t("settings.general.showHotSearch.desc")}
          highlighted={isHi("showHotSearch")}
          index={nextIndex()}
          checked={showHotSearch()}
          disabled={onlineSearchControlsDisabled()}
          onChange={(checked) =>
            setBooleanField("showHotSearch", checked, showHotSearch, setShowHotSearch)
          }
        />
        <BooleanSettingItem
          id="enableSearchKeyword"
          label={t("settings.general.enableSearchKeyword")}
          description={t("settings.general.enableSearchKeyword.desc")}
          highlighted={isHi("enableSearchKeyword")}
          index={nextIndex()}
          checked={enableSearchKeyword()}
          disabled={onlineSearchControlsDisabled()}
          onChange={(checked) =>
            setBooleanField(
              "enableSearchKeyword",
              checked,
              enableSearchKeyword,
              setEnableSearchKeyword
            )
          }
        />
        <SelectSettingItem
          id="searchInputBehavior"
          label={t("settings.general.searchInputBehavior")}
          description={t("settings.general.searchInputBehavior.desc")}
          highlighted={isHi("searchInputBehavior")}
          index={nextIndex()}
          value={searchInputBehavior()}
          options={searchInputBehaviorOptions()}
          onChange={(value) =>
            commitUISettingField(
              "searchInputBehavior",
              value as SearchInputBehavior,
              searchInputBehavior,
              setSearchInputBehavior
            )
          }
        />
      </SettingGroup>

      <SettingGroup title={t("settings.general.share.title")}>
        <SelectSettingItem
          id="shareUrlFormat"
          label={t("settings.general.shareUrlFormat")}
          description={t("settings.general.shareUrlFormat.desc")}
          highlighted={isHi("shareUrlFormat")}
          index={nextIndex()}
          value={shareUrlFormat()}
          options={shareUrlFormatOptions()}
          onChange={(value) =>
            commitUISettingField(
              "shareUrlFormat",
              value as ShareUrlFormat,
              shareUrlFormat,
              setShareUrlFormat
            )
          }
        />
      </SettingGroup>
    </section>
  );
}
