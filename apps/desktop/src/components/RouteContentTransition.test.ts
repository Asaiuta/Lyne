import assert from "node:assert/strict";
import test from "node:test";
import type { RouteAnimation } from "../shared/state/uiSettingsModel";
import { routeContentTransitionName } from "./RouteContentTransition";

test("route content transition reuses the shared page motion matrix", () => {
  const animated: readonly Exclude<RouteAnimation, "none">[] = [
    "fade",
    "zoom",
    "slide",
    "up",
    "flow",
    "mask-left",
    "mask-top"
  ];

  assert.equal(routeContentTransitionName("none"), null);
  for (const animation of animated) {
    assert.equal(routeContentTransitionName(animation), `page-${animation}`);
  }
});
