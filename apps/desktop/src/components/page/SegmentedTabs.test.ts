import assert from "node:assert/strict";
import test from "node:test";
import source from "./SegmentedTabs.tsx?raw";
import css from "../../shared/styles/components/segmented-tabs.css?raw";

test("segmented tabs are a compatibility adapter over NaiveTabs", () => {
  assert.equal(/<NaiveTabs\b/.test(source), true);
  assert.equal(/type="segment"/.test(source), true);
  assert.equal(/<button\b/.test(source), false);
  assert.equal(/<select\b/.test(source), false);
  assert.equal(/styles\/components\/segmented-tabs\.css/.test(source), true);
  assert.equal(/size="medium"/.test(source), true);
  assert.equal(/SegmentedTabsDensity = "regular" \| "compact"/.test(source), true);
  assert.equal(/SegmentedTabItem<TValue extends string = string>/.test(source), true);
  assert.equal(/items: ReadonlyArray<SegmentedTabItem<TValue>>/.test(source), true);
  assert.equal(/segmented-tabs--compact/.test(source), true);
  assert.equal(/segmented-tabs--regular/.test(source), true);
  assert.equal(/--n-color-segment:\s*var\(--segmented-surface\)/.test(css), true);
  assert.equal(/--n-tab-color-segment:\s*var\(--segmented-active-bg\)/.test(css), true);
  assert.equal(/--n-tab-text-color:\s*var\(--segmented-text-color\)/.test(css), true);
  assert.equal(/--n-tab-text-color-hover:\s*var\(--segmented-hover-color\)/.test(css), true);
  assert.equal(/--n-tab-text-color-active:\s*var\(--segmented-active-color\)/.test(css), true);
  assert.equal(/\.segmented-tab:(?:hover|disabled)|\.segmented-tab\.is-active/.test(css), false);
  assert.equal(
    /@media\s*\(max-width:\s*720px\)[\s\S]*?\.naive-tabs\.n-tabs\.segmented-tabs\.segmented-tabs--compact\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;/.test(css),
    true
  );
});
