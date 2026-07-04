import { For, Show, createMemo, createSignal } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type {
  DesktopLyricPosition,
  LyricsBlendMode,
  LyricsPosition
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
import { SettingItem, settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";

const DESKTOP_LYRIC_COLORS = [
  "#ffffff",
  "#fe7971",
  "#22c55e",
  "#38bdf8",
  "#fbbf24",
  "#a78bfa"
] as const;

interface LyricsSectionProps {
  highlightId: string | null;
}

export function LyricsSection(props: LyricsSectionProps) {
  const { t } = useTranslation();
  const initialSettings = readUISettingsSnapshot();

  const [lyricFontSize, setLyricFontSize] = createSignal<number>(initialSettings.lyricFontSize);
  const [lyricFontWeight, setLyricFontWeight] =
    createSignal<number>(initialSettings.lyricFontWeight);
  const [lyricTranslationFontSize, setLyricTranslationFontSize] =
    createSignal<number>(initialSettings.lyricTranslationFontSize);
  const [lyricRomanizationFontSize, setLyricRomanizationFontSize] =
    createSignal<number>(initialSettings.lyricRomanizationFontSize);
  const [showLyricTranslation, setShowLyricTranslation] =
    createSignal<boolean>(initialSettings.showLyricTranslation);
  const [showLyricRomanization, setShowLyricRomanization] =
    createSignal<boolean>(initialSettings.showLyricRomanization);
  const [showWordLyrics, setShowWordLyrics] = createSignal<boolean>(initialSettings.showWordLyrics);
  const [lyricsBlur, setLyricsBlur] = createSignal<boolean>(initialSettings.lyricsBlur);
  const [lyricsScrollOffset, setLyricsScrollOffset] =
    createSignal<number>(initialSettings.lyricsScrollOffset);
  const [swapLyricTranslationRomanization, setSwapLyricTranslationRomanization] =
    createSignal<boolean>(initialSettings.swapLyricTranslationRomanization);
  const [lyricsPosition, setLyricsPosition] =
    createSignal<LyricsPosition>(initialSettings.lyricsPosition);
  const [lyricHorizontalOffset, setLyricHorizontalOffset] =
    createSignal<number>(initialSettings.lyricHorizontalOffset);
  const [lyricAlignRight, setLyricAlignRight] =
    createSignal<boolean>(initialSettings.lyricAlignRight);
  const [lyricsBlendMode, setLyricsBlendMode] =
    createSignal<LyricsBlendMode>(initialSettings.lyricsBlendMode);

  const [desktopLyricFontSize, setDesktopLyricFontSize] =
    createSignal<number>(initialSettings.desktopLyricFontSize);
  const [desktopLyricDoubleLine, setDesktopLyricDoubleLine] =
    createSignal<boolean>(initialSettings.desktopLyricDoubleLine);
  const [desktopLyricPosition, setDesktopLyricPosition] =
    createSignal<DesktopLyricPosition>(initialSettings.desktopLyricPosition);
  const [desktopLyricShowTranslation, setDesktopLyricShowTranslation] =
    createSignal<boolean>(initialSettings.desktopLyricShowTranslation);
  const [desktopLyricShowWordByWord, setDesktopLyricShowWordByWord] =
    createSignal<boolean>(initialSettings.desktopLyricShowWordByWord);
  const [desktopLyricPlayedColor, setDesktopLyricPlayedColor] =
    createSignal<string>(initialSettings.desktopLyricPlayedColor);
  const [desktopLyricShowPlayInfo, setDesktopLyricShowPlayInfo] =
    createSignal<boolean>(initialSettings.desktopLyricShowPlayInfo);

  const desktopLyricPositionOptions = createMemo<SelectOption[]>(() => [
    { value: "left", label: t("settings.desktopLyric.position.left") },
    { value: "center", label: t("settings.desktopLyric.position.center") },
    { value: "right", label: t("settings.desktopLyric.position.right") },
    { value: "both", label: t("settings.desktopLyric.position.both") }
  ]);

  const lyricsPositionOptions = createMemo<SelectOption[]>(() => [
    { value: "flex-start", label: t("settings.lyric.position.left") },
    { value: "center", label: t("settings.lyric.position.center") },
    { value: "flex-end", label: t("settings.lyric.position.right") }
  ]);

  const lyricsBlendModeOptions = createMemo<SelectOption[]>(() => [
    { value: "screen", label: t("settings.lyric.blendMode.screen") },
    { value: "plus-lighter", label: t("settings.lyric.blendMode.plusLighter") }
  ]);

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  const handleLyricFontSize = (v: number) => {
    commitUISettingField("lyricFontSize", v, lyricFontSize, setLyricFontSize);
  };
  const handleLyricFontWeight = (v: number) => {
    commitUISettingField("lyricFontWeight", v, lyricFontWeight, setLyricFontWeight);
  };
  const handleLyricTranslationFontSize = (v: number) => {
    commitUISettingField(
      "lyricTranslationFontSize",
      v,
      lyricTranslationFontSize,
      setLyricTranslationFontSize
    );
  };
  const handleLyricRomanizationFontSize = (v: number) => {
    commitUISettingField(
      "lyricRomanizationFontSize",
      v,
      lyricRomanizationFontSize,
      setLyricRomanizationFontSize
    );
  };
  const handleShowLyricTranslation = (checked: boolean) => {
    commitUISettingField(
      "showLyricTranslation",
      checked,
      showLyricTranslation,
      setShowLyricTranslation
    );
  };
  const handleShowLyricRomanization = (checked: boolean) => {
    commitUISettingField(
      "showLyricRomanization",
      checked,
      showLyricRomanization,
      setShowLyricRomanization
    );
  };
  const handleShowWordLyrics = (checked: boolean) => {
    commitUISettingField("showWordLyrics", checked, showWordLyrics, setShowWordLyrics);
  };
  const handleLyricsBlur = (checked: boolean) => {
    commitUISettingField("lyricsBlur", checked, lyricsBlur, setLyricsBlur);
  };
  const handleLyricsScrollOffsetPercent = (v: number) => {
    const next = v / 100;
    commitUISettingField("lyricsScrollOffset", next, lyricsScrollOffset, setLyricsScrollOffset);
  };
  const handleSwapLyricTranslationRomanization = (checked: boolean) => {
    commitUISettingField(
      "swapLyricTranslationRomanization",
      checked,
      swapLyricTranslationRomanization,
      setSwapLyricTranslationRomanization
    );
  };
  const handleLyricsPosition = (value: LyricsPosition) => {
    commitUISettingField("lyricsPosition", value, lyricsPosition, setLyricsPosition);
  };
  const handleLyricHorizontalOffset = (v: number) => {
    commitUISettingField("lyricHorizontalOffset", v, lyricHorizontalOffset, setLyricHorizontalOffset);
  };
  const handleLyricAlignRight = (checked: boolean) => {
    commitUISettingField("lyricAlignRight", checked, lyricAlignRight, setLyricAlignRight);
  };
  const handleLyricsBlendMode = (value: LyricsBlendMode) => {
    commitUISettingField("lyricsBlendMode", value, lyricsBlendMode, setLyricsBlendMode);
  };

  const handleDesktopLyricFontSize = (v: number) => {
    commitUISettingField("desktopLyricFontSize", v, desktopLyricFontSize, setDesktopLyricFontSize);
  };
  const handleDesktopLyricDoubleLine = (checked: boolean) => {
    commitUISettingField(
      "desktopLyricDoubleLine",
      checked,
      desktopLyricDoubleLine,
      setDesktopLyricDoubleLine
    );
  };
  const handleDesktopLyricPosition = (value: DesktopLyricPosition) => {
    commitUISettingField(
      "desktopLyricPosition",
      value,
      desktopLyricPosition,
      setDesktopLyricPosition
    );
  };
  const handleDesktopLyricShowTranslation = (checked: boolean) => {
    commitUISettingField(
      "desktopLyricShowTranslation",
      checked,
      desktopLyricShowTranslation,
      setDesktopLyricShowTranslation
    );
  };
  const handleDesktopLyricShowWordByWord = (checked: boolean) => {
    commitUISettingField(
      "desktopLyricShowWordByWord",
      checked,
      desktopLyricShowWordByWord,
      setDesktopLyricShowWordByWord
    );
  };
  const handleDesktopLyricPlayedColor = (color: string) => {
    commitUISettingField(
      "desktopLyricPlayedColor",
      color,
      desktopLyricPlayedColor,
      setDesktopLyricPlayedColor
    );
  };
  const handleDesktopLyricShowPlayInfo = (checked: boolean) => {
    commitUISettingField(
      "desktopLyricShowPlayInfo",
      checked,
      desktopLyricShowPlayInfo,
      setDesktopLyricShowPlayInfo
    );
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.lyric.displaySettings")}>
        <RangeSettingItem
          id="lyricFontSize"
          label={t("settings.lyric.fontSize")}
          highlighted={isHi("lyricFontSize")}
          index={nextIndex()}
          min={16}
          max={48}
          step={1}
          value={lyricFontSize()}
          onPreview={setLyricFontSize}
          onCommit={handleLyricFontSize}
          formatSuffix="px"
        />

        <RangeSettingItem
          id="lyricTranslationFontSize"
          label={t("settings.lyric.translationFontSize")}
          description={t("settings.lyric.translationFontSize.desc")}
          highlighted={isHi("lyricTranslationFontSize")}
          index={nextIndex()}
          min={5}
          max={40}
          step={1}
          value={lyricTranslationFontSize()}
          onPreview={setLyricTranslationFontSize}
          onCommit={handleLyricTranslationFontSize}
          formatSuffix="px"
        />

        <RangeSettingItem
          id="lyricRomanizationFontSize"
          label={t("settings.lyric.romanizationFontSize")}
          description={t("settings.lyric.romanizationFontSize.desc")}
          highlighted={isHi("lyricRomanizationFontSize")}
          index={nextIndex()}
          min={5}
          max={40}
          step={1}
          value={lyricRomanizationFontSize()}
          onPreview={setLyricRomanizationFontSize}
          onCommit={handleLyricRomanizationFontSize}
          formatSuffix="px"
        />

        <RangeSettingItem
          id="lyricFontWeight"
          label={t("settings.lyric.fontWeight")}
          description={t("settings.lyric.fontWeight.desc")}
          highlighted={isHi("lyricFontWeight")}
          index={nextIndex()}
          min={100}
          max={900}
          step={100}
          value={lyricFontWeight()}
          onPreview={setLyricFontWeight}
          onCommit={handleLyricFontWeight}
        />

        <SelectSettingItem
          id="lyricsPosition"
          label={t("settings.lyric.position")}
          description={t("settings.lyric.position.desc")}
          highlighted={isHi("lyricsPosition")}
          index={nextIndex()}
          value={lyricsPosition()}
          options={lyricsPositionOptions()}
          onChange={(v) => handleLyricsPosition(v as LyricsPosition)}
        />

        <RangeSettingItem
          id="lyricHorizontalOffset"
          label={t("settings.lyric.horizontalOffset")}
          description={t("settings.lyric.horizontalOffset.desc")}
          highlighted={isHi("lyricHorizontalOffset")}
          index={nextIndex()}
          min={0}
          max={200}
          step={1}
          value={lyricHorizontalOffset()}
          onPreview={setLyricHorizontalOffset}
          onCommit={handleLyricHorizontalOffset}
          formatSuffix="px"
        />

        <BooleanSettingItem
          id="lyricAlignRight"
          label={t("settings.lyric.alignRight")}
          description={t("settings.lyric.alignRight.desc")}
          highlighted={isHi("lyricAlignRight")}
          index={nextIndex()}
          checked={lyricAlignRight()}
          onChange={handleLyricAlignRight}
        />

        <RangeSettingItem
          id="lyricsScrollOffset"
          label={t("settings.lyric.scrollOffset")}
          description={t("settings.lyric.scrollOffset.desc")}
          highlighted={isHi("lyricsScrollOffset")}
          index={nextIndex()}
          min={10}
          max={90}
          step={5}
          value={Math.round(lyricsScrollOffset() * 100)}
          onPreview={(value) => setLyricsScrollOffset(value / 100)}
          onCommit={handleLyricsScrollOffsetPercent}
          formatSuffix="%"
        />

        <BooleanSettingItem
          id="showWordLyrics"
          label={t("settings.lyric.showWordLyrics")}
          description={t("settings.lyric.showWordLyrics.desc")}
          highlighted={isHi("showWordLyrics")}
          index={nextIndex()}
          checked={showWordLyrics()}
          onChange={handleShowWordLyrics}
        />

        <BooleanSettingItem
          id="showLyricTranslation"
          label={t("settings.lyric.showTranslation")}
          description={t("settings.lyric.showTranslation.desc")}
          highlighted={isHi("showLyricTranslation")}
          index={nextIndex()}
          checked={showLyricTranslation()}
          onChange={handleShowLyricTranslation}
        />

        <BooleanSettingItem
          id="showLyricRomanization"
          label={t("settings.lyric.showRomanization")}
          description={t("settings.lyric.showRomanization.desc")}
          highlighted={isHi("showLyricRomanization")}
          index={nextIndex()}
          checked={showLyricRomanization()}
          onChange={handleShowLyricRomanization}
        />

        <Show when={showLyricTranslation() && showLyricRomanization()}>
          <BooleanSettingItem
            id="swapLyricTranslationRomanization"
            label={t("settings.lyric.swapTranslationRomanization")}
            description={t("settings.lyric.swapTranslationRomanization.desc")}
            highlighted={isHi("swapLyricTranslationRomanization")}
            index={nextIndex()}
            checked={swapLyricTranslationRomanization()}
            onChange={handleSwapLyricTranslationRomanization}
          />
        </Show>

        <BooleanSettingItem
          id="lyricsBlur"
          label={t("settings.lyric.blur")}
          description={t("settings.lyric.blur.desc")}
          highlighted={isHi("lyricsBlur")}
          index={nextIndex()}
          checked={lyricsBlur()}
          onChange={handleLyricsBlur}
        />

        <SelectSettingItem
          id="lyricsBlendMode"
          label={t("settings.lyric.blendMode")}
          description={t("settings.lyric.blendMode.desc")}
          highlighted={isHi("lyricsBlendMode")}
          index={nextIndex()}
          value={lyricsBlendMode()}
          options={lyricsBlendModeOptions()}
          onChange={(v) => handleLyricsBlendMode(v as LyricsBlendMode)}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.desktopLyric.title")}>
        <RangeSettingItem
          id="desktopLyricFontSize"
          label={t("settings.desktopLyric.fontSize")}
          description={t("settings.desktopLyric.fontSize.desc")}
          highlighted={isHi("desktopLyricFontSize")}
          index={nextIndex()}
          min={18}
          max={80}
          step={1}
          value={desktopLyricFontSize()}
          onPreview={setDesktopLyricFontSize}
          onCommit={handleDesktopLyricFontSize}
          formatSuffix="px"
        />

        <SelectSettingItem
          id="desktopLyricPosition"
          label={t("settings.desktopLyric.position")}
          description={t("settings.desktopLyric.position.desc")}
          highlighted={isHi("desktopLyricPosition")}
          index={nextIndex()}
          value={desktopLyricPosition()}
          options={desktopLyricPositionOptions()}
          onChange={(v) => handleDesktopLyricPosition(v as DesktopLyricPosition)}
        />

        <SettingItem
          id="desktopLyricPlayedColor"
          label={t("settings.desktopLyric.playedColor")}
          description={t("settings.desktopLyric.playedColor.desc")}
          highlighted={isHi("desktopLyricPlayedColor")}
          index={nextIndex()}
        >
          <div class="settings-color-control">
            <For each={DESKTOP_LYRIC_COLORS}>
              {(color) => (
                <button
                  type="button"
                  class={`settings-color-swatch${desktopLyricPlayedColor().toLowerCase() === color ? " is-active" : ""}`}
                  style={{ "--swatch-color": color }}
                  onClick={() => handleDesktopLyricPlayedColor(color)}
                  aria-label={color}
                />
              )}
            </For>
          </div>
        </SettingItem>

        <BooleanSettingItem
          id="desktopLyricDoubleLine"
          label={t("settings.desktopLyric.doubleLine")}
          description={t("settings.desktopLyric.doubleLine.desc")}
          highlighted={isHi("desktopLyricDoubleLine")}
          index={nextIndex()}
          checked={desktopLyricDoubleLine()}
          onChange={handleDesktopLyricDoubleLine}
        />

        <BooleanSettingItem
          id="desktopLyricShowWordByWord"
          label={t("settings.desktopLyric.showWordByWord")}
          description={t("settings.desktopLyric.showWordByWord.desc")}
          highlighted={isHi("desktopLyricShowWordByWord")}
          index={nextIndex()}
          checked={desktopLyricShowWordByWord()}
          onChange={handleDesktopLyricShowWordByWord}
        />

        <BooleanSettingItem
          id="desktopLyricShowTranslation"
          label={t("settings.desktopLyric.showTranslation")}
          description={t("settings.desktopLyric.showTranslation.desc")}
          highlighted={isHi("desktopLyricShowTranslation")}
          index={nextIndex()}
          checked={desktopLyricShowTranslation()}
          onChange={handleDesktopLyricShowTranslation}
        />

        <BooleanSettingItem
          id="desktopLyricShowPlayInfo"
          label={t("settings.desktopLyric.showPlayInfo")}
          description={t("settings.desktopLyric.showPlayInfo.desc")}
          highlighted={isHi("desktopLyricShowPlayInfo")}
          index={nextIndex()}
          checked={desktopLyricShowPlayInfo()}
          onChange={handleDesktopLyricShowPlayInfo}
        />
      </SettingGroup>
    </section>
  );
}
