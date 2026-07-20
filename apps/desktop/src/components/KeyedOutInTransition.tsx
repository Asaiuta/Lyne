import {
  batch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
  type JSX
} from "solid-js";

export type KeyedOutInTransitionPhase =
  | "idle"
  | "leaving"
  | "swapping"
  | "entering";

interface KeyedOutInTransitionProps<Value> {
  value: Value;
  transitionKey: string;
  transitionName: string | null;
  targetSelector?: string;
  appear?: boolean;
  class?: string;
  motionScope?: string;
  onDisplayedValueChange?: (value: Value) => void;
  children: (displayedValue: Accessor<Value>) => JSX.Element;
}

interface CssTimelineStyle {
  readonly transitionDuration: string;
  readonly transitionDelay: string;
  readonly animationDuration: string;
  readonly animationDelay: string;
}

type AnimationResult = "finished" | "cancelled";

interface PendingAnimation {
  readonly promise: Promise<AnimationResult>;
  readonly cancel: () => void;
}

const parseCssTimeList = (value: string): readonly number[] =>
  value
    .split(",")
    .map((part) => {
      const token = part.trim();
      if (token.endsWith("ms")) return Number.parseFloat(token);
      if (token.endsWith("s")) return Number.parseFloat(token) * 1000;
      return 0;
    })
    .filter((duration) => Number.isFinite(duration));

const longestRepeatedTimelineMs = (
  durations: readonly number[],
  delays: readonly number[]
): number => {
  if (durations.length === 0) return 0;
  const count = Math.max(durations.length, delays.length, 1);
  let longest = 0;
  for (let index = 0; index < count; index += 1) {
    const duration = durations[index % durations.length] ?? 0;
    const delay = delays.length > 0 ? delays[index % delays.length] ?? 0 : 0;
    longest = Math.max(longest, duration + delay);
  }
  return Math.max(0, longest);
};

export const longestCssTimelineMs = (style: CssTimelineStyle): number =>
  Math.max(
    longestRepeatedTimelineMs(
      parseCssTimeList(style.transitionDuration),
      parseCssTimeList(style.transitionDelay)
    ),
    longestRepeatedTimelineMs(
      parseCssTimeList(style.animationDuration),
      parseCssTimeList(style.animationDelay)
    )
  );

export const transitionPhaseClassNames = (
  transitionName: string,
  phase: "enter" | "leave"
): readonly [from: string, active: string, to: string] => [
  `${transitionName}-${phase}-from`,
  `${transitionName}-${phase}-active`,
  `${transitionName}-${phase}-to`
];

const animatePhase = (
  element: Element | null,
  transitionName: string,
  phase: "enter" | "leave"
): PendingAnimation => {
  if (!element) {
    return {
      promise: Promise.resolve("finished"),
      cancel: () => undefined
    };
  }

  const [fromClass, activeClass, toClass] = transitionPhaseClassNames(
    transitionName,
    phase
  );
  let settle: (result: AnimationResult) => void = () => undefined;
  const promise = new Promise<AnimationResult>((resolve) => {
    let settled = false;
    let timer: number | undefined;
    let startedAt = 0;

    const removeListeners = () => {
      element.removeEventListener("animationend", handleEnd);
      element.removeEventListener("transitionend", handleEnd);
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const finish = (result: AnimationResult) => {
      if (settled) return;
      settled = true;
      removeListeners();
      element.classList.remove(fromClass, activeClass, toClass);
      resolve(result);
    };
    const handleEnd = (event: Event) => {
      if (event.target !== element) return;
      const elapsedMs = performance.now() - startedAt;
      const timelineMs = longestCssTimelineMs(window.getComputedStyle(element));
      if (elapsedMs + 4 >= timelineMs) finish("finished");
    };

    settle = finish;
    element.addEventListener("animationend", handleEnd);
    element.addEventListener("transitionend", handleEnd);
    element.classList.add(fromClass);
    (element as HTMLElement).offsetHeight;
    element.classList.add(activeClass);
    element.classList.remove(fromClass);
    element.classList.add(toClass);

    const timelineMs = longestCssTimelineMs(window.getComputedStyle(element));
    startedAt = performance.now();
    if (timelineMs <= 0) {
      queueMicrotask(() => finish("finished"));
      return;
    }
    timer = window.setTimeout(() => finish("finished"), timelineMs + 34);
  });

  return {
    promise,
    cancel: () => settle("cancelled")
  };
};

export function KeyedOutInTransition<Value>(
  props: KeyedOutInTransitionProps<Value>
) {
  const [displayedValue, setDisplayedValue] = createSignal<Value>(props.value, {
    equals: false
  });
  const [displayedKey, setDisplayedKey] = createSignal<string>(props.transitionKey);
  const [phase, setPhase] = createSignal<KeyedOutInTransitionPhase>("idle");

  let containerRef: HTMLDivElement | undefined;
  let pendingAnimation: PendingAnimation | null = null;
  let generation = 0;
  let disposed = false;

  const getTarget = (): Element | null => {
    if (!containerRef) return null;
    if (props.targetSelector) {
      return containerRef.querySelector(props.targetSelector);
    }
    return containerRef.firstElementChild;
  };

  const cancelPendingAnimation = () => {
    pendingAnimation?.cancel();
    pendingAnimation = null;
  };

  const commitDisplayedValue = (value: Value, key: string) => {
    batch(() => {
      setDisplayedValue(() => value);
      setDisplayedKey(key);
    });
  };

  const runEnter = (
    transitionName: string,
    expectedGeneration: number
  ) => {
    queueMicrotask(() => {
      queueMicrotask(() => {
        if (disposed || generation !== expectedGeneration) return;
        setPhase("entering");
        const run = animatePhase(getTarget(), transitionName, "enter");
        pendingAnimation = run;
        void run.promise.then((result) => {
          if (pendingAnimation === run) pendingAnimation = null;
          if (
            result !== "finished" ||
            disposed ||
            generation !== expectedGeneration
          ) {
            return;
          }
          setPhase("idle");
        });
      });
    });
  };

  createEffect(() => {
    const targetValue = props.value;
    const targetKey = props.transitionKey;
    const transitionName = props.transitionName;
    const expectedGeneration = ++generation;
    cancelPendingAnimation();

    if (targetKey === untrack(displayedKey)) {
      commitDisplayedValue(targetValue, targetKey);
      setPhase("idle");
      return;
    }

    if (!transitionName) {
      commitDisplayedValue(targetValue, targetKey);
      setPhase("idle");
      return;
    }

    setPhase("leaving");
    const run = animatePhase(getTarget(), transitionName, "leave");
    pendingAnimation = run;
    void run.promise.then((result) => {
      if (pendingAnimation === run) pendingAnimation = null;
      if (
        result !== "finished" ||
        disposed ||
        generation !== expectedGeneration
      ) {
        return;
      }
      commitDisplayedValue(targetValue, targetKey);
      setPhase("swapping");
      runEnter(transitionName, expectedGeneration);
    });
  });

  createEffect(() => {
    const value = displayedValue();
    untrack(() => props.onDisplayedValueChange?.(value));
  });

  onMount(() => {
    const transitionName = props.transitionName;
    const expectedGeneration = generation;
    if (!props.appear || !transitionName) return;
    runEnter(transitionName, expectedGeneration);
  });

  onCleanup(() => {
    disposed = true;
    generation += 1;
    cancelPendingAnimation();
  });

  return (
    <div
      ref={containerRef}
      class={props.class}
      style={{ display: "contents" }}
      data-motion-scope={props.motionScope}
      data-motion-phase={phase()}
      data-motion-displayed-key={displayedKey()}
      data-motion-target-key={props.transitionKey}
      data-motion-pending={
        phase() !== "idle" || displayedKey() !== props.transitionKey
          ? "true"
          : undefined
      }
    >
      {props.children(displayedValue)}
    </div>
  );
}
