import { invalidateApiToken, resolveApiToken } from "./env";
import type { ApiEnvelope } from "./types";

export type ParseApiEnvelope = (value: unknown) => ApiEnvelope;

export const requestJson = async (baseUrl: string, path: string, init?: RequestInit): Promise<unknown> => {
  const runRequest = async (forceTokenRefresh: boolean) => {
    const token = await resolveApiToken(forceTokenRefresh);
    const headers = new Headers(init?.headers ?? {});
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers
    });
  };

  let response = await runRequest(false);
  if (response.status === 401) {
    invalidateApiToken();
    response = await runRequest(true);
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const body = (await response.json()) as unknown;
      if (
        typeof body === "object" &&
        body !== null &&
        "message" in body &&
        typeof body.message === "string" &&
        body.message.trim().length > 0
      ) {
        message = body.message;
      }
    } catch {
      // Keep the status-only fallback when the server did not return JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as unknown;
};

export const requestEnvelope = async (
  baseUrl: string,
  path: string,
  parseEnvelope: ParseApiEnvelope,
  init?: RequestInit
): Promise<ApiEnvelope> => {
  const json = await requestJson(baseUrl, path, init);
  return parseEnvelope(json);
};
