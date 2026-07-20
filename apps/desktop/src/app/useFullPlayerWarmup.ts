import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor
} from "solid-js";
import { scheduleIdlePreload } from "../shared/ui/idlePreload";
import { createFullPlayerWarmupCoordinator } from "./fullPlayerWarmupCoordinator";

const FULL_PLAYER_IDLE_PRELOAD_TIMING = {
  idleTimeout: 1500,
  fallbackDelay: 800
} as const;

interface UseFullPlayerWarmupOptions {
  readonly load: () => Promise<unknown>;
  readonly hasPlayableTrack: Accessor<boolean>;
  readonly requestMount: () => void;
  readonly commitOpen: () => void;
}

interface FullPlayerWarmupControls {
  readonly prewarm: () => void;
  readonly requestOpen: () => void;
  readonly notifyShellMounted: () => void;
}

interface FullPlayerWarmupCommands {
  readonly warmup: () => void;
  readonly requestOpen: () => void;
  readonly notifyShellMounted: () => void;
  readonly dispose: () => void;
}

interface FullPlayerWarmupOrchestrationOptions {
  readonly commands: FullPlayerWarmupCommands;
  readonly scheduleIdle: (callback: () => void) => () => void;
}

export interface FullPlayerWarmupOrchestration extends FullPlayerWarmupControls {
  readonly updateEligibility: (eligible: boolean) => void;
  readonly dispose: () => void;
}

export function createFullPlayerWarmupOrchestration(
  options: FullPlayerWarmupOrchestrationOptions
): FullPlayerWarmupOrchestration {
  let cancelIdleWarmup: (() => void) | undefined;
  let disposed = false;

  const cancelScheduledWarmup = () => {
    cancelIdleWarmup?.();
    cancelIdleWarmup = undefined;
  };

  const updateEligibility = (eligible: boolean) => {
    if (disposed) return;
    cancelScheduledWarmup();
    if (!eligible) return;
    cancelIdleWarmup = options.scheduleIdle(() => {
      cancelIdleWarmup = undefined;
      if (!disposed) options.commands.warmup();
    });
  };

  const prewarm = () => {
    if (disposed) return;
    cancelScheduledWarmup();
    options.commands.warmup();
  };

  const requestOpen = () => {
    if (disposed) return;
    cancelScheduledWarmup();
    options.commands.requestOpen();
  };

  const notifyShellMounted = () => {
    if (!disposed) options.commands.notifyShellMounted();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelScheduledWarmup();
    options.commands.dispose();
  };

  return { updateEligibility, prewarm, requestOpen, notifyShellMounted, dispose };
}

export function useFullPlayerWarmup(
  options: UseFullPlayerWarmupOptions
): FullPlayerWarmupControls {
  const [documentVisible, setDocumentVisible] = createSignal<boolean>(
    typeof document !== "undefined" && document.visibilityState !== "hidden"
  );
  const warmupEligible = createMemo<boolean>(
    () => options.hasPlayableTrack() && documentVisible()
  );

  const coordinator = createFullPlayerWarmupCoordinator({
    load: options.load,
    requestMount: options.requestMount,
    commitOpen: options.commitOpen,
    canMountClosed: documentVisible,
    scheduleFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    reportLoadError: (error) => {
      console.warn("[FullPlayer] deferred warmup failed", error);
    }
  });
  const orchestration = createFullPlayerWarmupOrchestration({
    commands: coordinator,
    scheduleIdle: (callback) => scheduleIdlePreload(callback, FULL_PLAYER_IDLE_PRELOAD_TIMING)
  });

  onMount(() => {
    const syncDocumentVisibility = () => {
      setDocumentVisible(document.visibilityState !== "hidden");
    };
    syncDocumentVisibility();
    document.addEventListener("visibilitychange", syncDocumentVisibility);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", syncDocumentVisibility);
    });
  });

  createEffect(() => {
    orchestration.updateEligibility(warmupEligible());
  });

  onCleanup(orchestration.dispose);

  return {
    prewarm: orchestration.prewarm,
    requestOpen: orchestration.requestOpen,
    notifyShellMounted: orchestration.notifyShellMounted
  };
}
