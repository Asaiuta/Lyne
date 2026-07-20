import { Show, createEffect, createSignal, type JSX } from "solid-js";
import type {
  NaiveSelectComponent,
  NaiveSelectProps,
  NaiveSelectValue
} from "./select.types";
import {
  NaiveSelectShell,
  naiveSelectDisplayLabel,
  naiveSelectHasValue,
  naiveSelectRootClass
} from "./select-core";
import { NaiveSelectFocusHandoffContext } from "./select-focus-handoff";
import { createLazyNaive } from "./lazy-naive";

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

const lazyNaiveSelect = createLazyNaive<NaiveSelectComponent>(() =>
  import("./NaiveSelectKobalte").then(
    (module) => module.NaiveSelectKobalte as NaiveSelectComponent
  )
);

type NaiveSelectFallbackProps<TValue extends NaiveSelectValue> =
  NaiveSelectProps<TValue> & {
    onWarmup: () => void;
    onRequestOpen: () => void;
    onFocusIntentChange: (focused: boolean) => void;
    onTriggerRef: (element: HTMLButtonElement) => void;
  };

function NaiveSelectFallback<TValue extends NaiveSelectValue>(
  props: NaiveSelectFallbackProps<TValue>
): JSX.Element {
  const [focused, setFocused] = createSignal<boolean>(false);
  const hasValue = () => naiveSelectHasValue(props);

  return (
    <div
      class={naiveSelectRootClass(props)}
      onPointerEnter={props.onWarmup}
      onFocusIn={props.onWarmup}
    >
      <NaiveSelectShell selectProps={props} state={{ open: false, focused: focused() }}>
        <button
          type="button"
          class="n-base-selection-label"
          ref={props.onTriggerRef}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledBy}
          aria-describedby={props.ariaDescribedBy}
          onClick={(event) => {
            if (!props.disabled && !props.readonly) {
              event.preventDefault();
              props.onRequestOpen();
            }
          }}
          onFocus={(event) => {
            setFocused(true);
            props.onFocusIntentChange(true);
            props.onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            props.onFocusIntentChange(false);
            props.onBlur?.(event);
          }}
        >
          <span class="n-base-selection-value-slot">
            <Show
              when={hasValue()}
              fallback={
                <span class="n-base-selection-placeholder n-base-selection-overlay">
                  <span class="n-base-selection-placeholder__inner">
                    {props.placeholder}
                  </span>
                </span>
              }
            >
              <span class="n-base-selection-input">
                <span class="n-base-selection-input__content">
                  {naiveSelectDisplayLabel(props)}
                </span>
              </span>
            </Show>
          </span>
          <span class="n-base-suffix" aria-hidden="true">
            <Show when={props.loading}>
              <span class="n-base-loading is-loading" />
            </Show>
            <Show when={props.showArrow ?? true}>
              <span class="n-base-suffix__arrow" />
            </Show>
          </span>
        </button>
      </NaiveSelectShell>
    </div>
  );
}

export function NaiveSelect<TValue extends NaiveSelectValue = string>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  const [LoadedSelect, setLoadedSelect] =
    createSignal<NaiveSelectComponent | null>(lazyNaiveSelect.getLoaded());
  const [openOnLoad, setOpenOnLoad] = createSignal<boolean>(false);
  const [focusRequested, setFocusRequested] = createSignal<boolean>(false);
  const [focusOnLoad, setFocusOnLoad] = createSignal<boolean>(false);
  let fallbackTrigger: HTMLButtonElement | undefined;
  let loading = false;

  const ensureLoaded = (): void => {
    if (loading || LoadedSelect()) return;
    loading = true;
    void lazyNaiveSelect.load().then((component) => {
      setFocusOnLoad(
        focusRequested() &&
          typeof document !== "undefined" &&
          document.activeElement === fallbackTrigger
      );
      setLoadedSelect(() => component);
    });
  };
  const requestOpen = (): void => {
    if (props.disabled || props.readonly) return;
    if (props.open === undefined) setOpenOnLoad(true);
    props.onOpenChange?.(true);
    ensureLoaded();
  };

  createEffect(() => {
    if (props.open === true || (props.open === undefined && props.defaultOpen === true)) {
      ensureLoaded();
    }
  });

  return (
    <Show
      when={LoadedSelect()}
      fallback={
        <NaiveSelectFallback
          {...props}
          onWarmup={ensureLoaded}
          onRequestOpen={requestOpen}
          onFocusIntentChange={setFocusRequested}
          onTriggerRef={(element) => {
            fallbackTrigger = element;
          }}
        />
      }
    >
      {(Loaded) => {
        const LoadedComponent = Loaded();
        return (
          <NaiveSelectFocusHandoffContext.Provider value={focusOnLoad}>
            <LoadedComponent
              {...props}
              defaultOpen={props.open === undefined && openOnLoad() ? true : props.defaultOpen}
            />
          </NaiveSelectFocusHandoffContext.Provider>
        );
      }}
    </Show>
  );
}
