import { For, Show } from "solid-js";
import type { PlayerBarNcmQualityOption } from "./usePlayerBarNcmQuality";
import { NaivePopover } from "../../shared/ui/naive";
import type { NcmSongLevel } from "../../shared/state/uiSettingsModel";

interface PlayerQualityPopoverProps {
  open: boolean;
  buttonValue: string;
  buttonLabel: string;
  dialogLabel: string;
  mode: "online" | "output";
  options: readonly PlayerBarNcmQualityOption[];
  selectedLevel: NcmSongLevel | null;
  loading: boolean;
  error: string | null;
  targetLabel: string;
  targetValue: string;
  resamplerLabel: string;
  resamplerValue: string;
  outputBitsLabel: string;
  outputBitsValue: string;
  exclusiveLabel: string;
  exclusiveValue: string;
  ditherLabel: string;
  ditherValue: string;
  loudnessLabel: string;
  loudnessValue: string;
  hintLabel: string;
  triggerClass?: string;
  popoverClass?: string;
  onOpenChange: (open: boolean) => void;
  onSelectLevel?: (level: NcmSongLevel) => void;
}

export function PlayerQualityPopover(props: PlayerQualityPopoverProps) {
  return (
    <NaivePopover
      triggerMode="click"
      placement="top"
      gutter={6}
      open={props.open}
      onOpenChange={props.onOpenChange}
      showArrow={false}
      raw
      class={`player-quality-popover${props.popoverClass ? ` ${props.popoverClass}` : ""}`}
      ariaLabel={props.dialogLabel}
      rootStyle={{ height: "26px" }}
      trigger={
        <button
          type="button"
          class={props.triggerClass !== undefined
            ? `${props.triggerClass}${props.open ? " is-open" : ""}`
            : `naive-tag naive-tag--primary player-inline-tag player-right-tag player-utility-hidden player-quality-tag cursor-pointer bg-transparent text-xs${props.open ? " is-open" : ""}`}
          aria-label={props.buttonLabel}
          title={props.buttonLabel}
          aria-haspopup="dialog"
          aria-expanded={props.open}
        >
          {props.buttonValue}
        </button>
      }
    >
      <div class="player-popover-title text-13px font-semibold">{props.dialogLabel}</div>
      <Show
        when={props.mode === "online"}
        fallback={
          <>
            <dl class="player-popover-grid grid gap-x-3 gap-y-1 text-xs">
              <dt>{props.targetLabel}</dt>
              <dd>{props.targetValue}</dd>
              <dt>{props.resamplerLabel}</dt>
              <dd>{props.resamplerValue}</dd>
              <dt>{props.outputBitsLabel}</dt>
              <dd>{props.outputBitsValue}</dd>
              <dt>{props.exclusiveLabel}</dt>
              <dd>{props.exclusiveValue}</dd>
              <dt>{props.ditherLabel}</dt>
              <dd>{props.ditherValue}</dd>
              <dt>{props.loudnessLabel}</dt>
              <dd>{props.loudnessValue}</dd>
            </dl>
            <div class="player-popover-hint text-11px">{props.hintLabel}</div>
          </>
        }
      >
        <div class="player-quality-options flex flex-col gap-1">
          <Show when={props.loading}>
            <div class="player-popover-hint text-11px">{props.hintLabel}</div>
          </Show>
          <For each={props.options}>
            {(item) => (
              <button
                type="button"
                class={`player-quality-option flex items-center justify-between gap-3 text-left${
                  props.selectedLevel === item.level ? " is-active" : ""
                }`}
                onClick={() => props.onSelectLevel?.(item.level)}
              >
                <span>{item.label}</span>
                <Show when={item.detail}>
                  {(detail) => <span class="player-quality-option-meta">{detail()}</span>}
                </Show>
              </button>
            )}
          </For>
          <Show when={props.error}>
            {(error) => <div class="player-popover-hint text-11px">{error()}</div>}
          </Show>
        </div>
      </Show>
    </NaivePopover>
  );
}
