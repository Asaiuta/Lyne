import assert from "node:assert/strict";
import test from "node:test";
import contextMenuSource from "../../../components/media/ContextMenu.tsx?raw";
import fullPlayerStyles from "../../styles/full-player/primary-panel.css?raw";
import contextMenuStyles from "../../styles/pages/context-menu.css?raw";
import tokensStyles from "../../styles/tokens.css?raw";
import selectStyles from "./styles/select-kobalte.css?raw";
import naiveStyles from "./styles.css?raw";

const SHARED_INSET_DECLARATION =
  /inset-inline:\s*var\(--naive-menu-option-inline-inset\)/g;

test("floating Naive option menus share one inline highlight inset token", () => {
  assert.equal(/--naive-menu-option-inline-inset:\s*4px;/.test(tokensStyles), true);
  assert.equal(naiveStyles.match(SHARED_INSET_DECLARATION)?.length, 2);
  assert.equal(selectStyles.match(SHARED_INSET_DECLARATION)?.length, 1);
  assert.equal(
    /\.n-dropdown-option::before\s*\{[^}]*\b(?:left|right):\s*4px/s.test(naiveStyles),
    false
  );
  assert.equal(
    /\.n-popselect-menu \.n-base-select-option::before\s*\{[^}]*inset:\s*0 4px/s.test(
      naiveStyles
    ),
    false
  );
  assert.equal(
    /\.naive-select-menu \.n-base-select-option::before\s*\{[^}]*inset:\s*0 4px/s.test(
      selectStyles
    ),
    false
  );
});

test("dropdown expanded rows reuse the shared pseudo-element highlight", () => {
  for (const state of ["data-expanded", 'aria-expanded="true"']) {
    assert.equal(
      new RegExp(`\\.n-dropdown-option[^,{]*\\[${state}\\]::before`).test(naiveStyles),
      true
    );
  }
});

test("migrated context menus do not retain legacy option hover ownership", () => {
  assert.equal(/context-menu-item/.test(contextMenuSource), false);
  assert.equal(/\.context-menu-item/.test(contextMenuStyles), false);
  assert.equal(/^@layer components\s*\{/.test(contextMenuStyles), true);
  assert.equal(/--n-option-height:\s*40px;/.test(contextMenuStyles), true);
  assert.equal(
    /\.context-menu \.n-dropdown-option\s*\{[^}]*padding-inline:\s*12px;/s.test(
      contextMenuStyles
    ),
    true
  );
  assert.equal(
    /\.n-dropdown\.n-dropdown-menu\.context-menu\s*\{[^}]*\bpadding:/s.test(
      contextMenuStyles
    ),
    false
  );
});

test("customized full-player Popselect keeps block-only surface padding", () => {
  assert.equal(
    /\.full-player-meta-popover\.n-popselect-menu\.n-base-select-menu\s*\{[^}]*padding:\s*4px 0;/s.test(
      fullPlayerStyles
    ),
    true
  );
});
