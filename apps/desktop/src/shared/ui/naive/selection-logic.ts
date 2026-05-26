export type NaiveSelectionValue = string | number;

export interface NaiveCheckboxToggleOptions {
  readonly min?: number;
  readonly max?: number;
}

export interface NaiveCheckboxToggleResult {
  readonly values: readonly NaiveSelectionValue[];
  readonly changed: boolean;
  readonly blocked: boolean;
  readonly actionType: "check" | "uncheck";
}

export interface NaiveSelectableState {
  readonly checked: boolean;
  readonly disabled: boolean;
}

export const naiveSelectionValueKey = (value: NaiveSelectionValue): string => String(value);

export const naiveSelectionValueSet = (
  values: readonly NaiveSelectionValue[]
): ReadonlySet<string> => new Set(values.map(naiveSelectionValueKey));

export const isNaiveCheckboxDisabledByQuota = (
  values: readonly NaiveSelectionValue[],
  _item: NaiveSelectionValue,
  checked: boolean,
  ownDisabled: boolean | undefined,
  groupDisabled: boolean | undefined,
  options: NaiveCheckboxToggleOptions
): boolean => {
  const disabled = ownDisabled ?? groupDisabled ?? false;
  if (disabled) return true;
  if (options.max != null && values.length >= options.max && !checked) return true;
  return options.min != null && values.length <= options.min && checked;
};

export const toggleNaiveCheckboxValues = (
  values: readonly NaiveSelectionValue[],
  item: NaiveSelectionValue,
  checked: boolean,
  options: NaiveCheckboxToggleOptions = {}
): NaiveCheckboxToggleResult => {
  const itemKey = naiveSelectionValueKey(item);
  const currentKeys = naiveSelectionValueSet(values);
  const isChecked = currentKeys.has(itemKey);
  const actionType = checked ? "check" : "uncheck";

  if (checked === isChecked) {
    return { values, changed: false, blocked: false, actionType };
  }
  if (checked && options.max != null && values.length >= options.max) {
    return { values, changed: false, blocked: true, actionType };
  }
  if (!checked && options.min != null && values.length <= options.min) {
    return { values, changed: false, blocked: true, actionType };
  }

  return {
    values: checked
      ? [...values, item]
      : values.filter((value) => naiveSelectionValueKey(value) !== itemKey),
    changed: true,
    blocked: false,
    actionType
  };
};

export const resolveNaiveSelectionOriginalValue = (
  key: string,
  values: ReadonlyMap<string, NaiveSelectionValue>
): NaiveSelectionValue => values.get(key) ?? key;

export const naiveRadioSplitorPriority = (state: NaiveSelectableState): number =>
  (state.checked ? 2 : 0) + (!state.disabled ? 1 : 0);

export const resolveNaiveRadioSplitorState = (
  previous: NaiveSelectableState,
  next: NaiveSelectableState
): NaiveSelectableState =>
  naiveRadioSplitorPriority(previous) > naiveRadioSplitorPriority(next) ? previous : next;
