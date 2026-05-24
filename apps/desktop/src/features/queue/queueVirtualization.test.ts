import assert from "node:assert/strict";
import test from "node:test";
import {
  QUEUE_ROW_HEIGHT_PX,
  resolveQueueVisibleRange
} from "./queueVirtualization";

test("queue drawer keeps a bounded window through a 2000-row sustained scroll", () => {
  const totalItems = 2000;
  const viewportHeight = 640;
  const maxRows = 20;
  const maxScrollTop = totalItems * QUEUE_ROW_HEIGHT_PX - viewportHeight;

  let previousStart = -1;
  for (let step = 0; step <= 160; step += 1) {
    const range = resolveQueueVisibleRange({
      totalItems,
      viewportHeight,
      scrollTop: (maxScrollTop * step) / 160
    });
    const renderedRows = range.end - range.start;

    assert.equal(renderedRows > 0, true, `expected rows at step ${step}`);
    assert.equal(renderedRows <= maxRows, true, `render window too large at step ${step}`);
    assert.equal(range.start >= previousStart, true, `range moved backwards at step ${step}`);
    previousStart = range.start;
  }
});

test("queue drawer clamps negative and end scroll positions", () => {
  assert.deepEqual(
    resolveQueueVisibleRange({ totalItems: 10, scrollTop: -100, viewportHeight: 320 }),
    { start: 0, end: 10 }
  );
  assert.deepEqual(
    resolveQueueVisibleRange({ totalItems: 10, scrollTop: 9999, viewportHeight: 320 }),
    { start: 10, end: 10 }
  );
});
