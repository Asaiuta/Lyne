type LoadState = "idle" | "pending" | "resolved" | "rejected";

export interface FullPlayerWarmupCoordinatorOptions {
  readonly load: () => Promise<unknown>;
  readonly requestMount: () => void;
  readonly commitOpen: () => void;
  readonly canMountClosed: () => boolean;
  readonly scheduleFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly reportLoadError?: (error: unknown) => void;
}

export interface FullPlayerWarmupCoordinator {
  readonly warmup: () => void;
  readonly requestOpen: () => void;
  readonly notifyShellMounted: () => void;
  readonly dispose: () => void;
}

export function createFullPlayerWarmupCoordinator(
  options: FullPlayerWarmupCoordinatorOptions
): FullPlayerWarmupCoordinator {
  let loadState: LoadState = "idle";
  let mountRequested = false;
  let shellMounted = false;
  let shellPaintReady = false;
  let openRequested = false;
  let disposed = false;
  let firstPaintFrame: number | undefined;
  let secondPaintFrame: number | undefined;

  const requestMountOnce = () => {
    if (disposed || mountRequested) return;
    mountRequested = true;
    options.requestMount();
  };

  const flushOpenRequest = () => {
    if (disposed || !openRequested || !shellPaintReady) return;
    openRequested = false;
    options.commitOpen();
  };

  const handleLoadResolved = () => {
    if (disposed) return;
    loadState = "resolved";
    if (openRequested || options.canMountClosed()) {
      requestMountOnce();
    }
  };

  const handleLoadRejected = (error: unknown) => {
    if (disposed) return;
    loadState = "rejected";
    options.reportLoadError?.(error);
    if (openRequested) {
      requestMountOnce();
    }
  };

  const ensureLoaded = () => {
    if (disposed) return;
    if (loadState === "resolved") {
      if (openRequested || options.canMountClosed()) {
        requestMountOnce();
      }
      return;
    }
    if (loadState === "rejected") {
      if (openRequested) requestMountOnce();
      return;
    }
    if (loadState === "pending") return;

    loadState = "pending";
    void Promise.resolve()
      .then(options.load)
      .then(handleLoadResolved, handleLoadRejected);
  };

  const warmup = () => {
    ensureLoaded();
  };

  const requestOpen = () => {
    if (disposed) return;
    if (shellPaintReady) {
      options.commitOpen();
      return;
    }
    openRequested = true;
    ensureLoaded();
  };

  const notifyShellMounted = () => {
    if (disposed || shellMounted) return;
    shellMounted = true;
    firstPaintFrame = options.scheduleFrame(() => {
      firstPaintFrame = undefined;
      if (disposed) return;
      secondPaintFrame = options.scheduleFrame(() => {
        secondPaintFrame = undefined;
        if (disposed) return;
        shellPaintReady = true;
        flushOpenRequest();
      });
    });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    openRequested = false;
    if (firstPaintFrame !== undefined) {
      options.cancelFrame(firstPaintFrame);
      firstPaintFrame = undefined;
    }
    if (secondPaintFrame !== undefined) {
      options.cancelFrame(secondPaintFrame);
      secondPaintFrame = undefined;
    }
  };

  return { warmup, requestOpen, notifyShellMounted, dispose };
}
