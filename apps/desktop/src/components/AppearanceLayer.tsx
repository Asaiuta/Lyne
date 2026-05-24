import { Match, Switch, createEffect, onCleanup, onMount } from "solid-js";
import { appearanceEngine } from "../shared/theme/appearanceEngine";
import { CoverBlurBg } from "./appearance/CoverBlurBg";
import { CoverImmersiveBg } from "./appearance/CoverImmersiveBg";
import { ParticlesBg } from "./appearance/ParticlesBg";
import { SolidBg } from "./appearance/SolidBg";
import { VinylBg } from "./appearance/VinylBg";

interface AppearanceLayerProps {
  readonly coverUrl: string | null;
  readonly enabled: boolean;
  readonly blur?: number;
  readonly maskOpacity?: number;
  readonly fullPlayerOpen: boolean;
}
export function AppearanceLayer(props: AppearanceLayerProps) {
  onMount(() => {
    const dispose = appearanceEngine.installBrowserRuntime();
    onCleanup(dispose);
  });

  createEffect(() => {
    appearanceEngine.syncRuntime({
      backgroundEnabled: props.enabled,
      fullPlayerOpen: props.fullPlayerOpen
    });
  });

  createEffect(() => {
    appearanceEngine.applyDomMode(appearanceEngine.effectiveMode());
  });

  onCleanup(() => {
    if (typeof document !== "undefined") {
      document.documentElement.dataset.appearanceMode = "solid";
    }
  });

  const mode = appearanceEngine.effectiveMode;
  const movingActive = appearanceEngine.movingModeAllowed;

  return (
    <Switch fallback={<SolidBg />}>
      <Match when={mode() === "cover-blur"}>
        <CoverBlurBg
          coverUrl={props.coverUrl}
          enabled={props.enabled}
          blur={props.blur}
          maskOpacity={props.maskOpacity}
        />
      </Match>
      <Match when={mode() === "cover-immersive"}>
        <CoverImmersiveBg
          coverUrl={props.coverUrl}
          enabled={props.enabled}
          blur={props.blur}
          maskOpacity={props.maskOpacity}
        />
      </Match>
      <Match when={mode() === "particles"}>
        <ParticlesBg coverUrl={props.coverUrl} active={movingActive()} />
      </Match>
      <Match when={mode() === "vinyl"}>
        <VinylBg coverUrl={props.coverUrl} active={movingActive()} />
      </Match>
      <Match when={mode() === "solid"}>
        <SolidBg />
      </Match>
    </Switch>
  );
}
