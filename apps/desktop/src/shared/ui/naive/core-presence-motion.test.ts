import assert from "node:assert/strict";
import test from "node:test";
import collapseSource from "./NaiveCollapseKobalte.tsx?raw";
import collapseTransitionSource from "./collapse-transition.tsx?raw";
import selectFacadeSource from "./select.tsx?raw";
import selectSource from "./NaiveSelectKobalte.tsx?raw";
import sliderSource from "./NaiveSliderKobalte.tsx?raw";
import naiveStyles from "./styles.css?raw";
import selectStyles from "./styles/select-kobalte.css?raw";
import presenceSource from "../usePresenceTransition.ts?raw";

test("Select uses SPlayer's 200ms fade-in-scale-up presence contract", () => {
  assert.equal(/const SELECT_MENU_TRANSITION_MS = 200;/.test(selectSource), true);
  assert.equal(/is-naive-select-transition/.test(selectSource), true);
  assert.equal(/durationMs: SELECT_MENU_TRANSITION_MS/.test(selectSource), true);
  for (const pattern of [
    /is-naive-select-transition\.is-open/,
    /is-naive-select-transition\.is-closing/,
    /--motion-duration-feedback/,
    /transform: scale\(0\.9\)/,
    /naive-select-menu-leave/
  ]) {
    assert.equal(pattern.test(selectStyles), true);
  }
});

test("Select carries a first uncontrolled fallback click into the lazy implementation", () => {
  assert.equal(/const \[openOnLoad, setOpenOnLoad\] = createSignal<boolean>\(false\);/.test(selectFacadeSource), true);
  assert.equal(/if \(props\.open === undefined\) setOpenOnLoad\(true\);/.test(selectFacadeSource), true);
  assert.equal(/props\.onOpenChange\?\.\(true\);/.test(selectFacadeSource), true);
  assert.equal(/defaultOpen=\{props\.open === undefined && openOnLoad\(\) \? true : props\.defaultOpen\}/.test(selectFacadeSource), true);
  assert.equal(/props\.open \?\? props\.defaultOpen \?\? false/.test(selectSource), true);
});

test("Select transfers a still-focused fallback trigger to the lazy implementation", () => {
  assert.equal(/document\.activeElement === fallbackTrigger/.test(selectFacadeSource), true);
  assert.equal(/NaiveSelectFocusHandoffContext\.Provider value=\{focusOnLoad\}/.test(selectFacadeSource), true);
  assert.equal(/useNaiveSelectFocusHandoff/.test(selectSource), true);
  assert.equal(/element\?\.focus\(\)/.test(selectSource), true);
});

test("Slider tooltip keeps its DOM through the 200ms bidirectional presence window", () => {
  assert.equal(/const SLIDER_TOOLTIP_TRANSITION_MS = 200;/.test(sliderSource), true);
  assert.equal(/usePresenceTransition\(showIndicator/.test(sliderSource), true);
  assert.equal(/is-naive-slider-indicator-transition/.test(sliderSource), true);
  for (const pattern of [
    /naive-slider-indicator-enter/,
    /naive-slider-indicator-leave/,
    /--motion-duration-feedback/,
    /scale\(0\.9\)/
  ]) {
    assert.equal(pattern.test(naiveStyles), true);
  }
});

test("Collapse retains its content only for the measured 150ms leave lifecycle", () => {
  assert.equal(/forceMount/.test(collapseSource), true);
  assert.equal(/<NaiveCollapseTransition show=\{active\(\)\}>/.test(collapseSource), true);
  assert.equal(/aria-hidden=\{collapsed\(\)\}/.test(collapseSource), true);
  assert.equal(/inert=\{collapsed\(\)\}/.test(collapseSource), true);
  assert.equal(/COLLAPSE_TRANSITION_FALLBACK_MS = 200/.test(collapseTransitionSource), true);
  assert.equal(/prefersReducedMotion/.test(collapseTransitionSource), true);
  assert.equal(/max-height var\(--motion-duration-subtle\)/.test(naiveStyles), true);
});

test("shared presence settles reduced-motion close on the next animation frame", () => {
  assert.equal(/prefersReducedMotion/.test(presenceSource), true);
  assert.equal(/closeFrame = window\.requestAnimationFrame\(finishClose\)/.test(presenceSource), true);
});
