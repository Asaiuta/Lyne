import assert from "node:assert/strict";
import test from "node:test";
import {
  createMediaIdentityIndex,
  findMediaIdentityIndex,
  isMediaListItemCurrent,
  mediaKeyForPath
} from "./mediaIdentity";

test("mediaKeyForPath mirrors backend canonical media ids", () => {
  assert.equal(
    mediaKeyForPath(String.raw`\\?\D:\Music\Artist\Track.FLAC`),
    "d:/music/artist/track.flac"
  );
  assert.equal(
    mediaKeyForPath("//?/D:/Music/Artist/Track.FLAC"),
    "d:/music/artist/track.flac"
  );
  assert.equal(
    mediaKeyForPath("//?/UNC/Server/Share/Artist/Track.FLAC"),
    "server/share/artist/track.flac"
  );
});

test("isMediaListItemCurrent derives media identity from current source path first", () => {
  const staleMediaId = "d:/music/first.flac";
  const currentPath = "D:/Music/Later.flac";

  assert.equal(
    isMediaListItemCurrent(
      {
        media_id: staleMediaId,
        source_path: "D:/Music/First.flac"
      },
      {
        mediaId: staleMediaId,
        sourcePath: currentPath
      }
    ),
    false
  );

  assert.equal(
    isMediaListItemCurrent(
      {
        media_id: "d:/music/later.flac",
        source_path: "D:/Music/Later.flac"
      },
      {
        mediaId: staleMediaId,
        sourcePath: currentPath
      }
    ),
    true
  );
});

test("isMediaListItemCurrent matches summary rows by source-path-derived media id", () => {
  assert.equal(
    isMediaListItemCurrent(
      {
        media_id: "d:/music/later.flac",
        source_path: null
      },
      {
        mediaId: "d:/music/first.flac",
        sourcePath: "D:/Music/Later.flac"
      }
    ),
    true
  );
});

test("findMediaIdentityIndex locates current media without scanning rows", () => {
  const index = createMediaIdentityIndex([
    {
      songId: 1,
      media_id: "d:/music/first.flac",
      source_path: "D:/Music/First.flac"
    },
    {
      songId: 2,
      media_id: "d:/music/later.flac",
      source_path: "D:/Music/Later.flac"
    }
  ]);

  assert.equal(findMediaIdentityIndex(index, { songId: 2 }), 1);
  assert.equal(findMediaIdentityIndex(index, { sourcePath: "D:/Music/Later.flac" }), 1);
  assert.equal(
    findMediaIdentityIndex(index, {
      mediaId: "d:/music/first.flac",
      sourcePath: "D:/Music/Later.flac"
    }),
    1
  );
  assert.equal(findMediaIdentityIndex(index, { mediaId: "d:/music/missing.flac" }), -1);
});
