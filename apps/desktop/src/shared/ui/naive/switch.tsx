import { Show, createSignal, onMount, type JSX } from "solid-js";
import { joinClassNames } from "./utils";

export type NaiveSwitchSize = "small" | "medium" | "large";

export interface NaiveSwitchProps {
  checked: boolean;
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
  name?: string;
  value?: string;
  checkedContent?: JSX.Element;
  uncheckedContent?: JSX.Element;
  icon?: JSX.Element;
  checkedIcon?: JSX.Element;
  uncheckedIcon?: JSX.Element;
}

export type NaiveSwitchComponent = (props: NaiveSwitchProps) => JSX.Element;

let loadedNaiveSwitch: NaiveSwitchComponent | null = null;
let naiveSwitchImport: Promise<NaiveSwitchComponent> | null = null;

const loadNaiveSwitch = async (): Promise<NaiveSwitchComponent> => {
  if (loadedNaiveSwitch) return loadedNaiveSwitch;
  naiveSwitchImport ??= import("./NaiveSwitchKobalte").then(
    (module) => module.NaiveSwitchKobalte as NaiveSwitchComponent
  );
  loadedNaiveSwitch = await naiveSwitchImport;
  return loadedNaiveSwitch;
};

const hasSwitchIcon = (props: NaiveSwitchProps): boolean =>
  props.icon != null || props.checkedIcon != null || props.uncheckedIcon != null;

const hasSwitchContent = (props: NaiveSwitchProps): boolean =>
  props.checkedContent != null || props.uncheckedContent != null;

export const naiveSwitchRootClass = (props: NaiveSwitchProps): string =>
  joinClassNames("naive-switch-root", props.rootClass);

export const naiveSwitchClass = (props: NaiveSwitchProps, pressed: boolean): string =>
  joinClassNames(
    "naive-switch",
    "n-switch",
    props.size === "small" ? "naive-switch--small" : false,
    props.size === "large" ? "naive-switch--large" : false,
    hasSwitchIcon(props) ? "n-switch--icon" : false,
    props.checked ? "n-switch--active" : false,
    props.disabled ? "n-switch--disabled" : false,
    props.round ?? true ? "n-switch--round" : false,
    props.loading ? "n-switch--loading" : false,
    pressed ? "n-switch--pressed" : false,
    props.rubberBand ?? true ? "n-switch--rubber-band" : false,
    props.class
  );

export const naiveSwitchButtonIcon = (props: NaiveSwitchProps): JSX.Element | undefined => {
  if (props.checked) return props.checkedIcon ?? props.icon;
  return props.uncheckedIcon ?? props.icon;
};

export function NaiveSwitchRail(props: NaiveSwitchProps): JSX.Element {
  const buttonIcon = () => naiveSwitchButtonIcon(props);

  return (
    <div class="n-switch__rail" aria-hidden="true">
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
          <div class="naive-switch-loading-indicator" />
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
    createSignal<NaiveSwitchComponent | null>(loadedNaiveSwitch);

  const ensureLoaded = (): void => {
    void loadNaiveSwitch().then((component) => setLoadedSwitch(() => component));
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
          <div class={naiveSwitchClass(props, false)} title={props.title}>
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
