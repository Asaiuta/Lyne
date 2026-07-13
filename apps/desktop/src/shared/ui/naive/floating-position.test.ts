import assert from "node:assert/strict";
import test from "node:test";
import { computeFloatingPosition, type FloatingAnchorRect } from "./floating-position";

const anchor = (overrides: Partial<FloatingAnchorRect> = {}): FloatingAnchorRect => ({
  left: 1102,
  right: 1190,
  top: 240,
  bottom: 280,
  width: 88,
  height: 40,
  ...overrides
});

const viewport = { width: 1280, height: 800 };

test("bottom-end uses the measured content width", () => {
  const position = computeFloatingPosition({
    anchor: anchor(),
    content: { width: 96, height: 120 },
    viewport,
    placement: "bottom-end",
    gutter: 6
  });

  assert.equal(position.left, 1094);
  assert.equal(position.left + 96, 1190);
  assert.equal(position.top, 286);
  assert.equal(position.placement, "bottom-end");
});

test("top and side alignments preserve the requested edge", () => {
  const topStart = computeFloatingPosition({
    anchor: anchor({ left: 200, right: 280, top: 300, bottom: 340 }),
    content: { width: 120, height: 80 },
    viewport,
    placement: "top-start",
    gutter: 8
  });
  assert.deepEqual(topStart, { left: 200, top: 212, placement: "top-start" });

  const rightEnd = computeFloatingPosition({
    anchor: anchor({ left: 200, right: 280, top: 300, bottom: 340 }),
    content: { width: 120, height: 80 },
    viewport,
    placement: "right-end",
    gutter: 4
  });
  assert.deepEqual(rightEnd, { left: 284, top: 260, placement: "right-end" });
});

test("flips to the opposite side when the preferred side cannot fit", () => {
  const position = computeFloatingPosition({
    anchor: anchor({ top: 740, bottom: 780 }),
    content: { width: 120, height: 100 },
    viewport,
    placement: "bottom-start",
    gutter: 6
  });

  assert.equal(position.placement, "top-start");
  assert.equal(position.top, 634);
  assert.equal(position.left, 1102);
});

test("shifts both axes inside the viewport when content is wider than the anchor", () => {
  const position = computeFloatingPosition({
    anchor: anchor({ left: 2, right: 42, top: 2, bottom: 42, width: 40, height: 40 }),
    content: { width: 400, height: 200 },
    viewport: { width: 480, height: 300 },
    placement: "bottom-end",
    gutter: 6
  });

  assert.equal(position.left, 8);
  assert.equal(position.top, 48);
});
