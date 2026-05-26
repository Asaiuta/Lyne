import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNaiveGridResponsiveValue,
  resolveNaiveGridItemStates
} from "./grid-logic";

test("NaiveGrid parses NaiveUI responsive numeric and breakpoint values", () => {
  assert.equal(parseNaiveGridResponsiveValue(24, undefined, 1), 24);
  assert.equal(parseNaiveGridResponsiveValue("1 600:2 1000:3", 599, 24), 1);
  assert.equal(parseNaiveGridResponsiveValue("1 600:2 1000:3", 640, 24), 2);
  assert.equal(parseNaiveGridResponsiveValue("1 600:2 1000:3", 1200, 24), 3);
  assert.equal(parseNaiveGridResponsiveValue("1 s:2 m:3 l:4", 1024, 24), 3);
});

test("NaiveGrid keeps suffix visible and reports overflow when collapsed", () => {
  const states = resolveNaiveGridItemStates({
    collapsed: true,
    collapsedRows: 1,
    cols: 7,
    items: [
      { id: "a", span: 1, offset: 0, suffix: false },
      { id: "b", span: 1, offset: 0, suffix: false },
      { id: "c", span: 1, offset: 0, suffix: false },
      { id: "d", span: 1, offset: 0, suffix: false },
      { id: "e", span: 1, offset: 0, suffix: false },
      { id: "f", span: 1, offset: 0, suffix: false },
      { id: "g", span: 1, offset: 0, suffix: false },
      { id: "suffix", span: 1, offset: 0, suffix: true }
    ]
  });

  assert.equal(states.a.show, true);
  assert.equal(states.f.show, true);
  assert.equal(states.g.show, false);
  assert.equal(states.suffix.show, true);
  assert.equal(states.suffix.colStart, 7);
  assert.equal(states.suffix.overflow, true);
});

test("NaiveGrid item offsets consume span and create margin input", () => {
  const states = resolveNaiveGridItemStates({
    collapsed: false,
    collapsedRows: 1,
    cols: 24,
    items: [{ id: "offset", span: 10, offset: 2, suffix: false }]
  });

  assert.equal(states.offset.span, 12);
  assert.equal(states.offset.offset, 2);
  assert.equal(states.offset.show, true);
});
