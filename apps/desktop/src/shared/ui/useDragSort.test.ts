import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "solid-js";
import {
  resolveDropPosition,
  resolveReorderIndex,
  reorderItems,
  useDragSort,
  type DragSortRowGeometry
} from "./useDragSort";

const ROWS: DragSortRowGeometry[] = [
  { index: 0, top: 0, bottom: 40 },
  { index: 1, top: 40, bottom: 80 },
  { index: 2, top: 80, bottom: 120 },
  { index: 3, top: 120, bottom: 160 }
];

interface ListenerRecord {
  type: string;
  listener: (event: Event) => void;
}

interface FakeWindowEnv {
  windowListeners: ListenerRecord[];
  documentListeners: ListenerRecord[];
  documentElementListeners: ListenerRecord[];
  dispatchWindow: (type: string, event: Event) => void;
  dispatchDocument: (type: string, event: Event) => void;
  dispatchDocumentElement: (type: string, event: Event) => void;
  restore: () => void;
}

const installFakeWindow = (): FakeWindowEnv => {
  const windowListeners: ListenerRecord[] = [];
  const documentListeners: ListenerRecord[] = [];
  const documentElementListeners: ListenerRecord[] = [];

  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

  const recorder = (target: ListenerRecord[]) => ({
    addEventListener: (type: string, listener: EventListener) => {
      target.push({ type, listener });
    },
    removeEventListener: (type: string, listener: EventListener) => {
      const idx = target.findIndex((r) => r.type === type && r.listener === listener);
      if (idx >= 0) target.splice(idx, 1);
    }
  });

  const documentElementHost = recorder(documentElementListeners);
  const documentHost = {
    ...recorder(documentListeners),
    hidden: false,
    documentElement: documentElementHost as unknown as HTMLElement
  };
  const windowHost = recorder(windowListeners);

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowHost
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentHost
  });

  const dispatch = (records: ListenerRecord[], type: string, event: Event) => {
    for (const record of records.slice()) {
      if (record.type === type) record.listener(event);
    }
  };

  return {
    windowListeners,
    documentListeners,
    documentElementListeners,
    dispatchWindow: (type, event) => dispatch(windowListeners, type, event),
    dispatchDocument: (type, event) => dispatch(documentListeners, type, event),
    dispatchDocumentElement: (type, event) =>
      dispatch(documentElementListeners, type, event),
    restore: () => {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", previousWindow);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
      if (previousDocument) {
        Object.defineProperty(globalThis, "document", previousDocument);
      } else {
        Reflect.deleteProperty(globalThis, "document");
      }
    }
  };
};

const makePointerEvent = (type: string, init: Partial<PointerEvent> & { clientX?: number; clientY?: number; pointerId?: number; button?: number }): PointerEvent => {
  const event = new Event(type);
  Object.defineProperties(event, {
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    pointerId: { value: init.pointerId ?? 1 },
    button: { value: init.button ?? 0 }
  });
  return event as PointerEvent;
};

test("resolveDropPosition picks top-half of target row as 'before'", () => {
  const drop = resolveDropPosition({ rows: ROWS, pointerY: 45 });
  assert.deepEqual(drop, { targetIndex: 1, position: "before" });
});

test("resolveDropPosition picks bottom-half of target row as 'after'", () => {
  const drop = resolveDropPosition({ rows: ROWS, pointerY: 75 });
  assert.deepEqual(drop, { targetIndex: 1, position: "after" });
});

test("resolveReorderIndex returns null for drag onto the same logical slot", () => {
  // drag row 1 to position "after row 1" → no-op
  assert.equal(
    resolveReorderIndex({
      fromIndex: 1,
      targetIndex: 1,
      position: "after",
      totalItems: 4
    }),
    null
  );
  // drag row 1 to position "before row 1" → no-op
  assert.equal(
    resolveReorderIndex({
      fromIndex: 1,
      targetIndex: 1,
      position: "before",
      totalItems: 4
    }),
    null
  );
  // drag row 1 to "before row 2" is also a no-op (insertion 2 minus shift = 1)
  assert.equal(
    resolveReorderIndex({
      fromIndex: 1,
      targetIndex: 2,
      position: "before",
      totalItems: 4
    }),
    null
  );
});

test("resolveReorderIndex computes forward and backward moves", () => {
  // move row 0 to "after row 2" → land at index 2
  assert.equal(
    resolveReorderIndex({
      fromIndex: 0,
      targetIndex: 2,
      position: "after",
      totalItems: 4
    }),
    2
  );
  // move row 3 to "before row 0" → land at index 0
  assert.equal(
    resolveReorderIndex({
      fromIndex: 3,
      targetIndex: 0,
      position: "before",
      totalItems: 4
    }),
    0
  );
});

test("reorderItems moves entries without dropping data", () => {
  const result = reorderItems(["a", "b", "c", "d"], 0, 2);
  assert.deepEqual(result, ["b", "c", "a", "d"]);
  const reversed = reorderItems(["a", "b", "c", "d"], 3, 1);
  assert.deepEqual(reversed, ["a", "d", "b", "c"]);
});

test("useDragSort commits a reorder when the pointer drops in the bottom half", () => {
  const env = installFakeWindow();
  try {
    const reorders: Array<[number, number]> = [];
    createRoot((dispose) => {
      const sort = useDragSort({
        getRows: () => ROWS,
        getTotalItems: () => ROWS.length,
        onReorder: (from, to) => {
          reorders.push([from, to]);
        }
      });

      // begin drag on row 0
      sort.beginDrag(0, makePointerEvent("pointerdown", { clientY: 20 }));
      // move into bottom half of row 2
      env.dispatchWindow("pointermove", makePointerEvent("pointermove", { clientY: 110 }));
      // release
      env.dispatchWindow("pointerup", makePointerEvent("pointerup", { clientY: 110 }));

      assert.deepEqual(reorders, [[0, 2]]);
      assert.equal(sort.state(), null);
      dispose();
    });
  } finally {
    env.restore();
  }
});

test("useDragSort cancels on Escape and does not emit reorder", () => {
  const env = installFakeWindow();
  try {
    const reorders: Array<[number, number]> = [];
    createRoot((dispose) => {
      const sort = useDragSort({
        getRows: () => ROWS,
        getTotalItems: () => ROWS.length,
        onReorder: (from, to) => {
          reorders.push([from, to]);
        }
      });

      sort.beginDrag(0, makePointerEvent("pointerdown", { clientY: 20 }));
      env.dispatchWindow("pointermove", makePointerEvent("pointermove", { clientY: 100 }));

      const escape = new Event("keydown") as KeyboardEvent & Record<string, unknown>;
      (escape as { key: string }).key = "Escape";
      env.dispatchWindow("keydown", escape);

      assert.equal(sort.state(), null);
      assert.equal(reorders.length, 0);

      // pointerup after cancel should be a no-op (listeners detached)
      env.dispatchWindow("pointerup", makePointerEvent("pointerup", { clientY: 100 }));
      assert.equal(reorders.length, 0);

      dispose();
    });
  } finally {
    env.restore();
  }
});

test("useDragSort cancels when pointer leaves the window", () => {
  const env = installFakeWindow();
  try {
    const reorders: Array<[number, number]> = [];
    createRoot((dispose) => {
      const sort = useDragSort({
        getRows: () => ROWS,
        getTotalItems: () => ROWS.length,
        onReorder: (from, to) => {
          reorders.push([from, to]);
        }
      });

      sort.beginDrag(0, makePointerEvent("pointerdown", { clientY: 20 }));

      const leaveEvent = makePointerEvent("pointerleave", { clientY: -5 }) as PointerEvent & {
        target: unknown;
        relatedTarget: unknown;
      };
      // Simulate leaving the viewport: relatedTarget === null marks an exit.
      Object.defineProperties(leaveEvent, {
        relatedTarget: { value: null },
        target: { value: (document as unknown as { documentElement: unknown }).documentElement }
      });
      env.dispatchDocumentElement("pointerleave", leaveEvent);

      assert.equal(sort.state(), null);

      // pointerup after cancel should NOT trigger reorder
      env.dispatchWindow("pointerup", makePointerEvent("pointerup", { clientY: 110 }));
      assert.equal(reorders.length, 0);

      dispose();
    });
  } finally {
    env.restore();
  }
});

test("useDragSort treats a drop on the same position as a no-op", () => {
  const env = installFakeWindow();
  try {
    const reorders: Array<[number, number]> = [];
    createRoot((dispose) => {
      const sort = useDragSort({
        getRows: () => ROWS,
        getTotalItems: () => ROWS.length,
        onReorder: (from, to) => {
          reorders.push([from, to]);
        }
      });

      // start on row 1, release back on row 1 (top half) → no-op
      sort.beginDrag(1, makePointerEvent("pointerdown", { clientY: 50 }));
      env.dispatchWindow("pointermove", makePointerEvent("pointermove", { clientY: 45 }));
      env.dispatchWindow("pointerup", makePointerEvent("pointerup", { clientY: 45 }));

      assert.equal(reorders.length, 0);
      assert.equal(sort.state(), null);

      dispose();
    });
  } finally {
    env.restore();
  }
});
