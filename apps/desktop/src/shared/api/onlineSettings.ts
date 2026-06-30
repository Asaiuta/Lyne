import { isBoolean, isNumber, isRecord, isString } from "./ncmParserUtils";

/**
 * Application-level online settings (NetEase Cloud Music resolve / cache).
 * Mirrors the backend `OnlineSettings` (src/server/online_settings.rs), which
 * is deliberately separate from the DSP `EngineSettings`.
 */
export interface OnlineSettings {
  cacheEnabled: boolean;
  cacheMaxBytes: number;
  qualityFallbackEnabled: boolean;
  allowTrialPlayback: boolean;
  defaultLevel: string;
}

export interface OnlineSettingsApiClient {
  getOnlineSettings: () => Promise<OnlineSettings>;
  saveOnlineSettings: (settings: OnlineSettings) => Promise<OnlineSettings>;
}

export type OnlineSettingsRequestJson = (path: string, init?: RequestInit) => Promise<unknown>;

export interface OnlineSettingsApiTransport {
  requestJson: OnlineSettingsRequestJson;
}

const parseOnlineSettings = (value: unknown): OnlineSettings => {
  if (
    !isRecord(value) ||
    !isBoolean(value.cache_enabled) ||
    !isNumber(value.cache_max_bytes) ||
    !isBoolean(value.quality_fallback_enabled) ||
    !isBoolean(value.allow_trial_playback) ||
    !isString(value.default_level)
  ) {
    throw new Error("Invalid online settings payload");
  }
  return {
    cacheEnabled: value.cache_enabled,
    cacheMaxBytes: value.cache_max_bytes,
    qualityFallbackEnabled: value.quality_fallback_enabled,
    allowTrialPlayback: value.allow_trial_playback,
    defaultLevel: value.default_level
  };
};

const parseOnlineSettingsResponse = (value: unknown): OnlineSettings => {
  if (!isRecord(value)) {
    throw new Error("Invalid online settings response shape");
  }
  if (value.status === "error") {
    throw new Error(
      typeof value.message === "string" ? value.message : "Failed to fetch online settings"
    );
  }
  return parseOnlineSettings(value.settings);
};

const toWire = (settings: OnlineSettings): Record<string, unknown> => ({
  cache_enabled: settings.cacheEnabled,
  cache_max_bytes: settings.cacheMaxBytes,
  quality_fallback_enabled: settings.qualityFallbackEnabled,
  allow_trial_playback: settings.allowTrialPlayback,
  default_level: settings.defaultLevel
});

const postJson = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body)
});

export const createOnlineSettingsApiClient = (
  transport: OnlineSettingsApiTransport
): OnlineSettingsApiClient => ({
  getOnlineSettings: async () =>
    parseOnlineSettingsResponse(await transport.requestJson("/online_settings")),
  saveOnlineSettings: async (settings) =>
    parseOnlineSettingsResponse(
      await transport.requestJson("/online_settings", postJson(toWire(settings)))
    )
});
