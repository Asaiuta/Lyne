import type {
  ActiveAudioSettingsPreview,
  AudioSettingApplyStatus,
  AudioSettingsApplyState,
  AudioSettingsPreviewPatch,
  AudioSettingsPreviewResult,
  AudioSettingsSnapshot,
  PersistentSettings,
  PersistentSettingsUpdate
} from "./types";
import { ApiHttpError } from "./transport";
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
  getAudioSettings: () => Promise<AudioSettingsSnapshot>;
  previewAudioSettings: (
    sessionId: string,
    seq: number,
    settings: AudioSettingsPreviewPatch
  ) => Promise<AudioSettingsPreviewResult>;
  commitAudioSettings: (
    baseRevision: number,
    settings: PersistentSettingsUpdate,
    previewSessionId?: string
  ) => Promise<AudioSettingsSnapshot>;
  cancelAudioSettingsPreview: (sessionId: string) => Promise<AudioSettingsSnapshot>;
}

export class AudioSettingsConflictError extends Error {
  readonly conflictingFields: readonly string[];
  readonly snapshot: AudioSettingsSnapshot;

  constructor(message: string, conflictingFields: readonly string[], snapshot: AudioSettingsSnapshot) {
    super(message);
    this.name = "AudioSettingsConflictError";
    this.conflictingFields = conflictingFields;
    this.snapshot = snapshot;
  }
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

const persistentSettingsIntegerFields = ["output_bits", "streaming_pcm_window_limit_mib"] as const;

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

export const parsePersistentSettings = (value: unknown): PersistentSettings | null => {
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
    streaming_pcm_window_limit_mib: value.streaming_pcm_window_limit_mib as number,
    use_next_prefetch: value.use_next_prefetch as boolean
  };
};

const AUDIO_SETTINGS_APPLY_STATES = [
  "applied",
  "next_track",
  "restart_output",
  "failed"
] as const satisfies readonly AudioSettingsApplyState[];

const parseApplyStatus = (value: unknown): AudioSettingApplyStatus | null => {
  if (!isRecord(value) || !AUDIO_SETTINGS_APPLY_STATES.includes(value.state as AudioSettingsApplyState)) {
    return null;
  }
  if (!isInteger(value.revision)) {
    return null;
  }
  if (value.message !== undefined && value.message !== null && !isString(value.message)) {
    return null;
  }
  return {
    state: value.state as AudioSettingsApplyState,
    revision: value.revision,
    message: typeof value.message === "string" ? value.message : null
  };
};

const parseActivePreview = (value: unknown): ActiveAudioSettingsPreview | null => {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value) || !isString(value.session_id) || !isInteger(value.seq)) {
    throw new Error("Invalid active audio settings preview");
  }
  const volume = value.volume === undefined || value.volume === null ? null : value.volume;
  const eqBands = value.eq_bands === undefined || value.eq_bands === null ? null : value.eq_bands;
  if ((volume !== null && !isNumber(volume)) || (eqBands !== null && !isNumberRecord(eqBands))) {
    throw new Error("Invalid active audio settings preview values");
  }
  return {
    session_id: value.session_id,
    seq: value.seq,
    volume,
    eq_bands: eqBands
  };
};

export const parseAudioSettingsSnapshot = (value: unknown): AudioSettingsSnapshot => {
  if (
    !isRecord(value) ||
    !isInteger(value.revision) ||
    !isInteger(value.state_revision) ||
    !isRecord(value.apply_status)
  ) {
    throw new Error("Invalid audio settings snapshot");
  }
  const desired = parsePersistentSettings(value.desired);
  const effective = parsePersistentSettings(value.effective);
  if (!desired || !effective) {
    throw new Error("Invalid audio settings snapshot payload");
  }
  const applyStatus: Record<string, AudioSettingApplyStatus> = {};
  for (const [field, rawStatus] of Object.entries(value.apply_status)) {
    const status = parseApplyStatus(rawStatus);
    if (!status) {
      throw new Error(`Invalid audio settings apply status: ${field}`);
    }
    applyStatus[field] = status;
  }
  return {
    revision: value.revision,
    state_revision: value.state_revision,
    desired,
    effective,
    apply_status: applyStatus,
    active_preview: parseActivePreview(value.active_preview)
  };
};

const parseSnapshotResponse = (value: unknown): AudioSettingsSnapshot => {
  if (!isRecord(value)) {
    throw new Error("Invalid audio settings response shape");
  }
  if (parseStatus(value.status) === "error") {
    throw new Error(typeof value.message === "string" ? value.message : "Audio settings request failed");
  }
  return parseAudioSettingsSnapshot(value.snapshot);
};

const parseConflictResponse = (value: unknown): AudioSettingsConflictError | null => {
  if (!isRecord(value) || !Array.isArray(value.conflicting_fields)) {
    return null;
  }
  const conflictingFields = value.conflicting_fields.filter(isString);
  if (conflictingFields.length !== value.conflicting_fields.length) {
    return null;
  }
  try {
    return new AudioSettingsConflictError(
      typeof value.message === "string" ? value.message : "Audio settings conflict",
      conflictingFields,
      parseAudioSettingsSnapshot(value.snapshot)
    );
  } catch {
    return null;
  }
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
  },
  getAudioSettings: async () =>
    parseSnapshotResponse(await transport.requestJson("/audio_settings")),
  previewAudioSettings: async (sessionId, seq, settings) => {
    const value = await transport.requestJson(
      "/audio_settings/preview",
      postJson({ session_id: sessionId, seq, settings })
    );
    if (!isRecord(value) || parseStatus(value.status) === "error") {
      throw new Error(
        isRecord(value) && typeof value.message === "string"
          ? value.message
          : "Failed to preview audio settings"
      );
    }
    if (!isBoolean(value.accepted) || !isString(value.session_id) || !isInteger(value.seq)) {
      throw new Error("Invalid audio settings preview response");
    }
    return {
      accepted: value.accepted,
      sessionId: value.session_id,
      seq: value.seq,
      snapshot: parseAudioSettingsSnapshot(value.snapshot)
    };
  },
  commitAudioSettings: async (baseRevision, settings, previewSessionId) => {
    try {
      return parseSnapshotResponse(
        await transport.requestJson(
          "/audio_settings/commit",
          postJson({
            base_revision: baseRevision,
            settings,
            ...(previewSessionId ? { preview_session_id: previewSessionId } : {})
          })
        )
      );
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 409) {
        const conflict = parseConflictResponse(error.body);
        if (conflict) {
          throw conflict;
        }
      }
      throw error;
    }
  },
  cancelAudioSettingsPreview: async (sessionId) =>
    parseSnapshotResponse(
      await transport.requestJson(
        "/audio_settings/cancel",
        postJson({ session_id: sessionId })
      )
    )
});
