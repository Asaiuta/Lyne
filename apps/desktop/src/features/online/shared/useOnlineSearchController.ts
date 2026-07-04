import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import type { ApiClient } from "../../../shared/api/client";
import { cloudsearch } from "../../../shared/api/ncm/search";
import type { OnlinePlaylistSummary } from "../ncmPlaylistSummary";
import {
  NCM_SEARCH_TYPES,
  parseNcmSearchAlbums,
  parseNcmSearchArtists,
  parseNcmSearchRadios,
  parseNcmSearchVideos
} from "../searchParsers";
import { DISCOVER_SEARCH_LIMIT } from "./parsers";
import type { FeedbackSetter, Translator } from "./feedback";
import type { FeedCardItem, OnlineTrackItem, SearchTab } from "./types";

export interface OnlineSearchController {
  readonly searchTab: Accessor<SearchTab>;
  readonly setSearchTab: (tab: SearchTab) => void;
  readonly isSearching: Accessor<boolean>;
  readonly submittedQuery: Accessor<string>;
  readonly songResults: Accessor<OnlineTrackItem[]>;
  readonly playlistResults: Accessor<OnlinePlaylistSummary[]>;
  readonly artistResults: Accessor<FeedCardItem[]>;
  readonly albumResults: Accessor<FeedCardItem[]>;
  readonly videoResults: Accessor<FeedCardItem[]>;
  readonly radioResults: Accessor<FeedCardItem[]>;
  readonly hasResults: Accessor<boolean>;
  readonly runVersion: Accessor<number>;
  readonly runSearch: (rawQuery: string) => Promise<void>;
}

interface OnlineSearchControllerOptions {
  readonly api: ApiClient;
  readonly t: Translator;
  readonly setFeedback: FeedbackSetter;
  readonly readErrorMessage: (error: unknown) => string;
}

export function createOnlineSearchController(
  options: OnlineSearchControllerOptions
): OnlineSearchController {
  const [searchTab, setSearchTab] = createSignal<SearchTab>("songs");
  const [isSearching, setIsSearching] = createSignal<boolean>(false);
  const [submittedQuery, setSubmittedQuery] = createSignal<string>("");
  const [songResults, setSongResults] = createSignal<OnlineTrackItem[]>([]);
  const [playlistResults, setPlaylistResults] = createSignal<OnlinePlaylistSummary[]>([]);
  const [artistResults, setArtistResults] = createSignal<FeedCardItem[]>([]);
  const [albumResults, setAlbumResults] = createSignal<FeedCardItem[]>([]);
  const [videoResults, setVideoResults] = createSignal<FeedCardItem[]>([]);
  const [radioResults, setRadioResults] = createSignal<FeedCardItem[]>([]);
  const [runVersion, setRunVersion] = createSignal<number>(0);
  let activeRunId = 0;

  const clearResults = () => {
    setSongResults([]);
    setPlaylistResults([]);
    setArtistResults([]);
    setAlbumResults([]);
    setVideoResults([]);
    setRadioResults([]);
  };

  const hasResults = createMemo<boolean>(() =>
    songResults().length > 0 ||
    playlistResults().length > 0 ||
    artistResults().length > 0 ||
    albumResults().length > 0 ||
    videoResults().length > 0 ||
    radioResults().length > 0
  );

  const runSearch = async (rawQuery: string): Promise<void> => {
    const query = rawQuery.trim();
    const runId = activeRunId + 1;
    activeRunId = runId;
    setSubmittedQuery(query);
    setRunVersion((current) => current + 1);
    clearResults();

    if (!query) {
      setIsSearching(false);
      options.setFeedback("error", options.t("ncm.error.emptySearch"));
      return;
    }

    setIsSearching(true);
    try {
      const [songs, playlists, artists, albums, videos, radios] = await Promise.all([
        options.api.searchNcmTracks({ keywords: query, limit: DISCOVER_SEARCH_LIMIT }),
        options.api.searchNcmPlaylists({ keywords: query, limit: DISCOVER_SEARCH_LIMIT }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.artists }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.albums }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.videos }),
        cloudsearch({ keywords: query, limit: DISCOVER_SEARCH_LIMIT, type: NCM_SEARCH_TYPES.radios })
      ]);

      if (runId !== activeRunId) return;
      setSongResults(songs);
      setPlaylistResults(playlists);
      setArtistResults(parseNcmSearchArtists(artists));
      setAlbumResults(parseNcmSearchAlbums(albums));
      setVideoResults(parseNcmSearchVideos(videos));
      setRadioResults(parseNcmSearchRadios(radios));
    } catch (error) {
      if (runId !== activeRunId) return;
      options.setFeedback("error", options.readErrorMessage(error));
    } finally {
      if (runId === activeRunId) {
        setIsSearching(false);
      }
    }
  };

  return {
    searchTab,
    setSearchTab,
    isSearching,
    submittedQuery,
    songResults,
    playlistResults,
    artistResults,
    albumResults,
    videoResults,
    radioResults,
    hasResults,
    runVersion,
    runSearch
  };
}