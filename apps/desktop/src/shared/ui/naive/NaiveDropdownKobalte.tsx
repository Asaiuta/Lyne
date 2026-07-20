import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import type {
  NaiveDropdownOption,
  NaiveDropdownProps,
  NaiveDropdownTriggerMode
} from "./dropdown.shared";
import {
  naiveDropdownDividerClass,
  naiveDropdownMenuClass,
  naiveDropdownOptionClass,
  naiveDropdownOptionLabelClass,
  naiveDropdownOptionPrefixClass,
  naiveDropdownOptionSuffixClass
} from "./dropdown.shared";
import { joinClassNames } from "./utils";

const HOVER_OPEN_DELAY = 100;
const HOVER_CLOSE_DELAY = 200;
const DROPDOWN_LEAVE_PRESENCE_MS = 180;

let virtualVsTriggerWarnLogged = false;

const warnVirtualVsTriggerOnce = (): void => {
  if (virtualVsTriggerWarnLogged) return;
  virtualVsTriggerWarnLogged = true;
  console.warn(
    "[NaiveDropdown] virtual x/y takes precedence over trigger children"
  );
};

interface DropdownOptionRowProps {
  option: NaiveDropdownOption;
  onSelect: (option: NaiveDropdownOption) => void;
  mountTarget?: HTMLElement;
  menuClass: string;
}

function DropdownDividerRow(): JSX.Element {
  return (
    <DropdownMenu.Separator class={naiveDropdownDividerClass()} aria-hidden="true" />
  );
}

function DropdownOptionContent(props: { option: NaiveDropdownOption }): JSX.Element {
  const hasIcon = (): boolean => props.option.icon != null;
  const hasSuffix = (): boolean => props.option.suffix != null;

  return (
    <>
      <Show when={hasIcon()}>
        <span class={naiveDropdownOptionPrefixClass({ hasIcon: true })} aria-hidden="true">
          {props.option.icon}
        </span>
      </Show>
      <span class={naiveDropdownOptionLabelClass()}>{props.option.label}</span>
      <Show when={hasSuffix()}>
        <span class={naiveDropdownOptionSuffixClass()} aria-hidden="true">
          {props.option.suffix}
        </span>
      </Show>
    </>
  );
}

function DropdownLeafOptionRow(props: DropdownOptionRowProps): JSX.Element {
  const disabled = (): boolean => props.option.disabled === true;

  return (
    <DropdownMenu.Item
      disabled={disabled()}
      textValue={props.option.label}
      data-key={props.option.key}
      class={naiveDropdownOptionClass({
        disabled: disabled(),
        className: props.option.class
      })}
      onSelect={() => {
        if (disabled()) return;
        props.onSelect(props.option);
      }}
    >
      <DropdownOptionContent option={props.option} />
    </DropdownMenu.Item>
  );
}

function DropdownSubmenuOptionRow(props: DropdownOptionRowProps): JSX.Element {
  const disabled = (): boolean => props.option.disabled === true;

  return (
    <DropdownMenu.Sub gutter={4}>
      <DropdownMenu.SubTrigger
        textValue={props.option.label}
        disabled={disabled()}
        data-key={props.option.key}
        class={naiveDropdownOptionClass({
          disabled: disabled(),
          className: props.option.class
        })}
      >
        <DropdownOptionContent option={props.option} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal mount={props.mountTarget}>
        <DropdownMenu.SubContent
          class={joinClassNames(props.menuClass, "n-dropdown-submenu")}
        >
          <For each={props.option.children}>
            {(option) => (
              <DropdownOptionTreeRow
                option={option}
                onSelect={props.onSelect}
                mountTarget={props.mountTarget}
                menuClass={props.menuClass}
              />
            )}
          </For>
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function DropdownOptionTreeRow(props: DropdownOptionRowProps): JSX.Element {
  if (props.option.type === "divider") return <DropdownDividerRow />;
  if (props.option.children && props.option.children.length > 0) {
    return <DropdownSubmenuOptionRow {...props} />;
  }
  return <DropdownLeafOptionRow {...props} />;
}

export function NaiveDropdownKobalte(props: NaiveDropdownProps): JSX.Element {
  const triggerMode = (): NaiveDropdownTriggerMode => props.triggerMode ?? "hover";
  const isManual = (): boolean => triggerMode() === "manual";
  const usesPassiveTrigger = (): boolean => triggerMode() !== "click";
  const [contentPresent, setContentPresent] = createSignal<boolean>(
    props.show ?? props.open ?? props.defaultOpen ?? false
  );
  const [hoverOpen, setHoverOpen] = createSignal<boolean>(props.defaultOpen ?? false);

  // Virtual mode is active when both x and y coords are defined.
  const isVirtual = (): boolean =>
    typeof props.x === "number" && typeof props.y === "number";

  // One-shot warn when both a trigger slot AND virtual coords are present.
  createEffect(() => {
    if (isVirtual() && props.children !== undefined) {
      warnVirtualVsTriggerOnce();
    }
  });

  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearTimers = (): void => {
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const clearPresenceTimer = (): void => {
    if (presenceTimer === undefined) return;
    clearTimeout(presenceTimer);
    presenceTimer = undefined;
  };
  const updateContentPresence = (nextOpen: boolean): void => {
    clearPresenceTimer();
    if (nextOpen) {
      setContentPresent(true);
      return;
    }
    if (!contentPresent()) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = undefined;
      setContentPresent(false);
    }, DROPDOWN_LEAVE_PRESENCE_MS);
  };

  onCleanup(() => {
    clearTimers();
    clearPresenceTimer();
  });

  const handleOpenChange = (nextOpen: boolean): void => {
    clearTimers();
    if (isVirtual()) {
      props.onShowChange?.(nextOpen);
    }
    if (props.open === undefined && props.show === undefined && triggerMode() === "hover") {
      setHoverOpen(nextOpen);
    }
    props.onOpenChange?.(nextOpen);
    if (rootOpen() === undefined) updateContentPresence(nextOpen);
  };

  const handleSelect = (option: NaiveDropdownOption): void => {
    if (option.disabled) return;
    option.onSelect?.(option);
    props.onSelect?.(option);
  };

  const scheduleHoverOpen = (): void => {
    if (props.disabled || isManual() || isVirtual()) return;
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    if (props.open === true) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      handleOpenChange(true);
    }, HOVER_OPEN_DELAY);
  };

  const scheduleHoverClose = (): void => {
    if (props.disabled || isManual() || isVirtual()) return;
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (props.open === false) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      handleOpenChange(false);
    }, HOVER_CLOSE_DELAY);
  };

  const mountTarget = (): HTMLElement | undefined => props.to ?? undefined;
  const triggerClass = () =>
    joinClassNames("naive-dropdown-trigger", props.triggerClass);
  const menuClass = () => naiveDropdownMenuClass({ class: props.class });
  const passiveTriggerStyle = (): JSX.CSSProperties => ({
    ...props.triggerStyle,
    position: props.triggerStyle?.position ?? "relative"
  });
  const passiveAnchorStyle = (): JSX.CSSProperties => ({
    position: "absolute",
    top: "0",
    right: "0",
    bottom: "0",
    left: "0",
    width: "100%",
    height: "100%",
    opacity: 0,
    "pointer-events": "none"
  });

  // Determine the open prop pass-through. In virtual mode, `show` wins over
  // `open`. Otherwise pass `open` if caller wired it (else Kobalte uncontrolled).
  const rootOpen = (): boolean | undefined => {
    if (isVirtual()) {
      if (props.show !== undefined) return props.show;
      if (props.open !== undefined) return props.open;
      return undefined;
    }
    if (isManual()) return props.open ?? props.show ?? false;
    if (triggerMode() === "hover") return props.open ?? props.show ?? hoverOpen();
    if (props.open !== undefined) return props.open;
    return undefined;
  };

  createEffect(() => {
    const controlledOpen = rootOpen();
    if (controlledOpen === undefined) return;
    updateContentPresence(controlledOpen);
  });

  // Reactive style for the invisible virtual trigger. SolidJS updates only the
  // changed style fields per prop change, so the Trigger element is never
  // re-rendered when (x, y) moves.
  const virtualTriggerStyle = (): JSX.CSSProperties => ({
    position: "fixed",
    left: `${props.x ?? 0}px`,
    top: `${props.y ?? 0}px`,
    width: "0px",
    height: "0px",
    "pointer-events": "none"
  });
  const renderInlineTrigger = (): JSX.Element => {
    if (usesPassiveTrigger()) {
      return (
        <span
          class={triggerClass()}
          style={passiveTriggerStyle()}
          data-naive-dropdown-trigger
          onPointerEnter={
            triggerMode() === "hover" && !isManual() ? scheduleHoverOpen : undefined
          }
          onPointerLeave={
            triggerMode() === "hover" && !isManual() ? scheduleHoverClose : undefined
          }
        >
          <DropdownMenu.Trigger
            as="span"
            tabindex={-1}
            style={passiveAnchorStyle()}
          />
          {props.children}
        </span>
      );
    }
    return (
      <DropdownMenu.Trigger
        as="span"
        class={triggerClass()}
        style={props.triggerStyle}
        data-naive-dropdown-trigger
      >
        {props.children}
      </DropdownMenu.Trigger>
    );
  };

  return (
    <DropdownMenu
      open={rootOpen()}
      defaultOpen={props.defaultOpen}
      onOpenChange={handleOpenChange}
      placement={props.placement ?? "bottom-start"}
      gutter={props.gutter ?? 6}
      modal={false}
      preventScroll={false}
      forceMount={contentPresent()}
    >
      <Show
        when={isVirtual()}
        fallback={renderInlineTrigger()}
      >
        <DropdownMenu.Trigger
          as="span"
          class={triggerClass()}
          data-naive-dropdown-virtual-trigger
          tabindex={-1}
          style={virtualTriggerStyle()}
        />
      </Show>
      <DropdownMenu.Portal mount={mountTarget()}>
        <DropdownMenu.Content
          class={menuClass()}
          aria-label={props.ariaLabel}
          onPointerEnter={
            triggerMode() === "hover" && !isManual() && !isVirtual()
              ? () => {
                  if (closeTimer !== undefined) {
                    clearTimeout(closeTimer);
                    closeTimer = undefined;
                  }
                }
              : undefined
          }
          onPointerLeave={
            triggerMode() === "hover" && !isManual() && !isVirtual()
              ? scheduleHoverClose
              : undefined
          }
        >
          {props.header}
          <For each={props.options}>
            {(option) => (
              <DropdownOptionTreeRow
                option={option}
                onSelect={handleSelect}
                mountTarget={mountTarget()}
                menuClass={menuClass()}
              />
            )}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
