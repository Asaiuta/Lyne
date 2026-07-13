import assert from "node:assert/strict";
import test from "node:test";

import sidebarSource from "../../../app/Sidebar.tsx?raw";
import layoutCss from "./layout.css?raw";

function readRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(layoutCss);
  if (match === null) throw new Error(`CSS rule not found: ${selector}`);
  return match[1];
}

test("sidebar geometry is driven by one inherited animated width token", () => {
  assert.equal(
    /@property\s+--sidebar-inline-size\s*\{[\s\S]*?syntax:\s*"<length>";[\s\S]*?inherits:\s*true;/.test(
      layoutCss
    ),
    true
  );

  const sidebarRule = readRule(".sidebar");
  assert.equal(
    /transition:[\s\S]*?--sidebar-inline-size\s+var\(--motion-duration-spatial\)/.test(
      sidebarRule
    ),
    true
  );
  assert.equal(/\b(?:width|min-width|max-width)\s+var\(--motion-duration-spatial\)/.test(sidebarRule), false);

  for (const selector of [
    ".sidebar-scrollbar",
    ".sidebar-content",
    ".sidebar-brand",
    ".sidebar-scroll",
    ".sidebar-menu",
    ".sidebar-section-header",
    ".sidebar-nav-button,\n  .sidebar-playlist-button",
    ".sidebar-nav-item",
    ".sidebar-playlist-item"
  ]) {
    const rule = readRule(selector);
    assert.equal(
      /width:\s*var\(--sidebar-inline-size\);/.test(rule),
      true,
      `${selector} must consume --sidebar-inline-size`
    );
    assert.equal(
      /\b(?:width|min-width|max-width)\s+var\(--motion-duration-spatial\)/.test(rule),
      false,
      `${selector} must not start an independent geometry transition`
    );
  }
});

test("sidebar motion lifecycle suppresses transient main-content hover retargeting", () => {
  assert.equal(
    /\.app-body:has\(> \.sidebar\.is-collapse-motion-active\) \.app-main\s*\{[\s\S]*?pointer-events:\s*none;/.test(
      layoutCss
    ),
    true
  );
  assert.equal(
    /const COLLAPSE_TRANSITION_PROPERTY = "--sidebar-inline-size";/.test(sidebarSource),
    true
  );
  assert.equal(
    /event\.type === "transitionend" \|\| event\.type === "transitioncancel"/.test(
      sidebarSource
    ),
    true
  );
});
