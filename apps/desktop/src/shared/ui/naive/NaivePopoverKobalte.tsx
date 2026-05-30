import { Popover as KobaltePopover } from "@kobalte/core/popover";
import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import type {
  NaivePopoverAnchorRect,
  NaivePopoverProps,
  NaivePopoverTrigger
} from "./popover";
import {
  naivePopoverArrowClass,
  naivePopoverContentClass
} from "./popover";
import { joinClassNames } from "./utils";

const HOVER_OPEN_DELAY = 100;
const HOVER_CLOSE_DELAY = 100;
const POPOVER_LEAVE_PRESENCE_MS = 180;

const resolveAnchorRect = (
  rect: NaivePopoverAnchorRect
): { x: number; y: number; width: number; height: number } => ({
  x: rect.x,
  y: rect.y,
  width: rect.width ?? 0,
  height: rect.height ?? 0
});

export function NaivePopoverKobalte(props: NaivePopoverProps): JSX.Element {
  const triggerMode = (): NaivePopoverTrigger => props.triggerMode ?? "hover";
  const isManual = (): boolean => triggerMode() === "manual";
  const showArrow = (): boolean => props.showArrow ?? true;
  const useTriggerElement = (): boolean =>
    triggerMode() === "click" && !isManual();

  const [uncontrolledOpen, setUncontrolledOpen] = createSignal<boolean>(
    props.defaultOpen ?? false
  );
  const [contentPresent, setContentPresent] = createSignal<boolean>(
    props.open ?? props.defaultOpen ?? false
  );

  const open = (): boolean => {
    if (props.open !== undefined) return props.open;
    return uncontrolledOpen();
  };

  const setOpen = (next: boolean): void => {
    if (props.open === undefined) setUncontrolledOpen(next);
    props.onOpenChange?.(next);
  };

  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let triggerRef: HTMLElement | undefined;
  let triggerPointerDown = false;

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
    }, POPOVER_LEAVE_PRESENCE_MS);
  };

  createEffect(() => updateContentPresence(open()));

  onCleanup(() => {
    clearTimers();
    clearPresenceTimer();
  });

  const scheduleHoverOpen = (): void => {
    if (props.disabled || isManual()) return;
    if (closeTimer !== undefined) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
    if (open()) return;
    openTimer = setTimeout(() => {
      openTimer = undefined;
      setOpen(true);
    }, HOVER_OPEN_DELAY);
  };

  const scheduleHoverClose = (): void => {
    if (props.disabled || isManual()) return;
    if (openTimer !== undefined) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (!open()) return;
    closeTimer = setTimeout(() => {
      closeTimer = undefined;
      setOpen(false);
    }, HOVER_CLOSE_DELAY);
  };

  const handleFocusIn = (): void => {
    if (props.disabled || isManual()) return;
    if (triggerMode() === "focus") setOpen(true);
  };

  const handleFocusOut = (): void => {
    if (props.disabled || isManual()) return;
    if (triggerMode() === "focus") setOpen(false);
  };

  const getAnchorRectImpl = ():
    | { x: number; y: number; width: number; height: number }
    | undefined => {
    const supplier = props.getAnchorRect;
    if (!supplier) return undefined;
    return resolveAnchorRect(supplier());
  };

  const mountTarget = (): HTMLElement | undefined => props.to ?? undefined;

  const contentClass = () =>
    naivePopoverContentClass({
      class: props.class,
      raw: props.raw,
      showArrow: showArrow()
    });

  const anchorClass = () =>
    joinClassNames("naive-popover-trigger", props.rootClass);

  const isTriggerEventTarget = (target: EventTarget | null): boolean =>
    target instanceof Element && Boolean(triggerRef?.contains(target));

  const markTriggerPointerDown = (): void => {
    if (triggerMode() === "click") return;
    triggerPointerDown = true;
    setTimeout(() => {
      triggerPointerDown = false;
    }, 0);
  };

  const renderTrigger = (): JSX.Element => {
    // Click mode: Kobalte's PopoverTrigger handles toggle + aria semantics
    // automatically. Hover/focus/manual modes use Anchor with custom handlers
    // so click does not auto-toggle.
    if (useTriggerElement()) {
      return (
        <KobaltePopover.Trigger
          as="span"
          ref={(element: HTMLElement) => {
            triggerRef = element;
          }}
          class={anchorClass()}
          style={props.rootStyle}
          data-naive-popover-trigger
        >
          {props.trigger}
        </KobaltePopover.Trigger>
      );
    }
    return (
      <KobaltePopover.Anchor
        as="span"
        ref={(element: HTMLElement) => {
          triggerRef = element;
        }}
        class={anchorClass()}
        style={props.rootStyle}
        data-naive-popover-trigger
        onPointerEnter={triggerMode() === "hover" ? scheduleHoverOpen : undefined}
        onPointerLeave={
          triggerMode() === "hover" ? scheduleHoverClose : undefined
        }
        onPointerDownCapture={markTriggerPointerDown}
        onFocusIn={triggerMode() === "focus" ? handleFocusIn : undefined}
        onFocusOut={triggerMode() === "focus" ? handleFocusOut : undefined}
      >
        {props.trigger}
      </KobaltePopover.Anchor>
    );
  };

  return (
    <KobaltePopover
      open={open()}
      onOpenChange={(nextOpen) => {
        clearTimers();
        if (props.disabled && nextOpen) return;
        if (!nextOpen && triggerPointerDown) return;
        setOpen(nextOpen);
      }}
      placement={props.placement ?? "top"}
      gutter={props.gutter}
      modal={false}
      forceMount={contentPresent()}
      getAnchorRect={props.getAnchorRect ? getAnchorRectImpl : undefined}
    >
      <Show when={props.trigger !== undefined || !props.getAnchorRect}>
        {renderTrigger()}
      </Show>
      <KobaltePopover.Portal mount={mountTarget()}>
        <KobaltePopover.Content
          class={contentClass()}
          aria-label={props.ariaLabel}
          role={props.role as JSX.HTMLAttributes<HTMLElement>["role"]}
          onPointerEnter={
            triggerMode() === "hover" ? scheduleHoverOpen : undefined
          }
          onPointerLeave={
            triggerMode() === "hover" ? scheduleHoverClose : undefined
          }
          onPointerDownOutside={(event) => {
            if (isTriggerEventTarget(event.target)) markTriggerPointerDown();
          }}
        >
          <Show when={showArrow()}>
            <KobaltePopover.Arrow
              class={naivePopoverArrowClass({ arrowClass: props.arrowClass })}
            />
          </Show>
          {props.children}
        </KobaltePopover.Content>
      </KobaltePopover.Portal>
    </KobaltePopover>
  );
}
