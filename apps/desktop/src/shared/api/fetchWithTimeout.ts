export const DEFAULT_API_REQUEST_TIMEOUT_MS = 30_000;

const createAbortError = (message: string, name: "AbortError" | "TimeoutError") => {
  if (typeof DOMException === "function") {
    return new DOMException(message, name);
  }
  const error = new Error(message);
  error.name = name;
  return error;
};

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_API_REQUEST_TIMEOUT_MS
): Promise<Response> => {
  if (timeoutMs <= 0) {
    return fetch(input, init);
  }

  const callerSignal = init.signal;
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => {
    controller.abort(callerSignal?.reason ?? createAbortError("Request aborted", "AbortError"));
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  }

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(
      createAbortError(`Request timed out after ${timeoutMs} ms`, "TimeoutError")
    );
  }, timeoutMs);

  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (timedOut) {
      throw createAbortError(`Request timed out after ${timeoutMs} ms`, "TimeoutError");
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
};
