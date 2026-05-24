import assert from "node:assert/strict";
import test from "node:test";

import { argbFromHex } from "@material/material-color-utilities";

import { createDefaultPalette, createPaletteFromSource } from "./paletteEngine";

test("createDefaultPalette keeps the SPlayer coral seed stable in dark mode", () => {
  const palette = createDefaultPalette("dark");

  assert.equal(palette.tokens.primary, "rgb(255 179 173)");
  assert.equal(palette.tokens.onPrimary, "rgb(102 6 12)");
  assert.equal(palette.tokens.primaryContainer, "rgb(134 32 32)");
  assert.equal(palette.tokens.onPrimaryContainer, "rgb(255 218 214)");
  assert.equal(palette.tokens.neutralContainer, "rgb(77 69 68)");
});

test("createDefaultPalette uses Material tone mapping for light mode", () => {
  const palette = createDefaultPalette("light");

  assert.equal(palette.tokens.primary, "rgb(167 56 52)");
  assert.equal(palette.tokens.onPrimary, "rgb(255 255 255)");
  assert.equal(palette.tokens.primaryContainer, "rgb(255 218 214)");
  assert.equal(palette.tokens.onPrimaryContainer, "rgb(65 0 3)");
});

test("createPaletteFromSource produces role-separated colors from a cover seed", () => {
  const palette = createPaletteFromSource(argbFromHex("#3366cc"), "dark");

  assert.equal(palette.tokens.primary, "rgb(177 197 255)");
  assert.equal(palette.tokens.secondary, "rgb(192 198 220)");
  assert.equal(palette.tokens.tertiary, "rgb(224 187 221)");
  assert.equal(palette.tokens.neutralContainer, "rgb(70 70 74)");
  assert.equal(palette.tokens.primary === palette.tokens.secondary, false);
});
