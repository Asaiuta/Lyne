import assert from "node:assert/strict";
import test from "node:test";

import { buildAppearanceColorTokenPlan } from "./customAppearance";

function tokenMap(entries: readonly (readonly [`--${string}`, string])[]): Map<string, string> {
  return new Map(entries);
}

function assertUniqueTokenNames(entries: readonly (readonly [`--${string}`, string])[]): void {
  const names = entries.map(([name]) => name);
  assert.equal(new Set(names).size, names.length);
}

test("neutral appearance token plan keeps runtime color writes on semantic roots", () => {
  const plan = buildAppearanceColorTokenPlan({
    playerFollowCoverColor: true,
    themeGlobalColor: false
  });
  const semantic = tokenMap(plan.semantic);

  assertUniqueTokenNames(plan.semantic);
  assert.equal(plan.themeGlobalColor, false);
  assert.equal(semantic.get("--bg-dynamic"), "var(--bg-base)");
  assert.equal(semantic.get("--surface-container-dynamic"), "var(--surface-container-default)");
  assert.equal(semantic.get("--floating-surface-dynamic"), "var(--surface-2)");
  assert.equal(semantic.get("--player-cover-color"), "var(--player-cover-accent)");
});

test("global appearance token plan tints shell surfaces from SPlayer palette aliases", () => {
  const plan = buildAppearanceColorTokenPlan({
    playerFollowCoverColor: false,
    themeGlobalColor: true
  });
  const semantic = tokenMap(plan.semantic);

  assertUniqueTokenNames(plan.semantic);
  assert.equal(plan.themeGlobalColor, true);
  assert.equal(semantic.get("--bg-dynamic"), "var(--splayer-background, var(--bg-base))");
  assert.equal(
    semantic.get("--surface-container-dynamic"),
    "var(--splayer-surface-container, var(--surface-container-default))"
  );
  assert.equal(semantic.get("--player-cover-color"), "var(--player-cover-accent-default)");
});
