import type { Accessor } from "solid-js";
import {
  NaiveButton,
  NaiveInput,
  NaiveSelect,
  NaiveSlider,
  NaiveSwitch,
  type NaiveSelectOption
} from "../../../shared/ui/naive";
import { SettingItem, rangeValueClass, rangeWithValueClass } from "./SettingItem";
import { WipBadge } from "./WipBadge";

export type SelectOption = NaiveSelectOption<string>;

interface BaseSettingControlProps {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
  highlighted: boolean;
  index: number;
  wip?: boolean;
}

interface BooleanSettingItemProps extends BaseSettingControlProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
}

export function BooleanSettingItem(props: BooleanSettingItemProps) {
  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
      badge={props.wip ? <WipBadge /> : undefined}
    >
      <NaiveSwitch
        checked={props.checked}
        disabled={props.disabled || props.wip}
        round={false}
        onChange={props.disabled || props.wip ? undefined : props.onChange}
        ariaLabel={props.label}
      />
    </SettingItem>
  );
}

interface ButtonSettingItemProps extends BaseSettingControlProps {
  buttonLabel: string;
  onClick?: () => void;
}

export function ButtonSettingItem(props: ButtonSettingItemProps) {
  const disabled = () => props.disabled || props.wip;

  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
      badge={props.wip ? <WipBadge /> : undefined}
    >
      <NaiveButton
        class="settings-action-button"
        variant="primary"
        secondary
        strong
        size="medium"
        onClick={() => {
          if (!disabled()) props.onClick?.();
        }}
        disabled={disabled()}
      >
        {props.buttonLabel}
      </NaiveButton>
    </SettingItem>
  );
}

interface RecordBooleanSettingItemProps<T extends Record<string, boolean>, K extends keyof T>
  extends BaseSettingControlProps {
  record: Accessor<T>;
  recordKey: K;
  checked: (record: T, key: K) => boolean;
  onChange: (nextChecked: boolean) => void;
}

export function RecordBooleanSettingItem<T extends Record<string, boolean>, K extends keyof T>(
  props: RecordBooleanSettingItemProps<T, K>
) {
  const currentChecked = () => props.checked(props.record(), props.recordKey);

  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
    >
      <NaiveSwitch
        checked={currentChecked()}
        round={false}
        onChange={props.onChange}
        ariaLabel={props.label}
      />
    </SettingItem>
  );
}

interface SelectSettingItemProps extends BaseSettingControlProps {
  value: string;
  options: SelectOption[];
  onChange?: (value: string) => void;
}

export function SelectSettingItem(props: SelectSettingItemProps) {
  const handleChange = (value: string) => {
    if (props.disabled || props.wip) return;
    props.onChange?.(value);
  };

  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
      badge={props.wip ? <WipBadge /> : undefined}
    >
      <NaiveSelect
        value={props.value}
        options={props.options}
        onUpdateValue={(value) => {
          if (value != null) handleChange(value);
        }}
        disabled={props.disabled || props.wip}
        ariaLabel={props.label}
      />
    </SettingItem>
  );
}

interface RangeSettingItemProps extends BaseSettingControlProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onPreview?: (value: number) => void;
  onCommit?: (value: number) => void;
  formatSuffix?: string;
}

export function RangeSettingItem(props: RangeSettingItemProps) {
  const disabled = () => props.disabled || props.wip;
  const formattedValue = (value: number) => `${value}${props.formatSuffix ?? ""}`;

  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
    >
      <div class={rangeWithValueClass}>
        <span class={rangeValueClass}>{formattedValue(props.value)}</span>
        <NaiveSlider
          class="settings-range-slider"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={disabled()}
          formatTooltip={formattedValue}
          onUpdateValue={(value) => {
            if (!disabled()) props.onPreview?.(value);
          }}
          onUpdateValueEnd={(value) => {
            if (!disabled()) props.onCommit?.(value);
          }}
          ariaLabel={props.label}
        />
      </div>
    </SettingItem>
  );
}

interface TextSettingItemProps extends BaseSettingControlProps {
  value: string;
  onInput?: (value: string) => void;
  onCommit?: (value: string) => void;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "numeric";
}

export function TextSettingItem(props: TextSettingItemProps) {
  const disabled = () => props.disabled || props.wip;
  const readCurrentValue = (event: FocusEvent) =>
    (event.currentTarget as HTMLInputElement).value;
  const commit = (value: string) => {
    if (disabled()) return;
    props.onCommit?.(value);
  };

  return (
    <SettingItem
      id={props.id}
      label={props.label}
      description={props.description}
      highlighted={props.highlighted}
      index={props.index}
      badge={props.wip ? <WipBadge /> : undefined}
    >
      <NaiveInput
        type="text"
        value={props.value}
        onUpdateValue={(value) => {
          if (!disabled()) props.onInput?.(value);
        }}
        onBlur={(event) => commit(readCurrentValue(event))}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          (event.currentTarget as HTMLInputElement).blur();
        }}
        disabled={disabled()}
        placeholder={props.placeholder}
        inputProps={{ inputmode: props.inputMode }}
        ariaLabel={props.label}
      />
    </SettingItem>
  );
}
