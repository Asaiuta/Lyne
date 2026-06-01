import { lazy, type JSX } from "solid-js";
import type {
  NaiveSelectComponent,
  NaiveSelectProps,
  NaiveSelectValue
} from "./select.types";

export type {
  NaiveSelectComponent,
  NaiveSelectMultipleProps,
  NaiveSelectOption,
  NaiveSelectPlacement,
  NaiveSelectProps,
  NaiveSelectRenderState,
  NaiveSelectSingleProps,
  NaiveSelectSize,
  NaiveSelectStatus,
  NaiveSelectValue
} from "./select.types";

const LazyNaiveSelect = lazy(async () => {
  const module = await import("./NaiveSelectKobalte");
  return { default: module.NaiveSelectKobalte as NaiveSelectComponent };
});

export function NaiveSelect<TValue extends NaiveSelectValue = string>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  return <LazyNaiveSelect {...props} />;
}
