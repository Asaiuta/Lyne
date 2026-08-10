import assert from "node:assert/strict";
import test from "node:test";

import localLibraryCss from "./local-library.css?raw";

test("local library bounds its internal list viewport to the shell content height", () => {
  assert.equal(
    /\.panel-library\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/.test(
      localLibraryCss
    ),
    true
  );
  assert.equal(
    /\.local-library-router\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/.test(
      localLibraryCss
    ),
    true
  );
});

test("local library delegates toolbar button states to the shared contract", () => {
  assert.equal(/\.local-library-play\s*\{/.test(localLibraryCss), false);
  assert.equal(/\.local-library-icon-button\s*\{/.test(localLibraryCss), false);
  assert.equal(/\.local-library-more-menu\s*\{[\s\S]*?--n-min-width:\s*136px;/.test(localLibraryCss), true);
});
