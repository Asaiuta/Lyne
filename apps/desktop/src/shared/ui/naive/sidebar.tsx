import {
  Show,
  type Component,
  type JSX
} from "solid-js";
import { NaiveButton, type NaiveAriaHasPopup, type NaiveButtonMouseHandler } from "./button";
import { NaiveAvatar, NaiveBadge, NaiveEllipsis } from "./display";
import {
  NaivePopselect,
  type NaivePopselectOption,
  type NaivePopselectTriggerButtonProps
} from "./popselect";
import { joinClassNames } from "./utils";

export type NaiveSidebarIconComponent = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

interface SidebarNavButtonProps {
  icon: NaiveSidebarIconComponent;
  label: string;
  active?: boolean;
  collapsed?: boolean;
  expanded?: boolean;
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

const SIDEBAR_SECTION_ACTION_BUTTON = {
  variant: "tertiary",
  size: "tiny",
  round: true,
  secondary: true,
  strong: true
} satisfies NaivePopselectTriggerButtonProps;

export function SidebarNavButton(props: SidebarNavButtonProps) {
  const Icon = props.icon;
  const badgeCount = () => props.badgeCount ?? 0;
  const labelWhenCollapsed = () => (props.collapsed ? props.label : undefined);

  return (
    <NaiveButton
      class={`sidebar-nav-button sidebar-nav-item${activeClass(props.active)}`}
      dataPerfRouteKey={props.routeKey}
      onClick={props.onClick}
      ariaCurrent={props.active ? "page" : undefined}
      ariaExpanded={props.expanded}
      ariaLabel={labelWhenCollapsed()}
      title={labelWhenCollapsed()}
    >
      <span class="sidebar-nav-icon" aria-hidden="true">
        <Icon />
      </span>
      <span class="sidebar-nav-label">{props.label}</span>
      <Show when={badgeCount() > 0}>
        <NaiveBadge class="sidebar-nav-badge" ariaLabel={String(badgeCount())}>
          {badgeCount()}
        </NaiveBadge>
      </Show>
    </NaiveButton>
  );
}

export function SidebarIconButton(props: SidebarIconButtonProps) {
  const Icon = props.icon;
  const baseClass = () =>
    props.variant === "section" ? "sidebar-section-action-icon" : "sidebar-nav-action";
  const buttonVisualProps = (): NaivePopselectTriggerButtonProps =>
    props.variant === "section"
      ? SIDEBAR_SECTION_ACTION_BUTTON
      : {
          variant: props.active ? "primary" : "tertiary",
          size: "small",
          round: true,
          secondary: true,
          strong: true
        };
  const stateClass = () => `${props.open ? " is-open" : ""}${props.active ? " is-sidebar-active" : ""}`;
  const className = () => joinClassNames(baseClass(), props.class) + stateClass();

  return (
    <NaiveButton
      class={className()}
      variant={buttonVisualProps().variant}
      size={buttonVisualProps().size}
      round={buttonVisualProps().round}
      secondary={buttonVisualProps().secondary}
      strong={buttonVisualProps().strong}
      ariaLabel={props.label}
      ariaHasPopup={props.hasPopup}
      ariaExpanded={props.expanded}
      ariaPressed={props.pressed}
      title={props.label}
      onClick={props.onClick}
    >
      <Icon />
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
      triggerButton={SIDEBAR_SECTION_ACTION_BUTTON}
      popoverClass="sidebar-playlist-source-popover"
      optionClass="sidebar-playlist-source-option"
      optionActiveClass="is-active"
      optionContentClass="sidebar-playlist-source-option-content"
      optionCheckClass="sidebar-playlist-source-option-check"
      gutter={10}
      stopTriggerPropagation={true}
      triggerContent={<TriggerIcon />}
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
      class={`sidebar-playlist-button sidebar-playlist-item${activeClass(props.active)}${hiddenCoverClass()}`}
      onClick={props.onClick}
      title={props.label}
    >
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
    </NaiveButton>
  );
}
