import { Show, createSignal, onMount, type JSX } from "solid-js";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export type NaiveSwitchSize = "small" | "medium" | "large";
export type NaiveSwitchValue = string | number | boolean;

export interface NaiveSwitchRailStyleState {
  checked: boolean;
  focused: boolean;
}

export type NaiveSwitchRailStyle =
  | JSX.CSSProperties
  | string
  | ((state: NaiveSwitchRailStyleState) => JSX.CSSProperties | string | undefined);

export interface NaiveSwitchProps {
  checked?: boolean;
  value?: NaiveSwitchValue;
  defaultValue?: NaiveSwitchValue;
  defaultChecked?: boolean;
  checkedValue?: NaiveSwitchValue;
  uncheckedValue?: NaiveSwitchValue;
  onUpdateValue?: (value: NaiveSwitchValue) => void;
  "onUpdate:value"?: (value: NaiveSwitchValue) => void;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  readOnly?: boolean;
  required?: boolean;
  round?: boolean;
  rubberBand?: boolean;
  size?: NaiveSwitchSize;
  class?: string;
  rootClass?: string;
  title?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  name?: string;
  id?: string;
  railStyle?: NaiveSwitchRailStyle;
  checkedContent?: JSX.Element;
  uncheckedContent?: JSX.Element;
  icon?: JSX.Element;
  checkedIcon?: JSX.Element;
  uncheckedIcon?: JSX.Element;
}

export type NaiveSwitchComponent = (props: NaiveSwitchProps) => JSX.Element;

const lazyNaiveSwitch = createLazyNaive<NaiveSwitchComponent>(() =>
  import("./NaiveSwitchKobalte").then(
    (module) => module.NaiveSwitchKobalte as NaiveSwitchComponent
  )
);

const hasSwitchIcon = (props: NaiveSwitchProps): boolean =>
  props.icon != null || props.checkedIcon != null || props.uncheckedIcon != null;

const hasSwitchContent = (props: NaiveSwitchProps): boolean =>
  props.checkedContent != null || props.uncheckedContent != null;

export const naiveSwitchRootClass = (props: NaiveSwitchProps): string =>
  joinClassNames("naive-switch-root", props.rootClass);

export const naiveSwitchCheckedValue = (props: NaiveSwitchProps): NaiveSwitchValue =>
  props.checkedValue ?? true;

export const naiveSwitchUncheckedValue = (props: NaiveSwitchProps): NaiveSwitchValue =>
  props.uncheckedValue ?? false;

export const naiveSwitchResolvedChecked = (props: NaiveSwitchProps): boolean => {
  if (props.checked !== undefined) return props.checked;
  if (props.value !== undefined) return props.value === naiveSwitchCheckedValue(props);
  if (props.defaultChecked !== undefined) return props.defaultChecked;
  if (props.defaultValue !== undefined) {
    return props.defaultValue === naiveSwitchCheckedValue(props);
  }
  return false;
};

export const resolveNaiveSwitchRailStyle = (
  props: NaiveSwitchProps,
  state: NaiveSwitchRailStyleState
): JSX.CSSProperties | string | undefined => {
  if (typeof props.railStyle === "function") return props.railStyle(state);
  return props.railStyle;
};

export const naiveSwitchClass = (
  props: NaiveSwitchProps,
  pressed: boolean,
  checked = naiveSwitchResolvedChecked(props)
): string =>
  joinClassNames(
    "naive-switch",
    "n-switch",
    props.size === "small" ? "naive-switch--small" : false,
    props.size === "large" ? "naive-switch--large" : false,
    hasSwitchIcon(props) ? "n-switch--icon" : false,
    checked ? "n-switch--active" : false,
    props.disabled ? "n-switch--disabled" : false,
    props.round ?? true ? "n-switch--round" : false,
    props.loading ? "n-switch--loading" : false,
    pressed ? "n-switch--pressed" : false,
    props.rubberBand ?? true ? "n-switch--rubber-band" : false,
    props.class
  );

export const naiveSwitchButtonIcon = (
  props: NaiveSwitchProps,
  checked = naiveSwitchResolvedChecked(props)
): JSX.Element | undefined => {
  if (checked) return props.checkedIcon ?? props.icon;
  return props.uncheckedIcon ?? props.icon;
};

type NaiveSwitchRailProps = NaiveSwitchProps & {
  focused?: boolean;
};

export function NaiveSwitchRail(props: NaiveSwitchRailProps): JSX.Element {
  const checked = () => naiveSwitchResolvedChecked(props);
  const buttonIcon = () => naiveSwitchButtonIcon(props, checked());

  return (
    <div
      class="n-switch__rail"
      aria-hidden="true"
      style={resolveNaiveSwitchRailStyle(props, {
        checked: checked(),
        focused: props.focused ?? false
      })}
    >
      <Show when={hasSwitchContent(props)}>
        <div class="n-switch__children-placeholder" aria-hidden="true">
          <div class="n-switch__rail-placeholder">
            <div class="n-switch__button-placeholder" />
            {props.checkedContent}
          </div>
          <div class="n-switch__rail-placeholder">
            <div class="n-switch__button-placeholder" />
            {props.uncheckedContent}
          </div>
        </div>
      </Show>
      <div class="n-switch__button">
        <Show
          when={props.loading}
          fallback={
            <Show when={buttonIcon()}>
              {(icon) => <div class="n-switch__button-icon">{icon()}</div>}
            </Show>
          }
        >
          <div class="n-base-loading" />
        </Show>
      </div>
      <Show when={props.checkedContent}>
        {(content) => <div class="n-switch__checked">{content()}</div>}
      </Show>
      <Show when={props.uncheckedContent}>
        {(content) => <div class="n-switch__unchecked">{content()}</div>}
      </Show>
    </div>
  );
}

export function NaiveSwitch(props: NaiveSwitchProps): JSX.Element {
  const [LoadedSwitch, setLoadedSwitch] =
    createSignal<NaiveSwitchComponent | null>(lazyNaiveSwitch.getLoaded());

  const ensureLoaded = (): void => {
    void lazyNaiveSwitch.load().then((component) => setLoadedSwitch(() => component));
  };

  onMount(ensureLoaded);

  return (
    <Show
      when={LoadedSwitch()}
      fallback={
        <div
          class={naiveSwitchRootClass(props)}
          aria-hidden="true"
          onPointerEnter={ensureLoaded}
          onFocusIn={ensureLoaded}
        >
          <div class={naiveSwitchClass(props, false)} title={props.title} id={props.id}>
            <NaiveSwitchRail {...props} />
          </div>
        </div>
      }
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
