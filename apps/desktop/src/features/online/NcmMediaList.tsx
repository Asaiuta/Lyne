import { createSignal } from "solid-js";
import { MediaList } from "../../components/media/MediaList";
import type { MediaContextAction } from "../../components/media/mediaContextActions";
import type { MediaListProps } from "../../components/media/mediaListTypes";
import type { MediaListItem } from "../../shared/media/mediaListItem";
import { copyToClipboard } from "../../shared/utils/clipboard";
import { ncmSongShareUrl } from "../../shared/api/ncm/urls";
import { readSongCommentsPayload, songComments } from "../../shared/api/ncm/comment";
import { useTranslation } from "../../shared/i18n";
import { useUISearch } from "../../shared/state/UISearchContext";
import { useUISettings } from "../../shared/state/useUISettings";
import { createNcmFavoriteRowAction } from "./ncmFavoriteRowAction";
import {
  NcmCommentsModal,
  closedNcmCommentsModal,
  type NcmCommentsModalState
} from "./NcmCommentsModal";

type NcmMediaListProps<T extends MediaListItem> = MediaListProps<T>;

const displayTitle = (item: MediaListItem): string =>
  item.title?.trim() || item.fileName?.trim() || (typeof item.songId === "number" ? String(item.songId) : item.id);

export function NcmMediaList<T extends MediaListItem>(props: NcmMediaListProps<T>) {
  const { t } = useTranslation();
  const uiSettings = useUISettings();
  const search = useUISearch();
  const defaultFavoriteAction = createNcmFavoriteRowAction<T>();
  const [commentsModal, setCommentsModal] =
    createSignal<NcmCommentsModalState>(closedNcmCommentsModal);

  const submitSearch = (item: T) => {
    const keyword = displayTitle(item).trim();
    if (!keyword) return;
    search.setQuery(keyword);
    search.submitSearch();
  };

  const copyShareLink = async (item: T) => {
    if (typeof item.songId !== "number") return;
    await copyToClipboard(ncmSongShareUrl(item.songId, uiSettings.shareUrlFormat));
  };

  const copySongInfo = async (item: T) => {
    const parts = [
      displayTitle(item).trim(),
      item.artist?.trim() || "",
      item.album?.trim() || ""
    ].filter((part) => part.length > 0);
    if (parts.length === 0) return;
    await copyToClipboard(parts.join(" - "));
  };

  const loadComments = async (item: T) => {
    if (typeof item.songId !== "number") return;
    const title = displayTitle(item);
    setCommentsModal({
      ...closedNcmCommentsModal,
      open: true,
      title,
      status: "loading"
    });
    try {
      const payload = readSongCommentsPayload(await songComments(item.songId, 30, 0));
      setCommentsModal({
        open: true,
        title,
        status: "success",
        total: payload.total,
        hotComments: payload.hotComments,
        comments: payload.comments,
        error: null
      });
    } catch (error) {
      console.warn("[NcmMediaList] load song comments failed", error);
      setCommentsModal({
        ...closedNcmCommentsModal,
        open: true,
        title,
        status: "error",
        error: error instanceof Error ? error.message : t("common.error.requestFailed")
      });
    }
  };

  const handleContextAction = (action: MediaContextAction, item: T) => {
    switch (action) {
      case "search":
        submitSearch(item);
        break;
      case "share-link":
        void copyShareLink(item);
        break;
      case "copy-song-info":
        void copySongInfo(item);
        break;
      case "view-comments":
        void loadComments(item);
        break;
      default:
        break;
    }
    props.onContextAction?.(action, item);
  };

  return (
    <>
      <MediaList
        items={props.items}
        totalCount={props.totalCount}
        virtualStart={props.virtualStart}
        rowHeight={props.rowHeight}
        currentSourcePath={props.currentSourcePath}
        currentMediaId={props.currentMediaId}
        currentSongId={props.currentSongId}
        isPlayingNow={props.isPlayingNow}
        onPlay={props.onPlay}
        onEnqueue={props.onEnqueue}
        rowAction={props.rowAction ?? defaultFavoriteAction()}
        onDoubleClick={props.onDoubleClick}
        onCopyPath={props.onCopyPath}
        onVisibleRangeChange={props.onVisibleRangeChange}
        onScroll={props.onScroll}
        onContextAction={handleContextAction}
        isLoading={props.isLoading}
        emptyState={props.emptyState}
        hideSize={props.hideSize}
        hideArtwork={props.hideArtwork}
        contextActions={props.contextActions}
        deleteActionLabel={props.deleteActionLabel}
        sort={props.sort}
        onSortChange={props.onSortChange}
        onSortOrderChange={props.onSortOrderChange}
        sortDisabled={props.sortDisabled}
        hideTopScrollTool={props.hideTopScrollTool}
        draggable={props.draggable}
        onReorder={props.onReorder}
      />
      <NcmCommentsModal
        state={commentsModal()}
        onClose={() => setCommentsModal(closedNcmCommentsModal)}
      />
    </>
  );
}
