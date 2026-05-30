// Compatibility wrappers for settings code that still speaks in storage keys.
// New settings flows should prefer field-driven helpers from useUISettings.ts directly.
// Backend-bound audio engine settings persist via the API and live in AudioEngineSection directly.
import type { Accessor, Setter } from "solid-js";
import {
  type UISettings,
  type UISettingsBooleanFieldName,
  type UISettingsBooleanRecordFieldName,
  type UISettingsScalarFieldName,
  UI_SETTINGS_CHANGED_EVENT,
  commitUISettingField,
  persistUISettingField,
  storageKeyToUISettingField
} from "../../shared/state/useUISettings";

export function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function persist(key: string, value: boolean | number | string): boolean {
  const field = storageKeyToUISettingField(key);
  if (!field) {
    try {
      localStorage.setItem(key, String(value));
      window.dispatchEvent(new Event(UI_SETTINGS_CHANGED_EVENT));
      return true;
    } catch {
      return false;
    }
  }
  return persistUISettingField(
    field as UISettingsScalarFieldName,
    value as UISettings[UISettingsScalarFieldName]
  );
}

export function commitPersistedSetting<T extends boolean | number | string>(
  key: string,
  value: T,
  currentValue: Accessor<T>,
  setValue: Setter<T>
): boolean {
  const field = storageKeyToUISettingField(key);
  if (!field) {
    const previous = currentValue();
    setValue(() => value);
    if (persist(key, value)) {
      return true;
    }
    setValue(() => previous);
    console.warn("[settings] failed to persist setting", { key });
    return false;
  }
  return commitUISettingField(
    field as UISettingsScalarFieldName,
    value as UISettings[UISettingsScalarFieldName],
    currentValue as unknown as Accessor<UISettings[UISettingsScalarFieldName]>,
    setValue as unknown as Setter<UISettings[UISettingsScalarFieldName]>
  );
}

export function commitPersistedRecordSetting<T extends Record<string, boolean>>(
  key: string,
  value: T,
  currentValue: Accessor<T>,
  setValue: Setter<T>
): boolean {
  const field = storageKeyToUISettingField(key);
  if (!field) {
    const previous = currentValue();
    setValue(() => value);
    if (persist(key, JSON.stringify(value))) {
      return true;
    }
    setValue(() => previous);
    console.warn("[settings] failed to persist setting", { key });
    return false;
  }
  return commitUISettingField(
    field as UISettingsBooleanRecordFieldName,
    value as unknown as UISettings[UISettingsBooleanRecordFieldName],
    currentValue as unknown as Accessor<UISettings[UISettingsBooleanRecordFieldName]>,
    setValue as unknown as Setter<UISettings[UISettingsBooleanRecordFieldName]>
  );
}

export function togglePersistedField<K extends UISettingsBooleanFieldName>(
  field: K,
  currentValue: Accessor<UISettings[K]>,
  setValue: Setter<UISettings[K]>
): boolean {
  return setPersistedBooleanField(field, (!currentValue()) as UISettings[K], currentValue, setValue);
}

export function setPersistedBooleanField<K extends UISettingsBooleanFieldName>(
  field: K,
  value: UISettings[K],
  currentValue: Accessor<UISettings[K]>,
  setValue: Setter<UISettings[K]>
): boolean {
  return commitUISettingField(field, value, currentValue, setValue);
}
