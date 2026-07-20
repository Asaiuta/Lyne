import { createSignal, type JSX } from "solid-js";
import type { RouteAnimation } from "../shared/state/uiSettingsModel";
import type { ActivePage } from "../shared/ui/navigation";
import { KeyedOutInTransition } from "./KeyedOutInTransition";

interface PageTransitionProps {
  activePage: ActivePage;
  animation: RouteAnimation;
  onDisplayedPageChange?: (page: ActivePage) => void;
  /** Render function — receives the displayed page signal, which only updates after leave completes. */
  children: (displayedPage: () => ActivePage) => JSX.Element;
}

/**
 * Top-level page wrapper around the shared keyed out-in transition lifecycle.
 * The outer data attributes remain stable for route performance probes.
 */
export function PageTransition(props: PageTransitionProps) {
  const [displayedPage, setDisplayedPage] = createSignal<ActivePage>(props.activePage);

  const handleDisplayedPageChange = (page: ActivePage) => {
    setDisplayedPage(page);
    props.onDisplayedPageChange?.(page);
  };

  return (
    <div
      class="page-transition-container"
      style={{ display: "contents" }}
      data-perf-active-page={displayedPage()}
      data-perf-transition-pending={
        props.activePage !== displayedPage() ? "true" : undefined
      }
    >
      <KeyedOutInTransition
        value={props.activePage}
        transitionKey={props.activePage}
        transitionName={
          props.animation === "none" ? null : `page-${props.animation}`
        }
        targetSelector=".panel"
        appear
        motionScope="page"
        onDisplayedValueChange={handleDisplayedPageChange}
      >
        {props.children}
      </KeyedOutInTransition>
    </div>
  );
}
