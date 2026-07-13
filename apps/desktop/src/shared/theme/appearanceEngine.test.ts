import assert from "node:assert/strict";
import test from "node:test";
import { appearanceEngine } from "./appearanceEngine";

test("appearance background switch overrides a stale solid mode stub", () => {
  appearanceEngine.setAppearanceMode("solid");
  appearanceEngine.syncRuntime({ backgroundEnabled: true, fullPlayerOpen: false });

  assert.equal(appearanceEngine.baseMode(), "cover-blur");
  assert.equal(appearanceEngine.effectiveMode(), "cover-blur");

  appearanceEngine.syncRuntime({ backgroundEnabled: false, fullPlayerOpen: false });
  assert.equal(appearanceEngine.baseMode(), "solid");
});

test("appearance background switch ignores stale non-cover mode stubs", () => {
  appearanceEngine.setAppearanceMode("particles");
  appearanceEngine.syncRuntime({ backgroundEnabled: true, fullPlayerOpen: true });

  assert.equal(appearanceEngine.baseMode(), "cover-blur");
  assert.equal(appearanceEngine.effectiveMode(), "cover-blur");
});

test("appearance background switch preserves explicit cover background modes", () => {
  appearanceEngine.setAppearanceMode("cover-immersive");
  appearanceEngine.syncRuntime({ backgroundEnabled: true, fullPlayerOpen: false });

  assert.equal(appearanceEngine.baseMode(), "cover-immersive");
  assert.equal(appearanceEngine.effectiveMode(), "cover-immersive");

  appearanceEngine.syncRuntime({ backgroundEnabled: false, fullPlayerOpen: false });
  assert.equal(appearanceEngine.baseMode(), "solid");

  appearanceEngine.setAppearanceMode("solid");
});
