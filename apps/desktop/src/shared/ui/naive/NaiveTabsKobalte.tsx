import { Tabs as KobalteTabs } from "@kobalte/core/tabs";
import { For, Show, type JSX } from "solid-js";
import type { NaiveTabsProps } from "./tabs.shared";
import {
  createNaiveTabsResolvedProps,
  createNaiveTabsSegmentCapsule,
  naiveTabsTabClass
} from "./tabs.shared";

export function NaiveTabsKobalte<TValue extends string>(
  props: NaiveTabsProps<TValue>
): JSX.Element {
  const resolved = createNaiveTabsResolvedProps(props);
  const segmentCapsule = createNaiveTabsSegmentCapsule(
    () => props.value,
    resolved.items
  );

  return (
    <KobalteTabs
      class={resolved.rootClass()}
      value={props.value}
      onChange={(value: string) => props.onChange(value as TValue)}
      orientation={resolved.orientation()}
      activationMode={props.activationMode ?? "automatic"}
    >
      <div class={resolved.navClass()}>
        <Show
          when={resolved.type() === "segment"}
          fallback={
            <div class="n-tabs-nav-scroll-wrapper">
              <div class="n-tabs-nav-scroll-content">
                <KobalteTabs.List
                  class={resolved.wrapperClass()}
                  aria-label={props.ariaLabel}
                >
                  <For each={resolved.items()}>
                    {(item, index) => {
                      const active = () => item.value === props.value;
                      return (
                        <div class="n-tabs-tab-wrapper">
                          <Show when={index() !== 0}>
                            <div class="n-tabs-tab-pad" />
                          </Show>
                          <KobalteTabs.Trigger
                            value={item.value}
                            disabled={item.disabled}
                            data-name={item.value}
                            data-disabled={item.disabled ? "true" : undefined}
                            class={naiveTabsTabClass(
                              active(),
                              item.disabled,
                              props.tabClass,
                              props.tabActiveClass
                            )}
                          >
                            <span class="n-tabs-tab__label">{item.label}</span>
                          </KobalteTabs.Trigger>
                        </div>
                      );
                    }}
                  </For>
                </KobalteTabs.List>
                <div class="n-tabs-bar" />
              </div>
            </div>
          }
        >
          <KobalteTabs.List
            ref={segmentCapsule.railRef}
            class={resolved.railClass()}
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
                      <KobalteTabs.Trigger
                        ref={(el: HTMLButtonElement) => {
                          segmentCapsule.tabRef(item.value, el);
                        }}
                        value={item.value}
                        disabled={item.disabled}
                        data-name={item.value}
                        data-disabled={item.disabled ? "true" : undefined}
                        class={naiveTabsTabClass(
                          active(),
                          item.disabled,
                          props.tabClass,
                          props.tabActiveClass
                        )}
                      >
                        <span class="n-tabs-tab__label">{item.label}</span>
                      </KobalteTabs.Trigger>
                    </div>
                  );
                }}
              </For>
            </div>
          </KobalteTabs.List>
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
    </KobalteTabs>
  );
}
