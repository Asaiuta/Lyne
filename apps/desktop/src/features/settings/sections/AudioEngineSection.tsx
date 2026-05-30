import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { createApiClient, type NoiseShaperCurve } from "../../../shared/api/client";
import type {
  AudioDeviceInfo,
  DevicesResponse,
  PersistentSettings,
  PersistentSettingsUpdate,
  RequestState
} from "../../../shared/api/types";
import { useTranslation } from "../../../shared/i18n";
import type { TranslationKey } from "../../../shared/i18n";
import {
  BooleanSettingItem,
  ButtonSettingItem,
  SelectSettingItem,
  TextSettingItem,
  type SelectOption
} from "../components/SettingControls";
import {
  settingItemBlockBodyClass,
  settingItemBlockClass,
  settingItemClass,
  settingItemHighlightedClass,
  settingItemLabelClass,
  settingItemNameClass,
  settingsSectionClass
} from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import {
  AUDIO_ENGINE_BOOLEAN_ITEMS,
  AUDIO_ENGINE_TEXT_ITEMS,
  EQ_BANDS,
  EQ_TYPE_OPTIONS,
  LOUDNESS_MODE_OPTIONS,
  NOISE_SHAPER_OPTIONS,
  OUTPUT_BIT_OPTIONS,
  RESAMPLE_QUALITY_OPTIONS,
  audioEngineFormFromSettings,
  buildEmptyEqBands,
  defaultAudioEngineForm,
  eqBandsFromSettings,
  eqBandsForSettingsUpdate,
  findAudioEngineBooleanItem,
  readAudioEngineFormScalarValue,
  type AudioEngineBooleanItemDescriptor,
  type AudioEngineTextDisableWhen,
  type AudioEngineTextItemDescriptor,
  type EqBandKey,
  type SettingsFormState
} from "./audioEngineSettingsModel";

const api = createApiClient();

interface AudioEngineSectionProps {
  highlightId: string | null;
  onStateRefresh: () => Promise<void>;
}

type OutputBits = 16 | 24 | 32;

const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

const isOption = <T extends string>(value: string, options: readonly T[]): value is T =>
  options.includes(value as T);

const eqBandsGridClass =
  "eq-bands grid grid-cols-[repeat(auto-fit,minmax(54px,1fr))] items-end gap-2 rounded-lg border border-[var(--border-overlay)] bg-[color-mix(in_oklch,var(--surface-2)_62%,transparent)] p-4";

const eqBandClass = "eq-band flex flex-col items-center gap-[10px]";

const eqBandTextClass = "text-xs";

const eqBandSliderClass =
  "eq-band-slider my-[58px] h-[18px] w-[140px] rotate-[-90deg] accent-accent";

export function AudioEngineSection(props: AudioEngineSectionProps) {
  const { t } = useTranslation();
  const [settingsState, setSettingsState] = createSignal<RequestState<PersistentSettings>>({ status: "idle" });
  const [devicesState, setDevicesState] = createSignal<RequestState<DevicesResponse>>({ status: "idle" });
  const [form, setForm] = createStore<SettingsFormState>(defaultAudioEngineForm());
  const [pendingIds, setPendingIds] = createSignal<ReadonlySet<string>>(new Set());
  const [saveMessageKey, setSaveMessageKey] = createSignal<TranslationKey | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  const settingsData = () => {
    const state = settingsState();
    return state.status === "success" ? state.data : null;
  };
  const settingsError = () => {
    const state = settingsState();
    return state.status === "error" ? state.error : null;
  };
  const devicesData = () => {
    const state = devicesState();
    return state.status === "success" ? state.data : null;
  };
  const devicesError = () => {
    const state = devicesState();
    return state.status === "error" ? state.error : null;
  };
  const devices = (): AudioDeviceInfo[] => {
    const data = devicesData();
    return data ? [...data.preferred, ...data.other] : [];
  };
  const isPending = (id: string) => pendingIds().has(id);
  const isBusy = () => pendingIds().size > 0;
  const isOutputPending = () => isPending("device") || isPending("exclusive");

  const eqBandsClass = () =>
    [
      settingItemClass,
      settingItemBlockClass,
      props.highlightId === "eqBands" ? settingItemHighlightedClass : ""
    ]
      .filter(Boolean)
      .join(" ");

  const deviceOptions = createMemo<SelectOption[]>(() => {
    const devList = devices();
    return [
      { value: "", label: t("settings.device.systemDefault") },
      ...devList.map((d) => ({
        value: String(d.id),
        label: d.name + (d.is_default ? t("settings.device.defaultSuffix") : "")
      }))
    ];
  });

  const eqTypeOptions: SelectOption[] = [
    ...EQ_TYPE_OPTIONS.map((opt) => ({ value: opt, label: opt }))
  ];

  const outputBitOptions = createMemo<SelectOption[]>(() =>
    OUTPUT_BIT_OPTIONS.map((opt) => ({
      value: opt,
      label: t("settings.outputBitsOption", { bits: opt })
    }))
  );

  const noiseShaperOptions: SelectOption[] = NOISE_SHAPER_OPTIONS.map((opt) => ({
    value: opt,
    label: opt
  }));

  const loudnessModeOptions: SelectOption[] = LOUDNESS_MODE_OPTIONS.map((opt) => ({
    value: opt,
    label: opt
  }));

  const resampleQualityOptions: SelectOption[] = RESAMPLE_QUALITY_OPTIONS.map((opt) => ({
    value: opt,
    label: opt
  }));

  const readErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : t("common.error.requestFailed");

  const parseOptionalInteger = (value: string, label: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(t("settings.error.positiveOrEmpty", { label }));
    }
    return parsed;
  };

  const parseRequiredNumber = (value: string, label: string): number => {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      throw new Error(t("settings.error.notANumber", { label }));
    }
    return parsed;
  };

  const parseDeviceId = (value: string): number | null => {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed)) {
      throw new Error(t("settings.error.invalidDevice"));
    }
    return parsed;
  };

  const parseRangedNumber = (value: string, label: string, min: number, max: number): number => {
    const parsed = parseRequiredNumber(value, label);
    if (parsed < min || parsed > max) {
      throw new Error(t("settings.error.outOfRange", { label, min, max }));
    }
    return parsed;
  };

  const parseOutputBits = (value: string): OutputBits => {
    if (!isOption(value, OUTPUT_BIT_OPTIONS)) {
      throw new Error(t("settings.error.invalidBits"));
    }
    return Number.parseInt(value, 10) as OutputBits;
  };

  const markPending = (ids: readonly string[], pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      ids.forEach((id) => {
        if (pending) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const refreshSettings = async () => {
    const settings = await api.getSettings();
    setSettingsState({ status: "success", data: settings });
    setForm(audioEngineFormFromSettings(settings));
    return settings;
  };

  const loadPanelData = async () => {
    setSettingsState({ status: "loading" });
    setDevicesState({ status: "loading" });
    try {
      const [settings, devices] = await Promise.all([api.getSettings(), api.listDevices()]);
      setSettingsState({ status: "success", data: settings });
      setDevicesState({ status: "success", data: devices });
      setForm(audioEngineFormFromSettings(settings));
      setSaveError(null);
    } catch (error) {
      const message = readErrorMessage(error);
      setSettingsState({ status: "error", error: message });
      setDevicesState({ status: "error", error: message });
    }
  };

  const commit = async (
    ids: readonly string[],
    action: () => Promise<void>,
    rollback?: () => void
  ) => {
    setSaveMessageKey(null);
    setSaveError(null);
    markPending(ids, true);
    let actionSucceeded = false;
    try {
      await action();
      actionSucceeded = true;
      await Promise.all([props.onStateRefresh(), refreshSettings()]);
      setSaveMessageKey("settings.feedback.saved");
    } catch (error) {
      if (!actionSucceeded) rollback?.();
      setSaveError(readErrorMessage(error));
    } finally {
      markPending(ids, false);
    }
  };

  const savePatch = (
    id: string,
    patch: PersistentSettingsUpdate,
    rollback?: () => void
  ) => {
    void commit([id], () => api.saveSettings(patch), rollback);
  };

  const commitOutput = (ids: readonly string[], nextDeviceId: string, nextExclusive: boolean, rollback: () => void) => {
    void commit(
      ids,
      async () => {
        const deviceId = parseDeviceId(nextDeviceId);
        await api.configureOutput(deviceId, nextExclusive);
        await api.saveSettings({ device_id: deviceId, exclusive_mode: nextExclusive });
      },
      rollback
    );
  };

  onMount(() => {
    void loadPanelData();
  });

  const updateEqBand = (key: EqBandKey, value: number) => {
    setForm("eqBands", key, value);
  };

  const persistedEqBands = () => {
    const settings = settingsData();
    return settings ? eqBandsFromSettings(settings) : buildEmptyEqBands();
  };

  const revertEqBands = (bands: Record<EqBandKey, number>) => {
    setForm("eqBands", { ...bands });
  };

  const handleEqBandsCommit = () => {
    const nextBands = { ...form.eqBands };
    savePatch("eqBands", { eq_bands: eqBandsForSettingsUpdate(nextBands) }, () =>
      revertEqBands(persistedEqBands())
    );
  };

  const handleResetEq = () => {
    const nextBands = buildEmptyEqBands();
    setForm("eqBands", nextBands);
    savePatch("eqBands", { eq_bands: nextBands }, () => revertEqBands(persistedEqBands()));
  };

  const handleDeviceChange = (value: string) => {
    const previous = form.deviceId;
    setForm("deviceId", value);
    commitOutput(["device"], value, form.exclusiveMode, () => setForm("deviceId", previous));
  };

  const handleExclusiveModeChange = (checked: boolean) => {
    const previous = form.exclusiveMode;
    setForm("exclusiveMode", checked);
    commitOutput(["exclusive"], form.deviceId, checked, () => setForm("exclusiveMode", previous));
  };

  const handleEqTypeChange = (value: string) => {
    if (!isOption(value, EQ_TYPE_OPTIONS)) return;
    const previous = form.eqType;
    try {
      const firTaps = value === "FIR"
        ? parseOptionalInteger(form.firTaps, t("settings.field.firTaps")) ?? 1023
        : undefined;
      setForm("eqType", value);
      savePatch("eqType", { eq_type: value, fir_taps: firTaps }, () => setForm("eqType", previous));
    } catch (error) {
      setSaveMessageKey(null);
      setSaveError(readErrorMessage(error));
    }
  };

  const handleOutputBitsChange = (value: string) => {
    const previous = form.outputBits;
    try {
      const bits = parseOutputBits(value);
      setForm("outputBits", value);
      void commit(
        ["outputBits"],
        async () => {
          await api.configureOutputBits({ bits });
          await api.saveSettings({ output_bits: bits });
        },
        () => setForm("outputBits", previous)
      );
    } catch (error) {
      setSaveError(readErrorMessage(error));
    }
  };

  const handleNoiseShaperChange = (value: string) => {
    if (!isOption(value, NOISE_SHAPER_OPTIONS)) {
      setSaveError(t("settings.error.invalidNoiseShaper"));
      return;
    }
    const previous = form.noiseShaperCurve;
    setForm("noiseShaperCurve", value);
    void commit(
      ["noiseShaper"],
      async () => {
        await api.setNoiseShaperCurve({ curve: value as NoiseShaperCurve });
        await api.saveSettings({ noise_shaper_curve: value });
      },
      () => setForm("noiseShaperCurve", previous)
    );
  };

  const handleLoudnessModeChange = (value: string) => {
    if (!isOption(value, LOUDNESS_MODE_OPTIONS)) {
      setSaveError(t("settings.error.invalidLoudnessMode"));
      return;
    }
    const previous = form.loudnessMode;
    setForm("loudnessMode", value);
    savePatch("loudnessMode", { loudness_mode: value }, () => setForm("loudnessMode", previous));
  };

  const handleResampleQualityChange = (value: string) => {
    if (!isOption(value, RESAMPLE_QUALITY_OPTIONS)) {
      setSaveError(t("settings.error.invalidResampleQuality"));
      return;
    }
    const previous = form.resampleQuality;
    setForm("resampleQuality", value);
    savePatch("resampleQuality", { resample_quality: value }, () => setForm("resampleQuality", previous));
  };

  const handleBooleanChange = (id: string, checked: boolean) => {
    const { formField, settingsField } = findAudioEngineBooleanItem(id);
    const previous = form[formField];
    setForm(formField, checked);
    savePatch(id, { [settingsField]: checked }, () => setForm(formField, previous));
  };

  const parseTextSetting = (descriptor: AudioEngineTextItemDescriptor) => {
    const label = t(descriptor.parser.fieldLabelKey);
    const value = form[descriptor.formField];
    switch (descriptor.parser.kind) {
      case "optionalInteger":
        return parseOptionalInteger(value, label) ?? descriptor.parser.emptyFallback ?? null;
      case "requiredNumber":
        return parseRequiredNumber(value, label);
      case "rangedNumber":
        return parseRangedNumber(value, label, descriptor.parser.min, descriptor.parser.max);
      default: {
        const exhaustive: never = descriptor.parser;
        throw new Error(`unhandled text setting parser: ${String(exhaustive)}`);
      }
    }
  };

  const isTextSettingDisabled = (disabledWhen?: AudioEngineTextDisableWhen) => {
    switch (disabledWhen) {
      case undefined:
        return false;
      case "eqTypeIsNotFir":
        return form.eqType !== "FIR";
      case "saturationDisabled":
        return !form.saturationEnabled;
      case "crossfeedDisabled":
        return !form.crossfeedEnabled;
      case "dynamicLoudnessDisabled":
        return !form.dynamicLoudnessEnabled;
      default: {
        const exhaustive: never = disabledWhen;
        throw new Error(`unhandled text setting disabled condition: ${String(exhaustive)}`);
      }
    }
  };

  const commitTextField = (
    id: string,
    patch: () => PersistentSettingsUpdate,
    rollback: () => void
  ) => {
    try {
      savePatch(id, patch(), rollback);
    } catch (error) {
      setSaveMessageKey(null);
      setSaveError(readErrorMessage(error));
    }
  };

  const textField = (descriptor: AudioEngineTextItemDescriptor) => (
    <TextSettingItem
      id={descriptor.id}
      label={t(descriptor.labelKey)}
      highlighted={isHi(descriptor.id)}
      index={nextIndex()}
      value={form[descriptor.formField]}
      onInput={(next) => setForm(descriptor.formField, next)}
      onCommit={() =>
        commitTextField(
          descriptor.id,
          () =>
            ({
              [descriptor.settingsField]: parseTextSetting(descriptor)
            }) as PersistentSettingsUpdate,
          () =>
            setForm(
              descriptor.formField,
              readAudioEngineFormScalarValue(settingsData(), descriptor.formField)
            )
        )
      }
      disabled={isTextSettingDisabled(descriptor.disabledWhen) || isPending(descriptor.id)}
      inputMode="decimal"
    />
  );

  const booleanField = (descriptor: AudioEngineBooleanItemDescriptor, label: string) => (
    <BooleanSettingItem
      id={descriptor.id}
      label={label}
      highlighted={isHi(descriptor.id)}
      index={nextIndex()}
      checked={form[descriptor.formField]}
      onChange={(checked) => handleBooleanChange(descriptor.id, checked)}
      disabled={isPending(descriptor.id)}
    />
  );

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.title")}>
        <SelectSettingItem
          id="device"
          label={t("settings.device.label")}
          highlighted={isHi("device")}
          index={nextIndex()}
          value={form.deviceId}
          options={deviceOptions()}
          onChange={handleDeviceChange}
          disabled={devicesState().status !== "success" || isOutputPending()}
        />

        <BooleanSettingItem
          id="exclusive"
          label={t("settings.exclusiveMode")}
          highlighted={isHi("exclusive")}
          index={nextIndex()}
          checked={form.exclusiveMode}
          onChange={handleExclusiveModeChange}
          disabled={isOutputPending()}
        />

        {textField(AUDIO_ENGINE_TEXT_ITEMS.volume)}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.upsampling)}
      </SettingGroup>

      <SettingGroup title={t("settings.eq.bandsTitle")}>
        <SelectSettingItem
          id="eqType"
          label={t("settings.eq.profile")}
          highlighted={isHi("eqType")}
          index={nextIndex()}
          value={form.eqType}
          options={eqTypeOptions}
          onChange={handleEqTypeChange}
          disabled={isPending("eqType")}
        />
        {textField(AUDIO_ENGINE_TEXT_ITEMS.firTaps)}

        <div id="setting-eqBands" class={eqBandsClass()}>
          <div class={settingItemLabelClass}>
            <span class={settingItemNameClass}>{t("settings.eq.bandsTitle")}</span>
          </div>
          <div class={settingItemBlockBodyClass}>
            <button type="button" class="ghost-button" onClick={handleResetEq} disabled={isPending("eqBands")}>
              {t("settings.eq.reset")}
            </button>
            <div class={eqBandsGridClass}>
              <For each={EQ_BANDS}>
                {(hz) => {
                  const key = String(hz) as EqBandKey;
                  return (
                    <div class={eqBandClass}>
                      <span class={`eq-band-value ${eqBandTextClass}`}>{form.eqBands[key].toFixed(1)}</span>
                      <input
                        class={eqBandSliderClass}
                        type="range"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={form.eqBands[key]}
                        onInput={(event) => updateEqBand(key, Number.parseFloat(event.currentTarget.value))}
                        onChange={handleEqBandsCommit}
                        disabled={isPending("eqBands")}
                        aria-label={t("settings.eq.bandAria", { hz: formatHz(hz) })}
                      />
                      <span class={`eq-band-label ${eqBandTextClass}`}>{formatHz(hz)}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </SettingGroup>

      <SettingGroup title={t("settings.outputBits")}>
        <SelectSettingItem
          id="outputBits"
          label={t("settings.outputBits")}
          highlighted={isHi("outputBits")}
          index={nextIndex()}
          value={form.outputBits}
          options={outputBitOptions()}
          onChange={handleOutputBitsChange}
          disabled={isPending("outputBits")}
        />
        <SelectSettingItem
          id="noiseShaper"
          label={t("settings.noiseShaper")}
          highlighted={isHi("noiseShaper")}
          index={nextIndex()}
          value={form.noiseShaperCurve}
          options={noiseShaperOptions}
          onChange={handleNoiseShaperChange}
          disabled={isPending("noiseShaper")}
        />
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.dither, t("settings.dither"))}
      </SettingGroup>

      <SettingGroup title={t("settings.loudnessEnabled")}>
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.loudnessEnabled, t("settings.loudnessEnabled"))}
        <SelectSettingItem
          id="loudnessMode"
          label={t("settings.loudnessMode")}
          highlighted={isHi("loudnessMode")}
          index={nextIndex()}
          value={form.loudnessMode}
          options={loudnessModeOptions}
          onChange={handleLoudnessModeChange}
          disabled={isPending("loudnessMode")}
        />
        {textField(AUDIO_ENGINE_TEXT_ITEMS.targetLufs)}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.preamp)}
        <SelectSettingItem
          id="resampleQuality"
          label={t("settings.resampleQuality")}
          highlighted={isHi("resampleQuality")}
          index={nextIndex()}
          value={form.resampleQuality}
          options={resampleQualityOptions}
          onChange={handleResampleQualityChange}
          disabled={isPending("resampleQuality")}
        />
      </SettingGroup>

      <SettingGroup title={t("settings.saturation.title")}>
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.saturationEnabled, t("settings.saturation.enabled"))}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.saturationDrive)}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.saturationMix)}
      </SettingGroup>

      <SettingGroup title={t("settings.crossfeed.title")}>
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.crossfeedEnabled, t("settings.crossfeed.enabled"))}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.crossfeedMix)}
      </SettingGroup>

      <SettingGroup title={t("settings.dynamicLoudness.title")}>
        {booleanField(
          AUDIO_ENGINE_BOOLEAN_ITEMS.dynamicLoudnessEnabled,
          t("settings.dynamicLoudness.enabled")
        )}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.dynamicLoudnessStrength)}
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.useCache, t("settings.useCache"))}
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.preemptiveResample, t("settings.preemptiveResample"))}
      </SettingGroup>

      <ButtonSettingItem
        id="engineReload"
        label={t("settings.reload")}
        highlighted={isHi("engineReload")}
        index={nextIndex()}
        buttonLabel={t("settings.reload")}
        onClick={() => void loadPanelData()}
        disabled={isBusy()}
      />

      <Show when={settingsError()}>{(error) => <div class="status-error">{error()}</div>}</Show>
      <Show when={devicesError()}>{(error) => <div class="status-error">{error()}</div>}</Show>
      <Show when={saveError()}>
        <div class="status-error">{saveError()}</div>
      </Show>
      <Show when={saveMessageKey()}>{(key) => <div class="status-line">{t(key())}</div>}</Show>
      <Show when={settingsData()}>
        {(settings) => (
          <div class="status-line">
            {t("settings.feedback.loaded", {
              eq: settings().eq_type,
              lufs: settings().target_lufs,
              bits: settings().output_bits
            })}
          </div>
        )}
      </Show>
    </section>
  );
}
