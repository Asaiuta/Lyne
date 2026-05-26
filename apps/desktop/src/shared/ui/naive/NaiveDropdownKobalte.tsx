import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { For, Show, onCleanup, type JSX } from "solid-js";
import type {
  NaiveDropdownOption,
  NaiveDropdownProps,
  NaiveDropdownTriggerMode
} from "./dropdown";
import {
  naiveDropdownDividerClass,
  naiveDropdownMenuClass,
  naiveDropdownOptionClass,
  naiveDropdownOptionLabelClass,
  naiveDropdownOptionPrefixClass,
  naiveDropdownOptionSuffixClass
} from "./dropdown";
import { joinClassNames } from "./utils";

const HOVER_OPEN_DELAY = 100;
const HOVER_CLOSE_DELAY = 200;

let cascadeWarnLogged = false;

const warnCascadeOnce = (): void => {
  if (cascadeWarnLogged) return;
  cascadeWarnLogged = true;
  console.warn(
    "[NaiveDropdown] cascade children deferred — flatten options or use Popover"
  );
};

interface DropdownOptionRowProps {
  option: NaiveDropdownOption;
  onSelect: (option: NaiveDropdownOption) => void;
}

function DropdownDividerRow(): JSX.Element {
  return (
    <DropdownMenu.Separator class={naiveDropdownDividerClass()} aria-hidden="true" />
  );
}

function DropdownOptionRow(props: DropdownOptionRowProps): JSX.Element {
  const disabled = (): boolean => props.option.disabled === true;
  const hasIcon = (): boolean => props.option.icon != null;
  const hasSuffix = (): boolean => props.option.suffix != null;

  return (
    <DropdownMenu.Item
      class={naiveDropdownOptionClass({ disabled: disabled() })}
      disabled={disabled()}
      textValue={props.option.label}
      data-key={props.option.key}
      onSelect={() => {
        if (disabled()) return;
        props.onSelect(props.option);
      }}
    >
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
    </DropdownMenu.Item>
  );
}

export function NaiveDropdownKobalte(props: NaiveDropdownProps): JSX.Element {
  const triggerMode = (): NaiveDropdownTriggerMode => props.triggerMode ?? "click";
  const isManual = (): boolean => triggerMode() === "manual";

  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

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

  onCleanup(clearTimers);

  const handleOpenChange = (nextOpen: boolean): void => {
    clearTimers();
    props.onOpenChange?.(nextOpen);
  };

  const handleSelect = (option: NaiveDropdownOption): void => {
    if (option.disabled) return;
    option.onSelect?.(option);
    props.onSelect?.(option);
  };

  const scheduleHoverOpen = (): void => {
    if (props.disabled || isManual()) return;
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    if (props.open === true) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      props.onOpenChange?.(true);
    }, HOVER_OPEN_DELAY);
  };

  const scheduleHoverClose = (): void => {
    if (props.disabled || isManual()) return;
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (props.open === false) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      props.onOpenChange?.(false);
    }, HOVER_CLOSE_DELAY);
  };

  const mountTarget = (): HTMLElement | undefined => props.to ?? undefined;
  const triggerClass = () =>
    joinClassNames("naive-dropdown-trigger", props.triggerClass);
  const menuClass = () => naiveDropdownMenuClass({ class: props.class });

  // Determine the open prop pass-through. When manual, always pass the controlled
  // value. When click/hover, only pass through if caller wired it (otherwise let
  // Kobalte own uncontrolled state).
  const rootOpen = (): boolean | undefined => {
    if (props.open !== undefined) return props.open;
    return undefined;
  };

  return (
    <DropdownMenu
      open={rootOpen()}
      defaultOpen={props.defaultOpen}
      onOpenChange={handleOpenChange}
      placement={props.placement ?? "bottom-start"}
      gutter={props.gutter}
      modal={false}
      preventScroll={false}
    >
      <DropdownMenu.Trigger
        as="span"
        class={triggerClass()}
        data-naive-dropdown-trigger
        // Hover semantics on the trigger. Kobalte click-toggle stays for "click"
        // mode; for hover we keep click-toggle as well so keyboard activation
        // remains a working fallback.
        onPointerEnter={
          triggerMode() === "hover" && !isManual() ? scheduleHoverOpen : undefined
        }
        onPointerLeave={
          triggerMode() === "hover" && !isManual() ? scheduleHoverClose : undefined
        }
      >
        {props.children}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal mount={mountTarget()}>
        <DropdownMenu.Content
          class={menuClass()}
          aria-label={props.ariaLabel}
          onPointerEnter={
            triggerMode() === "hover" && !isManual()
              ? () => {
                  if (closeTimer !== undefined) {
                    clearTimeout(closeTimer);
                    closeTimer = undefined;
                  }
                }
              : undefined
          }
          onPointerLeave={
            triggerMode() === "hover" && !isManual()
              ? scheduleHoverClose
              : undefined
          }
        >
          <For each={props.options}>
            {(option) => {
              // Cascade `children` is deferred in PR2; warn once and skip rendering
              // the submenu surface, but still render the option row inline.
              if (option.children && option.children.length > 0) {
                warnCascadeOnce();
              }
              if (option.type === "divider") {
                return <DropdownDividerRow />;
              }
              return <DropdownOptionRow option={option} onSelect={handleSelect} />;
            }}
          </For>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
