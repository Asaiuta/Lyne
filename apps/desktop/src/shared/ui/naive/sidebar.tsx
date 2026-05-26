import {
  Show,
  type Component,
  type JSX
} from "solid-js";
import { NaiveButton, type NaiveAriaHasPopup, type NaiveButtonMouseHandler } from "./button";
import { NaiveAvatar, NaiveBadge, NaiveEllipsis } from "./display";
import { NaivePopselect, type NaivePopselectOption } from "./popselect";
import { joinClassNames } from "./utils";

export type NaiveSidebarIconComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

interface SidebarNavButtonProps {
  icon: NaiveSidebarIconComponent;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  routeKey?: string;
  badgeCount?: number;
  onClick: NaiveButtonMouseHandler;
}

interface SidebarIconButtonProps {
  icon: NaiveSidebarIconComponent;
  label: string;
  variant: "nav" | "section";
  active?: boolean;
  pressed?: boolean;
  open?: boolean;
  class?: string;
  hasPopup?: NaiveAriaHasPopup;
  expanded?: boolean;
  onClick: NaiveButtonMouseHandler;
}

export type NaiveSidebarPopselectOption<TValue extends string> = NaivePopselectOption<TValue>;

export interface SidebarPopselectProps<TValue extends string> {
  label: string;
  open: boolean;
  value: TValue;
  options: ReadonlyArray<NaivePopselectOption<TValue>>;
  triggerIcon: NaiveSidebarIconComponent;
  checkIcon: NaiveSidebarIconComponent;
  onOpenChange: (open: boolean) => void;
  onChange: (value: TValue) => void;
}

interface SidebarPlaylistItemProps {
  label: string;
  active?: boolean;
  showCover?: boolean;
  icon: NaiveSidebarIconComponent;
  cover?: JSX.Element;
  onClick: NaiveButtonMouseHandler;
}

const activeClass = (active: boolean | undefined): string => (active ? " is-active" : "");

export function SidebarNavButton(props: SidebarNavButtonProps) {
  const Icon = props.icon;
  const badgeCount = () => props.badgeCount ?? 0;
  const labelWhenCollapsed = () => (props.collapsed ? props.label : undefined);

  return (
    <NaiveButton
      class={`sidebar-nav-button${activeClass(props.active)}`}
      dataPerfRouteKey={props.routeKey}
      onClick={props.onClick}
      ariaCurrent={props.active ? "page" : undefined}
      ariaLabel={labelWhenCollapsed()}
      title={labelWhenCollapsed()}
    >
      <span class={`sidebar-nav-item${activeClass(props.active)}`}>
        <span class="sidebar-nav-icon" aria-hidden="true">
          <Icon />
        </span>
        <span class="sidebar-nav-label">{props.label}</span>
        <Show when={badgeCount() > 0}>
          <NaiveBadge class="sidebar-nav-badge" ariaLabel={String(badgeCount())}>
            {badgeCount()}
          </NaiveBadge>
        </Show>
      </span>
    </NaiveButton>
  );
}

export function SidebarIconButton(props: SidebarIconButtonProps) {
  const Icon = props.icon;
  const baseClass = () =>
    props.variant === "section" ? "sidebar-section-action-icon" : "sidebar-nav-action";
  const surfaceClass = () =>
    props.variant === "section" ? "sidebar-section-action-surface" : "sidebar-nav-action-surface";
  const stateClass = () => `${props.open ? " is-open" : ""}${activeClass(props.active)}`;
  const className = () => joinClassNames(baseClass(), props.class) + stateClass();

  return (
    <NaiveButton
      class={className()}
      ariaLabel={props.label}
      ariaHasPopup={props.hasPopup}
      ariaExpanded={props.expanded}
      ariaPressed={props.pressed}
      title={props.label}
      onClick={props.onClick}
    >
      <span class={surfaceClass()} aria-hidden="true">
        <Icon />
      </span>
    </NaiveButton>
  );
}

export function SidebarPopselect<TValue extends string>(props: SidebarPopselectProps<TValue>) {
  const TriggerIcon = props.triggerIcon;
  const CheckIcon = props.checkIcon;

  return (
    <NaivePopselect
      label={props.label}
      open={props.open}
      value={props.value}
      options={props.options}
      class="sidebar-playlist-source-menu"
      triggerClass="sidebar-section-action-icon sidebar-playlist-source-trigger"
      triggerOpenClass="is-open"
      popoverClass="sidebar-playlist-source-popover"
      optionClass="sidebar-playlist-source-option"
      optionActiveClass="is-active"
      optionContentClass="sidebar-playlist-source-option-content"
      optionCheckClass="sidebar-playlist-source-option-check"
      gutter={10}
      fallbackPopoverWidth={100}
      stopTriggerPropagation={true}
      triggerContent={
        <span class="sidebar-section-action-surface" aria-hidden="true">
          <TriggerIcon />
        </span>
      }
      renderCheck={() => <CheckIcon />}
      onOpenChange={props.onOpenChange}
      onChange={props.onChange}
    />
  );
}

export function SidebarPlaylistItem(props: SidebarPlaylistItemProps) {
  const Icon = props.icon;
  const showCover = () => props.showCover ?? true;
  const hiddenCoverClass = () => (showCover() ? "" : " is-cover-hidden");

  return (
    <NaiveButton
      class={`sidebar-playlist-button${activeClass(props.active)}${hiddenCoverClass()}`}
      onClick={props.onClick}
      title={props.label}
    >
      <span class={`sidebar-playlist-item${activeClass(props.active)}${hiddenCoverClass()}`}>
        <Show
          when={showCover()}
          fallback={
            <span class="sidebar-playlist-icon" aria-hidden="true">
              <Icon />
            </span>
          }
        >
          <NaiveAvatar
            class="sidebar-playlist-cover"
            ariaHidden={true}
            fallback={<span>{props.label.slice(0, 1)}</span>}
          >
            {props.cover}
          </NaiveAvatar>
        </Show>
        <span class="sidebar-playlist-copy">
          <NaiveEllipsis class="sidebar-playlist-name" title={props.label}>
            {props.label}
          </NaiveEllipsis>
        </span>
      </span>
    </NaiveButton>
  );
}
