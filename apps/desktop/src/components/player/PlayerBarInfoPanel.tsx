import { For, Show } from "solid-js";
import { CoverArt } from "../CoverArt";
import { MarqueeText } from "../MarqueeText";
import { IconExpand, IconHeart, IconHeartFilled, IconList } from "../icons";

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
  onToggle: () => void;
  onCopyTitle: () => void;
  onCopyArtist: () => void;
  onSearch: () => void;
  onShare: () => void;
  ref?: (element: HTMLDivElement) => void;
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

      <div class="player-bar-info player-bar-info-enter flex flex-col min-w-0">
        <div class="player-bar-title-row flex items-center gap-2 min-w-0">
          <MarqueeText
            text={props.meta.title}
            class="player-bar-title"
          />
          <Show when={props.meta.playbackRateLabel}>
            {(label) => (
              <span class="player-inline-tag player-inline-tag-accent inline-flex items-center min-h-22px text-11px font-semibold whitespace-nowrap">
                {label()}
              </span>
            )}
          </Show>
          <button
            type="button"
            class={`player-inline-icon player-like-icon grid place-items-center w-28px h-28px flex-none${props.meta.isLiked ? " is-liked" : ""}`}
            aria-label={props.meta.favoriteLabel}
            title={props.meta.favoriteLabel}
            onClick={() => props.meta.onToggleLike?.()}
          >
            <Show when={props.meta.isLiked} fallback={<IconHeart />}>
              <IconHeartFilled />
            </Show>
          </button>
          <div class="player-inline-menu relative inline-flex items-center" ref={props.menu.ref}>
            <button
              type="button"
              class="player-inline-icon grid place-items-center w-28px h-28px flex-none"
              aria-label={props.menu.label}
              title={props.menu.label}
              aria-expanded={props.menu.open}
              aria-haspopup="menu"
              onClick={props.menu.onToggle}
            >
              <IconList />
            </button>
            <Show when={props.menu.open}>
              <div
                class="player-inline-menu-popover absolute flex min-w-168px flex-col gap-1"
                role="menu"
                aria-label={props.menu.label}
              >
                <button
                  type="button"
                  class="player-menu-item flex items-center min-h-34px text-left"
                  role="menuitem"
                  onClick={props.menu.onCopyTitle}
                >
                  {props.menu.copyTitleLabel}
                </button>
                <button
                  type="button"
                  class="player-menu-item flex items-center min-h-34px text-left"
                  role="menuitem"
                  onClick={props.menu.onCopyArtist}
                >
                  {props.menu.copyArtistLabel}
                </button>
                <button
                  type="button"
                  class="player-menu-item flex items-center min-h-34px text-left"
                  role="menuitem"
                  onClick={props.menu.onSearch}
                >
                  {props.menu.searchLabel}
                </button>
                <button
                  type="button"
                  class="player-menu-item flex items-center min-h-34px text-left"
                  role="menuitem"
                  onClick={props.menu.onShare}
                >
                  {props.menu.shareLabel}
                </button>
              </div>
            </Show>
          </div>
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
                class={`player-artist-item inline-flex items-center whitespace-nowrap border-0 bg-transparent p-0${
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
