import { invoke, isTauri } from "@tauri-apps/api/core";
import { createSignal, untrack } from "solid-js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "18083";
const API_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface ApiRuntimeConfig {
  readonly baseUrl: string;
  readonly port: number;
  readonly token: string;
}

const readEnv = (key: string): string | undefined => {
  const value = import.meta.env[key] as string | undefined;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, "");

const readErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseBaseUrl = (value: string, port: number): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`Invalid API runtime baseUrl '${value}': ${readErrorMessage(error)}`);
  }

  const normalized = trimTrailingSlash(value);
  if (
    url.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.port !== String(port) ||
    normalized !== url.origin
  ) {
    throw new Error(
      `Invalid API runtime baseUrl '${value}': expected a loopback HTTP origin using port ${port}.`
    );
  }

  return normalized;
};

export const parseApiRuntimeConfig = (value: unknown): ApiRuntimeConfig => {
  if (!isRecord(value)) {
    throw new Error("Invalid API runtime config: expected an object.");
  }

  const { baseUrl, port, token } = value;
  if (typeof baseUrl !== "string") {
    throw new Error("Invalid API runtime config: baseUrl must be a string.");
  }
  if (!Number.isInteger(port) || typeof port !== "number" || port < 1 || port > 65_535) {
    throw new Error("Invalid API runtime config: port must be an integer between 1 and 65535.");
  }
  if (typeof token !== "string" || !API_TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid API runtime config: token must be a 64-character hexadecimal string.");
  }

  return {
    baseUrl: parseBaseUrl(baseUrl, port),
    port,
    token
  };
};

const resolveBuildTimeBaseUrl = (): string => {
  const direct = readEnv("VITE_AUDIO_SERVER_URL");
  if (direct) {
    return trimTrailingSlash(direct);
  }

  const host = readEnv("VITE_AUDIO_SERVER_HOST") ?? DEFAULT_HOST;
  const port = readEnv("VITE_AUDIO_SERVER_PORT") ?? DEFAULT_PORT;
  return `http://${host}:${port}`;
};

const createBrowserRuntimeConfig = (): ApiRuntimeConfig => {
  const baseUrl = resolveBuildTimeBaseUrl();
  const url = new URL(baseUrl);
  const fallbackPort = url.protocol === "https:" ? 443 : 80;
  const parsedPort = url.port.length > 0 ? Number(url.port) : fallbackPort;
  const token = readEnv("VITE_AUDIO_API_TOKEN") ?? "";

  if (!token) {
    console.warn(
      "[env] Running outside Tauri without VITE_AUDIO_API_TOKEN; authenticated audio requests will fail."
    );
  }

  return {
    baseUrl,
    port: parsedPort,
    token
  };
};

const [apiRuntimeSignal, setApiRuntimeSignal] = createSignal<ApiRuntimeConfig | null>(null);
let apiRuntimePromise: Promise<ApiRuntimeConfig> | null = null;

const fetchApiRuntimeConfig = async (): Promise<ApiRuntimeConfig> => {
  if (!isTauri()) {
    return createBrowserRuntimeConfig();
  }

  let value: unknown;
  try {
    value = await invoke<unknown>("get_api_runtime_config");
  } catch (error) {
    throw new Error(`Failed to initialize the audio sidecar: ${readErrorMessage(error)}`);
  }
  return parseApiRuntimeConfig(value);
};

/**
 * Resolve the endpoint and bearer token as one runtime contract. The renderer
 * bootstrap awaits this before importing window modules, so module-level API
 * clients capture the selected Tauri port instead of a build-time fallback.
 */
export const initializeApiRuntime = (forceRefresh = false): Promise<ApiRuntimeConfig> => {
  if (forceRefresh) {
    apiRuntimePromise = null;
  } else {
    const cached = untrack(apiRuntimeSignal);
    if (cached) {
      return Promise.resolve(cached);
    }
  }

  if (apiRuntimePromise === null) {
    apiRuntimePromise = fetchApiRuntimeConfig()
      .then((config) => {
        setApiRuntimeSignal(config);
        return config;
      })
      .catch((error: unknown) => {
        apiRuntimePromise = null;
        throw error;
      });
  }
  return apiRuntimePromise;
};

export const resolveBaseUrl = (): string =>
  apiRuntimeSignal()?.baseUrl ?? resolveBuildTimeBaseUrl();

export const resolveWsUrl = (): string => {
  const runtime = apiRuntimeSignal();
  if (!runtime) {
    const direct = readEnv("VITE_AUDIO_SERVER_WS_URL");
    if (direct) {
      return trimTrailingSlash(direct);
    }
  }

  const base = runtime?.baseUrl ?? resolveBuildTimeBaseUrl();
  const wsBase = base.replace(/^http(s)?/i, (match) =>
    match.toLowerCase() === "https" ? "wss" : "ws"
  );
  return `${wsBase}/ws`;
};

export const invalidateApiToken = (): void => {
  const runtime = untrack(apiRuntimeSignal);
  if (runtime) {
    setApiRuntimeSignal({ ...runtime, token: "" });
  }
  apiRuntimePromise = null;
};

export const resolveApiToken = async (forceRefresh = false): Promise<string> =>
  (await initializeApiRuntime(forceRefresh)).token;

/**
 * Synchronous reactive accessor used by cover-art URLs and other consumers
 * that cannot await. The bootstrap normally populates it before window modules
 * evaluate; a forced auth refresh temporarily exposes an empty token.
 */
export const peekApiToken = (): string => apiRuntimeSignal()?.token ?? "";
