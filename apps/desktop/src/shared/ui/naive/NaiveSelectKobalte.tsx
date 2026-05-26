import { Combobox } from "@kobalte/core/combobox";
import { Select } from "@kobalte/core/select";
import { Show, createSignal, type JSX } from "solid-js";
import type { CollectionNode } from "@kobalte/core";
import type { NaiveSelectOption, NaiveSelectProps, NaiveSelectValue } from "./select";
import {
  NaiveSelectShell,
  naiveSelectMenuClass,
  naiveSelectOptionClass,
  naiveSelectRootClass,
  naiveSelectSelectedOption
} from "./select-core";

const optionValue = <TValue extends NaiveSelectValue>(
  option: NaiveSelectOption<TValue>
): TValue => option.value;

const optionTextValue = <TValue extends NaiveSelectValue>(
  option: NaiveSelectOption<TValue>
): string => option.label;

const optionDisabled = <TValue extends NaiveSelectValue>(
  option: NaiveSelectOption<TValue>
): boolean => option.disabled ?? false;

const renderOptionLabel = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>,
  option: NaiveSelectOption<TValue>,
  selected: boolean
): JSX.Element => props.renderOption?.(option, selected) ?? props.renderLabel?.(option, selected) ?? option.label;

function NaiveSelectOptionItem<TValue extends NaiveSelectValue>(itemProps: {
  item: CollectionNode<NaiveSelectOption<TValue>>;
  selectProps: NaiveSelectProps<TValue>;
}): JSX.Element {
  const option = () => itemProps.item.rawValue;
  const selected = () => option().value === itemProps.selectProps.value;

  return (
    <Select.Item
      item={itemProps.item}
      class={naiveSelectOptionClass(itemProps.selectProps, option(), selected())}
    >
      <div class="n-base-select-option__content">
        <Select.ItemLabel>
          {renderOptionLabel(itemProps.selectProps, option(), selected())}
        </Select.ItemLabel>
        <Select.ItemIndicator class="n-base-select-option__check">
          <span class="n-base-icon" aria-hidden="true" />
        </Select.ItemIndicator>
      </div>
    </Select.Item>
  );
}

function NaiveComboboxOptionItem<TValue extends NaiveSelectValue>(itemProps: {
  item: CollectionNode<NaiveSelectOption<TValue>>;
  selectProps: NaiveSelectProps<TValue>;
}): JSX.Element {
  const option = () => itemProps.item.rawValue;
  const selected = () => option().value === itemProps.selectProps.value;

  return (
    <Combobox.Item
      item={itemProps.item}
      class={naiveSelectOptionClass(itemProps.selectProps, option(), selected())}
    >
      <div class="n-base-select-option__content">
        <Combobox.ItemLabel>
          {renderOptionLabel(itemProps.selectProps, option(), selected())}
        </Combobox.ItemLabel>
        <Combobox.ItemIndicator class="n-base-select-option__check">
          <span class="n-base-icon" aria-hidden="true" />
        </Combobox.ItemIndicator>
      </div>
    </Combobox.Item>
  );
}

function NaiveSelectSuffix<TValue extends NaiveSelectValue>(props: {
  selectProps: NaiveSelectProps<TValue>;
  selected: boolean;
  onClear: (event: MouseEvent) => void;
}): JSX.Element {
  const showClear = () =>
    props.selectProps.clearable === true &&
    props.selected &&
    !props.selectProps.disabled &&
    !props.selectProps.readonly;

  return (
    <span class="n-base-suffix" aria-hidden="true">
      <Show when={showClear()}>
        <span
          class="n-base-clear"
          onPointerDown={(event) => event.preventDefault()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={props.onClear}
        >
          <span class="n-base-icon" aria-hidden="true" />
        </span>
      </Show>
      <Show when={props.selectProps.loading}>
        <span class="n-base-loading is-loading" />
      </Show>
      <Show when={props.selectProps.showArrow ?? true}>
        <span class="n-base-suffix__arrow" />
      </Show>
    </span>
  );
}

function NaiveSelectValueDisplay<TValue extends NaiveSelectValue>(props: {
  selectProps: NaiveSelectProps<TValue>;
}): JSX.Element {
  const selected = () => naiveSelectSelectedOption(props.selectProps);

  return (
    <span class="n-base-selection-value">
      <Show
        when={selected()}
        fallback={
          <span class="n-base-selection-placeholder n-base-selection-overlay">
            <span class="n-base-selection-placeholder__inner">
              {props.selectProps.placeholder}
            </span>
          </span>
        }
      >
        {(option) => (
          <span class="n-base-selection-input">
            <span class="n-base-selection-input__content">
              {props.selectProps.renderLabel?.(option(), true) ?? option().label}
            </span>
          </span>
        )}
      </Show>
    </span>
  );
}

function NaiveKobalteSelect<TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  const [open, setOpen] = createSignal<boolean>(props.open ?? false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const selectedOption = () => naiveSelectSelectedOption(props);
  const selected = () => selectedOption() != null;
  const currentOpen = () => props.open ?? open();

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };
  const handleChange = (option: NaiveSelectOption<TValue> | null): void => {
    props.onUpdateValue?.(option?.value ?? null, option);
    props.onChange?.(option?.value ?? null, option);
  };
  const handleClear = (event: MouseEvent): void => {
    event.stopPropagation();
    props.onClear?.();
    props.onUpdateValue?.(null, null);
    props.onChange?.(null, null);
  };

  return (
    <Select<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      value={selectedOption()}
      options={[...props.options]}
      optionValue={optionValue}
      optionTextValue={optionTextValue}
      optionDisabled={optionDisabled}
      itemComponent={(itemProps) => (
        <NaiveSelectOptionItem item={itemProps.item} selectProps={props} />
      )}
      placeholder={props.placeholder}
      open={currentOpen()}
      onOpenChange={handleOpenChange}
      onChange={handleChange}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      placement={props.placement ?? "bottom-start"}
      gutter={4}
      sameWidth
      modal={false}
      preventScroll={false}
    >
      <Select.HiddenSelect />
      <NaiveSelectShell selectProps={props} state={{ open: currentOpen(), focused: focused() }}>
        <Select.Trigger
          class="n-base-selection-label"
          aria-label={props.ariaLabel}
          aria-labelledby={props.ariaLabelledBy}
          aria-describedby={props.ariaDescribedBy}
          onFocus={(event: FocusEvent) => {
            setFocused(true);
            props.onFocus?.(event);
          }}
          onBlur={(event: FocusEvent) => {
            setFocused(false);
            props.onBlur?.(event);
          }}
        >
          <Select.Value<NaiveSelectOption<TValue>>
            class="n-base-selection-value-slot"
          >
            {() => <NaiveSelectValueDisplay selectProps={props} />}
          </Select.Value>
          <NaiveSelectSuffix selectProps={props} selected={selected()} onClear={handleClear} />
        </Select.Trigger>
      </NaiveSelectShell>
      <Show when={currentOpen() && typeof document !== "undefined"}>
        <Select.Portal mount={document.body}>
          <Select.Content class={naiveSelectMenuClass(props)}>
            <Select.Listbox />
          </Select.Content>
        </Select.Portal>
      </Show>
    </Select>
  );
}

function NaiveKobalteCombobox<TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  const [open, setOpen] = createSignal<boolean>(props.open ?? false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const selectedOption = () => naiveSelectSelectedOption(props);
  const selected = () => selectedOption() != null;
  const currentOpen = () => props.open ?? open();

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };
  const handleChange = (option: NaiveSelectOption<TValue> | null): void => {
    props.onUpdateValue?.(option?.value ?? null, option);
    props.onChange?.(option?.value ?? null, option);
  };
  const handleClear = (event: MouseEvent): void => {
    event.stopPropagation();
    props.onClear?.();
    props.onUpdateValue?.(null, null);
    props.onChange?.(null, null);
  };

  return (
    <Combobox<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      value={selectedOption()}
      options={[...props.options]}
      optionValue={optionValue}
      optionTextValue={optionTextValue}
      optionLabel={optionTextValue}
      optionDisabled={optionDisabled}
      itemComponent={(itemProps) => (
        <NaiveComboboxOptionItem item={itemProps.item} selectProps={props} />
      )}
      placeholder={props.placeholder}
      open={currentOpen()}
      onOpenChange={handleOpenChange}
      onInputChange={(value) => props.onSearch?.(value)}
      onChange={handleChange}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      placement={props.placement ?? "bottom-start"}
      gutter={4}
      sameWidth
      modal={false}
      preventScroll={false}
      triggerMode="focus"
    >
      <Combobox.HiddenSelect />
      <NaiveSelectShell selectProps={props} state={{ open: currentOpen(), focused: focused() }}>
        <Combobox.Control class="n-base-selection-label">
          <span class="n-base-selection-value">
            <Combobox.Input
              class="n-base-selection-input"
              aria-label={props.ariaLabel}
              aria-labelledby={props.ariaLabelledBy}
              aria-describedby={props.ariaDescribedBy}
              onFocus={(event: FocusEvent) => {
                setFocused(true);
                props.onFocus?.(event);
              }}
              onBlur={(event: FocusEvent) => {
                setFocused(false);
                props.onBlur?.(event);
              }}
            />
          </span>
          <Combobox.Trigger class="n-base-selection-trigger">
            <NaiveSelectSuffix
              selectProps={props}
              selected={selected()}
              onClear={handleClear}
            />
          </Combobox.Trigger>
        </Combobox.Control>
      </NaiveSelectShell>
      <Show when={currentOpen() && typeof document !== "undefined"}>
        <Combobox.Portal mount={document.body}>
          <Combobox.Content class={naiveSelectMenuClass(props)}>
            <Combobox.Listbox />
          </Combobox.Content>
        </Combobox.Portal>
      </Show>
    </Combobox>
  );
}

export function NaiveSelectKobalte<TValue extends NaiveSelectValue = string>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  return props.filterable ? (
    <NaiveKobalteCombobox {...props} />
  ) : (
    <NaiveKobalteSelect {...props} />
  );
}
