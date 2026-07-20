import assert from "node:assert/strict";
import test from "node:test";

import pageTransitionSource from "../../../components/PageTransition.tsx?raw";
import libraryPageSource from "../../../features/library/LibraryPage.tsx?raw";
import libraryTabContentSource from "../../../features/library/LibraryTabContent.tsx?raw";
import localLibraryCss from "./local-library.css?raw";

test("library title and content use independent keyed out-in transitions", () => {
  assert.equal(
    /motionScope="library-title"[\s\S]*?transitionName="local-library-title-fade"/.test(
      libraryPageSource
    ) ||
      /transitionName="local-library-title-fade"[\s\S]*?motionScope="library-title"/.test(
        libraryPageSource
      ),
    true
  );
  assert.equal(
    /transitionKey=\{libraryDestinationMotionKey\(props\.destination\)\}/.test(
      libraryPageSource
    ),
    true
  );
  assert.equal(
    /props\.routeAnimation === "none" \? null : `page-\$\{props\.routeAnimation\}`/.test(
      libraryPageSource
    ),
    true
  );
  assert.equal(
    /destination=\{transitionDestination\(\)\}/.test(libraryPageSource),
    true
  );
  assert.equal(
    /libraryDestinationToTab\(props\.destination\)/.test(
      libraryTabContentSource
    ),
    true
  );
});

test("library title fade preserves the SPlayer timing with semantic tokens", () => {
  assert.equal(
    /local-library-title-fade-enter-active[\s\S]*?--motion-duration-subtle[\s\S]*?--motion-ease-balanced/.test(
      localLibraryCss
    ),
    true
  );
  assert.equal(
    /local-library-title-fade-leave-active[\s\S]*?--motion-duration-exit[\s\S]*?--motion-ease-balanced/.test(
      localLibraryCss
    ),
    true
  );
});

test("top-level PageTransition keeps perf hooks while sharing the keyed lifecycle", () => {
  assert.equal(/<KeyedOutInTransition/.test(pageTransitionSource), true);
  assert.equal(/targetSelector="\.panel"/.test(pageTransitionSource), true);
  assert.equal(/data-perf-active-page=\{displayedPage\(\)\}/.test(pageTransitionSource), true);
  assert.equal(/data-perf-transition-pending=/.test(pageTransitionSource), true);
});
