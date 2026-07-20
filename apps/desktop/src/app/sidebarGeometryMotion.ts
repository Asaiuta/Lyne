export const SIDEBAR_GEOMETRY_PROPERTY = "--sidebar-inline-size";

type AnimationFactory = (
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions
) => Animation;

interface SidebarGeometryMotionOptions {
  readonly expandedSize: string;
  readonly collapsedSize: string;
  readonly durationMs: number;
  readonly easing: string;
  readonly timelineTime: () => CSSNumberish | null;
  readonly animate: AnimationFactory;
  readonly onFinished: (generation: number, targetCollapsed: boolean) => void;
}

export interface SidebarGeometryMotion {
  readonly animateTo: (generation: number, targetCollapsed: boolean) => void;
  readonly cancel: () => void;
  readonly dispose: () => void;
}

export interface SidebarGeometryMotionTokens {
  readonly expandedSize: string;
  readonly collapsedSize: string;
  readonly durationMs: number;
  readonly easing: string;
}

export const parseCssTimeMs = (value: string): number | null => {
  const token = value.trim();
  const multiplier = token.endsWith("ms") ? 1 : token.endsWith("s") ? 1000 : null;
  if (multiplier === null) return null;
  const parsed = Number.parseFloat(token);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed * multiplier;
};

export const readSidebarGeometryMotionTokens = (
  element: HTMLElement
): SidebarGeometryMotionTokens | null => {
  const style = window.getComputedStyle(element);
  const expandedSize = style.getPropertyValue("--sidebar-width").trim();
  const collapsedSize = style.getPropertyValue("--sidebar-width-collapsed").trim();
  const durationMs = parseCssTimeMs(
    style.getPropertyValue("--motion-duration-spatial")
  );
  const easing = style.getPropertyValue("--motion-ease-decelerate").trim();
  if (
    expandedSize.length === 0 ||
    collapsedSize.length === 0 ||
    expandedSize === collapsedSize ||
    durationMs === null ||
    durationMs <= 0 ||
    easing.length === 0
  ) {
    return null;
  }
  return { expandedSize, collapsedSize, durationMs, easing };
};

export function createSidebarGeometryMotion(
  options: SidebarGeometryMotionOptions
): SidebarGeometryMotion {
  let animation: Animation | null = null;
  let activeGeneration = 0;
  let targetCollapsed = false;
  let disposed = false;

  const releaseAnimation = (): void => {
    const current = animation;
    animation = null;
    if (current === null) return;
    current.onfinish = null;
    current.oncancel = null;
    current.cancel();
  };

  const animateTo = (generation: number, nextTargetCollapsed: boolean): void => {
    if (disposed) return;

    if (
      animation !== null &&
      animation.playState !== "finished" &&
      animation.playState !== "idle"
    ) {
      activeGeneration = generation;
      if (targetCollapsed !== nextTargetCollapsed) animation.reverse();
      targetCollapsed = nextTargetCollapsed;
      return;
    }

    releaseAnimation();
    activeGeneration = generation;
    targetCollapsed = nextTargetCollapsed;
    const fromSize = nextTargetCollapsed
      ? options.expandedSize
      : options.collapsedSize;
    const toSize = nextTargetCollapsed
      ? options.collapsedSize
      : options.expandedSize;
    const current = options.animate(
      [
        { [SIDEBAR_GEOMETRY_PROPERTY]: fromSize },
        { [SIDEBAR_GEOMETRY_PROPERTY]: toSize }
      ],
      {
        duration: options.durationMs,
        easing: options.easing,
        fill: "both"
      }
    );
    animation = current;
    current.onfinish = () => {
      if (animation !== current || disposed) return;
      const completedGeneration = activeGeneration;
      const completedTarget = targetCollapsed;
      releaseAnimation();
      options.onFinished(completedGeneration, completedTarget);
    };
    current.oncancel = () => {
      if (animation === current) animation = null;
    };

    const timelineTime = options.timelineTime();
    if (timelineTime !== null) current.startTime = timelineTime;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    releaseAnimation();
  };

  return { animateTo, cancel: releaseAnimation, dispose };
}

export const createSidebarGeometryMotionForElement = (
  element: HTMLElement,
  onFinished: (generation: number, targetCollapsed: boolean) => void
): SidebarGeometryMotion | null => {
  if (typeof element.animate !== "function") return null;
  const tokens = readSidebarGeometryMotionTokens(element);
  if (tokens === null) return null;
  return createSidebarGeometryMotion({
    ...tokens,
    timelineTime: () => document.timeline.currentTime,
    animate: (keyframes, options) => element.animate(keyframes, options),
    onFinished
  });
};
