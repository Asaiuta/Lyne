import type { JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveInputGroupSize = "tiny" | "small" | "medium" | "large";

export const naiveInputGroupClass = (className: string | undefined): string =>
  joinClassNames("naive-input-group", "n-input-group", className);

export const naiveInputGroupLabelClass = (className: string | undefined): string =>
  joinClassNames("naive-input-group-label", "n-input-group-label", className);

export const resolveNaiveInputGroupLabelMetrics = (
  size: NaiveInputGroupSize | undefined
): { fontSize: string; height: string } => {
  if (size === "tiny") return { fontSize: "12px", height: "22px" };
  if (size === "small") return { fontSize: "13px", height: "28px" };
  if (size === "large") return { fontSize: "15px", height: "40px" };
  return { fontSize: "14px", height: "34px" };
};

export const naiveInputGroupLabelStyle = (
  size: NaiveInputGroupSize | undefined,
  style: JSX.CSSProperties | undefined
): JSX.CSSProperties => {
  const metrics = resolveNaiveInputGroupLabelMetrics(size);
  return {
    "--n-bezier": "var(--ease-standard)",
    "--n-border-radius": "var(--radius-input)",
    "--n-font-size": metrics.fontSize,
    "--n-group-label-border": "1px solid var(--border-subtle)",
    "--n-group-label-color": "var(--surface-2)",
    "--n-group-label-text-color": "var(--text-soft)",
    "--n-height": metrics.height,
    "--n-line-height": "1.5",
    ...style
  };
};
