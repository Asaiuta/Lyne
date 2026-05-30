import assert from "node:assert/strict";
import test from "node:test";

import { argbFromHex } from "@material/material-color-utilities";

import {
  createDefaultPalette,
  createMonotonousPalette,
  createPaletteFromExtractedSource,
  createPaletteFromSource,
  extractPaletteSourceFromPixels
} from "./paletteEngine";

function makePixels(colors: ReadonlyArray<readonly [number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, a]) => [r, g, b, a]));
}

test("createDefaultPalette keeps the SPlayer coral seed stable in dark mode", () => {
  const palette = createDefaultPalette("dark");

  assert.equal(palette.tokens.primary, "rgb(255 179 173)");
  assert.equal(palette.tokens.onPrimary, "rgb(102 6 12)");
  assert.equal(palette.tokens.primaryContainer, "rgb(134 32 32)");
  assert.equal(palette.tokens.onPrimaryContainer, "rgb(255 218 214)");
  assert.equal(palette.tokens.neutralContainer, "rgb(77 69 68)");
  assert.equal(palette.theme.main, "rgb(255 218 214)");
  assert.equal(palette.theme.primary, "rgb(255 218 214)");
  assert.equal(palette.theme.background, "rgb(68 41 39)");
  assert.equal(palette.theme.surfaceContainer, "rgb(58 33 31)");
});

test("createDefaultPalette uses Material tone mapping for light mode", () => {
  const palette = createDefaultPalette("light");

  assert.equal(palette.tokens.primary, "rgb(167 56 52)");
  assert.equal(palette.tokens.onPrimary, "rgb(255 255 255)");
  assert.equal(palette.tokens.primaryContainer, "rgb(255 218 214)");
  assert.equal(palette.tokens.onPrimaryContainer, "rgb(65 0 3)");
  assert.equal(palette.theme.main, "rgb(255 218 214)");
  assert.equal(palette.theme.primary, "rgb(44 21 19)");
  assert.equal(palette.theme.background, "rgb(255 233 231)");
  assert.equal(palette.theme.surfaceContainer, "rgb(255 218 214)");
});

test("createPaletteFromSource produces role-separated colors from a cover seed", () => {
  const palette = createPaletteFromSource(argbFromHex("#3366cc"), "dark");

  assert.equal(palette.tokens.primary, "rgb(177 197 255)");
  assert.equal(palette.tokens.secondary, "rgb(192 198 220)");
  assert.equal(palette.tokens.tertiary, "rgb(224 187 221)");
  assert.equal(palette.tokens.neutralContainer, "rgb(70 70 74)");
  assert.equal(palette.tokens.primary === palette.tokens.secondary, false);
});

test("extractPaletteSourceFromPixels returns SPlayer monotonous source for near-gray covers", () => {
  const pixels = makePixels(Array.from({ length: 20 }, () => [100, 101, 102, 255] as const));

  assert.deepEqual(extractPaletteSourceFromPixels(pixels), {
    sourceArgb: null,
    isMonotonous: true
  });
});

test("createMonotonousPalette mirrors SPlayer dark gray fallback theme", () => {
  const palette = createMonotonousPalette("dark");

  assert.equal(palette.isMonotonous, true);
  assert.equal(palette.theme.main, "rgb(239 239 239)");
  assert.equal(palette.theme.primary, "rgb(239 239 239)");
  assert.equal(palette.theme.background, "rgb(31 31 31)");
  assert.equal(palette.theme.surfaceContainer, "rgb(39 39 39)");
});

test("createPaletteFromExtractedSource keeps non-monotone covers on Material source colors", () => {
  const palette = createPaletteFromExtractedSource(
    { sourceArgb: argbFromHex("#3366cc"), isMonotonous: false },
    "dark"
  );

  assert.equal(palette.isMonotonous, false);
  assert.equal(palette.theme.main, "rgb(220 226 249)");
  assert.equal(palette.theme.primary, "rgb(220 226 249)");
  assert.equal(palette.theme.background, "rgb(42 48 66)");
  assert.equal(palette.theme.surfaceContainer, "rgb(33 39 57)");
});
