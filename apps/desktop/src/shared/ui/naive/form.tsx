import {
  Show,
  createContext,
  createMemo,
  type Accessor,
  type JSX,
  useContext
} from "solid-js";
import {
  isNaiveFormAutoLabelWidth,
  naiveFormItemBlankClass,
  naiveFormItemClass,
  naiveFormItemFeedbackClass,
  naiveFormItemLabelClass,
  resolveNaiveFormLabelPlacement,
  resolveNaiveFormLabelTextAlign,
  resolveNaiveFormLabelWidth,
  resolveNaiveFormRequireMarkPlacement,
  resolveNaiveFormShowFeedback,
  resolveNaiveFormShowLabel,
  resolveNaiveFormShowRequireMark,
  resolveNaiveFormSize,
  shouldReverseNaiveFormLabelColumns,
  type NaiveFormLabelAlign,
  type NaiveFormLabelPlacement,
  type NaiveFormRequireMarkPlacement,
  type NaiveFormSize,
  type NaiveFormValidationStatus
} from "./form-logic";
import { NaiveGridItem, type NaiveGridItemProps } from "./grid";
import { joinClassNames } from "./utils";

type FormStyle = JSX.CSSProperties;
type FormSubmitHandler = (event: SubmitEvent) => void;

export type {
  NaiveFormLabelAlign,
  NaiveFormLabelPlacement,
  NaiveFormRequireMarkPlacement,
  NaiveFormSize,
  NaiveFormValidationStatus
};

export interface NaiveFormProps {
  children: JSX.Element;
  class?: string;
  disabled?: boolean;
  id?: string;
  inline?: boolean;
  labelAlign?: NaiveFormLabelAlign;
  labelPlacement?: NaiveFormLabelPlacement;
  labelWidth?: string | number;
  onSubmit?: FormSubmitHandler;
  ref?: (element: HTMLFormElement) => void;
  requireMarkPlacement?: NaiveFormRequireMarkPlacement;
  showFeedback?: boolean;
  showLabel?: boolean;
  showRequireMark?: boolean;
  size?: NaiveFormSize;
  style?: FormStyle;
}

export interface NaiveFormItemLabelProps {
  for?: string;
  id?: string;
  class?: string;
  title?: string;
}

export interface NaiveFormItemProps {
  children: JSX.Element;
  class?: string;
  contentClass?: string;
  contentStyle?: FormStyle;
  feedback?: JSX.Element;
  feedbackClass?: string;
  feedbackStyle?: FormStyle;
  label?: JSX.Element;
  labelAlign?: NaiveFormLabelAlign;
  labelPlacement?: NaiveFormLabelPlacement;
  labelProps?: NaiveFormItemLabelProps;
  labelSlot?: JSX.Element;
  labelStyle?: FormStyle;
  labelWidth?: string | number;
  path?: string;
  required?: boolean;
  requireMarkPlacement?: NaiveFormRequireMarkPlacement;
  showFeedback?: boolean;
  showLabel?: boolean;
  showRequireMark?: boolean;
  size?: NaiveFormSize;
  style?: FormStyle;
  validationStatus?: NaiveFormValidationStatus;
}

export type NaiveFormItemGiProps = NaiveFormItemProps &
  Pick<NaiveGridItemProps, "offset" | "role" | "span" | "suffix"> & {
    gridClass?: string;
    gridStyle?: NaiveGridItemProps["style"];
  };

interface NaiveFormContextValue {
  disabled: Accessor<boolean | undefined>;
  labelAlign: Accessor<NaiveFormLabelAlign | undefined>;
  labelPlacement: Accessor<NaiveFormLabelPlacement | undefined>;
  labelWidth: Accessor<string | number | undefined>;
  requireMarkPlacement: Accessor<NaiveFormRequireMarkPlacement | undefined>;
  showFeedback: Accessor<boolean | undefined>;
  showLabel: Accessor<boolean | undefined>;
  showRequireMark: Accessor<boolean | undefined>;
  size: Accessor<NaiveFormSize | undefined>;
}

const NaiveFormContext = createContext<NaiveFormContextValue | null>(null);

const naiveFormContextFromProps = (props: NaiveFormProps): NaiveFormContextValue => ({
  disabled: () => props.disabled,
  labelAlign: () => props.labelAlign,
  labelPlacement: () => props.labelPlacement,
  labelWidth: () => props.labelWidth,
  requireMarkPlacement: () => props.requireMarkPlacement,
  showFeedback: () => props.showFeedback,
  showLabel: () => props.showLabel,
  showRequireMark: () => props.showRequireMark,
  size: () => props.size
});

const defaultSubmitHandler = (event: SubmitEvent): void => {
  event.preventDefault();
};

const formClass = (props: NaiveFormProps): string =>
  joinClassNames("naive-form", "n-form", props.inline ? "n-form--inline" : false, props.class);

const formItemCssVars = (
  size: NaiveFormSize,
  labelPlacement: NaiveFormLabelPlacement,
  labelAlign: NaiveFormLabelAlign | undefined
): FormStyle => {
  const topLabelSize = size === "small" ? "13px" : "14px";
  const leftLabelSize = size === "large" ? "15px" : "14px";
  const labelHeight = size === "small" ? "24px" : size === "large" ? "28px" : "26px";
  const feedbackHeight = size === "large" ? "26px" : "24px";
  const feedbackFontSize = size === "small" ? "13px" : "14px";
  const blankHeight = size === "small" ? "28px" : size === "large" ? "40px" : "34px";
  const direction = labelPlacement === "top" ? "vertical" : "horizontal";

  return {
    "--n-asterisk-color": "var(--danger, #ff6b6b)",
    "--n-bezier": "var(--ease-standard)",
    "--n-blank-height": blankHeight,
    "--n-feedback-font-size": feedbackFontSize,
    "--n-feedback-height": feedbackHeight,
    "--n-feedback-padding": "4px 0 0 2px",
    "--n-feedback-text-color": "var(--text-placeholder)",
    "--n-feedback-text-color-error": "var(--danger, #ff6b6b)",
    "--n-feedback-text-color-warning": "var(--warning, #f2c97d)",
    "--n-label-font-size": labelPlacement === "top" ? topLabelSize : leftLabelSize,
    "--n-label-font-weight": "400",
    "--n-label-height": labelHeight,
    "--n-label-padding": direction === "vertical" ? "0 0 6px 2px" : "0 12px 0 0",
    "--n-label-text-align": resolveNaiveFormLabelTextAlign(labelPlacement, labelAlign),
    "--n-label-text-color": "var(--text)",
    "--n-line-height": "1.5"
  };
};

export function NaiveForm(props: NaiveFormProps): JSX.Element {
  const handleSubmit: FormSubmitHandler = (event) => {
    if (props.onSubmit) {
      props.onSubmit(event);
      return;
    }
    defaultSubmitHandler(event);
  };

  return (
    <NaiveFormContext.Provider value={naiveFormContextFromProps(props)}>
      <form
        ref={props.ref}
        id={props.id}
        class={formClass(props)}
        style={props.style}
        onSubmit={handleSubmit}
      >
        {props.children}
      </form>
    </NaiveFormContext.Provider>
  );
}

export function NaiveFormItem(props: NaiveFormItemProps): JSX.Element {
  const form = useContext(NaiveFormContext);
  const size = () => resolveNaiveFormSize(props.size, form?.size());
  const labelPlacement = () =>
    resolveNaiveFormLabelPlacement(props.labelPlacement, form?.labelPlacement());
  const labelAlign = () => props.labelAlign ?? form?.labelAlign();
  const requireMarkPlacement = () =>
    resolveNaiveFormRequireMarkPlacement(
      props.requireMarkPlacement,
      form?.requireMarkPlacement()
    );
  const showLabel = () => resolveNaiveFormShowLabel(props.showLabel, form?.showLabel());
  const showFeedback = () =>
    resolveNaiveFormShowFeedback(props.showFeedback, form?.showFeedback());
  const required = () => props.required ?? false;
  const showRequireMark = () =>
    resolveNaiveFormShowRequireMark(
      props.showRequireMark,
      form?.showRequireMark(),
      required()
    );
  const autoLabelWidth = () =>
    isNaiveFormAutoLabelWidth(labelPlacement(), props.labelWidth, form?.labelWidth());
  const labelWidth = () =>
    resolveNaiveFormLabelWidth(
      labelPlacement(),
      props.labelWidth,
      form?.labelWidth(),
      undefined
    );
  const reverseColSpace = () =>
    shouldReverseNaiveFormLabelColumns(
      labelPlacement(),
      requireMarkPlacement(),
      labelAlign()
    );
  const labelContent = () => props.labelSlot ?? props.label;
  const labelStyle = (): FormStyle => ({
    ...props.labelStyle,
    width: labelWidth()
  });
  const rootStyle = createMemo<FormStyle>(() => ({
    ...formItemCssVars(size(), labelPlacement(), labelAlign()),
    ...props.style
  }));
  const rootClass = () =>
    naiveFormItemClass({
      autoLabelWidth: autoLabelWidth(),
      className: props.class,
      labelPlacement: labelPlacement(),
      showLabel: showLabel(),
      size: size()
    });
  const labelClass = () =>
    naiveFormItemLabelClass({
      requireMarkPlacement: requireMarkPlacement(),
      reverseColSpace: reverseColSpace(),
      userClass: props.labelProps?.class
    });
  const renderAsterisk = () =>
    showRequireMark() ? (
      <span class="n-form-item-label__asterisk">
        {requireMarkPlacement() === "left" ? "*\u00A0" : "\u00A0*"}
      </span>
    ) : requireMarkPlacement() === "right-hanging" ? (
      <span class="n-form-item-label__asterisk-placeholder">{"\u00A0*"}</span>
    ) : null;

  return (
    <div class={rootClass()} style={rootStyle()} data-path={props.path}>
      <Show when={showLabel() && labelContent()}>
        {(label) => (
          <label
            id={props.labelProps?.id}
            class={labelClass()}
            style={labelStyle()}
            for={props.labelProps?.for}
            title={props.labelProps?.title}
          >
            <Show
              when={requireMarkPlacement() === "left"}
              fallback={
                <>
                  <span class="n-form-item-label__text">{label()}</span>
                  {renderAsterisk()}
                </>
              }
            >
              <>
                {renderAsterisk()}
                <span class="n-form-item-label__text">{label()}</span>
              </>
            </Show>
          </label>
        )}
      </Show>
      <div
        class={naiveFormItemBlankClass(props.contentClass, props.validationStatus)}
        style={props.contentStyle}
      >
        {props.children}
      </div>
      <Show when={showFeedback()}>
        <div
          class={joinClassNames("n-form-item-feedback-wrapper", props.feedbackClass)}
          style={props.feedbackStyle}
        >
          <Show when={props.feedback}>
            {(feedback) => (
              <div class={naiveFormItemFeedbackClass(props.validationStatus)}>
                <div class="n-form-item-feedback__line">{feedback()}</div>
              </div>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

export function NaiveFormItemGi(props: NaiveFormItemGiProps): JSX.Element {
  return (
    <NaiveGridItem
      class={props.gridClass}
      offset={props.offset}
      role={props.role}
      span={props.span}
      style={props.gridStyle}
      suffix={props.suffix}
    >
      <NaiveFormItem
        class={props.class}
        contentClass={props.contentClass}
        contentStyle={props.contentStyle}
        feedback={props.feedback}
        feedbackClass={props.feedbackClass}
        feedbackStyle={props.feedbackStyle}
        label={props.label}
        labelAlign={props.labelAlign}
        labelPlacement={props.labelPlacement}
        labelProps={props.labelProps}
        labelSlot={props.labelSlot}
        labelStyle={props.labelStyle}
        labelWidth={props.labelWidth}
        path={props.path}
        required={props.required}
        requireMarkPlacement={props.requireMarkPlacement}
        showFeedback={props.showFeedback}
        showLabel={props.showLabel}
        showRequireMark={props.showRequireMark}
        size={props.size}
        style={props.style}
        validationStatus={props.validationStatus}
      >
        {props.children}
      </NaiveFormItem>
    </NaiveGridItem>
  );
}
