import type { ApiEnvelope, PlayerState } from "./types";
import { isBoolean, isNumber, isRecord, isString } from "./ncmParserUtils";

export const EFFECTS_API_ROUTES = {
  setEq: { method: "POST", path: "/set_eq" },
  setEqType: { method: "POST", path: "/set_eq_type" },
  configureOptimizations: { method: "POST", path: "/configure_optimizations" },
  getCrossfeed: { method: "GET", path: "/crossfeed" },
  setCrossfeed: { method: "POST", path: "/set_crossfeed" },
  getSaturation: { method: "GET", path: "/saturation" },
  setSaturation: { method: "POST", path: "/set_saturation" },
  getDynamicLoudness: { method: "GET", path: "/dynamic_loudness" },
  setDynamicLoudness: { method: "POST", path: "/set_dynamic_loudness" },
  getNoiseShaperCurve: { method: "GET", path: "/noise_shaper_curve" },
  setNoiseShaperCurve: { method: "POST", path: "/set_noise_shaper_curve" },
  configureOutputBits: { method: "POST", path: "/configure_output_bits" }
} as const;

export type EffectsApiMethod = keyof typeof EFFECTS_API_ROUTES;
export type EffectsApiRoute = (typeof EFFECTS_API_ROUTES)[EffectsApiMethod];

export type EffectsRequestJson = (path: string, init?: RequestInit) => Promise<unknown>;
export type EffectsRequestEnvelope = (path: string, init?: RequestInit) => Promise<ApiEnvelope>;

export interface EffectsApiTransport {
  requestJson: EffectsRequestJson;
  requestEnvelope: EffectsRequestEnvelope;
}

export interface EffectsApiClient {
  setEq: (input: SetEqInput) => Promise<PlayerState>;
  setEqType: (input: SetEqTypeInput) => Promise<StatusMessageResponse>;
  configureOptimizations: (input: ConfigureOptimizationsInput) => Promise<PlayerState>;
  getCrossfeed: () => Promise<CrossfeedResponse>;
  setCrossfeed: (input: SetCrossfeedInput) => Promise<CrossfeedResponse>;
  getSaturation: () => Promise<SaturationResponse>;
  setSaturation: (input: SetSaturationInput) => Promise<SaturationResponse>;
  getDynamicLoudness: () => Promise<DynamicLoudnessResponse>;
  setDynamicLoudness: (input: SetDynamicLoudnessInput) => Promise<DynamicLoudnessResponse>;
  getNoiseShaperCurve: () => Promise<NoiseShaperResponse>;
  setNoiseShaperCurve: (input: SetNoiseShaperCurveInput) => Promise<NoiseShaperResponse>;
  configureOutputBits: (input: ConfigureOutputBitsInput) => Promise<StatusMessageResponse>;
}

export interface SetEqInput {
  bands?: Record<string, number>;
  enabled?: boolean;
}

export interface SetEqTypeInput {
  type: "IIR" | "FIR";
  fir_taps?: number;
}

export interface ConfigureOptimizationsInput {
  dither_enabled?: boolean;
  replaygain_enabled?: boolean;
}

export interface CrossfeedSettings {
  enabled: boolean;
  mix: number;
}

export interface SetCrossfeedInput {
  enabled?: boolean;
  mix?: number;
}

export interface SaturationSettings {
  enabled: boolean;
  drive: number;
  threshold: number;
  mix: number;
  input_gain_db: number;
  output_gain_db: number;
  highpass_mode: boolean;
  highpass_cutoff: number;
  sat_type?: string;
}

export interface SetSaturationInput {
  enabled?: boolean;
  drive?: number;
  threshold?: number;
  mix?: number;
  input_gain_db?: number;
  output_gain_db?: number;
  highpass_mode?: boolean;
  highpass_cutoff?: number;
}

export interface DynamicLoudnessSettings {
  enabled: boolean;
  strength: number;
  factor: number;
  band_gains: readonly number[];
}

export interface SetDynamicLoudnessInput {
  enabled?: boolean;
  strength?: number;
}

export type NoiseShaperCurve =
  | "Lipshitz5"
  | "FWeighted9"
  | "ModifiedE9"
  | "ImprovedE9"
  | "TpdfOnly";

export interface NoiseShaperSettings {
  curve: string;
  enabled: boolean;
  bits: number;
}

export interface SetNoiseShaperCurveInput {
  curve: NoiseShaperCurve;
}

export interface ConfigureOutputBitsInput {
  bits: 16 | 24 | 32;
}

export interface StatusMessageResponse {
  status: "success" | "error";
  message: string | null;
}

export interface CrossfeedResponse extends StatusMessageResponse {
  crossfeed: CrossfeedSettings;
}

export interface SaturationResponse extends StatusMessageResponse {
  saturation: SaturationSettings;
}

export interface DynamicLoudnessResponse extends StatusMessageResponse {
  dynamic_loudness: DynamicLoudnessSettings;
}

export interface NoiseShaperResponse extends StatusMessageResponse {
  noise_shaper: NoiseShaperSettings;
}

const parseStatus = (value: unknown): "success" | "error" => {
  if (value === "success" || value === "error") {
    return value;
  }
  throw new Error("Invalid effects response status");
};

const parseStatusMessage = (value: Record<string, unknown>): StatusMessageResponse => ({
  status: parseStatus(value.status),
  message: isString(value.message) ? value.message : null
});

const requireSuccess = (response: StatusMessageResponse, fallback: string) => {
  if (response.status === "error") {
    throw new Error(response.message ?? fallback);
  }
};

const parseCrossfeedSettings = (value: unknown): CrossfeedSettings | null => {
  if (!isRecord(value) || !isBoolean(value.enabled) || !isNumber(value.mix)) {
    return null;
  }
  return { enabled: value.enabled, mix: value.mix };
};

const parseSaturationSettings = (value: unknown): SaturationSettings | null => {
  if (
    !isRecord(value) ||
    !isBoolean(value.enabled) ||
    !isNumber(value.drive) ||
    !isNumber(value.threshold) ||
    !isNumber(value.mix) ||
    !isNumber(value.input_gain_db) ||
    !isNumber(value.output_gain_db) ||
    !isBoolean(value.highpass_mode) ||
    !isNumber(value.highpass_cutoff)
  ) {
    return null;
  }

  return {
    enabled: value.enabled,
    drive: value.drive,
    threshold: value.threshold,
    mix: value.mix,
    input_gain_db: value.input_gain_db,
    output_gain_db: value.output_gain_db,
    highpass_mode: value.highpass_mode,
    highpass_cutoff: value.highpass_cutoff,
    sat_type: isString(value.sat_type) ? value.sat_type : undefined
  };
};

const parseDynamicLoudnessSettings = (value: unknown): DynamicLoudnessSettings | null => {
  if (
    !isRecord(value) ||
    !isBoolean(value.enabled) ||
    !isNumber(value.strength) ||
    !isNumber(value.factor) ||
    !Array.isArray(value.band_gains) ||
    !value.band_gains.every(isNumber)
  ) {
    return null;
  }

  return {
    enabled: value.enabled,
    strength: value.strength,
    factor: value.factor,
    band_gains: value.band_gains
  };
};

const parseNoiseShaperSettings = (value: unknown): NoiseShaperSettings | null => {
  if (!isRecord(value) || !isString(value.curve) || !isBoolean(value.enabled) || !isNumber(value.bits)) {
    return null;
  }
  return { curve: value.curve, enabled: value.enabled, bits: value.bits };
};

const parsePayloadResponse = <T>(
  value: unknown,
  key: string,
  parser: (value: unknown) => T | null,
  errorMessage: string
): { response: StatusMessageResponse; payload: T } => {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }
  const response = parseStatusMessage(value);
  requireSuccess(response, errorMessage);
  const payload = parser(value[key]);
  if (!payload) {
    throw new Error(errorMessage);
  }
  return { response, payload };
};

const parseStatusResponse = (value: unknown, errorMessage: string): StatusMessageResponse => {
  if (!isRecord(value)) {
    throw new Error(errorMessage);
  }
  const response = parseStatusMessage(value);
  requireSuccess(response, errorMessage);
  return response;
};

const requireState = (envelope: ApiEnvelope, fallback: string): PlayerState => {
  if (envelope.status === "error") {
    throw new Error(envelope.message ?? fallback);
  }
  if (!envelope.state) {
    throw new Error("State missing from effects response");
  }
  return envelope.state;
};

const postJson = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body)
});

export const setEq = async (transport: EffectsApiTransport, input: SetEqInput): Promise<PlayerState> => {
  const envelope = await transport.requestEnvelope(EFFECTS_API_ROUTES.setEq.path, postJson(input));
  return requireState(envelope, "Failed to update EQ");
};

export const setEqType = async (
  transport: EffectsApiTransport,
  input: SetEqTypeInput
): Promise<StatusMessageResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.setEqType.path, postJson(input));
  return parseStatusResponse(json, "Failed to set EQ type");
};

export const configureOptimizations = async (
  transport: EffectsApiTransport,
  input: ConfigureOptimizationsInput
): Promise<PlayerState> => {
  const envelope = await transport.requestEnvelope(
    EFFECTS_API_ROUTES.configureOptimizations.path,
    postJson(input)
  );
  return requireState(envelope, "Failed to configure optimizations");
};

export const getCrossfeed = async (transport: EffectsApiTransport): Promise<CrossfeedResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.getCrossfeed.path);
  const { response, payload } = parsePayloadResponse(
    json,
    "crossfeed",
    parseCrossfeedSettings,
    "Invalid crossfeed response"
  );
  return { ...response, crossfeed: payload };
};

export const setCrossfeed = async (
  transport: EffectsApiTransport,
  input: SetCrossfeedInput
): Promise<CrossfeedResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.setCrossfeed.path, postJson(input));
  const { response, payload } = parsePayloadResponse(
    json,
    "crossfeed",
    parseCrossfeedSettings,
    "Invalid crossfeed response"
  );
  return { ...response, crossfeed: payload };
};

export const getSaturation = async (transport: EffectsApiTransport): Promise<SaturationResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.getSaturation.path);
  const { response, payload } = parsePayloadResponse(
    json,
    "saturation",
    parseSaturationSettings,
    "Invalid saturation response"
  );
  return { ...response, saturation: payload };
};

export const setSaturation = async (
  transport: EffectsApiTransport,
  input: SetSaturationInput
): Promise<SaturationResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.setSaturation.path, postJson(input));
  const { response, payload } = parsePayloadResponse(
    json,
    "saturation",
    parseSaturationSettings,
    "Invalid saturation response"
  );
  return { ...response, saturation: payload };
};

export const getDynamicLoudness = async (
  transport: EffectsApiTransport
): Promise<DynamicLoudnessResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.getDynamicLoudness.path);
  const { response, payload } = parsePayloadResponse(
    json,
    "dynamic_loudness",
    parseDynamicLoudnessSettings,
    "Invalid dynamic loudness response"
  );
  return { ...response, dynamic_loudness: payload };
};

export const setDynamicLoudness = async (
  transport: EffectsApiTransport,
  input: SetDynamicLoudnessInput
): Promise<DynamicLoudnessResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.setDynamicLoudness.path, postJson(input));
  const { response, payload } = parsePayloadResponse(
    json,
    "dynamic_loudness",
    parseDynamicLoudnessSettings,
    "Invalid dynamic loudness response"
  );
  return { ...response, dynamic_loudness: payload };
};

export const getNoiseShaperCurve = async (
  transport: EffectsApiTransport
): Promise<NoiseShaperResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.getNoiseShaperCurve.path);
  const { response, payload } = parsePayloadResponse(
    json,
    "noise_shaper",
    parseNoiseShaperSettings,
    "Invalid noise shaper response"
  );
  return { ...response, noise_shaper: payload };
};

export const setNoiseShaperCurve = async (
  transport: EffectsApiTransport,
  input: SetNoiseShaperCurveInput
): Promise<NoiseShaperResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.setNoiseShaperCurve.path, postJson(input));
  const { response, payload } = parsePayloadResponse(
    json,
    "noise_shaper",
    parseNoiseShaperSettings,
    "Invalid noise shaper response"
  );
  return { ...response, noise_shaper: payload };
};

export const configureOutputBits = async (
  transport: EffectsApiTransport,
  input: ConfigureOutputBitsInput
): Promise<StatusMessageResponse> => {
  const json = await transport.requestJson(EFFECTS_API_ROUTES.configureOutputBits.path, postJson(input));
  return parseStatusResponse(json, "Failed to configure output bits");
};

export const createEffectsApiClient = (transport: EffectsApiTransport): EffectsApiClient => ({
  setEq: (input) => setEq(transport, input),
  setEqType: (input) => setEqType(transport, input),
  configureOptimizations: (input) => configureOptimizations(transport, input),
  getCrossfeed: () => getCrossfeed(transport),
  setCrossfeed: (input) => setCrossfeed(transport, input),
  getSaturation: () => getSaturation(transport),
  setSaturation: (input) => setSaturation(transport, input),
  getDynamicLoudness: () => getDynamicLoudness(transport),
  setDynamicLoudness: (input) => setDynamicLoudness(transport, input),
  getNoiseShaperCurve: () => getNoiseShaperCurve(transport),
  setNoiseShaperCurve: (input) => setNoiseShaperCurve(transport, input),
  configureOutputBits: (input) => configureOutputBits(transport, input)
});
