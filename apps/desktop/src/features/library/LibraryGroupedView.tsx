import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import {
  IconAlbum,
  IconArtist,
  IconFolder,
  IconMusic
} from "../../components/icons";
import { MediaList } from "../../components/media/MediaList";
import type { MediaContextAction, MediaSortField, MediaSortOrder, MediaSortState } from "../../components/media/MediaList";
import { useTranslation } from "../../shared/i18n";
import { useUISettings } from "../../shared/state/useUISettings";
import type { LibraryListItem } from "./libraryDataTypes";

export interface LibraryGroup {
  key: string;
  label: string;
  songs: LibraryListItem[];
  artworkUrl?: string | null;
  detail?: string;
}

type LibraryGroupedKind = "artists" | "albums" | "folders";

interface LibraryGroupedViewProps {
  kind: LibraryGroupedKind;
  groups: LibraryGroup[];
  currentTrackPath: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  sort?: MediaSortState;
  contextActions?: readonly MediaContextAction[];
  deleteActionLabel?: string;
  onSortChange?: (field: MediaSortField) => void;
  onSortOrderChange?: (order: MediaSortOrder) => void;
  onActiveItemsChange?: (items: LibraryListItem[]) => void;
  onPlay: (item: LibraryListItem, contextItems: readonly LibraryListItem[]) => void;
  onEnqueue: (item: LibraryListItem) => void;
  onContextAction: (action: MediaContextAction, item: LibraryListItem) => void;
}

const iconForKind = (kind: LibraryGroupedKind) => {
  switch (kind) {
    case "artists":
      return <IconArtist />;
    case "albums":
      return <IconAlbum />;
    case "folders":
      return <IconFolder />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
};

export function LibraryGroupedView(props: LibraryGroupedViewProps) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const [selectedKey, setSelectedKey] = createSignal<string | null>(props.groups[0]?.key ?? null);

  const selectedGroup = createMemo<LibraryGroup | null>(() => {
    const selected = selectedKey();
    const first = props.groups[0] ?? null;
    if (!selected) return first;
    return props.groups.find((group) => group.key === selected) ?? first;
  });

  createEffect(() => {
    props.onActiveItemsChange?.(selectedGroup()?.songs ?? []);
  });

  const emptyLabel = createMemo(() => {
    if (props.kind === "artists") return t("library.tabs.empty.artists");
    if (props.kind === "albums") return t("library.tabs.empty.albums");
    return t("library.tabs.empty.folders");
  });

  return (
    <Show
      when={props.groups.length > 0}
      fallback={
        <div class="empty-tab" role="status">
          <span class="empty-tab-icon" aria-hidden="true">
            {iconForKind(props.kind)}
          </span>
          <span>{emptyLabel()}</span>
        </div>
      }
    >
      <div class={`local-browser local-browser-${props.kind}`}>
        <aside class="local-browser-list" aria-label={emptyLabel()}>
          <For each={props.groups}>
            {(group) => {
              const active = () => selectedGroup()?.key === group.key;
              const coverVisible = () => props.kind !== "albums" || !uiSettings.hiddenCovers.album;
              const artworkInitial = () => (group.label.trim().slice(0, 1) || "#").toUpperCase();
              return (
                <button
                  type="button"
                  class="local-browser-card"
                  classList={{ "is-active": active(), "is-cover-hidden": !coverVisible() }}
                  onClick={() => setSelectedKey(group.key)}
                >
                  <Show when={coverVisible()}>
                    <span class="local-browser-cover" aria-hidden="true">
                      <Show when={group.artworkUrl} fallback={<span>{artworkInitial()}</span>}>
                        <img src={group.artworkUrl ?? ""} alt="" />
                      </Show>
                    </span>
                  </Show>
                  <span class="local-browser-copy">
                    <span class="local-browser-name" title={group.label}>{group.label}</span>
                    <span class="local-browser-count">
                      <IconMusic />
                      {t("library.group.songCount", { count: group.songs.length })}
                    </span>
                    <Show when={group.detail}>
                      {(detail) => <span class="local-browser-detail" title={detail()}>{detail()}</span>}
                    </Show>
                  </span>
                </button>
              );
            }}
          </For>
        </aside>

        <div class="local-browser-songs">
          <Show when={selectedGroup()}>
            {(group) => (
              <MediaList
                items={group().songs}
                currentSourcePath={props.currentTrackPath}
                isPlayingNow={props.isPlaying}
                onPlay={(item) => props.onPlay(item, group().songs)}
                onEnqueue={props.onEnqueue}
                onContextAction={props.onContextAction}
                isLoading={props.isLoading}
                emptyState={emptyLabel()}
                hideSize={props.kind !== "folders"}
                hideArtwork={props.kind === "albums"}
                contextActions={props.contextActions}
                deleteActionLabel={props.deleteActionLabel}
                sort={props.sort}
                onSortChange={props.onSortChange}
                onSortOrderChange={props.onSortOrderChange}
              />
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
}
