import { Show, createSignal, onMount, type JSX } from "solid-js";
import {
  NaiveSwitchRail,
  naiveSwitchClass,
  naiveSwitchRootClass,
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
