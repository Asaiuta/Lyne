import { Show, createSignal, type JSX } from "solid-js";
import {
  NaiveSwitchRail,
  naiveSwitchCheckedValue,
  naiveSwitchClass,
  naiveSwitchResolvedChecked,
  naiveSwitchRootClass,
  naiveSwitchUncheckedValue,
  type NaiveSwitchComponent,
  type NaiveSwitchProps
} from "./switch.shared";
import { createLazyNaive } from "./lazy-naive";

export * from "./switch.shared";

const lazyNaiveSwitch = createLazyNaive<NaiveSwitchComponent>(() =>
  import("./NaiveSwitchKobalte").then(
    (module) => module.NaiveSwitchKobalte as NaiveSwitchComponent
  )
);

export function NaiveSwitch(props: NaiveSwitchProps): JSX.Element {
  const [LoadedSwitch, setLoadedSwitch] =
    createSignal<NaiveSwitchComponent | null>(lazyNaiveSwitch.getLoaded());
  const [pressed, setPressed] = createSignal<boolean>(false);
  const [focused, setFocused] = createSignal<boolean>(false);

  const ensureLoaded = (): void => {
    void lazyNaiveSwitch.load().then((component) => setLoadedSwitch(() => component));
  };
  const blocked = (): boolean => props.disabled === true || props.loading === true || props.readOnly === true;
  const checked = (): boolean => naiveSwitchResolvedChecked(props);
  const endPress = (): void => {
    setPressed(false);
  };
  const emitChecked = (nextChecked: boolean): void => {
    if (blocked()) return;
    const value = nextChecked ? naiveSwitchCheckedValue(props) : naiveSwitchUncheckedValue(props);
    props["onUpdate:value"]?.(value);
    props.onUpdateValue?.(value);
    props.onChange?.(nextChecked);
  };
  const handleFallbackToggle = (): void => {
    ensureLoaded();
    emitChecked(!checked());
  };

  return (
    <Show
      when={LoadedSwitch()}
      fallback={
        <div
          class={naiveSwitchRootClass(props)}
          onPointerEnter={ensureLoaded}
          onFocusIn={ensureLoaded}
        >
          <button
            type="button"
            class={naiveSwitchClass(props, pressed(), checked())}
            title={props.title}
            id={props.id}
            name={props.name}
            role="switch"
            aria-checked={checked()}
            aria-label={props.ariaLabel}
            aria-labelledby={props.ariaLabelledBy}
            aria-describedby={props.ariaDescribedBy}
            disabled={props.disabled}
            onPointerDown={() => {
              if (!blocked()) setPressed(true);
            }}
            onPointerUp={endPress}
            onPointerCancel={endPress}
            onPointerLeave={endPress}
            onClick={(event) => {
              if (blocked()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              handleFallbackToggle();
            }}
            onKeyDown={(event) => {
              if (event.key !== " ") return;
              if (blocked()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              event.preventDefault();
              setPressed(true);
            }}
            onKeyUp={(event) => {
              if (event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                handleFallbackToggle();
              }
              endPress();
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              endPress();
            }}
          >
            <NaiveSwitchRail {...props} checked={checked()} focused={focused()} />
          </button>
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
