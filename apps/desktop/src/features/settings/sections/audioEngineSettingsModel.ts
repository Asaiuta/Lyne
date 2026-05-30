import type { PersistentSettings, PersistentSettingsUpdate } from "../../../shared/api/types";
import type { TranslationKey } from "../../../shared/i18n";

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export type EqBandKey = `${(typeof EQ_BANDS)[number]}`;
export const EQ_BAND_KEYS: ReadonlyArray<EqBandKey> = EQ_BANDS.map(
  (hz) => String(hz) as EqBandKey
);

export const NOISE_SHAPER_OPTIONS = [
  "Lipshitz5",
  "FWeighted9",
  "ModifiedE9",
  "ImprovedE9",
  "TpdfOnly"
] as const;
export const LOUDNESS_MODE_OPTIONS = [
  "track",
  "album",
  "streaming",
  "replaygain_track",
  "replaygain_album"
] as const;
export const RESAMPLE_QUALITY_OPTIONS = ["low", "std", "hq", "uhq"] as const;
export const OUTPUT_BIT_OPTIONS = ["16", "24", "32"] as const;
export const EQ_TYPE_OPTIONS = ["IIR", "FIR"] as const;

export interface SettingsFormState {
  deviceId: string;
  exclusiveMode: boolean;
  volume: string;
  eqType: string;
  firTaps: string;
  ditherEnabled: boolean;
  outputBits: string;
  noiseShaperCurve: string;
  loudnessEnabled: boolean;
  loudnessMode: string;
  targetLufs: string;
  preampDb: string;
  saturationEnabled: boolean;
  saturationDrive: string;
  saturationMix: string;
  crossfeedEnabled: boolean;
  crossfeedMix: string;
  dynamicLoudnessEnabled: boolean;
  dynamicLoudnessStrength: string;
  targetSamplerate: string;
  resampleQuality: string;
  useCache: boolean;
  preemptiveResample: boolean;
  eqBands: Record<EqBandKey, number>;
}

type ScalarFormField = Exclude<keyof SettingsFormState, "eqBands">;
type TextFormField = {
  [K in ScalarFormField]: SettingsFormState[K] extends string ? K : never;
}[ScalarFormField];

interface FormFieldDescriptor<K extends ScalarFormField> {
  field: K;
  defaultValue: SettingsFormState[K];
  read: (settings: PersistentSettings) => SettingsFormState[K];
}

const field = <K extends ScalarFormField>(
  descriptor: FormFieldDescriptor<K>
): FormFieldDescriptor<K> => descriptor;

const FORM_FIELD_DESCRIPTORS = [
  field({
    field: "deviceId",
    defaultValue: "",
    read: (settings) => (settings.device_id === null ? "" : String(settings.device_id))
  }),
  field({
    field: "exclusiveMode",
    defaultValue: false,
    read: (settings) => settings.exclusive_mode
  }),
  field({
    field: "volume",
    defaultValue: "0.7",
    read: (settings) => String(settings.volume)
  }),
  field({
    field: "eqType",
    defaultValue: "IIR",
    read: (settings) => settings.eq_type
  }),
  field({
    field: "firTaps",
    defaultValue: "1023",
    read: (settings) => (settings.fir_taps === null ? "" : String(settings.fir_taps))
  }),
  field({
    field: "ditherEnabled",
    defaultValue: true,
    read: (settings) => settings.dither_enabled
  }),
  field({
    field: "outputBits",
    defaultValue: "24",
    read: (settings) => String(settings.output_bits)
  }),
  field({
    field: "noiseShaperCurve",
    defaultValue: "Lipshitz5",
    read: (settings) => settings.noise_shaper_curve
  }),
  field({
    field: "loudnessEnabled",
    defaultValue: true,
    read: (settings) => settings.loudness_enabled
  }),
  field({
    field: "loudnessMode",
    defaultValue: "track",
    read: (settings) => settings.loudness_mode
  }),
  field({
    field: "targetLufs",
    defaultValue: "-12",
    read: (settings) => String(settings.target_lufs)
  }),
  field({
    field: "preampDb",
    defaultValue: "0",
    read: (settings) => String(settings.preamp_db)
  }),
  field({
    field: "saturationEnabled",
    defaultValue: false,
    read: (settings) => settings.saturation_enabled
  }),
  field({
    field: "saturationDrive",
    defaultValue: "0.5",
    read: (settings) => String(settings.saturation_drive)
  }),
  field({
    field: "saturationMix",
    defaultValue: "1.0",
    read: (settings) => String(settings.saturation_mix)
  }),
  field({
    field: "crossfeedEnabled",
    defaultValue: false,
    read: (settings) => settings.crossfeed_enabled
  }),
  field({
    field: "crossfeedMix",
    defaultValue: "0.3",
    read: (settings) => String(settings.crossfeed_mix)
  }),
  field({
    field: "dynamicLoudnessEnabled",
    defaultValue: false,
    read: (settings) => settings.dynamic_loudness_enabled
  }),
  field({
    field: "dynamicLoudnessStrength",
    defaultValue: "0.5",
    read: (settings) => String(settings.dynamic_loudness_strength)
  }),
  field({
    field: "targetSamplerate",
    defaultValue: "",
    read: (settings) =>
      settings.target_samplerate === null ? "" : String(settings.target_samplerate)
  }),
  field({
    field: "resampleQuality",
    defaultValue: "hq",
    read: (settings) => settings.resample_quality
  }),
  field({
    field: "useCache",
    defaultValue: false,
    read: (settings) => settings.use_cache
  }),
  field({
    field: "preemptiveResample",
    defaultValue: true,
    read: (settings) => settings.preemptive_resample
  })
] as const;

const FORM_FIELD_BY_NAME = new Map<ScalarFormField, FormFieldDescriptor<ScalarFormField>>(
  FORM_FIELD_DESCRIPTORS.map((descriptor) => [
    descriptor.field,
    descriptor as FormFieldDescriptor<ScalarFormField>
  ])
);

function assignField<K extends ScalarFormField>(
  form: Partial<SettingsFormState>,
  key: K,
  value: SettingsFormState[K]
) {
  (form as Record<K, SettingsFormState[K]>)[key] = value;
}

export const buildEmptyEqBands = (): Record<EqBandKey, number> =>
  EQ_BAND_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {} as Record<EqBandKey, number>);

export const eqBandsFromSettings = (settings: PersistentSettings): Record<EqBandKey, number> => {
  const result = buildEmptyEqBands();
  if (!settings.eq_bands) return result;
  for (const key of EQ_BAND_KEYS) {
    const value = settings.eq_bands[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
    }
  }
  return result;
};

export const defaultAudioEngineForm = (): SettingsFormState => {
  const form: Partial<SettingsFormState> = {};
  for (const descriptor of FORM_FIELD_DESCRIPTORS) {
    assignField(form, descriptor.field, descriptor.defaultValue);
  }
  form.eqBands = buildEmptyEqBands();
  return form as SettingsFormState;
};

export const audioEngineFormFromSettings = (settings: PersistentSettings): SettingsFormState => {
  const form: Partial<SettingsFormState> = {};
  for (const descriptor of FORM_FIELD_DESCRIPTORS) {
    assignField(form, descriptor.field, descriptor.read(settings));
  }
  form.eqBands = eqBandsFromSettings(settings);
  return form as SettingsFormState;
};

export const readAudioEngineFormScalarValue = <K extends ScalarFormField>(
  settings: PersistentSettings | null | undefined,
  fieldName: K
): SettingsFormState[K] => {
  const descriptor = FORM_FIELD_BY_NAME.get(fieldName) as FormFieldDescriptor<K> | undefined;
  if (!descriptor) {
    throw new Error(`unknown audio engine form field: ${String(fieldName)}`);
  }
  return settings ? descriptor.read(settings) : descriptor.defaultValue;
};

export const eqBandsForSettingsUpdate = (
  bands: Record<EqBandKey, number>
): Record<string, number> =>
  EQ_BAND_KEYS.reduce((acc, key) => {
    acc[key] = bands[key];
    return acc;
  }, {} as Record<string, number>);

export type AudioEngineBooleanFormField =
  | "ditherEnabled"
  | "loudnessEnabled"
  | "saturationEnabled"
  | "crossfeedEnabled"
  | "dynamicLoudnessEnabled"
  | "useCache"
  | "preemptiveResample";

export type AudioEngineBooleanSettingField =
  keyof Pick<
    PersistentSettingsUpdate,
    | "dither_enabled"
    | "loudness_enabled"
    | "saturation_enabled"
    | "crossfeed_enabled"
    | "dynamic_loudness_enabled"
    | "use_cache"
    | "preemptive_resample"
  >;

export interface AudioEngineBooleanItemDescriptor {
  id: string;
  formField: AudioEngineBooleanFormField;
  settingsField: AudioEngineBooleanSettingField;
}

export const AUDIO_ENGINE_BOOLEAN_ITEMS = {
  dither: { id: "dither", formField: "ditherEnabled", settingsField: "dither_enabled" },
  loudnessEnabled: {
    id: "loudnessEnabled",
    formField: "loudnessEnabled",
    settingsField: "loudness_enabled"
  },
  saturationEnabled: {
    id: "saturationEnabled",
    formField: "saturationEnabled",
    settingsField: "saturation_enabled"
  },
  crossfeedEnabled: {
    id: "crossfeedEnabled",
    formField: "crossfeedEnabled",
    settingsField: "crossfeed_enabled"
  },
  dynamicLoudnessEnabled: {
    id: "dynamicLoudnessEnabled",
    formField: "dynamicLoudnessEnabled",
    settingsField: "dynamic_loudness_enabled"
  },
  useCache: { id: "useCache", formField: "useCache", settingsField: "use_cache" },
  preemptiveResample: {
    id: "preemptiveResample",
    formField: "preemptiveResample",
    settingsField: "preemptive_resample"
  }
} as const satisfies Record<string, AudioEngineBooleanItemDescriptor>;

export const AUDIO_ENGINE_BOOLEAN_ITEM_LIST = Object.values(AUDIO_ENGINE_BOOLEAN_ITEMS);

export const findAudioEngineBooleanItem = (
  id: string
): AudioEngineBooleanItemDescriptor => {
  const descriptor = AUDIO_ENGINE_BOOLEAN_ITEM_LIST.find((item) => item.id === id);
  if (!descriptor) {
    throw new Error(`unknown audio engine boolean setting: ${id}`);
  }
  return descriptor;
};

type AudioEngineTextSettingField =
  keyof Pick<
    PersistentSettingsUpdate,
    | "volume"
    | "fir_taps"
    | "target_lufs"
    | "preamp_db"
    | "saturation_drive"
    | "saturation_mix"
    | "crossfeed_mix"
    | "dynamic_loudness_strength"
    | "target_samplerate"
  >;

type AudioEngineTextParser =
  | {
      kind: "optionalInteger";
      fieldLabelKey: TranslationKey;
      emptyFallback?: number;
    }
  | {
      kind: "requiredNumber";
      fieldLabelKey: TranslationKey;
    }
  | {
      kind: "rangedNumber";
      fieldLabelKey: TranslationKey;
      min: number;
      max: number;
    };

export type AudioEngineTextDisableWhen =
  | "eqTypeIsNotFir"
  | "saturationDisabled"
  | "crossfeedDisabled"
  | "dynamicLoudnessDisabled";

export interface AudioEngineTextItemDescriptor {
  id: string;
  labelKey: TranslationKey;
  formField: TextFormField;
  settingsField: AudioEngineTextSettingField;
  parser: AudioEngineTextParser;
  disabledWhen?: AudioEngineTextDisableWhen;
}

export const AUDIO_ENGINE_TEXT_ITEMS = {
  volume: {
    id: "volume",
    labelKey: "settings.volume",
    formField: "volume",
    settingsField: "volume",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.volume",
      min: 0,
      max: 4
    }
  },
  upsampling: {
    id: "upsampling",
    labelKey: "settings.upsampling",
    formField: "targetSamplerate",
    settingsField: "target_samplerate",
    parser: {
      kind: "optionalInteger",
      fieldLabelKey: "settings.field.upsampling"
    }
  },
  firTaps: {
    id: "firTaps",
    labelKey: "settings.eq.firTaps",
    formField: "firTaps",
    settingsField: "fir_taps",
    parser: {
      kind: "optionalInteger",
      fieldLabelKey: "settings.field.firTaps",
      emptyFallback: 1023
    },
    disabledWhen: "eqTypeIsNotFir"
  },
  targetLufs: {
    id: "targetLufs",
    labelKey: "settings.targetLufs",
    formField: "targetLufs",
    settingsField: "target_lufs",
    parser: {
      kind: "requiredNumber",
      fieldLabelKey: "settings.field.loudnessTarget"
    }
  },
  preamp: {
    id: "preamp",
    labelKey: "settings.preamp",
    formField: "preampDb",
    settingsField: "preamp_db",
    parser: {
      kind: "requiredNumber",
      fieldLabelKey: "settings.field.preamp"
    }
  },
  saturationDrive: {
    id: "saturationDrive",
    labelKey: "settings.saturation.drive",
    formField: "saturationDrive",
    settingsField: "saturation_drive",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.saturationDrive",
      min: 0,
      max: 4
    },
    disabledWhen: "saturationDisabled"
  },
  saturationMix: {
    id: "saturationMix",
    labelKey: "settings.saturation.mix",
    formField: "saturationMix",
    settingsField: "saturation_mix",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.saturationMix",
      min: 0,
      max: 1
    },
    disabledWhen: "saturationDisabled"
  },
  crossfeedMix: {
    id: "crossfeedMix",
    labelKey: "settings.crossfeed.mix",
    formField: "crossfeedMix",
    settingsField: "crossfeed_mix",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.crossfeedMix",
      min: 0,
      max: 1
    },
    disabledWhen: "crossfeedDisabled"
  },
  dynamicLoudnessStrength: {
    id: "dynamicLoudnessStrength",
    labelKey: "settings.dynamicLoudness.strength",
    formField: "dynamicLoudnessStrength",
    settingsField: "dynamic_loudness_strength",
    parser: {
      kind: "rangedNumber",
      fieldLabelKey: "settings.field.dynamicLoudnessStrength",
      min: 0,
      max: 1
    },
    disabledWhen: "dynamicLoudnessDisabled"
  }
} as const satisfies Record<string, AudioEngineTextItemDescriptor>;
