import assert from "node:assert/strict";
import test from "node:test";
import contextMenuSource from "../../../components/media/ContextMenu.tsx?raw";
import fallbackSource from "./dropdown.tsx?raw";
import kobalteSource from "./NaiveDropdownKobalte.tsx?raw";

test("dropdown cascade is implemented in both the eager fallback and Kobalte path", () => {
  for (const pattern of [
    /FallbackDropdownSubmenuRow/,
    /placement: "right-start"/,
    /event\.key === "ArrowRight"/
  ]) {
    assert.equal(pattern.test(fallbackSource), true);
  }
  for (const pattern of [
    /<DropdownMenu\.Sub gutter=\{4\}>/,
    /<DropdownMenu\.SubTrigger/,
    /<DropdownMenu\.SubContent/
  ]) {
    assert.equal(pattern.test(kobalteSource), true);
  }
  assert.equal(/cascade children deferred/.test(kobalteSource), false);
});

test("media context menus delegate virtual positioning and submenu behavior", () => {
  assert.equal(/<NaiveDropdown\b/.test(contextMenuSource), true);
  assert.equal(/x=\{props\.x\}/.test(contextMenuSource), true);
  assert.equal(/show=\{props\.open\}/.test(contextMenuSource), true);
  for (const forbidden of [/useDismissibleOverlay/, /computeFloatingPosition/, /<Portal\b/]) {
    assert.equal(forbidden.test(contextMenuSource), false);
  }
});
