import type { JSX } from "solid-js";
import { joinClassNames, toCssLength } from "./utils";

export interface NaiveScrollbarProps {
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  dataPageScrollRoot?: boolean;
  maxHeight?: string | number;
  onScroll?: JSX.EventHandlerUnion<HTMLDivElement, Event>;
  style?: JSX.CSSProperties;
}

export function NaiveScrollbar(props: NaiveScrollbarProps): JSX.Element {
  return (
    <div
      class={joinClassNames(
        "naive-scrollbar",
        "n-scrollbar",
        "n-scrollbar-container",
        props.class
      )}
      style={{ ...props.style, "max-height": toCssLength(props.maxHeight) }}
      data-page-scroll-root={props.dataPageScrollRoot ? "true" : undefined}
      onScroll={props.onScroll}
    >
      <div class={joinClassNames("naive-scrollbar-content", "n-scrollbar-content", props.contentClass)}>
        {props.children}
      </div>
    </div>
  );
}
