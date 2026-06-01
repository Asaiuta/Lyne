import { Show, createSignal, onMount, type JSX } from "solid-js";
import {
  NaiveSliderFallback,
  type NaiveSliderComponent,
  type NaiveSliderProps
} from "./slider.shared";
import { createLazyNaive } from "./lazy-naive";

export * from "./slider.shared";

const lazyNaiveSlider = createLazyNaive<NaiveSliderComponent>(() =>
  import("./NaiveSliderKobalte").then(
    (module) => module.NaiveSliderKobalte as NaiveSliderComponent
  )
);

export function NaiveSlider(props: NaiveSliderProps): JSX.Element {
  const [LoadedSlider, setLoadedSlider] =
    createSignal<NaiveSliderComponent | null>(lazyNaiveSlider.getLoaded());

  const ensureLoaded = (): void => {
    void lazyNaiveSlider.load().then((component) => setLoadedSlider(() => component));
  };

  onMount(ensureLoaded);

  return (
    <Show
      when={LoadedSlider()}
      fallback={<NaiveSliderFallback {...props} onWarmup={ensureLoaded} />}
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return <LoadedComponent {...props} />;
      }}
    </Show>
  );
}
