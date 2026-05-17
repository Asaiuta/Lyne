import { Show, createMemo, createSignal, onMount } from "solid-js";
import { createApiClient } from "../../../shared/api/client";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import { readUISettingsSnapshot, STORAGE_KEYS } from "../../../shared/state/useUISettings";
import {
  SettingItem,
  RangeInput,
  settingsSectionClass
} from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import { SelectInput, type SelectOption } from "../components/SelectInput";
import { commitPersistedSetting } from "../storage";

const api = createApiClient();

interface PlaybackSectionProps {
  highlightId: string | null;
}

const SONG_LEVELS: { value: string; i18nKey: TranslationKey }[] = [
  { value: "standard", i18nKey: "settings.ncm.songLevel.standard" },
  { value: "higher", i18nKey: "settings.ncm.songLevel.higher" },
  { value: "exhigh", i18nKey: "settings.ncm.songLevel.exhigh" },
  { value: "lossless", i18nKey: "settings.ncm.songLevel.lossless" },
  { value: "hires", i18nKey: "settings.ncm.songLevel.hires" },
  { value: "jyeffect", i18nKey: "settings.ncm.songLevel.jyeffect" },
  { value: "sky", i18nKey: "settings.ncm.songLevel.sky" },
  { value: "jymaster", i18nKey: "settings.ncm.songLevel.jymaster" }
];

export function PlaybackSection(props: PlaybackSectionProps) {
  const { t } = useTranslation();
  const initialSettings = readUISettingsSnapshot();

  const [autoPlay, setAutoPlay] = createSignal<boolean>(initialSettings.autoPlay);
  const [useNextPrefetch, setUseNextPrefetch] = createSignal<boolean>(true);
  const [volumeFade, setVolumeFade] = createSignal<boolean>(initialSettings.volumeFade);
  const [volumeFadeTime, setVolumeFadeTime] = createSignal<number>(initialSettings.volumeFadeTime);
  const [memoryLastSeek, setMemoryLastSeek] = createSignal<boolean>(initialSettings.memoryLastSeek);
  const [progressTooltipShow, setProgressTooltipShow] =
    createSignal<boolean>(initialSettings.progressTooltipShow);
  const [progressLyricShow, setProgressLyricShow] =
    createSignal<boolean>(initialSettings.progressLyricShow);
  const [progressAdjustLyric, setProgressAdjustLyric] =
    createSignal<boolean>(initialSettings.progressAdjustLyric);
  const [ncmSongLevel, setNcmSongLevel] = createSignal<string>(initialSettings.ncmSongLevel);

  const songLevelOptions = createMemo<SelectOption[]>(() =>
    SONG_LEVELS.map((level) => ({
      value: level.value,
      label: t(level.i18nKey)
    }))
  );

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  onMount(() => {
    void api.getSettings().then((settings) => {
      setUseNextPrefetch(settings.use_next_prefetch);
    }).catch(() => {
      setUseNextPrefetch(true);
    });
  });

  const handleAutoPlay = () => {
    const next = !autoPlay();
    commitPersistedSetting(STORAGE_KEYS.autoPlay, next, autoPlay, setAutoPlay);
  };
  const handleUseNextPrefetch = () => {
    const previous = useNextPrefetch();
    const next = !previous;
    setUseNextPrefetch(next);
    void api.saveSettings({ use_next_prefetch: next }).catch(() => {
      setUseNextPrefetch(previous);
    });
  };
  const handleVolumeFade = () => {
    const next = !volumeFade();
    commitPersistedSetting(STORAGE_KEYS.volumeFade, next, volumeFade, setVolumeFade);
  };
  const handleVolumeFadeTime = (v: number) => {
    commitPersistedSetting(STORAGE_KEYS.volumeFadeTime, v, volumeFadeTime, setVolumeFadeTime);
  };
  const handleMemoryLastSeek = () => {
    const next = !memoryLastSeek();
    commitPersistedSetting(STORAGE_KEYS.memoryLastSeek, next, memoryLastSeek, setMemoryLastSeek);
  };
  const handleProgressTooltipShow = () => {
    const next = !progressTooltipShow();
    commitPersistedSetting(
      STORAGE_KEYS.progressTooltipShow,
      next,
      progressTooltipShow,
      setProgressTooltipShow
    );
  };
  const handleProgressLyricShow = () => {
    const next = !progressLyricShow();
    commitPersistedSetting(
      STORAGE_KEYS.progressLyricShow,
      next,
      progressLyricShow,
      setProgressLyricShow
    );
  };
  const handleProgressAdjustLyric = () => {
    const next = !progressAdjustLyric();
    commitPersistedSetting(
      STORAGE_KEYS.progressAdjustLyric,
      next,
      progressAdjustLyric,
      setProgressAdjustLyric
    );
  };
  const handleNcmSongLevel = (level: string) => {
    commitPersistedSetting(STORAGE_KEYS.ncmSongLevel, level, ncmSongLevel, setNcmSongLevel);
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.playback.title")}>
        <SettingItem
          id="autoPlay"
          label={t("settings.playback.autoPlay")}
          description={t("settings.playback.autoPlay.desc")}
          highlighted={isHi("autoPlay")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={autoPlay()} onChange={handleAutoPlay} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          id="useNextPrefetch"
          label={t("settings.playback.useNextPrefetch")}
          description={t("settings.playback.useNextPrefetch.desc")}
          highlighted={isHi("useNextPrefetch")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={useNextPrefetch()} onChange={handleUseNextPrefetch} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          id="memoryLastSeek"
          label={t("settings.playback.memoryLastSeek")}
          description={t("settings.playback.memoryLastSeek.desc")}
          highlighted={isHi("memoryLastSeek")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={memoryLastSeek()} onChange={handleMemoryLastSeek} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          id="progressTooltipShow"
          label={t("settings.playback.progressTooltipShow")}
          description={t("settings.playback.progressTooltipShow.desc")}
          highlighted={isHi("progressTooltipShow")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={progressTooltipShow()} onChange={handleProgressTooltipShow} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <Show when={progressTooltipShow()}>
          <SettingItem
            id="progressLyricShow"
            label={t("settings.playback.progressLyricShow")}
            description={t("settings.playback.progressLyricShow.desc")}
            highlighted={isHi("progressLyricShow")}
            index={nextIndex()}
          >
            <label class="toggle-switch">
              <input type="checkbox" checked={progressLyricShow()} onChange={handleProgressLyricShow} />
              <span class="toggle-switch-slider" />
            </label>
          </SettingItem>
        </Show>

        <SettingItem
          id="progressAdjustLyric"
          label={t("settings.playback.progressAdjustLyric")}
          description={t("settings.playback.progressAdjustLyric.desc")}
          highlighted={isHi("progressAdjustLyric")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={progressAdjustLyric()} onChange={handleProgressAdjustLyric} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <SettingItem
          id="volumeFade"
          label={t("settings.playback.volumeFade")}
          description={t("settings.playback.volumeFade.desc")}
          highlighted={isHi("volumeFade")}
          index={nextIndex()}
        >
          <label class="toggle-switch">
            <input type="checkbox" checked={volumeFade()} onChange={handleVolumeFade} />
            <span class="toggle-switch-slider" />
          </label>
        </SettingItem>

        <Show when={volumeFade()}>
          <SettingItem id="volumeFadeTime" label={t("settings.playback.volumeFadeTime")} highlighted={isHi("volumeFadeTime")} index={nextIndex()}>
            <RangeInput
              min={200}
              max={2000}
              step={50}
              value={volumeFadeTime()}
              onPreview={setVolumeFadeTime}
              onCommit={handleVolumeFadeTime}
              formatSuffix="ms"
            />
          </SettingItem>
        </Show>
      </SettingGroup>

      <SettingGroup title={t("settings.playback.audioSettings")}>
        <SettingItem
          id="ncmSongLevel"
          label={t("settings.ncm.songLevel")}
          description={t("settings.ncm.songLevel.desc")}
          highlighted={isHi("ncmSongLevel")}
          index={nextIndex()}
        >
          <SelectInput
            value={ncmSongLevel()}
            options={songLevelOptions()}
            onChange={handleNcmSongLevel}
          />
        </SettingItem>
      </SettingGroup>
    </section>
  );
}
