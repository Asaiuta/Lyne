import { joinClassNames, toCssLength } from "./utils";

export type NaiveFormSize = "small" | "medium" | "large";
export type NaiveFormLabelPlacement = "left" | "top";
export type NaiveFormLabelAlign = "left" | "right";
export type NaiveFormRequireMarkPlacement = "left" | "right" | "right-hanging";
export type NaiveFormValidationStatus = "success" | "warning" | "error";

export interface NaiveFormItemClassOptions {
  autoLabelWidth?: boolean;
  className?: string;
  labelPlacement: NaiveFormLabelPlacement;
  showLabel: boolean;
  size: NaiveFormSize;
}

export interface NaiveFormItemLabelClassOptions {
  requireMarkPlacement: NaiveFormRequireMarkPlacement;
  reverseColSpace?: boolean;
  userClass?: string;
}

export const NAIVE_FORM_DEFAULT_SIZE: NaiveFormSize = "medium";
export const NAIVE_FORM_DEFAULT_LABEL_PLACEMENT: NaiveFormLabelPlacement = "top";
export const NAIVE_FORM_DEFAULT_REQUIRE_MARK_PLACEMENT: NaiveFormRequireMarkPlacement =
  "right";

export const resolveNaiveFormSize = (
  itemSize: NaiveFormSize | undefined,
  formSize: NaiveFormSize | undefined
): NaiveFormSize => itemSize ?? formSize ?? NAIVE_FORM_DEFAULT_SIZE;

export const resolveNaiveFormLabelPlacement = (
  itemPlacement: NaiveFormLabelPlacement | undefined,
  formPlacement: NaiveFormLabelPlacement | undefined
): NaiveFormLabelPlacement =>
  itemPlacement ?? formPlacement ?? NAIVE_FORM_DEFAULT_LABEL_PLACEMENT;

export const resolveNaiveFormRequireMarkPlacement = (
  itemPlacement: NaiveFormRequireMarkPlacement | undefined,
  formPlacement: NaiveFormRequireMarkPlacement | undefined
): NaiveFormRequireMarkPlacement =>
  itemPlacement ?? formPlacement ?? NAIVE_FORM_DEFAULT_REQUIRE_MARK_PLACEMENT;

export const resolveNaiveFormShowFeedback = (
  itemShowFeedback: boolean | undefined,
  formShowFeedback: boolean | undefined
): boolean => itemShowFeedback ?? formShowFeedback ?? true;

export const resolveNaiveFormShowLabel = (
  itemShowLabel: boolean | undefined,
  formShowLabel: boolean | undefined
): boolean => itemShowLabel ?? formShowLabel ?? true;

export const resolveNaiveFormShowRequireMark = (
  itemShowRequireMark: boolean | undefined,
  formShowRequireMark: boolean | undefined,
  required: boolean | undefined
): boolean => itemShowRequireMark ?? formShowRequireMark ?? required ?? false;

export const resolveNaiveFormLabelTextAlign = (
  labelPlacement: NaiveFormLabelPlacement,
  labelAlign: NaiveFormLabelAlign | undefined
): "left" | "right" | "flex-start" | "flex-end" => {
  if (labelPlacement === "top") {
    return labelAlign === "right" ? "flex-end" : "flex-start";
  }
  return labelAlign ?? "right";
};

export const isNaiveFormAutoLabelWidth = (
  labelPlacement: NaiveFormLabelPlacement,
  itemLabelWidth: string | number | undefined,
  formLabelWidth: string | number | undefined
): boolean =>
  labelPlacement === "left" &&
  (itemLabelWidth === "auto" || formLabelWidth === "auto");

export const resolveNaiveFormLabelWidth = (
  labelPlacement: NaiveFormLabelPlacement,
  itemLabelWidth: string | number | undefined,
  formLabelWidth: string | number | undefined,
  autoLabelWidth: string | undefined
): string | undefined => {
  if (labelPlacement === "top") return undefined;
  if (itemLabelWidth !== undefined && itemLabelWidth !== "auto") {
    return toCssLength(itemLabelWidth);
  }
  if (itemLabelWidth === "auto" || formLabelWidth === "auto") {
    return autoLabelWidth;
  }
  return toCssLength(formLabelWidth);
};

export const shouldReverseNaiveFormLabelColumns = (
  labelPlacement: NaiveFormLabelPlacement,
  requireMarkPlacement: NaiveFormRequireMarkPlacement,
  labelAlign: NaiveFormLabelAlign | undefined
): boolean =>
  labelPlacement === "left" &&
  requireMarkPlacement === "left" &&
  labelAlign === "left";

export const naiveFormItemClass = (options: NaiveFormItemClassOptions): string =>
  joinClassNames(
    "naive-form-item",
    "n-form-item",
    `n-form-item--${options.size}-size`,
    `n-form-item--${options.labelPlacement}-labelled`,
    options.autoLabelWidth ? "n-form-item--auto-label-width" : false,
    !options.showLabel ? "n-form-item--no-label" : false,
    options.className
  );

export const naiveFormItemLabelClass = (
  options: NaiveFormItemLabelClassOptions
): string =>
  joinClassNames(
    "n-form-item-label",
    `n-form-item-label--${options.requireMarkPlacement}-mark`,
    options.reverseColSpace ? "n-form-item-label--reverse-columns-space" : false,
    options.userClass
  );

export const naiveFormItemBlankClass = (
  contentClass: string | undefined,
  validationStatus: NaiveFormValidationStatus | undefined
): string =>
  joinClassNames(
    "n-form-item-blank",
    contentClass,
    validationStatus ? `n-form-item-blank--${validationStatus}` : false
  );

export const naiveFormItemFeedbackClass = (
  validationStatus: NaiveFormValidationStatus | undefined
): string =>
  joinClassNames(
    "n-form-item-feedback",
    validationStatus ? `n-form-item-feedback--${validationStatus}` : false
  );
