import {
  For,
  Show,
  createSignal,
  type JSX
} from "solid-js";
import {
  createNaiveTabsResolvedProps,
  createNaiveTabsSegmentCapsule,
  naiveTabsTabClass,
  type NaiveTabsComponent,
  type NaiveTabsProps
} from "./tabs.shared";
import { createLazyNaive } from "./lazy-naive";

export * from "./tabs.shared";

const lazyNaiveTabs = createLazyNaive<NaiveTabsComponent>(() =>
  import("./NaiveTabsKobalte").then(
    (module) => module.NaiveTabsKobalte as NaiveTabsComponent
  )
);

export function NaiveTabs<TValue extends string>(
  props: NaiveTabsProps<TValue>
): JSX.Element {
  const [LoadedTabs, setLoadedTabs] = createSignal<NaiveTabsComponent | null>(
    lazyNaiveTabs.getLoaded()
  );
  const resolved = createNaiveTabsResolvedProps(props);
  const segmentCapsule = createNaiveTabsSegmentCapsule(
    () => props.value,
    resolved.items
  );
  const buttons: Array<HTMLButtonElement | undefined> = [];

  const ensureLoaded = (): void => {
    void lazyNaiveTabs.load().then((component) => setLoadedTabs(() => component));
  };
  const focusNext = (currentIndex: number, direction: 1 | -1): void => {
    const items = resolved.items();
    const total = items.length;
    let next = currentIndex;
    for (let step = 0; step < total; step += 1) {
      next = (next + direction + total) % total;
      const item = items[next];
      if (item && !item.disabled) {
        buttons[next]?.focus();
        if (props.activationMode !== "manual") props.onChange(item.value);
        return;
      }
    }
  };
  const activateFocused = (index: number): void => {
    const item = resolved.items()[index];
    if (item && !item.disabled) props.onChange(item.value);
  };
  const handleKeyDown = (index: number, event: KeyboardEvent): void => {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      focusNext(index, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      focusNext(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = resolved.items().findIndex((item) => !item.disabled);
      if (first >= 0) {
        buttons[first]?.focus();
        if (props.activationMode !== "manual") props.onChange(resolved.items()[first].value);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      for (let i = resolved.items().length - 1; i >= 0; i -= 1) {
        const item = resolved.items()[i];
        if (item && !item.disabled) {
          buttons[i]?.focus();
          if (props.activationMode !== "manual") props.onChange(item.value);
          return;
        }
      }
    } else if (props.activationMode === "manual" && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      activateFocused(index);
    }
  };

  lazyNaiveTabs.useIdlePreload({ idleTimeout: 800, fallbackDelay: 300 });

  return (
    <Show
      when={LoadedTabs()}
      fallback={
        <div
          class={resolved.rootClass()}
          onPointerEnter={lazyNaiveTabs.preload}
          onFocusIn={ensureLoaded}
        >
          <div class={resolved.navClass()}>
            <Show
              when={resolved.type() === "segment"}
              fallback={
                <div class="n-tabs-nav-scroll-wrapper">
                  <div class="n-tabs-nav-scroll-content">
                    <div class={resolved.wrapperClass()} role="tablist" aria-label={props.ariaLabel}>
                      <For each={resolved.items()}>
                        {(item, index) => {
                          const active = () => item.value === props.value;
                          return (
                            <div class="n-tabs-tab-wrapper">
                              <Show when={index() !== 0}>
                                <div class="n-tabs-tab-pad" />
                              </Show>
                              <button
                                ref={(el) => {
                                  buttons[index()] = el;
                                }}
                                type="button"
                                role="tab"
                                data-name={item.value}
                                data-disabled={item.disabled ? "true" : undefined}
                                aria-selected={active()}
                                aria-disabled={item.disabled || undefined}
                                disabled={item.disabled}
                                class={naiveTabsTabClass(
                                  active(),
                                  item.disabled,
                                  props.tabClass,
                                  props.tabActiveClass
                                )}
                                tabIndex={active() ? 0 : -1}
                                onClick={() => {
                                  if (!item.disabled) props.onChange(item.value);
                                }}
                                onKeyDown={(event) => handleKeyDown(index(), event)}
                              >
                                <span class="n-tabs-tab__label">{item.label}</span>
                              </button>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                    <div class="n-tabs-bar" />
                  </div>
                </div>
              }
            >
              <div
                ref={segmentCapsule.railRef}
                class={resolved.railClass()}
                role="tablist"
                aria-label={props.ariaLabel}
              >
                <div class="n-tabs-capsule" style={segmentCapsule.capsuleStyle()} />
                <div class={resolved.wrapperClass()}>
                  <For each={resolved.items()}>
                    {(item, index) => {
                      const active = () => item.value === props.value;
                      return (
                        <div class="n-tabs-tab-wrapper">
                          <Show when={index() !== 0}>
                            <div class="n-tabs-tab-pad" />
                          </Show>
                          <button
                            ref={(el) => {
                              buttons[index()] = el;
                              segmentCapsule.tabRef(item.value, el);
                            }}
                            type="button"
                            role="tab"
                            data-name={item.value}
                            data-disabled={item.disabled ? "true" : undefined}
                            aria-selected={active()}
                            aria-disabled={item.disabled || undefined}
                            disabled={item.disabled}
                            class={naiveTabsTabClass(
                              active(),
                              item.disabled,
                              props.tabClass,
                              props.tabActiveClass
                            )}
                            tabIndex={active() ? 0 : -1}
                            onClick={() => {
                              if (!item.disabled) props.onChange(item.value);
                            }}
                            onKeyDown={(event) => handleKeyDown(index(), event)}
                          >
                            <span class="n-tabs-tab__label">{item.label}</span>
                          </button>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>
            </Show>
          </div>
          <select
            class={resolved.selectClass()}
            value={props.value}
            onChange={(event) => props.onChange(event.currentTarget.value as TValue)}
            aria-label={props.ariaLabel}
          >
            <For each={resolved.items()}>
              {(item) => (
                <option value={item.value} disabled={item.disabled}>
                  {item.textValue}
                </option>
              )}
            </For>
          </select>
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
