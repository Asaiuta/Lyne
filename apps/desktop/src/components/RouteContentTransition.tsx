import type { Accessor, JSX } from "solid-js";
import type { RouteAnimation } from "../shared/state/uiSettingsModel";
import { KeyedOutInTransition } from "./KeyedOutInTransition";

interface RouteContentTransitionProps<Value> {
  value: Value;
  transitionKey: string;
  animation: RouteAnimation;
  motionScope: string;
  children: (displayedValue: Accessor<Value>) => JSX.Element;
}

export const routeContentTransitionName = (
  animation: RouteAnimation
): string | null => (animation === "none" ? null : `page-${animation}`);

export function RouteContentTransition<Value>(
  props: RouteContentTransitionProps<Value>
) {
  return (
    <KeyedOutInTransition
      value={props.value}
      transitionKey={props.transitionKey}
      transitionName={routeContentTransitionName(props.animation)}
      motionScope={props.motionScope}
    >
      {props.children}
    </KeyedOutInTransition>
  );
}
