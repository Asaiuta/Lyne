import {
  createContext,
  createMemo,
  useContext,
  type Accessor,
  type JSX
} from "solid-js";
import {
  naiveCollapseNameKey,
  type NaiveCollapseExpandedNamesInput,
  type NaiveCollapseHeaderClickInfo,
  type NaiveCollapseName
} from "./collapse-logic";
import { joinClassNames } from "./utils";

export type {
  NaiveCollapseExpandedNamesInput,
  NaiveCollapseHeaderClickInfo,
  NaiveCollapseName
};

export type NaiveCollapseArrowPlacement = "left" | "right";

export interface NaiveCollapseProps {
  accordion?: boolean;
  expandedNames?: NaiveCollapseExpandedNamesInput;
  defaultExpandedNames?: NaiveCollapseExpandedNamesInput;
  arrowPlacement?: NaiveCollapseArrowPlacement;
  onUpdateExpandedNames?: (names: string[]) => void;
  onItemHeaderClick?: (info: NaiveCollapseHeaderClickInfo) => void;
  class?: string;
  id?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children?: JSX.Element;
}

export interface NaiveCollapseItemHeaderOptions {
  readonly collapsed: boolean;
}

export interface NaiveCollapseItemProps {
  name: NaiveCollapseName;
  title?: JSX.Element;
  disabled?: boolean;
  header?: JSX.Element | ((options: NaiveCollapseItemHeaderOptions) => JSX.Element);
  class?: string;
  children?: JSX.Element;
}

export interface NaiveCollapseRenderState {
  active: boolean;
  disabled: boolean;
  arrowPlacement: NaiveCollapseArrowPlacement;
}

export interface NaiveCollapseContextValue {
  expandedNames: Accessor<readonly string[]>;
  arrowPlacement: Accessor<NaiveCollapseArrowPlacement>;
  isExpanded: (name: NaiveCollapseName) => boolean;
}

export interface NaiveCollapseFamily {
  Collapse: (props: NaiveCollapseProps) => JSX.Element;
  CollapseItem: (props: NaiveCollapseItemProps) => JSX.Element;
}

export const NaiveCollapseContext =
  createContext<NaiveCollapseContextValue | null>(null);

export const useNaiveCollapse = (): NaiveCollapseContextValue | null =>
  useContext(NaiveCollapseContext);

export const naiveCollapseClass = (
  props: Pick<NaiveCollapseProps, "class">
): string => joinClassNames("n-collapse", props.class);

export const naiveCollapseItemClass = (
  props: Pick<NaiveCollapseItemProps, "class">,
  state: NaiveCollapseRenderState
): string =>
  joinClassNames(
    "n-collapse-item",
    state.active ? "n-collapse-item--active" : false,
    state.disabled ? "n-collapse-item--disabled" : false,
    `n-collapse-item--${state.arrowPlacement}-arrow-placement`,
    props.class
  );

export const createNaiveCollapseContext = (
  expandedNames: Accessor<readonly string[]>,
  arrowPlacement: Accessor<NaiveCollapseArrowPlacement>
): NaiveCollapseContextValue => {
  const expandedSet = createMemo(() => new Set(expandedNames()));
  return {
    expandedNames,
    arrowPlacement,
    isExpanded: (name) => expandedSet().has(naiveCollapseNameKey(name))
  };
};

export const renderNaiveCollapseHeader = (
  props: Pick<NaiveCollapseItemProps, "header" | "title">,
  collapsed: boolean
): JSX.Element => {
  if (typeof props.header === "function") return props.header({ collapsed });
  return props.header ?? props.title;
};
