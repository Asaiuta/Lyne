export const DEFAULT_MESSAGE_DURATION_MS = 3000;
export const DEFAULT_NOTIFICATION_DURATION_MS = 4500;
export const LOADING_BAR_HIDE_DELAY_MS = 650;

export type NaiveLoadingBarStatus = "idle" | "loading" | "success" | "error";

export interface NaiveLoadingBarState {
  visible: boolean;
  status: NaiveLoadingBarStatus;
  progress: number;
}

export const normalizeFeedbackDuration = (
  duration: number | undefined,
  fallback: number
): number => {
  if (duration == null || !Number.isFinite(duration)) return fallback;
  return Math.max(0, duration);
};

export const createLoadingBarState = (
  status: NaiveLoadingBarStatus,
  progress = 0
): NaiveLoadingBarState => ({
  visible: status !== "idle",
  status,
  progress: Math.min(100, Math.max(0, progress))
});
