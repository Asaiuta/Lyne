import { lazy, type Component } from "solid-js";

export type DeferredLazyComponent<Props extends object> = Component<Props> & {
  readonly loadModule: () => Promise<Component<Props>>;
};

export function createDeferredLazyComponent<Props extends object>(
  loader: () => Promise<Component<Props>>
): DeferredLazyComponent<Props> {
  let loadPromise: Promise<Component<Props>> | undefined;
  // Warm through this promise: Solid's `preload()` creates a detached rejection branch.
  const loadModule = () => (loadPromise ??= loader());
  const component = lazy(async () => ({ default: await loadModule() }));

  return Object.assign(component, { loadModule });
}
