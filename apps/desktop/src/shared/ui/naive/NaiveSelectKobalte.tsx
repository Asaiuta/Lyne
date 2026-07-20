import { Combobox } from "@kobalte/core/combobox";
import { Select } from "@kobalte/core/select";
import { For, Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import type { CollectionNode } from "@kobalte/core";
import "./styles/select-kobalte.css";
import { usePresenceTransition } from "../usePresenceTransition";
import type { NaiveSelectOption, NaiveSelectProps, NaiveSelectValue } from "./select.types";
import {
  NaiveSelectShell,
  naiveSelectMenuClass,
  naiveSelectOptionClass,
  naiveSelectRootClass,
  naiveSelectSelectedOption,
  naiveSelectSelectedOptions
} from "./select-core";
import { useNaiveSelectFocusHandoff } from "./select-focus-handoff";
import { joinClassNames } from "./utils";

const SELECT_MENU_TRANSITION_MS = 200;

const useInitialSelectFocus = (
  shouldFocus: boolean
): ((element: HTMLElement) => void) => {
  let element: HTMLElement | undefined;
  let frame = 0;

  onMount(() => {
    if (!shouldFocus || typeof window === "undefined") return;
    frame = window.requestAnimationFrame(() => element?.focus());
  });

  onCleanup(() => {
    if (typeof window !== "undefined") window.cancelAnimationFrame(frame);
  });

  return (nextElement: HTMLElement): void => {
    element = nextElement;
  };
};

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

const selectedOptionValues = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): Set<NaiveSelectValue> =>
  props.multiple ? new Set<NaiveSelectValue>(props.value) : new Set<NaiveSelectValue>();

const selectMenuClass = <TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>,
  presence: ReturnType<typeof usePresenceTransition>
): string =>
  joinClassNames(
    naiveSelectMenuClass(props),
    "is-naive-select-transition",
    presence.visible() && !presence.closing() ? "is-open" : false,
    presence.closing() ? "is-closing" : false
  );

function NaiveSelectOptionItem<TValue extends NaiveSelectValue>(itemProps: {
  item: CollectionNode<NaiveSelectOption<TValue>>;
  selectProps: NaiveSelectProps<TValue>;
}): JSX.Element {
  const option = () => itemProps.item.rawValue;
  const selectedValues = () => selectedOptionValues(itemProps.selectProps);
  const selected = () =>
    itemProps.selectProps.multiple
      ? selectedValues().has(option().value)
      : option().value === itemProps.selectProps.value;

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
  const selected = () =>
    itemProps.selectProps.multiple
      ? selectedOptionValues(itemProps.selectProps).has(option().value)
      : option().value === itemProps.selectProps.value;

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

function NaiveSelectTagsDisplay<TValue extends NaiveSelectValue>(props: {
  selectProps: NaiveSelectProps<TValue>;
  onRemove: (option: NaiveSelectOption<TValue>, event: MouseEvent) => void;
  input?: JSX.Element;
  showPlaceholder?: boolean;
}): JSX.Element {
  const selectedOptions = () => naiveSelectSelectedOptions(props.selectProps);
  const showPlaceholder = () => props.showPlaceholder ?? selectedOptions().length === 0;

  return (
    <span class="n-base-selection-tags">
      <Show when={selectedOptions().length > 0}>
        <For each={selectedOptions()}>
          {(option) => (
            <span class="n-base-selection-tag-wrapper">
              <span
                class={`n-tag n-tag--default n-tag--strong${option.disabled ? " n-tag--disabled" : ""}${!option.disabled && !props.selectProps.disabled && !props.selectProps.readonly ? " n-tag--closable" : ""}`}
              >
                <span class="n-tag__content">
                  {props.selectProps.renderLabel?.(option, true) ?? option.label}
                </span>
                <Show when={!option.disabled && !props.selectProps.disabled && !props.selectProps.readonly}>
                  <button
                    type="button"
                    class="n-base-close n-base-close--absolute n-tag__close"
                    aria-label={`Remove ${option.label}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => props.onRemove(option, event)}
                  >
                    <span class="n-base-icon" aria-hidden="true" />
                  </button>
                </Show>
                <span class="n-tag__border" aria-hidden="true" />
              </span>
            </span>
          )}
        </For>
      </Show>
      {props.input}
      <Show when={showPlaceholder()}>
        <span class="n-base-selection-placeholder n-base-selection-overlay">
          <span class="n-base-selection-placeholder__inner">
            {props.selectProps.placeholder}
          </span>
        </span>
      </Show>
    </span>
  );
}

function NaiveKobalteSelect<TValue extends NaiveSelectValue>(
  props: NaiveSelectProps<TValue>
): JSX.Element {
  const [open, setOpen] = createSignal<boolean>(props.open ?? props.defaultOpen ?? false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const selectedOption = () => naiveSelectSelectedOption(props);
  const selected = () =>
    props.multiple ? naiveSelectSelectedOptions(props).length > 0 : selectedOption() != null;
  const currentOpen = () => props.open ?? open();
  const menuPresence = usePresenceTransition(currentOpen, {
    durationMs: SELECT_MENU_TRANSITION_MS
  });
  const kobalteOpen = currentOpen;
  const menuClass = () => selectMenuClass(props, menuPresence);
  const focusHandoff = useNaiveSelectFocusHandoff();
  const setInitialFocusTarget = useInitialSelectFocus(focusHandoff?.() ?? false);

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };
  const emitSingle = (
    value: TValue | null,
    option: NaiveSelectOption<TValue> | null
  ): void => {
    if (props.multiple) return;
    props.onUpdateValue?.(value, option);
    props.onChange?.(value, option);
  };
  const handleChange = (option: NaiveSelectOption<TValue> | null): void => {
    emitSingle(option?.value ?? null, option);
  };
  const handleClear = (event: MouseEvent): void => {
    event.stopPropagation();
    props.onClear?.();
    if (props.multiple) {
      props.onUpdateValue?.([], []);
      props.onChange?.([], []);
      return;
    }
    emitSingle(null, null);
  };
  const handleMultipleChange = (options: NaiveSelectOption<TValue>[]): void => {
    if (!props.multiple) return;
    const values = options.map((option) => option.value);
    props.onUpdateValue?.(values, options);
    props.onChange?.(values, options);
  };
  const handleTagRemove = (option: NaiveSelectOption<TValue>, event: MouseEvent): void => {
    if (!props.multiple) return;
    event.stopPropagation();
    const nextOptions = naiveSelectSelectedOptions(props).filter(
      (selectedItem) => selectedItem.value !== option.value
    );
    handleMultipleChange(nextOptions);
  };

  return props.multiple ? (
    <Select<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      forceMount
      multiple
      value={naiveSelectSelectedOptions(props)}
      options={[...props.options]}
      optionValue={optionValue}
      optionTextValue={optionTextValue}
      optionDisabled={optionDisabled}
      itemComponent={(itemProps) => (
        <NaiveSelectOptionItem item={itemProps.item} selectProps={props} />
      )}
      placeholder={props.placeholder}
      open={kobalteOpen()}
      onOpenChange={handleOpenChange}
      onChange={handleMultipleChange}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      placement={props.placement ?? "bottom-start"}
      gutter={4}
      sameWidth
      modal={false}
      preventScroll={false}
      closeOnSelection={false}
    >
      <Select.HiddenSelect />
      <NaiveSelectShell selectProps={props} state={{ open: currentOpen(), focused: focused() }}>
        <Select.Trigger
          ref={setInitialFocusTarget}
          class="n-base-selection-label n-base-selection-label--multiple"
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
          <Select.Value<NaiveSelectOption<TValue>> class="n-base-selection-value-slot">
            {() => (
              <NaiveSelectTagsDisplay
                selectProps={props}
                onRemove={handleTagRemove}
              />
            )}
          </Select.Value>
          <NaiveSelectSuffix selectProps={props} selected={selected()} onClear={handleClear} />
        </Select.Trigger>
      </NaiveSelectShell>
      <Show when={menuPresence.rendered() && typeof document !== "undefined"}>
        <Select.Portal mount={document.body}>
          <Select.Content
            class={menuClass()}
            aria-hidden={menuPresence.closing()}
            inert={menuPresence.closing()}
          >
            <Select.Listbox />
          </Select.Content>
        </Select.Portal>
      </Show>
    </Select>
  ) : (
    <Select<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      forceMount
      value={selectedOption()}
      options={[...props.options]}
      optionValue={optionValue}
      optionTextValue={optionTextValue}
      optionDisabled={optionDisabled}
      itemComponent={(itemProps) => (
        <NaiveSelectOptionItem item={itemProps.item} selectProps={props} />
      )}
      placeholder={props.placeholder}
      open={kobalteOpen()}
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
          ref={setInitialFocusTarget}
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
      <Show when={menuPresence.rendered() && typeof document !== "undefined"}>
        <Select.Portal mount={document.body}>
          <Select.Content
            class={menuClass()}
            aria-hidden={menuPresence.closing()}
            inert={menuPresence.closing()}
          >
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
  const [open, setOpen] = createSignal<boolean>(props.open ?? props.defaultOpen ?? false);
  const [focused, setFocused] = createSignal<boolean>(false);
  const [pattern, setPattern] = createSignal<string>("");
  const selectedOption = () => naiveSelectSelectedOption(props);
  const selected = () =>
    props.multiple ? naiveSelectSelectedOptions(props).length > 0 : selectedOption() != null;
  const currentOpen = () => props.open ?? open();
  const menuPresence = usePresenceTransition(currentOpen, {
    durationMs: SELECT_MENU_TRANSITION_MS
  });
  const kobalteOpen = currentOpen;
  const menuClass = () => selectMenuClass(props, menuPresence);
  const focusHandoff = useNaiveSelectFocusHandoff();
  const setInitialFocusTarget = useInitialSelectFocus(focusHandoff?.() ?? false);
  const comboboxOptions = (): NaiveSelectOption<TValue>[] => {
    const options = [...props.options];
    const rawPattern = pattern().trim();
    if (!props.multiple || props.tag !== true || rawPattern.length === 0) return options;
    const alreadyExists = options.some(
      (option) => String(option.value) === rawPattern || option.label === rawPattern
    );
    if (alreadyExists || props.value.some((value) => String(value) === rawPattern)) return options;
    return [...options, { label: rawPattern, value: rawPattern as TValue }];
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    props.onOpenChange?.(nextOpen);
  };
  const emitSingle = (
    value: TValue | null,
    option: NaiveSelectOption<TValue> | null
  ): void => {
    if (props.multiple) return;
    props.onUpdateValue?.(value, option);
    props.onChange?.(value, option);
  };
  const handleChange = (option: NaiveSelectOption<TValue> | null): void => {
    emitSingle(option?.value ?? null, option);
  };
  const handleClear = (event: MouseEvent): void => {
    event.stopPropagation();
    props.onClear?.();
    if (props.multiple) {
      props.onUpdateValue?.([], []);
      props.onChange?.([], []);
      return;
    }
    emitSingle(null, null);
  };
  const handleMultipleChange = (options: NaiveSelectOption<TValue>[]): void => {
    if (!props.multiple) return;
    const values = options.map((option) => option.value);
    props.onUpdateValue?.(values, options);
    props.onChange?.(values, options);
  };
  const handleTagRemove = (option: NaiveSelectOption<TValue>, event: MouseEvent): void => {
    if (!props.multiple) return;
    event.stopPropagation();
    const nextOptions = naiveSelectSelectedOptions(props).filter(
      (selectedItem) => selectedItem.value !== option.value
    );
    handleMultipleChange(nextOptions);
  };

  return props.multiple ? (
    <Combobox<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      forceMount
      multiple
      value={naiveSelectSelectedOptions(props)}
      options={comboboxOptions()}
      optionValue={optionValue}
      optionTextValue={optionTextValue}
      optionLabel={optionTextValue}
      optionDisabled={optionDisabled}
      itemComponent={(itemProps) => (
        <NaiveComboboxOptionItem item={itemProps.item} selectProps={props} />
      )}
      placeholder={props.placeholder}
      open={kobalteOpen()}
      onOpenChange={handleOpenChange}
      onInputChange={(value) => {
        setPattern(value);
        props.onSearch?.(value);
      }}
      onChange={handleMultipleChange}
      disabled={props.disabled}
      readOnly={props.readonly}
      required={props.required}
      placement={props.placement ?? "bottom-start"}
      gutter={4}
      sameWidth
      modal={false}
      preventScroll={false}
      triggerMode="focus"
      selectionBehavior="toggle"
      closeOnSelection={false}
      removeOnBackspace
    >
      <Combobox.HiddenSelect />
      <NaiveSelectShell selectProps={props} state={{ open: currentOpen(), focused: focused() }}>
        <Combobox.Control class="n-base-selection-label n-base-selection-label--multiple">
          <NaiveSelectTagsDisplay
            selectProps={props}
            onRemove={handleTagRemove}
            showPlaceholder={!selected() && pattern().length === 0}
            input={
              <span class="n-base-selection-input-tag">
                <Combobox.Input
                  ref={setInitialFocusTarget}
                  class="n-base-selection-input-tag__input"
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
                <span class="n-base-selection-input-tag__mirror" />
              </span>
            }
          />
          <Combobox.Trigger class="n-base-selection-trigger">
            <NaiveSelectSuffix
              selectProps={props}
              selected={selected()}
              onClear={handleClear}
            />
          </Combobox.Trigger>
        </Combobox.Control>
      </NaiveSelectShell>
      <Show when={menuPresence.rendered() && typeof document !== "undefined"}>
        <Combobox.Portal mount={document.body}>
          <Combobox.Content
            class={menuClass()}
            aria-hidden={menuPresence.closing()}
            inert={menuPresence.closing()}
          >
            <Combobox.Listbox />
          </Combobox.Content>
        </Combobox.Portal>
      </Show>
    </Combobox>
  ) : (
    <Combobox<NaiveSelectOption<TValue>>
      id={props.id}
      name={props.name}
      class={naiveSelectRootClass(props)}
      forceMount
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
      open={kobalteOpen()}
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
              ref={setInitialFocusTarget}
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
      <Show when={menuPresence.rendered() && typeof document !== "undefined"}>
        <Combobox.Portal mount={document.body}>
          <Combobox.Content
            class={menuClass()}
            aria-hidden={menuPresence.closing()}
            inert={menuPresence.closing()}
          >
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
