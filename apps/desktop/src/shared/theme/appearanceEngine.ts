import { createRoot, createSignal } from "solid-js";

export const APPEARANCE_MODES = [
  "solid",
  "cover-blur",
  "cover-immersive",
  "particles",
  "vinyl"
] as const;

export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export const APPEARANCE_MODE_EVENT = "audio-appearance-mode";
const APPEARANCE_MODE_STORAGE_KEY = "ui.appearance.mode.stub";

interface AppearanceRuntimeState {
  readonly backgroundEnabled: boolean;
  readonly fullPlayerOpen: boolean;
  readonly reducedMotion: boolean;
  readonly windowFocused: boolean;
  readonly windowVisible: boolean;
}

type AppearanceModeEventDetail = {
  readonly mode: AppearanceMode;
};

function isAppearanceMode(value: string | null): value is AppearanceMode {
  return APPEARANCE_MODES.includes(value as AppearanceMode);
}

function readStoredMode(): AppearanceMode | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY);
    return isAppearanceMode(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredMode(mode: AppearanceMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, mode);
  } catch {
    // The real settings task will own persistence; this stub is best-effort.
  }
}

function canUseMovingMode(state: AppearanceRuntimeState): boolean {
  return state.fullPlayerOpen &&
    state.windowFocused &&
    state.windowVisible &&
    !state.reducedMotion;
}

function isMovingMode(mode: AppearanceMode): boolean {
  return mode === "particles" || mode === "vinyl";
}

function isCoverMode(mode: AppearanceMode): boolean {
  return mode === "cover-blur" || mode === "cover-immersive";
}

const signals = createRoot(() => {
  const [requestedMode, setRequestedModeSignal] = createSignal<AppearanceMode | null>(readStoredMode());
  const [runtimeState, setRuntimeState] = createSignal<AppearanceRuntimeState>({
    backgroundEnabled: false,
    fullPlayerOpen: false,
    reducedMotion: false,
    windowFocused: true,
    windowVisible: true
  });
  return {
    requestedMode,
    runtimeState,
    setRequestedModeSignal,
    setRuntimeState
  };
});

function baseMode(): AppearanceMode {
  const state = signals.runtimeState();
  if (!state.backgroundEnabled) {
    return "solid";
  }

  const requested = signals.requestedMode();
  return requested && isCoverMode(requested) ? requested : "cover-blur";
}

function effectiveMode(): AppearanceMode {
  const mode = baseMode();
  if (isMovingMode(mode) && !canUseMovingMode(signals.runtimeState())) {
    return "solid";
  }
  return mode;
}

function setAppearanceMode(mode: AppearanceMode): void {
  signals.setRequestedModeSignal(mode);
  writeStoredMode(mode);
}

function syncRuntime(next: Partial<Pick<AppearanceRuntimeState, "backgroundEnabled" | "fullPlayerOpen">>): void {
  signals.setRuntimeState((current) => ({ ...current, ...next }));
}

function applyDomMode(mode: AppearanceMode, root: HTMLElement = document.documentElement): void {
  root.dataset.appearanceMode = mode;
}

function installBrowserRuntime(): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const syncReducedMotion = () => {
    document.documentElement.dataset.reducedMotion = String(media.matches);
    signals.setRuntimeState((current) => ({ ...current, reducedMotion: media.matches }));
  };
  const syncWindowState = () => {
    const windowFocused = document.hasFocus();
    const windowVisible = document.visibilityState !== "hidden";
    document.documentElement.dataset.windowFocused = String(windowFocused);
    document.documentElement.dataset.windowVisible = String(windowVisible);
    signals.setRuntimeState((current) => ({
      ...current,
      windowFocused,
      windowVisible
    }));
  };
  const handleModeEvent = (event: Event) => {
    const detail = (event as CustomEvent<AppearanceModeEventDetail>).detail;
    if (detail && isAppearanceMode(detail.mode)) {
      setAppearanceMode(detail.mode);
    }
  };

  syncReducedMotion();
  syncWindowState();
  window.addEventListener("focus", syncWindowState);
  window.addEventListener("blur", syncWindowState);
  document.addEventListener("visibilitychange", syncWindowState);
  window.addEventListener(APPEARANCE_MODE_EVENT, handleModeEvent);
  media.addEventListener("change", syncReducedMotion);

  return () => {
    window.removeEventListener("focus", syncWindowState);
    window.removeEventListener("blur", syncWindowState);
    document.removeEventListener("visibilitychange", syncWindowState);
    window.removeEventListener(APPEARANCE_MODE_EVENT, handleModeEvent);
    media.removeEventListener("change", syncReducedMotion);
    delete document.documentElement.dataset.reducedMotion;
    delete document.documentElement.dataset.windowFocused;
    delete document.documentElement.dataset.windowVisible;
  };
}

function movingModeAllowed(): boolean {
  return canUseMovingMode(signals.runtimeState());
}

export const appearanceEngine = {
  modes: APPEARANCE_MODES,
  requestedMode: signals.requestedMode,
  runtimeState: signals.runtimeState,
  baseMode,
  effectiveMode,
  movingModeAllowed,
  setAppearanceMode,
  syncRuntime,
  applyDomMode,
  installBrowserRuntime
};
