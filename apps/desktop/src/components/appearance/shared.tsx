import { createEffect, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { SImage } from "../SImage";

export interface CoverStrategyProps {
  readonly coverUrl: string | null;
  readonly enabled: boolean;
  readonly blur?: number;
  readonly maskOpacity?: number;
}

export interface MovingStrategyProps {
  readonly coverUrl: string | null;
  readonly active: boolean;
}

export interface CoverMediaState {
  readonly currentUrl: () => string | null;
  readonly previousUrl: () => string | null;
  readonly fading: () => boolean;
}

export function createCoverMediaState(props: Pick<CoverStrategyProps, "coverUrl" | "enabled">): CoverMediaState {
  const [currentUrl, setCurrentUrl] = createSignal<string | null>(null);
  const [previousUrl, setPreviousUrl] = createSignal<string | null>(null);
  const [fading, setFading] = createSignal(false);
  let timer: number | undefined;

  const clearTimer = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };

  createEffect(() => {
    const nextCoverUrl = props.coverUrl;

    if (!nextCoverUrl || !props.enabled) {
      setCurrentUrl(null);
      setPreviousUrl(null);
      setFading(false);
      clearTimer();
      return;
    }

    if (nextCoverUrl !== currentUrl()) {
      setPreviousUrl(currentUrl());
      setCurrentUrl(nextCoverUrl);
      setFading(true);
      clearTimer();
      timer = window.setTimeout(() => {
        setPreviousUrl(null);
        setFading(false);
        timer = undefined;
      }, 500);
    }
  });

  onCleanup(clearTimer);

  return { currentUrl, previousUrl, fading };
}

export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === "light";
}

export function BackgroundMedia(props: {
  readonly url: string;
  readonly className: string;
  readonly style: JSX.CSSProperties;
}) {
  return (
    <SImage
      src={props.url}
      alt=""
      class={props.className}
      style={props.style}
      observeVisibility={false}
      shape="rect"
      draggable={false}
      ariaHidden="true"
    />
  );
}
