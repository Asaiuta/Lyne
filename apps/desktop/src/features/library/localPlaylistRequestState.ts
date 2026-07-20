import { ApiHttpError } from "../../shared/api/transport";
import type { LibraryDestination } from "../../shared/ui/navigation";

export type LocalPlaylistRequestState =
  | { readonly status: "idle"; readonly playlistId: null }
  | { readonly status: "loading"; readonly playlistId: string }
  | { readonly status: "success"; readonly playlistId: string }
  | { readonly status: "not-found"; readonly playlistId: string }
  | { readonly status: "error"; readonly playlistId: string; readonly message: string };

export interface LocalPlaylistRequestToken {
  readonly generation: number;
  readonly playlistId: string | null;
}

export interface LocalPlaylistRequestCoordinator {
  begin: (playlistId: string | null) => LocalPlaylistRequestToken;
  invalidate: () => void;
  isCurrent: (
    token: LocalPlaylistRequestToken,
    selectedPlaylistId: string | null
  ) => boolean;
}

export const createLocalPlaylistRequestCoordinator = (): LocalPlaylistRequestCoordinator => {
  let latestGeneration = 0;

  return {
    begin: (playlistId) => ({
      generation: ++latestGeneration,
      playlistId
    }),
    invalidate: () => {
      latestGeneration += 1;
    },
    isCurrent: (token, selectedPlaylistId) =>
      token.generation === latestGeneration && token.playlistId === selectedPlaylistId
  };
};

export const localPlaylistRequestIdForRoute = (
  routeActive: boolean,
  destination: LibraryDestination
): string | null =>
  routeActive && destination.kind === "playlist" ? destination.playlistId : null;

export const isLocalPlaylistNotFoundError = (error: unknown): boolean =>
  error instanceof ApiHttpError && error.status === 404;
