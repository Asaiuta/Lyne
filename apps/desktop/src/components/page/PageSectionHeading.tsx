import type { JSX } from "solid-js";
import { NaiveH3 } from "../../shared/ui/naive";
import "../../shared/styles/components/page-section-heading.css";

interface PageSectionHeadingProps {
  children: JSX.Element;
  class?: string;
}

const headingClass = (className: string | undefined): string =>
  ["page-section-heading", className]
    .filter((value): value is string => Boolean(value))
    .join(" ");

export function PageSectionHeading(props: PageSectionHeadingProps): JSX.Element {
  return (
    <NaiveH3 class={headingClass(props.class)} prefix="bar">
      {props.children}
    </NaiveH3>
  );
}
