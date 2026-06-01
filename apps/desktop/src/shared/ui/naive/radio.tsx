import {
  Show,
  createSignal,
  onMount,
  type JSX
} from "solid-js";
import {
  naiveRadioButtonClass,
  naiveRadioClass,
  naiveRadioGroupClass,
  naiveRadioHasLabel,
  type NaiveRadioButtonProps,
  type NaiveRadioFamily,
  type NaiveRadioGroupProps,
  type NaiveRadioProps
} from "./radio.shared";
import { createLazyNaive } from "./lazy-naive";
import { joinClassNames } from "./utils";

export * from "./radio.shared";

const lazyNaiveRadioFamily = createLazyNaive<NaiveRadioFamily>(() =>
  import("./NaiveRadioKobalte").then((module) => ({
    RadioGroup: module.NaiveRadioGroupKobalte,
    Radio: module.NaiveRadioKobalte,
    RadioButton: module.NaiveRadioButtonKobalte
  }))
);

function NaiveRadioGroupFallback(props: NaiveRadioGroupProps & { onWarmup?: () => void }): JSX.Element {
  return (
    <div
      id={props.id}
      class={naiveRadioGroupClass(props, false)}
      role="radiogroup"
      aria-hidden="true"
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      {props.children}
    </div>
  );
}

function NaiveRadioFallback(props: NaiveRadioProps & { button?: boolean; onWarmup?: () => void }): JSX.Element {
  const checked = () => props.checked ?? props.defaultChecked ?? false;
  const disabled = () => props.disabled ?? false;
  const state = () => ({
    checked: checked(),
    disabled: disabled(),
    focused: false,
    size: props.size
  });

  return (
    <div
      class={props.button ? naiveRadioButtonClass(props, state()) : naiveRadioClass(props, state())}
      aria-hidden="true"
      title={props.title}
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      <Show
        when={props.button}
        fallback={
          <>
            <span class="n-radio__dot-wrapper">
              <span class={joinClassNames("n-radio__dot", checked() ? "n-radio__dot--checked" : false)}>
                <span class="n-radio__dot-background" />
              </span>
            </span>
            <Show when={naiveRadioHasLabel(props)}>
              <span class="n-radio__label">{props.label ?? props.children}</span>
            </Show>
          </>
        }
      >
        <span class="n-radio-button__state-border" />
        <Show when={naiveRadioHasLabel(props)}>
          <span class="n-radio__label">{props.label ?? props.children}</span>
        </Show>
      </Show>
    </div>
  );
}

export function NaiveRadioGroup(props: NaiveRadioGroupProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show
      when={Family()}
      fallback={<NaiveRadioGroupFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(family) => {
        const Component = family().RadioGroup;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export function NaiveRadio(props: NaiveRadioProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show when={Family()} fallback={<NaiveRadioFallback {...props} onWarmup={ensureLoaded} />}>
      {(family) => {
        const Component = family().Radio;
        return <Component {...props} />;
      }}
    </Show>
  );
}

export function NaiveRadioButton(props: NaiveRadioButtonProps): JSX.Element {
  const [Family, setFamily] = createSignal<NaiveRadioFamily | null>(
    lazyNaiveRadioFamily.getLoaded()
  );
  const ensureLoaded = (): void => {
    void lazyNaiveRadioFamily.load().then((family) => setFamily(() => family));
  };
  onMount(ensureLoaded);

  return (
    <Show
      when={Family()}
      fallback={<NaiveRadioFallback {...props} button onWarmup={ensureLoaded} />}
    >
      {(family) => {
        const Component = family().RadioButton;
        return <Component {...props} />;
      }}
    </Show>
  );
}
