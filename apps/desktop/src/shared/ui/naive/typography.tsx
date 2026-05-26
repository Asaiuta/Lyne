import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export interface NaiveTypographyBaseProps {
  children: JSX.Element;
  class?: string;
  id?: string;
  title?: string;
}

export type NaiveHeadingPrefix = "bar";

export interface NaiveHeadingProps extends NaiveTypographyBaseProps {
  prefix?: NaiveHeadingPrefix;
}

export type NaiveParagraphProps = NaiveTypographyBaseProps;

export type NaiveOlProps = NaiveTypographyBaseProps;

export type NaiveLiProps = NaiveTypographyBaseProps;

function headingClass(level: 1 | 2 | 3, props: NaiveHeadingProps): string {
  return joinClassNames(
    "naive-heading",
    `naive-heading--h${level}`,
    props.prefix === "bar" ? "naive-heading--bar" : false,
    props.class
  );
}

function renderHeadingChildren(props: NaiveHeadingProps): JSX.Element {
  if (props.prefix !== "bar") return props.children;
  return (
    <>
      <span class="naive-heading-prefix" aria-hidden="true" />
      <span class="naive-heading-content">{props.children}</span>
    </>
  );
}

export function NaiveH1(props: NaiveHeadingProps): JSX.Element {
  return (
    <h1 id={props.id} class={headingClass(1, props)} title={props.title}>
      {renderHeadingChildren(props)}
    </h1>
  );
}

export function NaiveH2(props: NaiveHeadingProps): JSX.Element {
  return (
    <h2 id={props.id} class={headingClass(2, props)} title={props.title}>
      {renderHeadingChildren(props)}
    </h2>
  );
}

export function NaiveH3(props: NaiveHeadingProps): JSX.Element {
  return (
    <h3 id={props.id} class={headingClass(3, props)} title={props.title}>
      {renderHeadingChildren(props)}
    </h3>
  );
}

export function NaiveP(props: NaiveParagraphProps): JSX.Element {
  return (
    <p id={props.id} class={joinClassNames("naive-p", props.class)} title={props.title}>
      {props.children}
    </p>
  );
}

export function NaiveOl(props: NaiveOlProps): JSX.Element {
  return (
    <ol id={props.id} class={joinClassNames("naive-ol", props.class)} title={props.title}>
      {props.children}
    </ol>
  );
}

export function NaiveLi(props: NaiveLiProps): JSX.Element {
  return (
    <li id={props.id} class={joinClassNames("naive-li", props.class)} title={props.title}>
      {props.children}
    </li>
  );
}
