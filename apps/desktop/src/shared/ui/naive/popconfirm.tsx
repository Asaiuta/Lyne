import { Show, createSignal, type JSX } from "solid-js";
import {
  NaiveButton,
  type NaiveButtonMouseHandler,
  type NaiveButtonProps
} from "./button";
import {
  NaivePopover,
  type NaivePopoverPlacement,
  type NaivePopoverTrigger
} from "./popover";
import { joinClassNames } from "./utils";

export interface NaivePopconfirmButtonProps
  extends Partial<Omit<NaiveButtonProps, "children" | "onClick">> {
  /** NaiveUI-compatible alias. */
  type?: NaiveButtonProps["variant"] | "error";
}

export type NaivePopconfirmClickResult =
  | boolean
  | void
  | Promise<boolean | void>;

export interface NaivePopconfirmProps {
  children: JSX.Element;
  trigger?: JSX.Element;
  triggerMode?: NaivePopoverTrigger;
  placement?: NaivePopoverPlacement;
  gutter?: number;
  showArrow?: boolean;
  disabled?: boolean;
  show?: boolean;
  defaultShow?: boolean;
  onUpdateShow?: (show: boolean) => void;
  to?: HTMLElement;
  icon?: JSX.Element;
  showIcon?: boolean;
  positiveText?: string | null;
  negativeText?: string | null;
  positiveButtonProps?: NaivePopconfirmButtonProps;
  negativeButtonProps?: NaivePopconfirmButtonProps;
  onPositiveClick?: (event: MouseEvent) => NaivePopconfirmClickResult;
  onNegativeClick?: (event: MouseEvent) => NaivePopconfirmClickResult;
  action?: JSX.Element;
  class?: string;
  panelClass?: string;
  ariaLabel?: string;
}

const DEFAULT_POSITIVE_TEXT = "Confirm";
const DEFAULT_NEGATIVE_TEXT = "Cancel";

const resolveButtonVariant = (
  props: NaivePopconfirmButtonProps | undefined,
  fallback: NaiveButtonProps["variant"]
): NaiveButtonProps["variant"] => {
  const variant = props?.variant ?? props?.type ?? fallback;
  return variant === "error" ? "primary" : variant;
};

const resolveButtonProps = (
  props: NaivePopconfirmButtonProps | undefined,
  fallbackVariant: NaiveButtonProps["variant"]
): Partial<NaiveButtonProps> => {
  if (!props) {
    return {
      size: "small",
      variant: fallbackVariant
    };
  }
  return {
    active: props.active,
    ariaChecked: props.ariaChecked,
    ariaCurrent: props.ariaCurrent,
    ariaExpanded: props.ariaExpanded,
    ariaHasPopup: props.ariaHasPopup,
    ariaLabel: props.ariaLabel,
    ariaPressed: props.ariaPressed,
    block: props.block,
    class: props.class,
    dataNaivePopselectTrigger: props.dataNaivePopselectTrigger,
    dataPerfRouteKey: props.dataPerfRouteKey,
    disabled: props.disabled,
    nativeType: props.nativeType,
    onPointerDown: props.onPointerDown,
    role: props.role,
    round: props.round,
    secondary: props.secondary,
    size: props.size ?? "small",
    strong: props.strong,
    title: props.title,
    variant: resolveButtonVariant(props, fallbackVariant)
  };
};

const WarningIcon = (): JSX.Element => (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
  >
    <path
      fill="currentColor"
      d="M12 3.2 22 20.4H2L12 3.2Zm0 5.7c-.5 0-.9.4-.9.9v4.4c0 .5.4.9.9.9s.9-.4.9-.9V9.8c0-.5-.4-.9-.9-.9Zm0 8c-.6 0-1 .4-1 1s.4 1 1 1 1-.4 1-1-.4-1-1-1Z"
    />
  </svg>
);

export function NaivePopconfirm(props: NaivePopconfirmProps): JSX.Element {
  const [uncontrolledShow, setUncontrolledShow] = createSignal<boolean>(
    props.defaultShow ?? false
  );

  const isOpen = (): boolean => props.show ?? uncontrolledShow();
  const setIsOpen = (next: boolean): void => {
    if (props.disabled && next) return;
    if (props.show === undefined) setUncontrolledShow(next);
    props.onUpdateShow?.(next);
  };

  const positiveText = (): string | null =>
    props.positiveText === undefined
      ? DEFAULT_POSITIVE_TEXT
      : props.positiveText;
  const negativeText = (): string | null =>
    props.negativeText === undefined
      ? DEFAULT_NEGATIVE_TEXT
      : props.negativeText;

  const handleAction = (
    handler: ((event: MouseEvent) => NaivePopconfirmClickResult) | undefined
  ): NaiveButtonMouseHandler => {
    return (event) => {
      if (!isOpen()) return;
      void Promise.resolve(handler?.(event)).then((result) => {
        if (result === false) return;
        setIsOpen(false);
      });
    };
  };

  return (
    <NaivePopover
      class={joinClassNames("n-popconfirm", props.class)}
      trigger={props.trigger}
      triggerMode={props.triggerMode ?? "click"}
      placement={props.placement ?? "top"}
      gutter={props.gutter}
      showArrow={props.showArrow ?? true}
      disabled={props.disabled}
      open={isOpen()}
      onOpenChange={setIsOpen}
      to={props.to}
      role="alertdialog"
      ariaLabel={props.ariaLabel}
    >
      <div class={joinClassNames("n-popconfirm__panel", props.panelClass)}>
        <div class="n-popconfirm__body">
          <Show when={props.showIcon ?? true}>
            <div class="n-popconfirm__icon">
              {props.icon ?? <WarningIcon />}
            </div>
          </Show>
          {props.children}
        </div>
        <Show
          when={
            props.action !== undefined ||
            positiveText() !== null ||
            negativeText() !== null
          }
        >
          <div class="n-popconfirm__action">
            <Show
              when={props.action}
              fallback={
                <>
                  <Show when={negativeText() !== null}>
                    <NaiveButton
                      {...resolveButtonProps(
                        props.negativeButtonProps,
                        "default"
                      )}
                      onClick={handleAction(props.onNegativeClick)}
                    >
                      {negativeText()}
                    </NaiveButton>
                  </Show>
                  <Show when={positiveText() !== null}>
                    <NaiveButton
                      {...resolveButtonProps(
                        props.positiveButtonProps,
                        "primary"
                      )}
                      onClick={handleAction(props.onPositiveClick)}
                    >
                      {positiveText()}
                    </NaiveButton>
                  </Show>
                </>
              }
            >
              {props.action}
            </Show>
          </div>
        </Show>
      </div>
    </NaivePopover>
  );
}
