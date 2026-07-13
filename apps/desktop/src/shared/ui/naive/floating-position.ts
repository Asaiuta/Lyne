export type FloatingSide = "top" | "bottom" | "left" | "right";
export type FloatingEdgeAlignment = "start" | "end";
export type FloatingAlignment = "start" | "center" | "end";
export type FloatingPlacement =
  | FloatingSide
  | `${FloatingSide}-${FloatingEdgeAlignment}`;

export const FLOATING_VIEWPORT_PADDING = 8;

export interface FloatingAnchorRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatingContentSize {
  readonly width: number;
  readonly height: number;
}

export interface FloatingViewport {
  readonly width: number;
  readonly height: number;
}

export interface FloatingPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: FloatingPlacement;
}

export interface FloatingPositionOptions {
  readonly anchor: FloatingAnchorRect;
  readonly content: FloatingContentSize;
  readonly viewport: FloatingViewport;
  readonly placement: FloatingPlacement;
  readonly gutter?: number;
  readonly padding?: number;
}

const oppositeSide = (side: FloatingSide): FloatingSide => {
  switch (side) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
  }
};

const finiteNonNegative = (value: number | undefined, fallback: number): number =>
  value != null && Number.isFinite(value) ? Math.max(0, value) : fallback;

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

const parsePlacement = (
  placement: FloatingPlacement
): { readonly side: FloatingSide; readonly alignment: FloatingAlignment } => {
  const [side, alignment] = placement.split("-") as [FloatingSide, FloatingAlignment | undefined];
  return {
    side,
    alignment: alignment ?? "center"
  };
};

const availableSpace = (
  side: FloatingSide,
  anchor: FloatingAnchorRect,
  viewport: FloatingViewport,
  gutter: number,
  padding: number
): number => {
  switch (side) {
    case "top":
      return anchor.top - gutter - padding;
    case "bottom":
      return viewport.height - anchor.bottom - gutter - padding;
    case "left":
      return anchor.left - gutter - padding;
    case "right":
      return viewport.width - anchor.right - gutter - padding;
  }
};

const requiredSpace = (
  side: FloatingSide,
  content: FloatingContentSize
): number => (side === "top" || side === "bottom" ? content.height : content.width);

const resolveSide = (
  side: FloatingSide,
  anchor: FloatingAnchorRect,
  content: FloatingContentSize,
  viewport: FloatingViewport,
  gutter: number,
  padding: number
): FloatingSide => {
  const preferredSpace = availableSpace(side, anchor, viewport, gutter, padding);
  const needed = requiredSpace(side, content);
  if (preferredSpace >= needed) return side;

  const fallback = oppositeSide(side);
  const fallbackSpace = availableSpace(fallback, anchor, viewport, gutter, padding);
  return fallbackSpace >= needed || fallbackSpace > preferredSpace ? fallback : side;
};

/**
 * Computes a viewport-relative floating position using the same high-level
 * policy as Kobalte's PopperRoot: preferred placement, opposite-side flip,
 * then viewport shifting with overflow padding.
 */
export function computeFloatingPosition(
  options: FloatingPositionOptions
): FloatingPosition {
  const { anchor, viewport } = options;
  const gutter = finiteNonNegative(options.gutter, 0);
  const padding = finiteNonNegative(options.padding, FLOATING_VIEWPORT_PADDING);
  const width = finiteNonNegative(options.content.width, 0);
  const height = finiteNonNegative(options.content.height, 0);
  const content = { width, height };
  const parsed = parsePlacement(options.placement);
  const side = resolveSide(parsed.side, anchor, content, viewport, gutter, padding);

  const crossAxisStart = parsed.alignment === "start";
  const crossAxisEnd = parsed.alignment === "end";
  const rawLeft =
    side === "left"
      ? anchor.left - gutter - width
      : side === "right"
        ? anchor.right + gutter
        : crossAxisEnd
          ? anchor.right - width
          : crossAxisStart
            ? anchor.left
            : anchor.left + anchor.width / 2 - width / 2;
  const rawTop =
    side === "top"
      ? anchor.top - gutter - height
      : side === "bottom"
        ? anchor.bottom + gutter
        : crossAxisEnd
          ? anchor.bottom - height
          : crossAxisStart
            ? anchor.top
            : anchor.top + anchor.height / 2 - height / 2;

  return {
    left: clamp(rawLeft, padding, viewport.width - width - padding),
    top: clamp(rawTop, padding, viewport.height - height - padding),
    placement: parsed.alignment === "center" ? side : `${side}-${parsed.alignment}`
  };
}
