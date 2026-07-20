import assert from "node:assert/strict";
import test from "node:test";
import { ApiHttpError } from "../../shared/api/transport";
import {
  createLocalPlaylistRequestCoordinator,
  isLocalPlaylistNotFoundError,
  localPlaylistRequestIdForRoute
} from "./localPlaylistRequestState";

test("a newer playlist request invalidates an older response", () => {
  const coordinator = createLocalPlaylistRequestCoordinator();
  const first = coordinator.begin("playlist-a");
  const second = coordinator.begin("playlist-b");

  assert.equal(coordinator.isCurrent(first, "playlist-a"), false);
  assert.equal(coordinator.isCurrent(second, "playlist-b"), true);
});

test("leaving playlist detail invalidates the in-flight response", () => {
  const coordinator = createLocalPlaylistRequestCoordinator();
  const detail = coordinator.begin("playlist-a");
  coordinator.invalidate();

  assert.equal(coordinator.isCurrent(detail, "playlist-a"), false);
});

test("opening the playlist overview starts a current null request identity", () => {
  const coordinator = createLocalPlaylistRequestCoordinator();
  const detail = coordinator.begin("playlist-a");
  const overview = coordinator.begin(null);

  assert.equal(coordinator.isCurrent(detail, "playlist-a"), false);
  assert.equal(coordinator.isCurrent(overview, null), true);
});

test("a response must also match the currently selected playlist", () => {
  const coordinator = createLocalPlaylistRequestCoordinator();
  const request = coordinator.begin("playlist-a");

  assert.equal(coordinator.isCurrent(request, "playlist-b"), false);
  assert.equal(coordinator.isCurrent(request, null), false);
});

test("leaving the library route clears the playlist request identity", () => {
  const destination = { kind: "playlist", playlistId: "playlist-a" } as const;

  assert.equal(localPlaylistRequestIdForRoute(true, destination), "playlist-a");
  assert.equal(localPlaylistRequestIdForRoute(false, destination), null);
  assert.equal(
    localPlaylistRequestIdForRoute(true, { kind: "tab", tab: "playlists" }),
    null
  );
});

test("only an HTTP 404 is classified as a missing local playlist", () => {
  assert.equal(isLocalPlaylistNotFoundError(new ApiHttpError(404, "missing", null)), true);
  assert.equal(isLocalPlaylistNotFoundError(new ApiHttpError(500, "failed", null)), false);
  assert.equal(isLocalPlaylistNotFoundError(new Error("network failed")), false);
});
