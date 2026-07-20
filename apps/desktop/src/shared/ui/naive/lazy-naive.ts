import { onCleanup, onMount } from "solid-js";
import {
  scheduleIdlePreload,
  type IdlePreloadTiming
} from "../idlePreload";

export {
  scheduleIdlePreload,
  type IdlePreloadTiming
} from "../idlePreload";

/**
 * Kobalte-free lazy-loader factory shared by the NaiveUI facade wrappers.
 *
 * Each interaction facade (dropdown, tabs, input, ...) keeps a startup-light
 * public proxy that renders a fallback until the Kobalte-backed implementation
 * is loaded. The proxies previously each duplicated the same quartet:
 *
 *   let loadedNaiveX / naiveXImport
 *   const loadNaiveX = async () => { ... cached dynamic import ... }
 *   const preloadNaiveX = () => void loadNaiveX()
 *   onMount(() => requestIdleCallback/setTimeout preload dance)
 *
 * `createLazyNaive` encapsulates exactly that behavior. It MUST stay Kobalte-free
 * (only `solid-js` + the caller-supplied import thunk) so the startup chunk never
 * references `@kobalte/core`. The dynamic `import("./Naive<Name>Kobalte")` thunk
 * is supplied inline by each wrapper, preserving Vite's per-impl code-splitting.
 *
 * @see .trellis/spec/frontend/index.md "Lazy heavy-library wrapper triplet"
 */

export interface LazyNaive<T> {
  /** Cached dynamic-import loader. Resolves the mapped facade value once. */
  readonly load: () => Promise<T>;
  /** Fire-and-forget warmup that discards the load promise. */
  readonly preload: () => void;
  /** Synchronously read the resolved value, or `null` if not yet loaded. */
  readonly getLoaded: () => T | null;
  /**
   * `onMount` idle/timeout preload dance. Schedules `preload()` through
   * `requestIdleCallback` when available, otherwise a `setTimeout` fallback,
   * cleaning up the handle on unmount. No-op when already loaded or when there
   * is no `window` (SSR/tests).
   */
  readonly useIdlePreload: (timing: IdlePreloadTiming) => void;
}

/**
 * Build a cached lazy loader for a NaiveUI facade implementation.
 *
 * @param resolve dynamic-import thunk that imports the `Naive<Name>Kobalte`
 *   module and maps it to the facade value (component or component family).
 */
export function createLazyNaive<T>(resolve: () => Promise<T>): LazyNaive<T> {
  let loaded: T | null = null;
  let pending: Promise<T> | null = null;

  const load = async (): Promise<T> => {
    if (loaded) return loaded;
    pending ??= resolve();
    loaded = await pending;
    return loaded;
  };

  const preload = (): void => {
    void load();
  };

  const getLoaded = (): T | null => loaded;

  const useIdlePreload = (timing: IdlePreloadTiming): void => {
    onMount(() => {
      if (loaded) return;
      onCleanup(scheduleIdlePreload(preload, timing));
    });
  };

  return { load, preload, getLoaded, useIdlePreload };
}
