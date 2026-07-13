import { For, Show } from "solid-js";
import { CoverArt } from "../CoverArt";
import { MarqueeText } from "../MarqueeText";
import {
  IconExpand,
  IconFavoriteFilled,
  IconFavoriteBorderFilled,
  IconFormatListFilled
} from "../icons";
import { NaiveDropdown, type NaiveDropdownOption } from "../../shared/ui/naive";

interface PlayerBarInfoCoverProps {
  coverHidden: boolean;
  coverTransitioning: boolean;
  coverUrl: string | null;
  coverAlt: string;
  coverExpandLabel: string;
  onClick: () => void;
}

interface PlayerBarInfoMenuProps {
  label: string;
  open: boolean;
  copyTitleLabel: string;
  copyArtistLabel: string;
  searchLabel: string;
  shareLabel: string;
  onOpenChange: (open: boolean) => void;
  onCopyTitle: () => void;
  onCopyArtist: () => void;
  onSearch: () => void;
  onShare: () => void;
}

interface PlayerBarInfoMetaProps {
  title: string;
  playbackRateLabel: string | null;
  isLiked: boolean;
  favoriteLabel: string;
  showSecondaryMeta: boolean;
  showLyric: boolean;
  currentLyric: string | null;
  lyricLiveLabel: string;
  artistList: readonly string[];
  artistLinks?: readonly { id: number; name: string }[];
  artistFallback: string;
  onToggleLike?: () => void;
  onSelectArtist?: (artistId: number) => void;
}

interface PlayerBarInfoPanelProps {
  cover: PlayerBarInfoCoverProps;
  meta: PlayerBarInfoMetaProps;
  menu: PlayerBarInfoMenuProps;
}

export function PlayerBarInfoPanel(props: PlayerBarInfoPanelProps) {
  const menuOptions = (): readonly NaiveDropdownOption[] => [
    {
      key: "copy-title",
      label: props.menu.copyTitleLabel,
      onSelect: props.menu.onCopyTitle
    },
    {
      key: "copy-artist",
      label: props.menu.copyArtistLabel,
      onSelect: props.menu.onCopyArtist
    },
    {
      key: "search",
      label: props.menu.searchLabel,
      onSelect: props.menu.onSearch
    },
    {
      key: "share",
      label: props.menu.shareLabel,
      onSelect: props.menu.onShare
    }
  ];

  return (
    <div
      class={`player-bar-left${props.cover.coverHidden ? " is-cover-hidden" : ""}`}
    >
      <Show when={!props.cover.coverHidden}>
        <button
          type="button"
          class={`player-bar-cover${props.cover.coverTransitioning ? " is-leaving" : ""}`}
          onClick={props.cover.onClick}
          aria-label={props.cover.coverExpandLabel}
          title={props.cover.coverExpandLabel}
        >
          <CoverArt coverUrl={props.cover.coverUrl} alt={props.cover.coverAlt} />
          <span
            class="player-bar-cover-expand"
            aria-hidden="true"
          >
            <IconExpand />
          </span>
        </button>
      </Show>

      <div class="player-bar-info player-bar-info-enter">
        <div class="player-bar-title-row">
          <MarqueeText
            text={props.meta.title}
            class="player-bar-title"
            sizing="content"
          />
          <Show when={props.meta.playbackRateLabel}>
            {(label) => (
              <span class="player-inline-tag player-inline-tag-accent">
                {label()}
              </span>
            )}
          </Show>
          <button
            type="button"
            class={`player-inline-icon player-like-icon${props.meta.isLiked ? " is-liked" : ""}`}
            aria-label={props.meta.favoriteLabel}
            title={props.meta.favoriteLabel}
            onClick={() => props.meta.onToggleLike?.()}
          >
            <Show when={props.meta.isLiked} fallback={<IconFavoriteBorderFilled />}>
              <IconFavoriteFilled />
            </Show>
          </button>
          <NaiveDropdown
            options={menuOptions()}
            triggerMode="click"
            placement="top-start"
            gutter={10}
            open={props.menu.open}
            onOpenChange={props.menu.onOpenChange}
            class="player-inline-menu-popover"
            triggerClass="player-inline-menu"
            triggerStyle={{ width: "20px", height: "20px" }}
            ariaLabel={props.menu.label}
          >
            <button
              type="button"
              class="player-inline-icon player-more-icon"
              aria-label={props.menu.label}
              title={props.menu.label}
            >
              <IconFormatListFilled />
            </button>
          </NaiveDropdown>
        </div>

        <Show when={props.meta.showSecondaryMeta}>
          <div class="player-info-secondary">
            <Show
              when={props.meta.showLyric}
              fallback={
                <ArtistList
                  artistList={props.meta.artistList}
                  artistLinks={props.meta.artistLinks}
                  fallbackText={props.meta.artistFallback}
                  onSelectArtist={props.meta.onSelectArtist}
                />
              }
            >
              <MarqueeText
                text={props.meta.currentLyric ?? ""}
                title={props.meta.lyricLiveLabel}
                speed={30}
                class="player-info-secondary-item player-lyric-line"
              />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

interface ArtistListProps {
  artistList: readonly string[];
  artistLinks?: readonly { id: number; name: string }[];
  fallbackText: string;
  onSelectArtist?: (artistId: number) => void;
}

function ArtistList(props: ArtistListProps) {
  return (
    <Show
      when={props.artistList.length > 0}
      fallback={
        <MarqueeText
          text={props.fallbackText}
          class="player-info-secondary-item player-artists"
          speed={24}
        />
      }
    >
      <MarqueeText
        title={props.artistList.join(" / ")}
        measureKey={props.artistList.join("|")}
        class="player-info-secondary-item player-artists"
        speed={24}
      >
        <For each={props.artistList}>
          {(name) => {
            const linkedArtist = () =>
              props.artistLinks?.find(
                (artist) => artist.name.trim().toLowerCase() === name.trim().toLowerCase()
              );
            return (
              <button
                type="button"
                class={`player-artist-item${
                  linkedArtist() ? "" : " is-static"
                }`}
                disabled={!linkedArtist()}
                onClick={() => {
                  const artist = linkedArtist();
                  if (artist) {
                    props.onSelectArtist?.(artist.id);
                  }
                }}
              >
                {name}
              </button>
            );
          }}
        </For>
      </MarqueeText>
    </Show>
  );
}
