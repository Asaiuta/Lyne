import { invalidateApiToken, resolveApiToken } from "./env";
import { fetchWithTimeout } from "./fetchWithTimeout";
import type { ApiEnvelope } from "./types";

export type ParseApiEnvelope = (value: unknown) => ApiEnvelope;

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiHttpError";
    this.status = status;
    this.body = body;
  }
}

const readFetchFailureMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "Unknown network error";
};

const createFetchFailureError = (path: string, error: unknown): Error =>
  new Error(
    `Request to ${path} failed before receiving a response: ${readFetchFailureMessage(error)}`
  );

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
    return fetchWithTimeout(`${baseUrl}${path}`, {
      ...init,
      headers
    });
  };

  let response: Response;
  try {
    response = await runRequest(false);
  } catch (error) {
    throw createFetchFailureError(path, error);
  }

  if (response.status === 401) {
    invalidateApiToken();
    try {
      response = await runRequest(true);
    } catch (error) {
      throw createFetchFailureError(path, error);
    }
  }

  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
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
    throw new ApiHttpError(response.status, message, body);
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
