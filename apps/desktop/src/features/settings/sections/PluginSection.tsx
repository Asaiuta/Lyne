import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import {
  BooleanSettingItem,
  TextSettingItem
} from "../components/SettingControls";
import { settingsSectionClass } from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import { useTranslation } from "../../../shared/i18n";

interface PluginSettingSnapshot {
  id: string;
  label: string;
  kind: string;
  secret: boolean;
  value: unknown;
}

interface PluginSnapshot {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  status: string;
  lastError: string | null;
  settings: PluginSettingSnapshot[];
  outboundOrigins: string[];
}

interface PluginSectionProps {
  highlightId: string | null;
}

const readPlugins = () => invoke<PluginSnapshot[]>("plugin_host_list");

const valueAsString = (value: unknown) =>
  value === null || value === undefined ? "" : String(value);

export function PluginSection(props: PluginSectionProps) {
  const { t } = useTranslation();
  const [plugins, setPlugins] = createSignal<PluginSnapshot[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pending, setPending] = createSignal<string | null>(null);
  let refreshTimer: number | undefined;
  const isHi = (id: string) => props.highlightId === id;
  const pluginItemIndex = (pluginIndex: number) =>
    plugins()
      .slice(0, pluginIndex)
      .reduce((total, plugin) => total + plugin.settings.length + 1, 0);

  const refresh = async () => {
    try {
      setPlugins(await readPlugins());
    } catch (error) {
      console.warn("[settings] failed to read integration plugins", error);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void refresh();
    refreshTimer = window.setInterval(() => {
      if (pending() === null) void refresh();
    }, 2000);
  });
  onCleanup(() => {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
  });

  const applySnapshots = (next: PluginSnapshot[]) => {
    setPlugins(next);
    setPending(null);
  };

  const setEnabled = async (plugin: PluginSnapshot, enabled: boolean) => {
    setPending(plugin.id);
    try {
      applySnapshots(
        await invoke<PluginSnapshot[]>("plugin_host_set_enabled", {
          id: plugin.id,
          enabled
        })
      );
    } catch (error) {
      console.warn("[settings] failed to change plugin state", error);
      setPending(null);
    }
  };

  const updateValue = async (
    plugin: PluginSnapshot,
    setting: PluginSettingSnapshot,
    rawValue: unknown
  ) => {
    const value = setting.kind === "number"
      ? Number(rawValue)
      : setting.kind === "boolean"
        ? rawValue === true || rawValue === "true"
        : rawValue;
    if (setting.kind === "number" && !Number.isFinite(value)) return;
    setPending(plugin.id + ":" + setting.id);
    try {
      applySnapshots(
        await invoke<PluginSnapshot[]>("plugin_host_update_settings", {
          id: plugin.id,
          values: { [setting.id]: value }
        })
      );
    } catch (error) {
      console.warn("[settings] failed to save plugin setting", error);
      setPending(null);
    }
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.plugins.title")}>
        <Show
          when={!loading() && plugins().length > 0}
          fallback={
            <p class="settings-hint">
              {loading() ? t("settings.plugins.loading") : t("settings.plugins.empty")}
            </p>
          }
        >
          <For each={plugins()}>
            {(plugin, pluginIndex) => (
              <>
                <BooleanSettingItem
                  id={"plugin-" + plugin.id}
                  label={plugin.name}
                  description={plugin.id + " v" + plugin.version + " - " + plugin.status}
                  highlighted={isHi("plugin-" + plugin.id)}
                  index={pluginItemIndex(pluginIndex())}
                  checked={plugin.enabled}
                  disabled={pending() === plugin.id}
                  onChange={(enabled) => void setEnabled(plugin, enabled)}
                />
                <Show when={plugin.lastError}>
                  <p class="settings-hint">{plugin.lastError}</p>
                </Show>
                <For each={plugin.settings}>
                  {(setting, settingIndex) => (
                    <Show
                      when={setting.kind === "boolean"}
                      fallback={
                        <TextSettingItem
                          id={"plugin-" + plugin.id + "-" + setting.id}
                          label={setting.label || setting.id}
                          description={
                            setting.secret
                              ? t("settings.plugins.secretDescription")
                              : undefined
                          }
                          highlighted={isHi("plugin-" + plugin.id + "-" + setting.id)}
                          index={pluginItemIndex(pluginIndex()) + settingIndex() + 1}
                          value={setting.secret ? "" : valueAsString(setting.value)}
                          secret={setting.secret}
                          placeholder={
                            setting.secret
                              ? t("settings.plugins.secretPlaceholder")
                              : undefined
                          }
                          inputMode={setting.kind === "number" ? "decimal" : "text"}
                          disabled={pending() === plugin.id + ":" + setting.id}
                          onCommit={(value) => {
                            if (setting.secret && value.length === 0) return;
                            void updateValue(plugin, setting, value);
                          }}
                        />
                      }
                    >
                      <BooleanSettingItem
                        id={"plugin-" + plugin.id + "-" + setting.id}
                        label={setting.label || setting.id}
                        highlighted={isHi("plugin-" + plugin.id + "-" + setting.id)}
                        index={pluginItemIndex(pluginIndex()) + settingIndex() + 1}
                        checked={setting.value === true}
                        disabled={pending() === plugin.id + ":" + setting.id}
                        onChange={(value) =>
                          void updateValue(plugin, setting, value)
                        }
                      />
                    </Show>
                  )}
                </For>
              </>
            )}
          </For>
        </Show>
      </SettingGroup>
    </section>
  );
}
