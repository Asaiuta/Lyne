import { lazy, type JSX } from "solid-js";
import type { NaivePopoverComponent, NaivePopoverProps } from "./popover.shared";

export * from "./popover.shared";

/**
 * Public lazy proxy. The Kobalte implementation lives in
 * `NaivePopoverKobalte.tsx` and is loaded on first mount via `lazy()`.
 *
 * This module must NOT top-level import `@kobalte/core`; the lazy proxy keeps
 * startup chunks free of the popover primitive.
 */
const LazyNaivePopover = lazy(async () => {
  const module = await import("./NaivePopoverKobalte");
  return { default: module.NaivePopoverKobalte as NaivePopoverComponent };
});

export function NaivePopover(props: NaivePopoverProps): JSX.Element {
  return <LazyNaivePopover {...props} />;
}
