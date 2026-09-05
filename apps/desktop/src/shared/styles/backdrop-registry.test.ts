import assert from "node:assert/strict";
import test from "node:test";

import tokensCss from "./tokens.css?raw";
import naiveStylesCss from "../ui/naive/styles.css?raw";
import queueDrawerCss from "./modals/queue-drawer.css?raw";
import shellCss from "./full-player/shell.css?raw";
import lyricsCss from "./full-player/lyrics.css?raw";
import primaryPanelCss from "./full-player/primary-panel.css?raw";

const componentSources: ReadonlyArray<readonly [string, string]> = [
  ["ui/naive/styles.css", naiveStylesCss],
  ["modals/queue-drawer.css", queueDrawerCss],
  // full-player/background.css is intentionally absent: the legacy inner
  // background (`.full-player-background*`, the only token-backed
  // backdrop-filter consumer there) was removed in 08-03-appearance-single-path;
  // the file now only holds vignette/fullscreen-cover rules with no
  // backdrop-filter declaration of its own (the vignette token is applied
  // through tokens.css `:where(.full-player-vignette)`).
  ["full-player/shell.css", shellCss],
  ["full-player/lyrics.css", lyricsCss],
  ["full-player/primary-panel.css", primaryPanelCss]
];

const BACKDROP_LITERAL_PATTERN = /(?:-webkit-)?backdrop-filter:\s*blur\(/;

const registryTokens = (): string[] => {
  // Extract the token names only from the registry `:root` block (the one
  // introduced by the "centralized backdrop registry" comment), not from
  // usages elsewhere (e.g. the [data-appearance-mode="solid"] none-list).
  const registryStart = tokensCss.indexOf("centralized backdrop registry");
  assert.equal(registryStart !== -1, true, "tokens.css should contain the backdrop registry");
  const rootOpen = tokensCss.indexOf(":root {", registryStart);
  assert.equal(rootOpen !== -1, true, "registry should open a :root block");
  const rootClose = tokensCss.indexOf("\n}", rootOpen);
  assert.equal(rootClose !== -1, true, "registry :root block should close");
  const registryBlock = tokensCss.slice(rootOpen, rootClose);
  const tokens = [...registryBlock.matchAll(/(--[\w-]*backdrop-filter)(?=\s*:)/g)].map(
    (match) => match[1]
  );
  assert.equal(tokens.length >= 6, true, "registry should define the backdrop tokens");
  assert.equal(
    new Set(tokens).size,
    tokens.length,
    "backdrop tokens should be unique"
  );
  return tokens;
};

const solidAppearanceBlock = (): string => {
  const match = tokensCss.match(/\[data-appearance-mode="solid"\]\s*\{([\s\S]*?)\n\}/);
  assert.equal(match !== null, true, "tokens.css should contain the [data-appearance-mode=\"solid\"] block");
  return (match as RegExpMatchArray)[1];
};

test("component CSS never hardcodes backdrop-filter blur literals", () => {
  for (const [name, source] of componentSources) {
    assert.equal(
      BACKDROP_LITERAL_PATTERN.test(source),
      false,
      `${name} must use a --*-backdrop-filter token, not a blur() literal`
    );
    // Positive guard: the backdrop-filter property must still exist, now
    // routed through a token var (catches edits that dropped the rule).
    assert.equal(
      /(?:-webkit-)?backdrop-filter:\s*var\(--[\w-]*backdrop-filter[\w-]*\)/.test(source),
      true,
      `${name} should keep a token-backed backdrop-filter declaration`
    );
  }
});

test("solid appearance mode disables every backdrop-filter token", () => {
  const tokens = registryTokens();
  const solidBlock = solidAppearanceBlock();
  for (const token of tokens) {
    assert.equal(
      new RegExp(`${token}:\\s*none;`).test(solidBlock),
      true,
      `[data-appearance-mode="solid"] should set ${token} to none`
    );
  }
});
