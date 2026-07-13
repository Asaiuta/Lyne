import assert from "node:assert/strict";
import test from "node:test";

import queueDrawerCss from "./queue-drawer.css?raw";

function readQueueDrawerBlock(): string {
  const match = /\.queue-drawer\s*\{([^}]*)\}/.exec(queueDrawerCss);
  if (match === null) {
    throw new Error("queue drawer block not found");
  }
  return match[1];
}

test("queue drawer shell uses the opaque floating surface token", () => {
  const block = readQueueDrawerBlock();

  assert.equal(/background:\s*var\(--floating-surface\);/.test(block), true);
  assert.equal(/background:\s*color-mix\([^;]*transparent[^;]*\);/.test(block), false);
});
