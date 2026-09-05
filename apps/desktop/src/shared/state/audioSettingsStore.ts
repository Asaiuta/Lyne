import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { SettingsApiClient } from "../api/settings";
import { AudioSettingsConflictError } from "../api/settings";
import type {
  AudioSettingsPreviewPatch,
  AudioSettingsPreviewResult,
  AudioSettingsSnapshot,
  PersistentSettings,
  PersistentSettingsUpdate,
  PlayerState,
  RequestState
} from "../api/types";

export type AudioSettingsApi = Pick<
  SettingsApiClient,
  | "getAudioSettings"
  | "previewAudioSettings"
  | "commitAudioSettings"
  | "cancelAudioSettingsPreview"
>;

export interface AudioSettingsCommitOptions {
  readonly baseRevision?: number;
  readonly previewSessionId?: string;
}

export interface AudioSettingsStore {
  readonly state: Accessor<RequestState<AudioSettingsSnapshot>>;
  readonly snapshot: Accessor<AudioSettingsSnapshot | null>;
  readonly desired: Accessor<PersistentSettings | null>;
  readonly effective: Accessor<PersistentSettings | null>;
  reservePreview: (sessionId: string, seq: number) => void;
  refresh: () => Promise<AudioSettingsSnapshot>;
  preview: (
    sessionId: string,
    seq: number,
    patch: AudioSettingsPreviewPatch
  ) => Promise<AudioSettingsPreviewResult>;
  commit: (
    patch: PersistentSettingsUpdate,
    options?: AudioSettingsCommitOptions
  ) => Promise<AudioSettingsSnapshot>;
  cancelPreview: (sessionId: string) => Promise<AudioSettingsSnapshot>;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Audio settings request failed";

export function createAudioSettingsStore(api: AudioSettingsApi): AudioSettingsStore {
  let currentState: RequestState<AudioSettingsSnapshot> = {
    status: "idle"
  };
  const [version, setVersion] = createSignal<number>(0);
  let issuedGeneration = 0;
  let appliedGeneration = 0;
  const latestPreviewSeq = new Map<string, number>();

  const state = (): RequestState<AudioSettingsSnapshot> => {
    version();
    return currentState;
  };
  const setState = (next: RequestState<AudioSettingsSnapshot>): void => {
    currentState = next;
    setVersion((current) => current + 1);
  };
  const snapshot = (): AudioSettingsSnapshot | null => {
    const current = state();
    return current.status === "success" ? current.data : null;
  };
  const desired = (): PersistentSettings | null => snapshot()?.desired ?? null;
  const effective = (): PersistentSettings | null => snapshot()?.effective ?? null;

  const nextGeneration = (): number => {
    issuedGeneration += 1;
    return issuedGeneration;
  };

  const applySnapshot = (next: AudioSettingsSnapshot, generation: number): boolean => {
    const current = snapshot();
    if (current && next.revision < current.revision) {
      return false;
    }
    if (current && next.state_revision < current.state_revision) {
      return false;
    }
    if (
      current &&
      next.revision === current.revision &&
      next.state_revision === current.state_revision &&
      generation < appliedGeneration
    ) {
      return false;
    }
    appliedGeneration = Math.max(appliedGeneration, generation);
    setState({ status: "success", data: next });
    return true;
  };

  const reservePreview = (sessionId: string, seq: number): void => {
    latestPreviewSeq.set(sessionId, Math.max(latestPreviewSeq.get(sessionId) ?? -1, seq));
  };

  const refresh = async (): Promise<AudioSettingsSnapshot> => {
    const generation = nextGeneration();
    if (!snapshot()) {
      setState({ status: "loading" });
    }
    try {
      const next = await api.getAudioSettings();
      applySnapshot(next, generation);
      return next;
    } catch (error) {
      if (!snapshot() && generation === issuedGeneration) {
        setState({ status: "error", error: errorMessage(error) });
      }
      throw error;
    }
  };

  const preview = async (
    sessionId: string,
    seq: number,
    patch: AudioSettingsPreviewPatch
  ): Promise<AudioSettingsPreviewResult> => {
    const generation = nextGeneration();
    reservePreview(sessionId, seq);
    const result = await api.previewAudioSettings(sessionId, seq, patch);
    if (result.sessionId !== sessionId || result.seq !== seq) {
      throw new Error("Audio settings preview response did not match its request");
    }
    if (seq >= (latestPreviewSeq.get(sessionId) ?? -1)) {
      applySnapshot(result.snapshot, generation);
    }
    return result;
  };

  const commit = async (
    patch: PersistentSettingsUpdate,
    options: AudioSettingsCommitOptions = {}
  ): Promise<AudioSettingsSnapshot> => {
    let current = snapshot();
    if (!current) {
      await refresh();
      current = snapshot();
    }
    if (!current) {
      throw new Error("Audio settings are unavailable");
    }

    const generation = nextGeneration();
    try {
      const next = await api.commitAudioSettings(
        options.baseRevision ?? current.revision,
        patch,
        options.previewSessionId
      );
      if (options.previewSessionId) {
        latestPreviewSeq.delete(options.previewSessionId);
      }
      applySnapshot(next, generation);
      return next;
    } catch (error) {
      if (error instanceof AudioSettingsConflictError) {
        applySnapshot(error.snapshot, generation);
      }
      throw error;
    }
  };

  const cancelPreview = async (sessionId: string): Promise<AudioSettingsSnapshot> => {
    const generation = nextGeneration();
    const next = await api.cancelAudioSettingsPreview(sessionId);
    latestPreviewSeq.delete(sessionId);
    applySnapshot(next, generation);
    return next;
  };

  return {
    state,
    snapshot,
    desired,
    effective,
    reservePreview,
    refresh,
    preview,
    commit,
    cancelPreview
  };
}

let previewSessionCounter = 0;

export const createAudioSettingsPreviewSessionId = (scope: string): string => {
  const normalizedScope = scope.trim().replace(/[^a-z0-9_-]+/gi, "-").slice(0, 32) || "audio";
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) {
    return `${normalizedScope}-${randomId}`;
  }
  previewSessionCounter += 1;
  return `${normalizedScope}-${Date.now().toString(36)}-${previewSessionCounter.toString(36)}`;
};

/**
 * Audio-engine fields of PersistentSettings that applyEffectiveAudioSettingsToPlayerState
 * mirrors into PlayerState. `as const satisfies Partial<Record<keyof PlayerState, true>>`
 * pins every mirror key to a real PlayerState field, and the AudioFieldMirrorContract
 * assertion below pins coverage against PersistentSettings: adding a PersistentSettings
 * field without mirroring it here or allowlisting it in AUDIO_FIELD_NOT_MIRRORED fails
 * typecheck. Runtime shape is identical to the previous hand-written spread.
 */
const AUDIO_FIELD_MIRROR = {
  volume: true,
  device_id: true,
  exclusive_mode: true,
  eq_type: true,
  dither_enabled: true,
  loudness_enabled: true,
  loudness_mode: true,
  target_lufs: true,
  preamp_db: true,
  saturation_enabled: true,
  saturation_drive: true,
  saturation_mix: true,
  crossfeed_enabled: true,
  crossfeed_mix: true,
  dynamic_loudness_enabled: true,
  dynamic_loudness_strength: true,
  output_bits: true,
  noise_shaper_curve: true,
  target_samplerate: true,
  resample_quality: true,
  use_cache: true,
  preemptive_resample: true
} as const satisfies Partial<Record<keyof PlayerState, true>>;

/**
 * PersistentSettings fields that intentionally have no PlayerState mirror.
 * Each entry documents why the field stays settings-domain-only; the contract
 * below fails typecheck when a new PersistentSettings field is neither
 * mirrored nor allowlisted here.
 */
const AUDIO_FIELD_NOT_MIRRORED = {
  eq_bands:
    "EQ band gains are engine-settings-domain only; PlayerState exposes no live band state.",
  fir_taps:
    "FIR filter length is engine-settings-domain only; PlayerState exposes no FIR state.",
  streaming_first_buffer:
    "Streaming first-buffer policy is engine-settings-domain only; PlayerState carries no streaming flags.",
  streaming_pcm_window_limit_mib:
    "Streaming PCM window limit is engine-settings-domain only; PlayerState carries no streaming flags.",
  use_next_prefetch:
    "Next-track prefetch policy is engine-settings-domain only; PlayerState carries no prefetch flags."
} as const satisfies Partial<Record<keyof PersistentSettings, string>>;

type AudioMirrorField = keyof typeof AUDIO_FIELD_MIRROR;

type AudioEnginePersistentField = Exclude<
  keyof PersistentSettings,
  keyof typeof AUDIO_FIELD_NOT_MIRRORED
>;

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

type Expect<T extends true> = T;

/**
 * Compile-time contract: every audio-engine PersistentSettings field is either
 * explicitly mirrored into PlayerState (AUDIO_FIELD_MIRROR) or allowlisted as
 * intentionally not-mirrored (AUDIO_FIELD_NOT_MIRRORED), and no mirror key
 * leaks outside PlayerState. Mirrors the Equal/Expect pattern from
 * shared/api/ws.contract.ts.
 */
export type AudioFieldMirrorContract = Expect<
  Equal<AudioEnginePersistentField, AudioMirrorField>
>;

type AudioMirrorOverrides = { [K in AudioMirrorField]: PersistentSettings[K] };

export const applyEffectiveAudioSettingsToPlayerState = (
  player: PlayerState,
  settings: PersistentSettings
): PlayerState => {
  const overrides: AudioMirrorOverrides = {
    volume: settings.volume,
    device_id: settings.device_id,
    exclusive_mode: settings.exclusive_mode,
    eq_type: settings.eq_type,
    dither_enabled: settings.dither_enabled,
    loudness_enabled: settings.loudness_enabled,
    loudness_mode: settings.loudness_mode,
    target_lufs: settings.target_lufs,
    preamp_db: settings.preamp_db,
    saturation_enabled: settings.saturation_enabled,
    saturation_drive: settings.saturation_drive,
    saturation_mix: settings.saturation_mix,
    crossfeed_enabled: settings.crossfeed_enabled,
    crossfeed_mix: settings.crossfeed_mix,
    dynamic_loudness_enabled: settings.dynamic_loudness_enabled,
    dynamic_loudness_strength: settings.dynamic_loudness_strength,
    output_bits: settings.output_bits,
    noise_shaper_curve: settings.noise_shaper_curve,
    target_samplerate: settings.target_samplerate,
    resample_quality: settings.resample_quality,
    use_cache: settings.use_cache,
    preemptive_resample: settings.preemptive_resample
  };
  return { ...player, ...overrides };
};
