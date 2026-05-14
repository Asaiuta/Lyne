import type { ApiEnvelope, DevicesResponse, PlayerState, RepeatMode, ShuffleMode } from "./types";

export interface LoadOptions {
  autoplay?: boolean;
}

export interface PlaybackApiClient {
  getState: () => Promise<PlayerState>;
  play: () => Promise<PlayerState>;
  pause: () => Promise<PlayerState>;
  stop: () => Promise<PlayerState>;
  load: (path: string, options?: LoadOptions) => Promise<PlayerState>;
  seek: (position: number) => Promise<PlayerState>;
  setVolume: (volume: number) => Promise<PlayerState>;
  setRepeatMode: (mode: RepeatMode) => Promise<PlayerState>;
  setShuffleMode: (mode: ShuffleMode) => Promise<PlayerState>;
  listDevices: () => Promise<DevicesResponse>;
  configureOutput: (deviceId: number | null, exclusive?: boolean) => Promise<PlayerState>;
}

export type PlaybackRequestEnvelope = (path: string, init?: RequestInit) => Promise<ApiEnvelope>;

export interface PlaybackApiTransport {
  requestEnvelope: PlaybackRequestEnvelope;
}

const requireState = (envelope: ApiEnvelope, fallback: string): PlayerState => {
  if (envelope.status === "error") {
    throw new Error(envelope.message ?? fallback);
  }
  if (!envelope.state) {
    throw new Error("State missing from response");
  }
  return envelope.state;
};

const requireDevices = (envelope: ApiEnvelope, fallback: string): DevicesResponse => {
  if (envelope.status === "error") {
    throw new Error(envelope.message ?? fallback);
  }
  if (!envelope.devices) {
    throw new Error("Devices missing from response");
  }
  return envelope.devices;
};

const postJson = (body: object): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body)
});

export const createPlaybackApiClient = (transport: PlaybackApiTransport): PlaybackApiClient => ({
  getState: async () => requireState(await transport.requestEnvelope("/state"), "Failed to fetch state"),
  play: async () => requireState(await transport.requestEnvelope("/play", { method: "POST" }), "Failed to play"),
  pause: async () => requireState(await transport.requestEnvelope("/pause", { method: "POST" }), "Failed to pause"),
  stop: async () => requireState(await transport.requestEnvelope("/stop", { method: "POST" }), "Failed to stop"),
  load: async (path, options) =>
    requireState(
      await transport.requestEnvelope(
        "/load",
        postJson({
          path,
          ...(options?.autoplay ? { autoplay: true } : {})
        })
      ),
      "Failed to load"
    ),
  seek: async (position) =>
    requireState(await transport.requestEnvelope("/seek", postJson({ position })), "Failed to seek"),
  setVolume: async (volume) =>
    requireState(await transport.requestEnvelope("/volume", postJson({ volume })), "Failed to set volume"),
  setRepeatMode: async (mode) =>
    requireState(await transport.requestEnvelope("/repeat", postJson({ mode })), "Failed to set repeat mode"),
  setShuffleMode: async (mode) =>
    requireState(await transport.requestEnvelope("/shuffle", postJson({ mode })), "Failed to set shuffle mode"),
  listDevices: async () => requireDevices(await transport.requestEnvelope("/devices"), "Failed to list devices"),
  configureOutput: async (deviceId, exclusive = false) =>
    requireState(
      await transport.requestEnvelope("/configure_output", postJson({ device_id: deviceId, exclusive })),
      "Failed to configure output"
    )
});
