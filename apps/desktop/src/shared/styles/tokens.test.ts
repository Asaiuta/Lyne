import assert from "node:assert/strict";
import test from "node:test";

import tokensCss from "./tokens.css?raw";
import {
  createDefaultPalette,
  type DynamicPalette,
  type PaletteTokenName
} from "../theme/paletteEngine";

const PALETTE_TOKEN_NAMES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "neutral",
  "onNeutral",
  "neutralContainer",
  "onNeutralContainer",
  "neutralVariant",
  "onNeutralVariant",
  "neutralVariantContainer",
  "onNeutralVariantContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer"
] as const satisfies readonly PaletteTokenName[];

type PaletteExpectation = readonly [`--${string}`, (palette: DynamicPalette) => string];

const THEME_TOKEN_EXPECTATIONS: readonly PaletteExpectation[] = [
  ["--theme-primary", (palette) => palette.theme.primary],
  ["--theme-primary-rgb", (palette) => palette.theme.primaryRgb],
  ["--theme-background", (palette) => palette.theme.background],
  ["--theme-background-rgb", (palette) => palette.theme.backgroundRgb],
  ["--theme-surface-container", (palette) => palette.theme.surfaceContainer],
  ["--theme-surface-container-rgb", (palette) => palette.theme.surfaceContainerRgb],
  ["--theme-main-cover-color", (palette) => palette.theme.main],
  ["--theme-main-cover-rgb", (palette) => palette.theme.mainRgb]
];

function readRootTokenBlock(): string {
  const match = /^:root\s*\{([\s\S]*?)\n\}/m.exec(tokensCss);
  if (match === null) {
    throw new Error("root token block not found");
  }
  return match[1];
}

function readLightThemeBlock(): string {
  const match = /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/.exec(tokensCss);
  if (match === null) {
    throw new Error("light theme block not found");
  }
  return match[1];
}

function readAppearanceModeBlock(mode: string): string {
  const match = new RegExp(`\\[data-appearance-mode="${mode}"\\]\\s*\\{([^}]*)\\}`).exec(tokensCss);
  if (match === null) {
    throw new Error(`appearance mode block not found: ${mode}`);
  }
  return match[1];
}

function readDeclarationValue(block: string, name: `--${string}`): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (match === null) {
    throw new Error(`declaration not found: ${name}`);
  }
  return match[1].trim();
}

function paletteTokenCssVar(name: PaletteTokenName): `--${string}` {
  return `--color-${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}` as `--${string}`;
}

function assertDefaultPaletteDeclarations(block: string, palette: DynamicPalette): void {
  PALETTE_TOKEN_NAMES.forEach((name) => {
    assert.equal(readDeclarationValue(block, paletteTokenCssVar(name)), palette.tokens[name]);
  });

  THEME_TOKEN_EXPECTATIONS.forEach(([name, readExpected]) => {
    assert.equal(readDeclarationValue(block, name), readExpected(palette));
  });
}

test("dark CSS palette defaults match the palette engine default", () => {
  assertDefaultPaletteDeclarations(readRootTokenBlock(), createDefaultPalette("dark"));
});

test("light CSS palette defaults match the palette engine default", () => {
  assertDefaultPaletteDeclarations(readLightThemeBlock(), createDefaultPalette("light"));
});

test("player bar accent defaults derive from the theme primary alias", () => {
  assert.equal(readDeclarationValue(readRootTokenBlock(), "--player-bar-accent-default"), "var(--theme-primary)");
  assert.equal(readDeclarationValue(readLightThemeBlock(), "--player-bar-accent-default"), "var(--theme-primary)");
});

test("cover blur keeps menu and modal surface tokens on opaque semantic roots", () => {
  const block = readAppearanceModeBlock("cover-blur");

  assert.equal(
    readDeclarationValue(block, "--surface-container"),
    "var(--surface-container-opaque-dynamic, var(--surface-container-opaque-default))"
  );
  assert.equal(
    readDeclarationValue(block, "--floating-surface"),
    "var(--floating-surface-opaque-dynamic, var(--floating-surface-opaque-default))"
  );
  assert.equal(
    readDeclarationValue(block, "--player-bar-surface"),
    "var(--player-bar-surface-opaque-dynamic, var(--player-bar-surface-default))"
  );
});

test("global color mode gives cover blur opaque theme-colored floating surfaces", () => {
  assert.equal(
    /--surface-container-opaque-dynamic:\s*var\(--theme-surface-container\);/.test(tokensCss),
    true
  );
  assert.equal(
    /--floating-surface-opaque-dynamic:\s*var\(--theme-surface-container\);/.test(tokensCss),
    true
  );
  assert.equal(
    /--player-bar-surface-opaque-dynamic:\s*var\(--theme-surface-container\);/.test(tokensCss),
    true
  );
});

test("media cards stay neutral by default and become palette-tinted only in global color mode", () => {
  const rootBlock = readRootTokenBlock();
  const globalColorMatch = /\[data-theme-global-color="true"\]\s*\{([\s\S]*?)\n\}/.exec(tokensCss);
  if (globalColorMatch === null) {
    throw new Error("global color token block not found");
  }

  assert.equal(readDeclarationValue(rootBlock, "--media-card-border"), "var(--border-subtle)");
  assert.equal(readDeclarationValue(rootBlock, "--media-card-border-emphasis"), "var(--border-strong)");
  assert.equal(
    readDeclarationValue(rootBlock, "--media-card-selected-bg"),
    "color-mix(in oklch, var(--surface-3) 74%, var(--surface-2))"
  );
  assert.equal(
    readDeclarationValue(globalColorMatch[1], "--media-card-border-emphasis"),
    "var(--color-primary-tonal-58)"
  );
  assert.equal(
    readDeclarationValue(globalColorMatch[1], "--media-card-selected-bg"),
    "color-mix(in oklch, var(--color-primary-container) 50%, var(--surface-2))"
  );
});
