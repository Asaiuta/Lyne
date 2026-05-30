import { For, Show, createMemo } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import {
  BooleanSettingItem,
  ButtonSettingItem,
  SelectSettingItem,
  type SelectOption
} from "../components/SettingControls";
import {
  SettingItem,
  settingsSectionClass
} from "../components/SettingItem";
import { SettingGroup } from "../components/SettingGroup";
import {
  persistUISettingField,
  useUISettings
} from "../../../shared/state/useUISettings";
import { IconDelete, IconFolder, IconFolderPlus } from "../../../components/icons";

interface LocalSectionProps {
  highlightId: string | null;
}

export function LocalSection(props: LocalSectionProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();

  const folderDisplayOptions = createMemo<SelectOption[]>(() => [
    { value: "flat", label: t("settings.local.folderDisplayMode.flat") },
    { value: "tree", label: t("settings.local.folderDisplayMode.tree") }
  ]);
  const downloadThreadOptions = createMemo<SelectOption[]>(() => [
    { value: "1", label: "1" },
    { value: "3", label: "3" },
    { value: "5", label: "5" },
    { value: "8", label: "8" }
  ]);
  const downloadLevelOptions = createMemo<SelectOption[]>(() => [
    { value: "standard", label: t("settings.local.downloadSongLevel.standard") },
    { value: "higher", label: t("settings.local.downloadSongLevel.higher") },
    { value: "exhigh", label: t("settings.local.downloadSongLevel.exhigh") },
    { value: "lossless", label: t("settings.local.downloadSongLevel.lossless") },
    { value: "hires", label: t("settings.local.downloadSongLevel.hires") }
  ]);

  const isHi = (id: string) => props.highlightId === id;
  let itemIndex = 0;
  const nextIndex = () => itemIndex++;
  const localLyricDirectories = () => uiSettings.localLyricDirectories;
  const commitLocalLyricDirectories = (directories: string[]) => {
    persistUISettingField("localLyricDirectories", directories);
  };
  const normalizeDirectory = (value: string) => value.trim();
  const addLocalLyricDirectory = () => {
    if (typeof window === "undefined") return;
    const value = window.prompt(t("settings.local.localLyricDirectories.prompt"));
    if (value === null) return;
    const directory = normalizeDirectory(value);
    if (!directory) return;
    const next = Array.from(new Set([...localLyricDirectories(), directory]));
    commitLocalLyricDirectories(next);
  };
  const removeLocalLyricDirectory = (directory: string) => {
    commitLocalLyricDirectories(
      localLyricDirectories().filter((candidate) => candidate !== directory)
    );
  };

  return (
    <section class={settingsSectionClass}>
      <SettingGroup title={t("settings.local.music.title")}>
        <ButtonSettingItem
          id="localMusicDirectory"
          label={t("settings.local.localMusicDirectory")}
          description={t("settings.local.localMusicDirectory.desc")}
          highlighted={isHi("localMusicDirectory")}
          index={nextIndex()}
          buttonLabel={t("settings.local.localMusicDirectory.action")}
          wip
        />
        <SelectSettingItem
          id="localFolderDisplayMode"
          label={t("settings.local.localFolderDisplayMode")}
          highlighted={isHi("localFolderDisplayMode")}
          index={nextIndex()}
          value="flat"
          options={folderDisplayOptions()}
          wip
        />
        <BooleanSettingItem
          id="showLocalCover"
          label={t("settings.local.showLocalCover")}
          highlighted={isHi("showLocalCover")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="showDefaultLocalPath"
          label={t("settings.local.showDefaultLocalPath")}
          highlighted={isHi("showDefaultLocalPath")}
          index={nextIndex()}
          checked={false}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.local.lyric.title")}>
        <SettingItem
          id="localLyricDirectories"
          label={t("settings.local.localLyricDirectories")}
          description={t("settings.local.localLyricDirectories.desc")}
          highlighted={isHi("localLyricDirectories")}
          index={nextIndex()}
        >
          <div class="local-lyric-directory-control">
            <button
              type="button"
              class="ghost-button local-lyric-directory-add"
              onClick={addLocalLyricDirectory}
              title={t("settings.local.localLyricDirectories.action")}
            >
              <IconFolderPlus />
              <span>{t("settings.local.localLyricDirectories.action")}</span>
            </button>
            <Show when={localLyricDirectories().length > 0}>
              <div class="local-lyric-directory-list">
                <For each={localLyricDirectories()}>
                  {(directory) => (
                    <div class="local-lyric-directory-item">
                      <IconFolder />
                      <span class="local-lyric-directory-path" title={directory}>{directory}</span>
                      <button
                        type="button"
                        class="local-lyric-directory-remove"
                        onClick={() => removeLocalLyricDirectory(directory)}
                        title={t("settings.local.localLyricDirectories.remove")}
                        aria-label={t("settings.local.localLyricDirectories.remove")}
                      >
                        <IconDelete />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </SettingItem>
      </SettingGroup>

      <SettingGroup title={t("settings.local.download.title")}>
        <ButtonSettingItem
          id="downloadPath"
          label={t("settings.local.downloadPath")}
          description={t("settings.local.downloadPath.desc")}
          highlighted={isHi("downloadPath")}
          index={nextIndex()}
          buttonLabel={t("settings.local.downloadPath.action")}
          wip
        />
        <BooleanSettingItem
          id="downloadMeta"
          label={t("settings.local.downloadMeta")}
          highlighted={isHi("downloadMeta")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="downloadCover"
          label={t("settings.local.downloadCover")}
          highlighted={isHi("downloadCover")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="downloadLyric"
          label={t("settings.local.downloadLyric")}
          highlighted={isHi("downloadLyric")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="downloadLyricTranslation"
          label={t("settings.local.downloadLyricTranslation")}
          highlighted={isHi("downloadLyricTranslation")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <SelectSettingItem
          id="downloadThreadCount"
          label={t("settings.local.downloadThreadCount")}
          highlighted={isHi("downloadThreadCount")}
          index={nextIndex()}
          value="3"
          options={downloadThreadOptions()}
          wip
        />
        <SelectSettingItem
          id="downloadSongLevel"
          label={t("settings.local.downloadSongLevel")}
          highlighted={isHi("downloadSongLevel")}
          index={nextIndex()}
          value="exhigh"
          options={downloadLevelOptions()}
          wip
        />
      </SettingGroup>

      <SettingGroup title={t("settings.local.cache.title")}>
        <BooleanSettingItem
          id="cacheEnabled"
          label={t("settings.local.cacheEnabled")}
          description={t("settings.local.cacheEnabled.desc")}
          highlighted={isHi("cacheEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <BooleanSettingItem
          id="songCacheEnabled"
          label={t("settings.local.songCacheEnabled")}
          highlighted={isHi("songCacheEnabled")}
          index={nextIndex()}
          checked={false}
          wip
        />
        <ButtonSettingItem
          id="cacheLimit"
          label={t("settings.local.cacheLimit")}
          highlighted={isHi("cacheLimit")}
          index={nextIndex()}
          buttonLabel={t("settings.local.cacheLimit.action")}
          wip
        />
        <ButtonSettingItem
          id="clearCache"
          label={t("settings.local.clearCache")}
          description={t("settings.local.clearCache.desc")}
          highlighted={isHi("clearCache")}
          index={nextIndex()}
          buttonLabel={t("settings.local.clearCache.action")}
          wip
        />
      </SettingGroup>
    </section>
  );
}
