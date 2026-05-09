import type { JSX } from "solid-js";
import { ContentArea } from "./ContentArea";

interface AppShellProps {
  sidebar: JSX.Element;
  topNav: JSX.Element;
  playerBar: JSX.Element;
  backgroundLayer: JSX.Element;
  children: JSX.Element;
}

/**
 * AppShell composes the SPlayer-style layout while keeping owning state in the
 * eventual top-level app port.
 */
export function AppShell(props: AppShellProps) {
  return (
    <div class="app-shell">
      {props.backgroundLayer}
      <div class="app-frame">
        <div class="app-body">
          {props.sidebar}
          <div class="app-main">
            <div class="app-main-layout">
              {props.topNav}
              <ContentArea>{props.children}</ContentArea>
            </div>
          </div>
        </div>
        {props.playerBar}
      </div>
    </div>
  );
}
