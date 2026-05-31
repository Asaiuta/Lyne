import assert from "node:assert/strict";
import test from "node:test";
import {
  MEDIA_LIST_ROW_HEIGHT_PX,
  resolveMediaListVisibleRange,
  shouldVirtualizeMediaList
} from "./mediaListVirtualization";

test("MediaList virtualizes a 3000-row sustained scroll without oversized render windows", () => {
  const totalItems = 3000;
  const viewportHeight = 720;
  const maxRenderedRows = 20;
  const scrollSteps = 180;
  const maxScrollTop = totalItems * MEDIA_LIST_ROW_HEIGHT_PX - viewportHeight;

  let previousStart = -1;
  let frameDrops = 0;
  for (let step = 0; step <= scrollSteps; step += 1) {
    const scrollTop = (maxScrollTop * step) / scrollSteps;
    const range = resolveMediaListVisibleRange({ totalItems, scrollTop, viewportHeight });
    const renderedRows = range.end - range.start;

    assert.equal(renderedRows > 0, true, `expected rows at step ${step}`);
    assert.equal(renderedRows <= maxRenderedRows, true, `render window too large at step ${step}`);
    assert.equal(range.start >= previousStart, true, `range moved backwards at step ${step}`);

    if (previousStart >= 0 && range.start - previousStart > maxRenderedRows) {
      frameDrops += 1;
    }
    previousStart = range.start;
  }

  const lastRange = resolveMediaListVisibleRange({
    totalItems,
    scrollTop: maxScrollTop,
    viewportHeight
  });
  assert.equal(lastRange.end, totalItems);
  assert.equal(frameDrops, 0);
});

test("MediaList keeps small lists unvirtualized", () => {
  assert.equal(shouldVirtualizeMediaList(120), false);
  assert.equal(shouldVirtualizeMediaList(121), true);
  assert.deepEqual(
    resolveMediaListVisibleRange({ totalItems: 20, scrollTop: 9999, viewportHeight: 360 }),
    { start: 0, end: 20 }
  );
});

test("MediaList clamps large-list ranges when scrollTop is beyond the current result set", () => {
  const range = resolveMediaListVisibleRange({
    totalItems: 121,
    scrollTop: 999_999,
    viewportHeight: MEDIA_LIST_ROW_HEIGHT_PX * 4
  });

  assert.equal(range.end, 121);
  assert.equal(range.end > range.start, true);
});
