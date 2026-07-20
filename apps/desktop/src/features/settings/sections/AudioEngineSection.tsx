import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack
} from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { createApiClient } from "../../../shared/api/client";
import { AudioSettingsConflictError } from "../../../shared/api/settings";
import type {
  AudioDeviceInfo,
  DevicesResponse,
  PersistentSettingsUpdate,
  RequestState
} from "../../../shared/api/types";
import { usePlayback } from "../../../app/PlaybackContext";
import { createAudioSettingsPreviewSessionId } from "../../../shared/state/audioSettingsStore";
import { useTranslation } from "../../../shared/i18n";
import type { TranslationKey } from "../../../shared/i18n";
import { NaiveButton, NaiveSlider } from "../../../shared/ui/naive";
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
  buildEmptyEqBands,
  defaultAudioEngineForm,
  eqBandsForSettingsUpdate,
  findAudioEngineBooleanItem,
  rebaseAudioEngineForm,
  type AudioEngineFormField,
  type AudioEngineBooleanItemDescriptor,
  type AudioEngineTextDisableWhen,
  type AudioEngineTextItemDescriptor,
  type EqBandKey,
  type SettingsFormState
} from "./audioEngineSettingsModel";

const api = createApiClient();

interface AudioEngineSectionProps {
  highlightId: string | null;
}

type OutputBits = 16 | 24 | 32;

const formatHz = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

const isOption = <T extends string>(value: string, options: readonly T[]): value is T =>
  options.includes(value as T);

const eqBandsGridClass =
  "eq-bands grid grid-cols-[repeat(auto-fit,minmax(54px,1fr))] items-end gap-2 rounded-lg border border-[var(--border-overlay)] bg-[color-mix(in_oklch,var(--surface-2)_62%,transparent)] p-4";

const eqBandClass = "eq-band flex flex-col items-center gap-[10px]";

const eqBandTextClass = "text-xs";

const eqBandSliderClass = "eq-band-slider h-[140px]";

export function AudioEngineSection(props: AudioEngineSectionProps) {
  const { t } = useTranslation();
  const audioSettings = usePlayback().audioSettings;
  const [devicesState, setDevicesState] = createSignal<RequestState<DevicesResponse>>({ status: "idle" });
  const [form, setForm] = createStore<SettingsFormState>(defaultAudioEngineForm());
  const [dirtyFields, setDirtyFields] = createSignal<ReadonlySet<AudioEngineFormField>>(new Set());
  const [pendingIds, setPendingIds] = createSignal<ReadonlySet<string>>(new Set());
  const [saveMessageKey, setSaveMessageKey] = createSignal<TranslationKey | null>(null);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;

  const dirtyBaseRevisions = new Map<AudioEngineFormField, number>();
  const settingsData = () => audioSettings.desired();
  const settingsError = () => {
    const state = audioSettings.state();
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
  let eqPreviewCommandId = 0;
  let eqPreviewRequestInFlight = false;
  let eqPreviewSession: { id: string; seq: number } | null = null;
  let pendingEqCommit: (() => void) | null = null;
  let queuedEqPreview:
    | {
        bands: Record<EqBandKey, number>;
        commandId: number;
        sessionId: string;
        seq: number;
      }
    | null = null;

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

  const parseRangedInteger = (value: string, label: string, min: number, max: number): number => {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new Error(t("settings.error.notANumber", { label }));
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      throw new Error(t("settings.error.notANumber", { label }));
    }
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

  const markDirty = (fields: readonly AudioEngineFormField[]): void => {
    const revision = audioSettings.snapshot()?.revision ?? 0;
    setDirtyFields((current) => {
      const next = new Set(current);
      fields.forEach((field) => {
        if (!next.has(field)) {
          dirtyBaseRevisions.set(field, revision);
          next.add(field);
        }
      });
      return next;
    });
  };

  const clearDirty = (fields: readonly AudioEngineFormField[]): void => {
    setDirtyFields((current) => {
      const next = new Set(current);
      fields.forEach((field) => {
        dirtyBaseRevisions.delete(field);
        next.delete(field);
      });
      return next;
    });
  };

  const baseRevisionFor = (fields: readonly AudioEngineFormField[]): number => {
    const revisions = fields
      .map((field) => dirtyBaseRevisions.get(field))
      .filter((revision): revision is number => revision !== undefined);
    return revisions.length > 0
      ? Math.min(...revisions)
      : audioSettings.snapshot()?.revision ?? 0;
  };

  const loadPanelData = async () => {
    setSaveError(null);
    setDevicesState({ status: "loading" });
    const settingsRequest = audioSettings.refresh().catch((error) => {
      setSaveError(readErrorMessage(error));
    });
    const devicesRequest = api
      .listDevices()
      .then((devices) => setDevicesState({ status: "success", data: devices } as const))
      .catch((error) => setDevicesState({ status: "error", error: readErrorMessage(error) }));
    await Promise.all([settingsRequest, devicesRequest]);
  };

  const reloadPanelData = async (): Promise<void> => {
    const sessionId = eqPreviewSession?.id;
    eqPreviewSession = null;
    queuedEqPreview = null;
    pendingEqCommit = null;
    if (sessionId) {
      await audioSettings.cancelPreview(sessionId).catch(() => undefined);
    }
    dirtyBaseRevisions.clear();
    setDirtyFields(new Set<AudioEngineFormField>());
    await loadPanelData();
  };

  const commit = async (
    ids: readonly string[],
    formFields: readonly AudioEngineFormField[],
    patch: PersistentSettingsUpdate,
    options: { previewSessionId?: string; onSuccess?: () => void } = {}
  ) => {
    setSaveMessageKey(null);
    setSaveError(null);
    markPending(ids, true);
    try {
      const snapshot = await audioSettings.commit(patch, {
        baseRevision: baseRevisionFor(formFields),
        previewSessionId: options.previewSessionId
      });
      clearDirty(formFields);
      options.onSuccess?.();
      const statuses = Object.keys(patch)
        .map((field) => snapshot.apply_status[field])
        .filter((status) => status !== undefined);
      const failed = statuses.find((status) => status.state === "failed");
      if (failed) {
        setSaveError(failed.message ?? t("settings.feedback.applyFailed"));
      } else if (statuses.some((status) => status.state === "restart_output")) {
        setSaveMessageKey("settings.feedback.restartOutput");
      } else if (statuses.some((status) => status.state === "next_track")) {
        setSaveMessageKey("settings.feedback.nextTrack");
      } else {
        setSaveMessageKey("settings.feedback.saved");
      }
    } catch (error) {
      if (error instanceof AudioSettingsConflictError) {
        formFields.forEach((field) => {
          dirtyBaseRevisions.set(field, error.snapshot.revision);
        });
      }
      if (options.previewSessionId) {
        await audioSettings.cancelPreview(options.previewSessionId).catch(() => undefined);
        if (eqPreviewSession?.id === options.previewSessionId) {
          eqPreviewSession = null;
        }
      }
      setSaveError(readErrorMessage(error));
    } finally {
      markPending(ids, false);
    }
  };

  const savePatch = (
    id: string,
    formFields: readonly AudioEngineFormField[],
    patch: PersistentSettingsUpdate,
    options?: { previewSessionId?: string; onSuccess?: () => void }
  ) => {
    void commit([id], formFields, patch, options);
  };

  createEffect(() => {
    const settings = audioSettings.desired();
    const dirty = dirtyFields();
    if (!settings) return;
    const next = untrack(() => rebaseAudioEngineForm(form, settings, dirty));
    setForm(reconcile(next));
  });

  onMount(() => {
    void loadPanelData();
  });

  const flushQueuedEqPreview = (): void => {
    if (eqPreviewRequestInFlight || queuedEqPreview === null) {
      return;
    }

    const request = queuedEqPreview;
    queuedEqPreview = null;
    eqPreviewRequestInFlight = true;

    void audioSettings
      .preview(request.sessionId, request.seq, {
        eq_bands: eqBandsForSettingsUpdate(request.bands)
      })
      .catch((error) => {
        if (request.commandId !== eqPreviewCommandId) {
          return;
        }
        setSaveMessageKey(null);
        setSaveError(readErrorMessage(error));
      })
      .finally(() => {
        eqPreviewRequestInFlight = false;
        if (pendingEqCommit) {
          const runCommit = pendingEqCommit;
          pendingEqCommit = null;
          runCommit();
          return;
        }
        flushQueuedEqPreview();
      });
  };

  const queueEqPreview = (bands: Record<EqBandKey, number>): void => {
    if (!eqPreviewSession) {
      eqPreviewSession = {
        id: createAudioSettingsPreviewSessionId("settings-eq"),
        seq: 0
      };
    }
    eqPreviewSession.seq += 1;
    const commandId = ++eqPreviewCommandId;
    audioSettings.reservePreview(eqPreviewSession.id, eqPreviewSession.seq);
    queuedEqPreview = {
      bands: { ...bands },
      commandId,
      sessionId: eqPreviewSession.id,
      seq: eqPreviewSession.seq
    };
    flushQueuedEqPreview();
  };

  const updateEqBand = (key: EqBandKey, value: number) => {
    const nextBands = { ...form.eqBands, [key]: value };
    markDirty(["eqBands"]);
    setForm("eqBands", key, value);
    queueEqPreview(nextBands);
  };

  const commitEqBands = (bands: Record<EqBandKey, number>): void => {
    queuedEqPreview = null;
    const session = eqPreviewSession;
    const runCommit = () => {
      savePatch(
        "eqBands",
        ["eqBands"],
        { eq_bands: eqBandsForSettingsUpdate(bands) },
        {
          previewSessionId: session?.id,
          onSuccess: () => {
            if (eqPreviewSession?.id === session?.id) {
              eqPreviewSession = null;
            }
          }
        }
      );
    };
    if (eqPreviewRequestInFlight) {
      pendingEqCommit = runCommit;
      return;
    }
    runCommit();
  };

  const handleEqBandsCommit = () => {
    const nextBands = { ...form.eqBands };
    commitEqBands(nextBands);
  };

  const handleResetEq = () => {
    const nextBands = buildEmptyEqBands();
    markDirty(["eqBands"]);
    setForm("eqBands", nextBands);
    queueEqPreview(nextBands);
    commitEqBands(nextBands);
  };

  const handleDeviceChange = (value: string) => {
    try {
      const deviceId = parseDeviceId(value);
      markDirty(["deviceId"]);
      setForm("deviceId", value);
      savePatch("device", ["deviceId"], { device_id: deviceId });
    } catch (error) {
      setSaveError(readErrorMessage(error));
    }
  };

  const handleExclusiveModeChange = (checked: boolean) => {
    markDirty(["exclusiveMode"]);
    setForm("exclusiveMode", checked);
    savePatch("exclusive", ["exclusiveMode"], { exclusive_mode: checked });
  };

  const handleEqTypeChange = (value: string) => {
    if (!isOption(value, EQ_TYPE_OPTIONS)) return;
    markDirty(["eqType"]);
    setForm("eqType", value);
    savePatch("eqType", ["eqType"], { eq_type: value });
  };

  const handleOutputBitsChange = (value: string) => {
    try {
      const bits = parseOutputBits(value);
      markDirty(["outputBits"]);
      setForm("outputBits", value);
      savePatch("outputBits", ["outputBits"], { output_bits: bits });
    } catch (error) {
      setSaveError(readErrorMessage(error));
    }
  };

  const handleNoiseShaperChange = (value: string) => {
    if (!isOption(value, NOISE_SHAPER_OPTIONS)) {
      setSaveError(t("settings.error.invalidNoiseShaper"));
      return;
    }
    markDirty(["noiseShaperCurve"]);
    setForm("noiseShaperCurve", value);
    savePatch("noiseShaper", ["noiseShaperCurve"], { noise_shaper_curve: value });
  };

  const handleLoudnessModeChange = (value: string) => {
    if (!isOption(value, LOUDNESS_MODE_OPTIONS)) {
      setSaveError(t("settings.error.invalidLoudnessMode"));
      return;
    }
    markDirty(["loudnessMode"]);
    setForm("loudnessMode", value);
    savePatch("loudnessMode", ["loudnessMode"], { loudness_mode: value });
  };

  const handleResampleQualityChange = (value: string) => {
    if (!isOption(value, RESAMPLE_QUALITY_OPTIONS)) {
      setSaveError(t("settings.error.invalidResampleQuality"));
      return;
    }
    markDirty(["resampleQuality"]);
    setForm("resampleQuality", value);
    savePatch("resampleQuality", ["resampleQuality"], { resample_quality: value });
  };

  const handleBooleanChange = (id: string, checked: boolean) => {
    const { formField, settingsField } = findAudioEngineBooleanItem(id);
    markDirty([formField]);
    setForm(formField, checked);
    savePatch(id, [formField], { [settingsField]: checked });
  };

  onCleanup(() => {
    const sessionId = eqPreviewSession?.id;
    if (sessionId) {
      void audioSettings.cancelPreview(sessionId).catch(() => undefined);
    }
  });

  const parseTextSetting = (descriptor: AudioEngineTextItemDescriptor) => {
    const label = t(descriptor.parser.fieldLabelKey);
    const value = form[descriptor.formField];
    switch (descriptor.parser.kind) {
      case "optionalInteger":
        return parseOptionalInteger(value, label) ?? descriptor.parser.emptyFallback ?? null;
      case "rangedInteger":
        return parseRangedInteger(value, label, descriptor.parser.min, descriptor.parser.max);
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
    descriptor: AudioEngineTextItemDescriptor,
    patch: () => PersistentSettingsUpdate
  ) => {
    try {
      savePatch(descriptor.id, [descriptor.formField], patch());
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
      onInput={(next) => {
        markDirty([descriptor.formField]);
        setForm(descriptor.formField, next);
      }}
      onCommit={() =>
        commitTextField(
          descriptor,
          () =>
            ({
              [descriptor.settingsField]: parseTextSetting(descriptor)
            }) as PersistentSettingsUpdate
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
            <NaiveButton
              variant="tertiary"
              onClick={handleResetEq}
              disabled={isPending("eqBands")}
            >
              {t("settings.eq.reset")}
            </NaiveButton>
            <div class={eqBandsGridClass}>
              <For each={EQ_BANDS}>
                {(hz) => {
                  const key = String(hz) as EqBandKey;
                  return (
                    <div class={eqBandClass}>
                      <span class={`eq-band-value ${eqBandTextClass}`}>{form.eqBands[key].toFixed(1)}</span>
                      <NaiveSlider
                        class={eqBandSliderClass}
                        orientation="vertical"
                        min={-12}
                        max={12}
                        step={0.5}
                        value={form.eqBands[key]}
                        formatTooltip={(value) => `${value.toFixed(1)} dB`}
                        onUpdateValue={(value) => updateEqBand(key, value)}
                        onUpdateValueEnd={handleEqBandsCommit}
                        disabled={isPending("eqBands")}
                        ariaLabel={t("settings.eq.bandAria", { hz: formatHz(hz) })}
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

      <SettingGroup title={t("settings.streamingBuffering")}>
        {booleanField(AUDIO_ENGINE_BOOLEAN_ITEMS.streamingFirstBuffer, t("settings.streamingFirstBuffer"))}
        {textField(AUDIO_ENGINE_TEXT_ITEMS.streamingPcmWindowLimitMib)}
      </SettingGroup>

      <ButtonSettingItem
        id="engineReload"
        label={t("settings.reload")}
        highlighted={isHi("engineReload")}
        index={nextIndex()}
        buttonLabel={t("settings.reload")}
        onClick={() => void reloadPanelData()}
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
