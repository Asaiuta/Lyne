import {
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  type JSX
} from "solid-js";
import {
  createCollapseTransitionSnapshot,
  type NaiveCollapseTransitionPhase
} from "./collapse-logic";
import { joinClassNames } from "./utils";

const COLLAPSE_TRANSITION_FALLBACK_MS = 200;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface NaiveCollapseTransitionProps {
  show: boolean;
  appear?: boolean;
  class?: string;
  children?: JSX.Element;
}

export function NaiveCollapseTransition(
  props: NaiveCollapseTransitionProps
): JSX.Element {
  const initialPhase: NaiveCollapseTransitionPhase =
    props.show && !props.appear ? "entered" : "exited";
  const [phase, setPhase] = createSignal<NaiveCollapseTransitionPhase>(initialPhase);
  const [maxHeight, setMaxHeight] = createSignal<string>(
    createCollapseTransitionSnapshot(initialPhase, 0).maxHeight
  );
  let wrapperRef: HTMLDivElement | undefined;
  let mounted = false;
  let frameOne = 0;
  let frameTwo = 0;
  let settleFrame = 0;
  let settleTimer: number | undefined;
  let runId = 0;

  const cancelFrames = (): void => {
    if (typeof window === "undefined") return;
    window.cancelAnimationFrame(frameOne);
    window.cancelAnimationFrame(frameTwo);
    window.cancelAnimationFrame(settleFrame);
    frameOne = 0;
    frameTwo = 0;
    settleFrame = 0;
  };

  const cancelSettlement = (): void => {
    if (typeof window === "undefined") return;
    if (settleTimer !== undefined) window.clearTimeout(settleTimer);
    settleTimer = undefined;
  };

  const measuredHeight = (): number => wrapperRef?.scrollHeight ?? 0;

  const finishEntered = (id: number): void => {
    if (id !== runId) return;
    cancelSettlement();
    setPhase("entered");
    setMaxHeight("");
  };

  const finishExited = (id: number): void => {
    if (id !== runId) return;
    cancelSettlement();
    setPhase("exited");
    setMaxHeight("0px");
  };

  const scheduleSettlement = (
    id: number,
    finish: (activeRunId: number) => void
  ): void => {
    if (typeof window === "undefined") {
      finish(id);
      return;
    }
    if (prefersReducedMotion()) {
      settleFrame = window.requestAnimationFrame(() => finish(id));
      return;
    }
    settleTimer = window.setTimeout(
      () => finish(id),
      COLLAPSE_TRANSITION_FALLBACK_MS
    );
  };

  const animateOpen = (): void => {
    const id = ++runId;
    const startsFromExited = phase() === "exited";
    cancelFrames();
    cancelSettlement();
    if (startsFromExited) {
      setMaxHeight("0px");
    } else {
      setPhase("entering");
      setMaxHeight(`${measuredHeight()}px`);
    }
    if (typeof window === "undefined") {
      finishEntered(id);
      return;
    }
    if (prefersReducedMotion()) {
      scheduleSettlement(id, finishEntered);
      return;
    }
    frameOne = window.requestAnimationFrame(() => {
      if (startsFromExited) void wrapperRef?.offsetHeight;
      frameTwo = window.requestAnimationFrame(() => {
        if (id !== runId) return;
        setPhase("entering");
        setMaxHeight(`${measuredHeight()}px`);
        scheduleSettlement(id, finishEntered);
      });
    });
  };

  const animateClose = (): void => {
    const id = ++runId;
    cancelFrames();
    cancelSettlement();
    setPhase("exiting");
    setMaxHeight(`${measuredHeight()}px`);
    if (typeof window === "undefined") {
      finishExited(id);
      return;
    }
    if (prefersReducedMotion()) {
      scheduleSettlement(id, finishExited);
      return;
    }
    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => {
        if (id !== runId) return;
        setMaxHeight("0px");
        scheduleSettlement(id, finishExited);
      });
    });
  };

  onMount(() => {
    mounted = true;
    if (props.show && props.appear) animateOpen();
  });

  createEffect(() => {
    if (!mounted) return;
    if (props.show) {
      if (phase() !== "entered" && phase() !== "entering") animateOpen();
      return;
    }
    if (phase() !== "exited" && phase() !== "exiting") animateClose();
  });

  onCleanup(() => {
    runId += 1;
    cancelFrames();
    cancelSettlement();
  });

  const handleTransitionEnd = (event: TransitionEvent): void => {
    if (event.target !== wrapperRef || event.propertyName !== "max-height") return;
    const currentRun = runId;
    if (phase() === "entering") finishEntered(currentRun);
    if (phase() === "exiting") finishExited(currentRun);
  };

  return (
    <Show when={phase() !== "exited" || props.show}>
      <div
        ref={wrapperRef}
        class={joinClassNames("n-collapse-transition", props.class)}
        data-phase={phase()}
        style={{ "max-height": maxHeight() }}
        onTransitionEnd={handleTransitionEnd}
      >
        {props.children}
      </div>
    </Show>
  );
}
