import assert from "node:assert/strict";
import test from "node:test";
import type { Component } from "solid-js";
import { createDeferredLazyComponent } from "./deferredLazyComponent";

test("deferred lazy component shares one cached module load", async () => {
  let loads = 0;
  const resolvedComponent: Component<Record<string, never>> = () => null;
  const component = createDeferredLazyComponent(async () => {
    loads += 1;
    return resolvedComponent;
  });

  const first = component.loadModule();
  const second = component.loadModule();

  assert.equal(first, second);
  assert.equal(await first, resolvedComponent);
  assert.equal(loads, 1);
});

test("deferred module failure is observable without a detached rejection", async () => {
  const expectedError = new Error("chunk failed");
  const component = createDeferredLazyComponent<Record<string, never>>(async () => {
    throw expectedError;
  });
  const first = component.loadModule();
  const second = component.loadModule();
  let observedError: unknown = null;

  assert.equal(first, second, "rejected loads remain cached");
  try {
    await first;
  } catch (error: unknown) {
    observedError = error;
  }
  assert.equal(observedError, expectedError);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
});
