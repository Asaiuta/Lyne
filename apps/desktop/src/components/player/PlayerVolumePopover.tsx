import { createEffect, createSignal } from "solid-js";
import type { Component, JSX } from "solid-js";
import { NaivePopover, NaiveSlider } from "../../shared/ui/naive";

interface PlayerVolumePopoverProps {
  open: boolean;
  value: number;
  icon: Component;
  buttonClass: string;
  popoverClass: string;
  buttonLabel: string;
  dialogLabel: string;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: number) => void;
  onValuePreview?: (value: number) => void;
  buttonTitle?: string;
  buttonDisabled?: boolean;
  sliderDisabled?: boolean;
  sliderClass?: string;
  sliderStyle?: JSX.CSSProperties;
  valueClass?: string;
  onButtonClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>;
  onButtonWheel?: JSX.EventHandlerUnion<HTMLButtonElement, WheelEvent>;
}

export function PlayerVolumePopover(props: PlayerVolumePopoverProps) {
  const Icon = () => props.icon;
  const [draftValue, setDraftValue] = createSignal<number>(props.value);
  const [dragging, setDragging] = createSignal<boolean>(false);

  createEffect(() => {
    if (!dragging()) {
      setDraftValue(props.value);
    }
  });

  const handlePreview = (value: number): void => {
    setDraftValue(value);
    (props.onValuePreview ?? props.onValueChange)(value);
  };
  const handleCommit = (value: number): void => {
    setDraftValue(value);
    props.onValueChange(value);
  };

  return (
    <NaivePopover
      triggerMode="hover"
      placement="top"
      gutter={6}
      open={props.open}
      onOpenChange={props.onOpenChange}
      showArrow={false}
      raw
      class={props.popoverClass}
      ariaLabel={props.dialogLabel}
      rootStyle={{ width: "38px", height: "38px" }}
      trigger={
        <button
          type="button"
          class={props.buttonClass}
          onClick={props.onButtonClick}
          onWheel={props.onButtonWheel}
          disabled={props.buttonDisabled}
          aria-label={props.buttonLabel}
          aria-expanded={props.open}
          aria-haspopup="dialog"
          title={props.buttonTitle ?? props.buttonLabel}
        >
          {(() => {
            const CurrentIcon = Icon();
            return <CurrentIcon />;
          })()}
        </button>
      }
    >
      <NaiveSlider
        min={0}
        max={1}
        step={0.01}
        value={draftValue()}
        onUpdateValue={handlePreview}
        onUpdateValueEnd={handleCommit}
        onDragStart={() => setDragging(true)}
        onDragEnd={() => setDragging(false)}
        disabled={props.sliderDisabled}
        class={props.sliderClass ?? "volume-slider"}
        ariaLabel={props.dialogLabel}
        orientation="vertical"
        tooltip={false}
        style={props.sliderStyle}
      />
      <span class={props.valueClass}>{Math.round(draftValue() * 100)}%</span>
    </NaivePopover>
  );
}
