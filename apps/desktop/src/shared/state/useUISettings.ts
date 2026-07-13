import { onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { UISettings, UISettingsFieldName } from "./uiSettingsModel";
import {
  browserUISettingsRuntime,
  readUISettingsPreviewEvent,
  readUISettingsSnapshot,
  shouldSyncUISettingsFromEvent,
  UI_SETTINGS_CHANGED_EVENT,
  UI_SETTINGS_PREVIEW_EVENT,
  type UISettingsRuntime
} from "./uiSettingsStorage";

export interface UISettingsStore {
  settings: UISettings;
  preview: <K extends UISettingsFieldName>(field: K, value: UISettings[K]) => void;
  sync: () => void;
}

interface SharedUISettingsStore {
  store: UISettingsStore;
  dispose: () => void;
}

let browserSharedUISettingsStore: SharedUISettingsStore | null = null;

export function createUISettingsStore(runtime: UISettingsRuntime): UISettingsStore {
  const [settings, setSettings] = createStore<UISettings>(readUISettingsSnapshot(runtime));

  return {
    settings,
    preview: (field, value) => {
      setSettings(reconcile({ ...settings, [field]: value } as UISettings));
    },
    sync: () => {
      setSettings(reconcile(readUISettingsSnapshot(runtime)));
    }
  };
}

function listenToUISettingsRuntime(runtime: UISettingsRuntime, store: UISettingsStore): () => void {
  const handleChange: EventListener = (event) => {
    if (shouldSyncUISettingsFromEvent(event)) {
      store.sync();
    }
  };
  const handlePreview: EventListener = (event) => {
    const preview = readUISettingsPreviewEvent(event);
    if (preview) {
      store.preview(preview.field, preview.value);
    }
  };

  runtime.events.addEventListener(UI_SETTINGS_CHANGED_EVENT, handleChange);
  runtime.events.addEventListener(UI_SETTINGS_PREVIEW_EVENT, handlePreview);
  runtime.events.addEventListener("storage", handleChange);

  return () => {
    runtime.events.removeEventListener(UI_SETTINGS_CHANGED_EVENT, handleChange);
    runtime.events.removeEventListener(UI_SETTINGS_PREVIEW_EVENT, handlePreview);
    runtime.events.removeEventListener("storage", handleChange);
  };
}

function getBrowserSharedUISettingsStore(): SharedUISettingsStore {
  if (!browserSharedUISettingsStore) {
    const runtime = browserUISettingsRuntime();
    const store = createUISettingsStore(runtime);
    browserSharedUISettingsStore = {
      store,
      dispose: listenToUISettingsRuntime(runtime, store)
    };
  }
  return browserSharedUISettingsStore;
}

export function disposeBrowserSharedUISettingsStore(): void {
  browserSharedUISettingsStore?.dispose();
  browserSharedUISettingsStore = null;
}

/**
 * Reads UI settings from the supplied runtime and listens for changes
 * dispatched by the settings sections.
 */
export function useUISettings(runtime?: UISettingsRuntime): UISettings {
  if (!runtime) {
    return getBrowserSharedUISettingsStore().store.settings;
  }

  const store = createUISettingsStore(runtime);
  let dispose: (() => void) | undefined;

  onMount(() => {
    dispose = listenToUISettingsRuntime(runtime, store);
  });

  onCleanup(() => {
    dispose?.();
  });

  return store.settings;
}
