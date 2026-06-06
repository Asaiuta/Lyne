import type { PersistentSettings, PersistentSettingsUpdate } from "./types";
import {
  isBoolean,
  isInteger,
  isNullableInteger,
  isNumber,
  isRecord,
  isString
} from "./ncmParserUtils";

export interface SettingsApiClient {
  getSettings: () => Promise<PersistentSettings>;
  saveSettings: (settings: PersistentSettingsUpdate) => Promise<void>;
}

export type SettingsRequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

export interface SettingsApiTransport {
  requestJson: SettingsRequestJson;
}

const isNumberRecord = (value: unknown): value is Record<string, number> => {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(isNumber);
};

const hasFields = <T extends string>(
  value: Record<string, unknown>,
  fields: readonly T[],
  predicate: (candidate: unknown) => boolean
) => fields.every((field) => predicate(value[field]));

const parseStatus = (value: unknown): "success" | "error" => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid settings response status");
};

const parseStatusMessage = (value: unknown): { status: "success" | "error"; message: string | null } => {
  if (!isRecord(value)) {
    throw new Error("Invalid settings response shape");
  }
  return {
    status: parseStatus(value.status),
    message: typeof value.message === "string" ? value.message : null
  };
};

const persistentSettingsBooleanFields = [
  "exclusive_mode",
  "dither_enabled",
  "loudness_enabled",
  "saturation_enabled",
  "crossfeed_enabled",
  "dynamic_loudness_enabled",
  "use_cache",
  "preemptive_resample",
  "streaming_first_buffer",
  "use_next_prefetch"
] as const;

const persistentSettingsNumberFields = [
  "volume",
  "target_lufs",
  "preamp_db",
  "saturation_drive",
  "saturation_mix",
  "crossfeed_mix",
  "dynamic_loudness_strength"
] as const;

const persistentSettingsIntegerFields = ["output_bits", "streaming_full_buffer_limit_mib"] as const;

const persistentSettingsNullableIntegerFields = [
  "device_id",
  "fir_taps",
  "target_samplerate"
] as const;

const persistentSettingsStringFields = [
  "eq_type",
  "noise_shaper_curve",
  "loudness_mode",
  "resample_quality"
] as const;

const parsePersistentSettings = (value: unknown): PersistentSettings | null => {
  if (!isRecord(value)) {
    return null;
  }

  const eqBands = value.eq_bands;
  if (eqBands !== null && eqBands !== undefined && !isNumberRecord(eqBands)) {
    return null;
  }

  if (
    !hasFields(value, persistentSettingsBooleanFields, isBoolean) ||
    !hasFields(value, persistentSettingsNumberFields, isNumber) ||
    !hasFields(value, persistentSettingsIntegerFields, isInteger) ||
    !hasFields(value, persistentSettingsNullableIntegerFields, isNullableInteger) ||
    !hasFields(value, persistentSettingsStringFields, isString)
  ) {
    return null;
  }

  return {
    volume: value.volume as number,
    device_id: value.device_id as number | null,
    exclusive_mode: value.exclusive_mode as boolean,
    eq_type: value.eq_type as string,
    eq_bands: eqBands === undefined ? null : (eqBands as Record<string, number> | null),
    fir_taps: value.fir_taps as number | null,
    dither_enabled: value.dither_enabled as boolean,
    output_bits: value.output_bits as number,
    noise_shaper_curve: value.noise_shaper_curve as string,
    loudness_enabled: value.loudness_enabled as boolean,
    loudness_mode: value.loudness_mode as string,
    target_lufs: value.target_lufs as number,
    preamp_db: value.preamp_db as number,
    saturation_enabled: value.saturation_enabled as boolean,
    saturation_drive: value.saturation_drive as number,
    saturation_mix: value.saturation_mix as number,
    crossfeed_enabled: value.crossfeed_enabled as boolean,
    crossfeed_mix: value.crossfeed_mix as number,
    dynamic_loudness_enabled: value.dynamic_loudness_enabled as boolean,
    dynamic_loudness_strength: value.dynamic_loudness_strength as number,
    target_samplerate: value.target_samplerate as number | null,
    resample_quality: value.resample_quality as string,
    use_cache: value.use_cache as boolean,
    preemptive_resample: value.preemptive_resample as boolean,
    streaming_first_buffer: value.streaming_first_buffer as boolean,
    streaming_full_buffer_limit_mib: value.streaming_full_buffer_limit_mib as number,
    use_next_prefetch: value.use_next_prefetch as boolean
  };
};

const parseSettingsResponse = (value: unknown): PersistentSettings => {
  if (!isRecord(value)) {
    throw new Error("Invalid settings response shape");
  }

  const status = parseStatus(value.status);
  if (status === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Failed to fetch settings");
  }

  const settings = parsePersistentSettings(value.settings);
  if (!settings) {
    throw new Error("Invalid settings payload");
  }

  return settings;
};

const postJson = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body)
});

export const createSettingsApiClient = (transport: SettingsApiTransport): SettingsApiClient => ({
  getSettings: async () => parseSettingsResponse(await transport.requestJson("/settings")),
  saveSettings: async (settings) => {
    const response = parseStatusMessage(
      await transport.requestJson("/save_settings", postJson({ settings }))
    );
    if (response.status === "error") {
      throw new Error(response.message ?? "Failed to save settings");
    }
  }
});
