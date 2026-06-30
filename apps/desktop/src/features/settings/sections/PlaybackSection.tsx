import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount
} from "solid-js";
import { usePlayback } from "../../../app/PlaybackContext";
import { createApiClient } from "../../../shared/api/client";
import type { OnlineSettings } from "../../../shared/api/onlineSettings";
import type { TranslationKey } from "../../../shared/i18n";
import { useTranslation } from "../../../shared/i18n";
import {
  isNcmSongLevel,
  NCM_SONG_LEVELS,
  type NcmSongLevel
} from "../../../shared/state/uiSettingsModel";
import {
  commitUISettingField,
  readUISettingsSnapshot
} from "../../../shared/state/uiSettingsStorage";
import {
  BooleanSettingItem,
  RangeSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import { settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";

interface PlaybackSectionProps {
  highlightId: string | null;
}

const SONG_LEVEL_LABEL_KEYS: Record<NcmSongLevel, TranslationKey> = {
  standard: "settings.ncm.songLevel.standard",
  higher: "settings.ncm.songLevel.higher",
  exhigh: "settings.ncm.songLevel.exhigh",
  lossless: "settings.ncm.songLevel.lossless",
  hires: "settings.ncm.songLevel.hires",
  jyeffect: "settings.ncm.songLevel.jyeffect",
  sky: "settings.ncm.songLevel.sky",
  jymaster: "settings.ncm.songLevel.jymaster"
};

const api = createApiClient();

export function PlaybackSection(props: PlaybackSectionProps) {
  const { t } = useTranslation();
  const audioSettings = usePlayback().audioSettings;
  const initialSettings = readUISettingsSnapshot();

  const [autoPlay, setAutoPlay] = createSignal<boolean>(initialSettings.autoPlay);
  const [useNextPrefetch, setUseNextPrefetch] = createSignal<boolean>(true);
  const [useNextPrefetchPending, setUseNextPrefetchPending] = createSignal<boolean>(false);
  const [volumeFade, setVolumeFade] = createSignal<boolean>(initialSettings.volumeFade);
  const [volumeFadeTime, setVolumeFadeTime] = createSignal<number>(initialSettings.volumeFadeTime);
  const [memoryLastSeek, setMemoryLastSeek] = createSignal<boolean>(initialSettings.memoryLastSeek);
  const [progressTooltipShow, setProgressTooltipShow] =
    createSignal<boolean>(initialSettings.progressTooltipShow);
  const [progressLyricShow, setProgressLyricShow] =
    createSignal<boolean>(initialSettings.progressLyricShow);
  const [progressAdjustLyric, setProgressAdjustLyric] =
    createSignal<boolean>(initialSettings.progressAdjustLyric);
  const [ncmSongLevel, setNcmSongLevel] =
    createSignal<NcmSongLevel>(initialSettings.ncmSongLevel);
  const [online, setOnline] = createSignal<OnlineSettings | null>(null);

  const songLevelOptions = createMemo<SelectOption[]>(() =>
    NCM_SONG_LEVELS.map((level) => ({
      value: level,
      label: t(SONG_LEVEL_LABEL_KEYS[level])
    }))
  );

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  createEffect(() => {
    const desired = audioSettings.desired();
    if (desired && !useNextPrefetchPending()) {
      setUseNextPrefetch(desired.use_next_prefetch);
    }
  });

  onMount(() => {
    void api
      .getOnlineSettings()
      .then(setOnline)
      .catch(() => {
        setOnline(null);
      });
  });

  // Optimistically apply an online-settings change, persisting the full object;
  // revert on failure.
  const updateOnline = (patch: Partial<OnlineSettings>) => {
    const current = online();
    if (!current) {
      return;
    }
    const next = { ...current, ...patch };
    setOnline(next);
    void api.saveOnlineSettings(next).then(setOnline).catch(() => {
      setOnline(current);
    });
  };

  const handleAutoPlay = (checked: boolean) => {
    commitUISettingField("autoPlay", checked, autoPlay, setAutoPlay);
  };
  const handleUseNextPrefetch = (checked: boolean) => {
    const previous = useNextPrefetch();
    const baseRevision = audioSettings.snapshot()?.revision;
    setUseNextPrefetch(checked);
    setUseNextPrefetchPending(true);
    void audioSettings
      .commit(
        { use_next_prefetch: checked },
        baseRevision === undefined ? undefined : { baseRevision }
      )
      .catch(() => {
        setUseNextPrefetch(previous);
      })
      .finally(() => {
        setUseNextPrefetchPending(false);
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
    if (!isNcmSongLevel(level)) {
      return;
    }
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
          disabled={useNextPrefetchPending()}
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

      <Show when={online()}>
        {(settings) => (
          <SettingGroup title={t("settings.ncm.resilience.title")}>
            <BooleanSettingItem
              id="ncmCacheEnabled"
              label={t("settings.ncm.cacheEnabled")}
              description={t("settings.ncm.cacheEnabled.desc")}
              highlighted={isHi("ncmCacheEnabled")}
              index={nextIndex()}
              checked={settings().cacheEnabled}
              onChange={(checked) => updateOnline({ cacheEnabled: checked })}
            />
            <BooleanSettingItem
              id="ncmQualityFallback"
              label={t("settings.ncm.qualityFallback")}
              description={t("settings.ncm.qualityFallback.desc")}
              highlighted={isHi("ncmQualityFallback")}
              index={nextIndex()}
              checked={settings().qualityFallbackEnabled}
              onChange={(checked) => updateOnline({ qualityFallbackEnabled: checked })}
            />
            <BooleanSettingItem
              id="ncmAllowTrial"
              label={t("settings.ncm.allowTrial")}
              description={t("settings.ncm.allowTrial.desc")}
              highlighted={isHi("ncmAllowTrial")}
              index={nextIndex()}
              checked={settings().allowTrialPlayback}
              onChange={(checked) => updateOnline({ allowTrialPlayback: checked })}
            />
          </SettingGroup>
        )}
      </Show>
    </section>
  );
}
