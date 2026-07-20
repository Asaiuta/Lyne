type IdlePreloadWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export interface IdlePreloadTiming {
  readonly idleTimeout: number;
  readonly fallbackDelay: number;
}

export function scheduleIdlePreload(
  preload: () => void,
  timing: IdlePreloadTiming
): () => void {
  if (typeof window === "undefined") return () => {};

  const preloadWindow = window as IdlePreloadWindow;
  if (preloadWindow.requestIdleCallback) {
    const id = preloadWindow.requestIdleCallback(preload, { timeout: timing.idleTimeout });
    return () => preloadWindow.cancelIdleCallback?.(id);
  }

  const id = preloadWindow.setTimeout(preload, timing.fallbackDelay);
  return () => preloadWindow.clearTimeout(id);
}
