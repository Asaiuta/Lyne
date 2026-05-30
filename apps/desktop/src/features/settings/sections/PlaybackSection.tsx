import { Show, createMemo, createSignal, onMount } from "solid-js";
import { createApiClient } from "../../../shared/api/client";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import {
  commitUISettingField,
  readUISettingsSnapshot
} from "../../../shared/state/useUISettings";
import {
  BooleanSettingItem,
  RangeSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";

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

  const handleAutoPlay = (checked: boolean) => {
    commitUISettingField("autoPlay", checked, autoPlay, setAutoPlay);
  };
  const handleUseNextPrefetch = (checked: boolean) => {
    const previous = useNextPrefetch();
    setUseNextPrefetch(checked);
    void api.saveSettings({ use_next_prefetch: checked }).catch(() => {
      setUseNextPrefetch(previous);
    });
  };
  const handleVolumeFade = (checked: boolean) => {
    commitUISettingField("volumeFade", checked, volumeFade, setVolumeFade);
  };
  const handleVolumeFadeTime = (v: number) => {
    commitUISettingField("volumeFadeTime", v, volumeFadeTime, setVolumeFadeTime);
  };
  const handleMemoryLastSeek = (checked: boolean) => {
    commitUISettingField("memoryLastSeek", checked, memoryLastSeek, setMemoryLastSeek);
  };
  const handleProgressTooltipShow = (checked: boolean) => {
    commitUISettingField(
      "progressTooltipShow",
      checked,
      progressTooltipShow,
      setProgressTooltipShow
    );
  };
  const handleProgressLyricShow = (checked: boolean) => {
    commitUISettingField("progressLyricShow", checked, progressLyricShow, setProgressLyricShow);
  };
  const handleProgressAdjustLyric = (checked: boolean) => {
    commitUISettingField(
      "progressAdjustLyric",
      checked,
      progressAdjustLyric,
      setProgressAdjustLyric
    );
  };
  const handleNcmSongLevel = (level: string) => {
    commitUISettingField("ncmSongLevel", level, ncmSongLevel, setNcmSongLevel);
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.playback.title")}>
        <BooleanSettingItem
          id="autoPlay"
          label={t("settings.playback.autoPlay")}
          description={t("settings.playback.autoPlay.desc")}
          highlighted={isHi("autoPlay")}
          index={nextIndex()}
          checked={autoPlay()}
          onChange={handleAutoPlay}
        />

        <BooleanSettingItem
          id="useNextPrefetch"
          label={t("settings.playback.useNextPrefetch")}
          description={t("settings.playback.useNextPrefetch.desc")}
          highlighted={isHi("useNextPrefetch")}
          index={nextIndex()}
          checked={useNextPrefetch()}
          onChange={handleUseNextPrefetch}
        />

        <BooleanSettingItem
          id="memoryLastSeek"
          label={t("settings.playback.memoryLastSeek")}
          description={t("settings.playback.memoryLastSeek.desc")}
          highlighted={isHi("memoryLastSeek")}
          index={nextIndex()}
          checked={memoryLastSeek()}
          onChange={handleMemoryLastSeek}
        />

        <BooleanSettingItem
          id="progressTooltipShow"
          label={t("settings.playback.progressTooltipShow")}
          description={t("settings.playback.progressTooltipShow.desc")}
          highlighted={isHi("progressTooltipShow")}
          index={nextIndex()}
          checked={progressTooltipShow()}
          onChange={handleProgressTooltipShow}
        />

        <Show when={progressTooltipShow()}>
          <BooleanSettingItem
            id="progressLyricShow"
            label={t("settings.playback.progressLyricShow")}
            description={t("settings.playback.progressLyricShow.desc")}
            highlighted={isHi("progressLyricShow")}
            index={nextIndex()}
            checked={progressLyricShow()}
            onChange={handleProgressLyricShow}
          />
        </Show>

        <BooleanSettingItem
          id="progressAdjustLyric"
          label={t("settings.playback.progressAdjustLyric")}
          description={t("settings.playback.progressAdjustLyric.desc")}
          highlighted={isHi("progressAdjustLyric")}
          index={nextIndex()}
          checked={progressAdjustLyric()}
          onChange={handleProgressAdjustLyric}
        />

        <BooleanSettingItem
          id="volumeFade"
          label={t("settings.playback.volumeFade")}
          description={t("settings.playback.volumeFade.desc")}
          highlighted={isHi("volumeFade")}
          index={nextIndex()}
          checked={volumeFade()}
          onChange={handleVolumeFade}
        />

        <Show when={volumeFade()}>
          <RangeSettingItem
            id="volumeFadeTime"
            label={t("settings.playback.volumeFadeTime")}
            highlighted={isHi("volumeFadeTime")}
            index={nextIndex()}
            min={200}
            max={2000}
            step={50}
            value={volumeFadeTime()}
            onPreview={setVolumeFadeTime}
            onCommit={handleVolumeFadeTime}
            formatSuffix="ms"
          />
        </Show>
      </SettingGroup>

      <SettingGroup title={t("settings.playback.audioSettings")}>
        <SelectSettingItem
          id="ncmSongLevel"
          label={t("settings.ncm.songLevel")}
          description={t("settings.ncm.songLevel.desc")}
          highlighted={isHi("ncmSongLevel")}
          index={nextIndex()}
          value={ncmSongLevel()}
          options={songLevelOptions()}
          onChange={handleNcmSongLevel}
        />
      </SettingGroup>
    </section>
  );
}
