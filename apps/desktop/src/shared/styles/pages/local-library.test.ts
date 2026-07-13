import assert from "node:assert/strict";
import test from "node:test";

import localLibraryCss from "./local-library.css?raw";

test("local library delegates toolbar button states to the shared contract", () => {
  assert.equal(/\.local-library-play\s*\{/.test(localLibraryCss), false);
  assert.equal(/\.local-library-icon-button\s*\{/.test(localLibraryCss), false);
  assert.equal(/\.local-library-more-menu\s*\{[\s\S]*?--n-min-width:\s*136px;/.test(localLibraryCss), true);
});
