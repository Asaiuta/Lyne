export const SIDEBAR_COLLAPSE_MOTION_FALLBACK_MS = 400;
export const SIDEBAR_COLLAPSED_CONTENT_RETENTION_MS = 1500;
export const SIDEBAR_COLLAPSED_CONTENT_IDLE_TIMING = {
  idleTimeout: 500,
  fallbackDelay: 0
} as const;

export type SidebarCollapsePhase =
  | "expanded"
  | "collapsing"
  | "collapsed-retained"
  | "collapsed-unmounted"
  | "expanding";

export interface SidebarCollapsePresentation {
  readonly expandedContentMounted: boolean;
  readonly expandedContentVisible: boolean;
  readonly compactContentVisible: boolean;
  readonly motionActive: boolean;
}

type CancelScheduledTask = () => void;

interface SidebarCollapseLifecycleOptions {
  readonly initialCollapsed: boolean;
  readonly onPhaseChange: (phase: SidebarCollapsePhase) => void;
  readonly scheduleFrame: (callback: () => void) => CancelScheduledTask;
  readonly scheduleDelay: (callback: () => void, delayMs: number) => CancelScheduledTask;
  readonly scheduleIdle: (callback: () => void) => CancelScheduledTask;
}

export interface SidebarCollapseLifecycle {
  readonly beginTransition: (targetCollapsed: boolean, settleByNextFrame: boolean) => number;
  readonly requestSettle: (generation: number, targetCollapsed: boolean) => void;
  readonly currentGeneration: () => number;
  readonly currentPhase: () => SidebarCollapsePhase;
  readonly dispose: () => void;
}

export function initialSidebarCollapsePhase(collapsed: boolean): SidebarCollapsePhase {
  return collapsed ? "collapsed-unmounted" : "expanded";
}

export function sidebarCollapsePresentation(
  phase: SidebarCollapsePhase
): SidebarCollapsePresentation {
  switch (phase) {
    case "expanded":
      return {
        expandedContentMounted: true,
        expandedContentVisible: true,
        compactContentVisible: false,
        motionActive: false
      };
    case "collapsing":
    case "expanding":
      return {
        expandedContentMounted: true,
        expandedContentVisible: true,
        compactContentVisible: false,
        motionActive: true
      };
    case "collapsed-retained":
      return {
        expandedContentMounted: true,
        expandedContentVisible: false,
        compactContentVisible: true,
        motionActive: false
      };
    case "collapsed-unmounted":
      return {
        expandedContentMounted: false,
        expandedContentVisible: false,
        compactContentVisible: true,
        motionActive: false
      };
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

export function createSidebarCollapseLifecycle(
  options: SidebarCollapseLifecycleOptions
): SidebarCollapseLifecycle {
  let phase = initialSidebarCollapsePhase(options.initialCollapsed);
  let generation = 0;
  let targetCollapsed = options.initialCollapsed;
  let settledGeneration: number | null = 0;
  let disposed = false;
  let cancelFallback: CancelScheduledTask | undefined;
  let cancelSettleFrame: CancelScheduledTask | undefined;
  let cancelRetention: CancelScheduledTask | undefined;
  let cancelIdle: CancelScheduledTask | undefined;

  const publishPhase = (nextPhase: SidebarCollapsePhase): void => {
    if (phase === nextPhase) return;
    phase = nextPhase;
    options.onPhaseChange(nextPhase);
  };

  const cancelFallbackTask = (): void => {
    cancelFallback?.();
    cancelFallback = undefined;
  };

  const cancelSettleTask = (): void => {
    cancelSettleFrame?.();
    cancelSettleFrame = undefined;
  };

  const cancelRetentionTask = (): void => {
    cancelRetention?.();
    cancelRetention = undefined;
  };

  const cancelIdleTask = (): void => {
    cancelIdle?.();
    cancelIdle = undefined;
  };

  const isCurrent = (requestedGeneration: number, requestedTarget: boolean): boolean =>
    !disposed &&
    generation === requestedGeneration &&
    targetCollapsed === requestedTarget;

  const scheduleCollapsedContentRelease = (requestedGeneration: number): void => {
    cancelRetentionTask();
    cancelIdleTask();
    cancelRetention = options.scheduleDelay(() => {
      cancelRetention = undefined;
      if (
        !isCurrent(requestedGeneration, true) ||
        phase !== "collapsed-retained"
      ) {
        return;
      }
      cancelIdle = options.scheduleIdle(() => {
        cancelIdle = undefined;
        if (
          !isCurrent(requestedGeneration, true) ||
          phase !== "collapsed-retained"
        ) {
          return;
        }
        publishPhase("collapsed-unmounted");
      });
    }, SIDEBAR_COLLAPSED_CONTENT_RETENTION_MS);
  };

  const requestSettle = (
    requestedGeneration: number,
    requestedTargetCollapsed: boolean
  ): void => {
    if (
      !isCurrent(requestedGeneration, requestedTargetCollapsed) ||
      settledGeneration === requestedGeneration ||
      cancelSettleFrame !== undefined
    ) {
      return;
    }

    cancelFallbackTask();
    cancelSettleFrame = options.scheduleFrame(() => {
      cancelSettleFrame = undefined;
      if (!isCurrent(requestedGeneration, requestedTargetCollapsed)) return;

      settledGeneration = requestedGeneration;
      if (!requestedTargetCollapsed) {
        publishPhase("expanded");
        return;
      }

      publishPhase("collapsed-retained");
      scheduleCollapsedContentRelease(requestedGeneration);
    });
  };

  const beginTransition = (
    nextTargetCollapsed: boolean,
    settleByNextFrame: boolean
  ): number => {
    if (disposed) return generation;

    generation += 1;
    targetCollapsed = nextTargetCollapsed;
    settledGeneration = null;
    cancelFallbackTask();
    cancelSettleTask();
    cancelRetentionTask();
    cancelIdleTask();
    publishPhase(nextTargetCollapsed ? "collapsing" : "expanding");

    const currentGeneration = generation;
    if (settleByNextFrame) {
      requestSettle(currentGeneration, nextTargetCollapsed);
    } else {
      cancelFallback = options.scheduleDelay(
        () => requestSettle(currentGeneration, nextTargetCollapsed),
        SIDEBAR_COLLAPSE_MOTION_FALLBACK_MS
      );
    }
    return currentGeneration;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    cancelFallbackTask();
    cancelSettleTask();
    cancelRetentionTask();
    cancelIdleTask();
  };

  return {
    beginTransition,
    requestSettle,
    currentGeneration: () => generation,
    currentPhase: () => phase,
    dispose
  };
}
