import type { UISettings } from "../../shared/state/uiSettingsModel";
import { clearCacheFetchMemoryByPrefix } from "../../shared/state/cacheFetch";

export type OnlineServiceModeChangeStatus =
  | "applied"
  | "cancelled"
  | "failed"
  | "unchanged";

export interface OnlineServiceModeChangeResult {
  readonly status: OnlineServiceModeChangeStatus;
  readonly resetError?: unknown;
}

export interface OnlineServiceModeChangeRuntime {
  readonly confirmChange: (nextEnabled: boolean) => Promise<boolean>;
  readonly currentValue: () => boolean;
  readonly persistValue: (nextEnabled: boolean) => boolean;
  readonly reloadApp: () => void;
  readonly reportResetError?: (error: unknown) => void;
  readonly resetOnlineRuntimeState: () => Promise<void>;
}

export interface TaskbarProgressRuntime {
  readonly clearTaskbarProgress: () => Promise<void>;
  readonly persistValue: (nextEnabled: boolean) => boolean;
  readonly reportError?: (error: unknown) => void;
}

export interface UpdateChannelRuntime {
  readonly persistValue: (nextChannel: UISettings["updateChannel"]) => boolean;
  readonly requestUpdateCheck: (nextChannel: UISettings["updateChannel"]) => void;
}

export async function requestOnlineServiceModeChange(
  nextEnabled: boolean,
  runtime: OnlineServiceModeChangeRuntime
): Promise<OnlineServiceModeChangeResult> {
  if (runtime.currentValue() === nextEnabled) {
    return { status: "unchanged" };
  }

  if (!(await runtime.confirmChange(nextEnabled))) {
    return { status: "cancelled" };
  }

  if (!runtime.persistValue(nextEnabled)) {
    return { status: "failed" };
  }

  try {
    await runtime.resetOnlineRuntimeState();
  } catch (error) {
    runtime.reportResetError?.(error);
    runtime.reloadApp();
    return { status: "applied", resetError: error };
  }

  runtime.reloadApp();
  return { status: "applied" };
}

export function setTaskbarProgressPreference(
  nextEnabled: boolean,
  runtime: TaskbarProgressRuntime
): boolean {
  if (!runtime.persistValue(nextEnabled)) {
    return false;
  }

  if (!nextEnabled) {
    void runtime.clearTaskbarProgress().catch((error: unknown) => {
      runtime.reportError?.(error);
    });
  }

  return true;
}

export function setUpdateChannelPreference(
  nextChannel: UISettings["updateChannel"],
  runtime: UpdateChannelRuntime
): boolean {
  if (!runtime.persistValue(nextChannel)) {
    return false;
  }

  runtime.requestUpdateCheck(nextChannel);
  return true;
}

export function clearBrowserSessionCacheByPrefix(prefix: string): void {
  clearCacheFetchMemoryByPrefix(prefix);

  if (typeof window === "undefined") {
    return;
  }

  try {
    const storage = window.sessionStorage;
    const matchingKeys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key !== null && key.startsWith(prefix));
    matchingKeys.forEach((key) => storage.removeItem(key));
  } catch {
    // Session cache cleanup is best-effort; the mode change still reloads the app.
  }
}
