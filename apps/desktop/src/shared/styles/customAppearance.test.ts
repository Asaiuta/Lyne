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

test("appearance token plan keeps surface roots neutral and cover accent follow-through", () => {
  const plan = buildAppearanceColorTokenPlan({
    playerFollowCoverColor: true
  });
  const semantic = tokenMap(plan.semantic);

  assertUniqueTokenNames(plan.semantic);
  assert.equal(semantic.get("--bg-dynamic"), "var(--bg-base)");
  assert.equal(semantic.get("--surface-container-dynamic"), "var(--surface-container-default)");
  assert.equal(semantic.get("--floating-surface-dynamic"), "var(--surface-2)");
  assert.equal(semantic.get("--player-cover-color"), "var(--player-cover-accent)");
});

test("appearance token plan falls back to the neutral cover accent when cover following is off", () => {
  const plan = buildAppearanceColorTokenPlan({
    playerFollowCoverColor: false
  });
  const semantic = tokenMap(plan.semantic);

  assertUniqueTokenNames(plan.semantic);
  assert.equal(semantic.get("--bg-dynamic"), "var(--bg-base)");
  assert.equal(semantic.get("--surface-container-dynamic"), "var(--surface-container-default)");
  assert.equal(semantic.get("--floating-surface-dynamic"), "var(--surface-2)");
  assert.equal(semantic.get("--player-cover-color"), "var(--player-cover-accent-default)");
});