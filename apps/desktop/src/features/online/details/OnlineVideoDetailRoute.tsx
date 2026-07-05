import type { FeedCardItem } from "../shared/types";
import { VideoDetail } from "./VideoDetail";

export interface OnlineVideoDetailRouteProps {
  request?: { video: FeedCardItem | null; version: number };
  onNavigateToArtistDetail?: (artist: FeedCardItem) => void;
}

export function OnlineVideoDetailRoute(props: OnlineVideoDetailRouteProps) {
  return (
    <VideoDetail
      video={props.request?.video ?? null}
      showInlineBack={false}
      onSelectArtist={props.onNavigateToArtistDetail}
    />
  );
}
