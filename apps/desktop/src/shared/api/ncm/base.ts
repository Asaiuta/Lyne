import { invalidateApiToken, resolveApiToken, resolveBaseUrl } from "../env";
import { fetchWithTimeout } from "../fetchWithTimeout";

export interface NcmRequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean | null | undefined>;
  data?: object | undefined;
  noCache?: boolean;
  allowErrorCodes?: readonly number[];
  /**
   * Per-request cookie override for login validation flows. `undefined`
   * lets the Rust proxy inject the active backend-owned cookie. A non-empty
   * string is sent once for this request. An explicit empty string suppresses
   * backend active-cookie injection for anonymous probes.
   */
  cookieOverride?: string;
}

export interface NcmResponseEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
  [key: string]: unknown;
}

const NCM_BASE_PATH = "/api/netease";
const SUPPRESS_ACTIVE_COOKIE_KEY = "_ncm_no_active_cookie";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const appendParams = (
  search: URLSearchParams,
  params: Record<string, string | number | boolean | null | undefined>
) => {
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }
    search.set(key, String(value));
  }
};

const buildUrl = (
  endpoint: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  noCache = false
) => {
  const trimmedBaseUrl = resolveBaseUrl().replace(/\/$/, "");
  const trimmedEndpoint = endpoint.replace(/^\/+/, "");
  const url = new URL(`${trimmedBaseUrl}${NCM_BASE_PATH}/${trimmedEndpoint}`);
  if (params) {
    appendParams(url.searchParams, params);
  }
  if (noCache) {
    url.searchParams.set("timestamp", String(Date.now()));
  }
  return url.toString();
};

export const parseNcmEnvelope = <T>(value: unknown): NcmResponseEnvelope<T> => {
  if (!isRecord(value)) {
    throw new Error("Invalid NCM response shape");
  }
  return value as NcmResponseEnvelope<T>;
};

export const readNcmHttpErrorMessage = async (response: Response): Promise<string> => {
  const fallback = `NCM request failed: ${response.status}`;
  const text = await response.text().catch(() => "");
  if (!text.trim()) {
    return fallback;
  }

  try {
    const value = JSON.parse(text) as unknown;
    if (isRecord(value)) {
      const msg = value.msg;
      if (typeof msg === "string" && msg.trim()) {
        return msg;
      }
      const message = value.message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  } catch {
    // Fall through to returning the upstream text when it is not JSON.
  }

  return text.trim();
};

export const requestNcm = async <T = unknown>(
  endpoint: string,
  options: NcmRequestOptions = {}
): Promise<NcmResponseEnvelope<T>> => {
  const method = options.method ?? "POST";
  const runRequest = async (forceTokenRefresh: boolean) => {
    const token = await resolveApiToken(forceTokenRefresh);
    const headers = new Headers();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const cookieOverride = (() => {
      if (typeof options.cookieOverride === "string") {
        const trimmed = options.cookieOverride.trim();
        return {
          cookie: trimmed.length > 0 ? trimmed : null,
          suppressActiveCookie: trimmed.length === 0
        };
      }
      return { cookie: null, suppressActiveCookie: false };
    })();

    let body: string | undefined;
    if (method === "POST") {
      headers.set("Content-Type", "application/json");
      const dataPayload = isRecord(options.data) ? options.data : {};
      const merged: Record<string, unknown> = {
        ...dataPayload,
        ...(cookieOverride.cookie ? { cookie: cookieOverride.cookie } : {}),
        ...(cookieOverride.suppressActiveCookie ? { [SUPPRESS_ACTIVE_COOKIE_KEY]: true } : {})
      };
      body = JSON.stringify(merged);
    }

    const finalParams: Record<string, string | number | boolean | null | undefined> | undefined =
      method === "POST" || (!cookieOverride.cookie && !cookieOverride.suppressActiveCookie)
        ? options.params
        : {
            ...(options.params ?? {}),
            ...(cookieOverride.cookie ? { cookie: cookieOverride.cookie } : {}),
            ...(cookieOverride.suppressActiveCookie ? { [SUPPRESS_ACTIVE_COOKIE_KEY]: true } : {})
          };

    return fetchWithTimeout(buildUrl(endpoint, finalParams, options.noCache), {
      method,
      headers,
      body,
      credentials: "include"
    });
  };

  let response = await runRequest(false);
  if (response.status === 401) {
    invalidateApiToken();
    response = await runRequest(true);
  }

  if (!response.ok) {
    throw new Error(await readNcmHttpErrorMessage(response));
  }

  const json = (await response.json()) as unknown;
  const envelope = parseNcmEnvelope<T>(json);
  const code = typeof envelope.code === "number" ? envelope.code : null;
  if (code !== null && code >= 400 && !options.allowErrorCodes?.includes(code)) {
    throw new Error(typeof envelope.msg === "string" ? envelope.msg : `NCM request failed: ${code}`);
  }
  return envelope;
};
