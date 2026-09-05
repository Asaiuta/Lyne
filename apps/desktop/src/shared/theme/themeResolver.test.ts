import assert from "node:assert/strict";
import test from "node:test";
import { resolveThemeMode } from "./themeResolver";

test("theme resolver passes explicit modes through without touching the DOM", () => {
  assert.equal(resolveThemeMode("dark"), "dark");
  assert.equal(resolveThemeMode("light"), "light");
});

test("theme resolver resolves auto to dark when no window exists (SSR-safe)", () => {
  assert.equal(resolveThemeMode("auto"), "dark");
});
