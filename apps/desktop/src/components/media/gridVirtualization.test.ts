import assert from "node:assert/strict";
import test from "node:test";
import {
  GRID_OVERSCAN_ROWS,
  resolveGridVisibleRange,
  shouldVirtualizeGrid
} from "./gridVirtualization";

test("grid virtualization keeps render windows bounded across a sustained scroll", () => {
  const totalItems = 3000;
  const columns = 5;
  const rowHeight = 220;
  const viewportHeight = 720;
  const maxRows = Math.ceil(viewportHeight / rowHeight) + GRID_OVERSCAN_ROWS * 2;
  const maxItems = maxRows * columns;
  const totalRows = Math.ceil(totalItems / columns);
  const maxScrollTop = totalRows * rowHeight - viewportHeight;

  let previousStartRow = -1;
  for (let step = 0; step <= 160; step += 1) {
    const range = resolveGridVisibleRange({
      totalItems,
      columns,
      rowHeight,
      viewportHeight,
      scrollTop: (maxScrollTop * step) / 160
    });

    assert.equal(range.virtualized, true);
    assert.equal(range.end > range.start, true, `expected items at step ${step}`);
    assert.equal(range.end - range.start <= maxItems, true, `render window too large at step ${step}`);
    assert.equal(range.startRow >= previousStartRow, true, `range moved backwards at step ${step}`);
    assert.equal(range.start, range.startRow * columns);
    assert.equal(range.padTop, range.startRow * rowHeight);
    previousStartRow = range.startRow;
  }
});

test("grid virtualization keeps small grids unvirtualized", () => {
  assert.equal(shouldVirtualizeGrid(120), false);
  assert.equal(shouldVirtualizeGrid(121), true);
  assert.deepEqual(
    resolveGridVisibleRange({
      totalItems: 20,
      columns: 4,
      rowHeight: 220,
      scrollTop: 9999,
      viewportHeight: 480
    }),
    {
      start: 0,
      end: 20,
      startRow: 0,
      endRow: 5,
      padTop: 0,
      padBottom: 0,
      virtualized: false
    }
  );
});

test("grid virtualization clamps overscroll to the final populated row", () => {
  const range = resolveGridVisibleRange({
    totalItems: 121,
    columns: 6,
    rowHeight: 180,
    scrollTop: 999_999,
    viewportHeight: 360
  });

  assert.equal(range.end, 121);
  assert.equal(range.end > range.start, true);
  assert.equal(range.padBottom, 0);
});
