import { createEffect } from "solid-js";
import type { Accessor } from "solid-js";
import { useTranslation } from "../../../shared/i18n";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import type { FeedbackSetter } from "../shared/feedback";
import type { OnlineDetailViewReporterProps } from "../shared/detailViewReporter";
import type { PlaybackController } from "../shared/playback";
import type { OnlineSearchController } from "../shared/useOnlineSearchController";
import type { FeedCardItem, NcmProfile, OnlineTrackItem } from "../shared/types";
import { SearchMode } from "./SearchMode";

export interface OnlineSearchModeProps extends OnlineDetailViewReporterProps {
  loginProfile: Accessor<NcmProfile | null>;
  search: OnlineSearchController;
  onNavigateToArtistDetail?: (artist: FeedCardItem) => void;
  onNavigateToRadioDetail?: (radio: FeedCardItem) => void;
  onNavigateToSongWiki?: (track: OnlineTrackItem) => void;
  onNavigateToMv?: (track: OnlineTrackItem) => void;
  onNavigateToAlbumDetail?: (album: FeedCardItem) => void;
  onNavigateToPlaylistDetail?: (playlist: OnlinePlaylistSummary) => void;
  onNavigateToVideoDetail?: (video: FeedCardItem) => void;
  onSelectedPlaylistChange?: (playlistId: number | null) => void;
  setFeedback: FeedbackSetter;
  playback: PlaybackController;
}

export function OnlineSearchMode(props: OnlineSearchModeProps) {
  const { t } = useTranslation();

  createEffect(
    () => {
      props.search.runVersion();
      props.onDetailViewChange?.(false);
    }
  );

  return (
    <SearchMode
      searchTab={props.search.searchTab()}
      onSearchTabChange={props.search.setSearchTab}
      isSearching={props.search.isSearching()}
      songResults={props.search.songResults()}
      playlistResults={props.search.playlistResults()}
      artistResults={props.search.artistResults()}
      albumResults={props.search.albumResults()}
      videoResults={props.search.videoResults()}
      radioResults={props.search.radioResults()}
      searchQuery={props.search.submittedQuery}
      onSelectPlaylist={(playlist) => props.onNavigateToPlaylistDetail?.(playlist)}
      onSelectArtist={(artist) => props.onNavigateToArtistDetail?.(artist)}
      onSelectAlbum={(album) => props.onNavigateToAlbumDetail?.(album)}
      onSelectVideo={(video) => props.onNavigateToVideoDetail?.(video)}
      onSelectRadio={(radio) => props.onNavigateToRadioDetail?.(radio)}
      onNavigateToSongWiki={props.onNavigateToSongWiki}
      playlistEmptyHint={t("ncm.empty.noPlaylistsHint")}
      playback={props.playback}
    />
  );
}
