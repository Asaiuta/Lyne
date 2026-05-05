import { invalidateApiToken, resolveApiToken, resolveBaseUrl } from "../env";

export interface NcmRequestOptions {
  method?: "GET" | "POST";
  params?: Record<string, string | number | boolean | null | undefined>;
  data?: object | undefined;
  noCache?: boolean;
}

export interface NcmResponseEnvelope<T = unknown> {
  code?: number;
  msg?: string;
  data?: T;
  [key: string]: unknown;
}

const NCM_BASE_PATH = "/api/netease";

/**
 * Module-level injection slot for the active NCM session cookie.
 *
 * The `NcmAccountProvider` keeps this in sync with `activeAccount().cookie`
 * via a `createEffect`. When non-null, every subsequent `requestNcm` call
 * carries `cookie=<value>` (POST → JSON body, GET → query string) so the
 * backend `apply_query_overrides` can lift it into `Query.cookie` and
 * authoritatively override the HTTP `Cookie` header. That mechanism is what
 * makes multi-account switching work without juggling `document.cookie`.
 *
 * Why a module-level mutable instead of threading a cookie param through
 * every wrapper signature: the cookie is cross-cutting (every call needs
 * it) and the alternative would touch ~20 wrapper signatures + every call
 * site. The trade-off is "global mutable" but only one writer (the
 * provider effect) and one reader (this file) — well-contained.
 */
let activeNcmCookie: string | null = null;

export const setActiveNcmCookie = (cookie: string | null): void => {
  const trimmed = typeof cookie === "string" ? cookie.trim() : "";
  activeNcmCookie = trimmed.length > 0 ? trimmed : null;
};

export const getActiveNcmCookie = (): string | null => activeNcmCookie;

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

    // Snapshot the active cookie at request time. Concurrent calls during a
    // switch get whatever value is set when they hit this line — acceptable
    // because the provider's `switchActive` awaits a refresh before resolving.
    const cookieToInject = activeNcmCookie;

    let body: string | undefined;
    if (method === "POST") {
      headers.set("Content-Type", "application/json");
      const dataPayload = isRecord(options.data) ? options.data : {};
      const merged: Record<string, unknown> = cookieToInject
        ? { ...dataPayload, cookie: cookieToInject }
        : dataPayload;
      body = JSON.stringify(merged);
    }

    const finalParams: Record<string, string | number | boolean | null | undefined> | undefined =
      method === "POST" || cookieToInject === null
        ? options.params
        : { ...(options.params ?? {}), cookie: cookieToInject };

    return fetch(buildUrl(endpoint, finalParams, options.noCache), {
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
    throw new Error(`NCM request failed: ${response.status}`);
  }

  const json = (await response.json()) as unknown;
  const envelope = parseNcmEnvelope<T>(json);
  const code = typeof envelope.code === "number" ? envelope.code : null;
  if (code !== null && code >= 400) {
    throw new Error(typeof envelope.msg === "string" ? envelope.msg : `NCM request failed: ${code}`);
  }
  return envelope;
};
