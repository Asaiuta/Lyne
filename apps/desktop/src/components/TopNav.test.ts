import assert from "node:assert/strict";
import test from "node:test";
import layoutCss from "../shared/styles/shell/layout.css?raw";
import topNavSource from "./TopNav.tsx?raw";

test("top nav removes online search and account controls in offline mode", () => {
  assert.equal(
    /<Show when=\{uiSettings\.useOnlineService\}>\s*<div class=\{searchWrapClassName\(\)\}>/.test(
      topNavSource
    ),
    true
  );
  assert.equal(
    /<Show when=\{uiSettings\.useOnlineService\}>\s*<TopNavAccountMenu[\s\S]*?<\/Show>/.test(
      topNavSource
    ),
    true
  );
});

test("top nav search uses the shared Naive input contract", () => {
  assert.equal(/<NaiveInput\b/.test(topNavSource), true);
  assert.equal(/inputRef=/.test(topNavSource), true);
  assert.equal(/clearable/.test(topNavSource), true);
  assert.equal(/\bround\b/.test(topNavSource), true);
  assert.equal(/bordered=\{false\}/.test(topNavSource), false);
  assert.equal(/<input\b/.test(topNavSource), false);
});

test("top nav search leaves visual states to NaiveInput", () => {
  const outerRule = /\.top-nav-search\s*\{([^}]*)\}/.exec(layoutCss)?.[1] ?? "";
  const inputRules = [...layoutCss.matchAll(/\.top-nav-search-input\.naive-input\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join("\n");

  assert.equal(/(?:^|;)\s*(?:background|border|box-shadow)\s*:/.test(outerRule), false);
  assert.equal(/--n-height:\s*40px;/.test(inputRules), true);
  assert.equal(/--n-color(?:-focus|-disabled)?:\s*transparent;/.test(inputRules), false);
});
