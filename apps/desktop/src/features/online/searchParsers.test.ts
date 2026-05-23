import assert from "node:assert/strict";
import test from "node:test";
import {
  NCM_SEARCH_TYPES,
  parseNcmArtistAlbums,
  parseNcmArtistVideos,
  parseNcmSearchAlbums,
  parseNcmSearchArtists,
  parseNcmSearchRadios,
  parseNcmSearchVideos
} from "./searchParsers";
import { parseArtistDetailInfo } from "./artistParsers";
import { parseAlbumDynamicInfo } from "./albumParsers";
import { parsePlaylistDynamicInfo } from "./playlistParsers";
import { parseRadioDetailInfo } from "./radioParsers";

test("uses the same NetEase search type ids as the SPlayer search tabs", () => {
  assert.equal(NCM_SEARCH_TYPES.songs, 1);
  assert.equal(NCM_SEARCH_TYPES.albums, 10);
  assert.equal(NCM_SEARCH_TYPES.artists, 100);
  assert.equal(NCM_SEARCH_TYPES.playlists, 1000);
  assert.equal(NCM_SEARCH_TYPES.videos, 1004);
  assert.equal(NCM_SEARCH_TYPES.radios, 1009);
});

test("parses raw cloudsearch card categories into feed cards", () => {
  assert.deepEqual(
    parseNcmSearchArtists({
      result: {
        artists: [{ id: 7, name: "Lamp", alias: ["city pop"], img1v1Url: "https://img/artist.jpg" }]
      }
    }),
    [{
      id: 7,
      title: "Lamp",
      subtitle: "city pop",
      coverUrl: "https://img/artist.jpg",
      playCount: null,
      description: null
    }]
  );

  assert.deepEqual(
    parseNcmSearchAlbums({
      result: {
        albums: [{ id: 8, name: "For Lovers", artists: [{ name: "Lamp" }], picUrl: "https://img/album.jpg" }]
      }
    }),
    [{
      id: 8,
      title: "For Lovers",
      subtitle: "Lamp",
      coverUrl: "https://img/album.jpg",
      playCount: null,
      description: null
    }]
  );

  assert.deepEqual(
    parseNcmSearchVideos({
      result: {
        mvs: [{ id: 9, name: "Live Session", artistName: "Lamp", cover: "https://img/mv.jpg", playCount: 1200 }]
      }
    }),
    [{
      id: 9,
      videoId: "9",
      videoKind: "mv",
      title: "Live Session",
      subtitle: "Lamp",
      coverUrl: "https://img/mv.jpg",
      playCount: 1200,
      description: null
    }]
  );

  const videoResult = parseNcmSearchVideos({
    result: {
      videos: [{ vid: "89ADDEADBEEF", title: "Behind the Scenes", creator: [{ nickname: "Director" }], coverUrl: "https://img/video.jpg" }]
    }
  });
  assert.equal(videoResult.length, 1);
  assert.equal(videoResult[0]?.videoId, "89ADDEADBEEF");
  assert.equal(videoResult[0]?.videoKind, "video");

  assert.deepEqual(
    parseNcmSearchRadios({
      result: {
        djRadios: [{ id: 10, name: "Night Talk", dj: { nickname: "DJ" }, picUrl: "https://img/radio.jpg" }]
      }
    }),
    [{
      id: 10,
      title: "Night Talk",
      subtitle: "DJ",
      coverUrl: "https://img/radio.jpg",
      playCount: null,
      description: null
    }]
  );
});

test("parses artist album and video pages into feed cards", () => {
  assert.deepEqual(
    parseNcmArtistAlbums({
      hotAlbums: [
        { id: 11, name: "Komorebi", artist: { name: "Lamp" }, picUrl: "https://img/artist-album.jpg" }
      ],
      more: true
    }),
    {
      items: [{
        id: 11,
        title: "Komorebi",
        subtitle: "Lamp",
        coverUrl: "https://img/artist-album.jpg",
        playCount: null,
        description: null
      }],
      hasMore: true
    }
  );

  assert.deepEqual(
    parseNcmArtistVideos({
      mvs: [
        { id: 12, name: "Studio Live", artistName: "Lamp", imgurl: "https://img/artist-mv.jpg", playCount: 4500 }
      ],
      hasMore: false
    }),
    {
      items: [{
        id: 12,
        videoId: "12",
        videoKind: "mv",
        title: "Studio Live",
        subtitle: "Lamp",
        coverUrl: "https://img/artist-mv.jpg",
        playCount: 4500,
        description: null
      }],
      hasMore: false
    }
  );
});

test("parses artist detail metadata used by the SPlayer-style artist page", () => {
  assert.deepEqual(
    parseArtistDetailInfo(
      {
        data: {
          artist: {
            id: 7,
            name: "Lamp",
            alias: ["ランプ"],
            img1v1Url: "https://img/artist.jpg",
            briefDesc: "Japanese band",
            musicSize: 140,
            albumSize: 20,
            mvSize: 6,
            followed: true
          },
          identify: { imageDesc: "乐队" }
        }
      },
      {
        id: 7,
        title: "Fallback",
        subtitle: null,
        coverUrl: null,
        playCount: null,
        description: null
      }
    ),
    {
      id: 7,
      title: "Lamp",
      subtitle: "ランプ",
      coverUrl: "https://img/artist.jpg",
      playCount: null,
      description: "Japanese band",
      alias: "ランプ",
      identify: "乐队",
      musicSize: 140,
      albumSize: 20,
      mvSize: 6,
      followed: true
    }
  );
});

test("parses album dynamic metadata used by the SPlayer-style album page", () => {
  assert.deepEqual(
    parseAlbumDynamicInfo({
      subed: true,
      commentCount: 42,
      shareCount: "7"
    }),
    {
      subscribed: true,
      commentCount: 42,
      shareCount: 7
    }
  );

  assert.deepEqual(
    parseAlbumDynamicInfo({
      data: {
        subscribed: false,
        commentCount: "12"
      }
    }),
    {
      subscribed: false,
      commentCount: 12,
      shareCount: null
    }
  );
});

test("parses playlist dynamic metadata used by the SPlayer-style playlist page", () => {
  assert.deepEqual(
    parsePlaylistDynamicInfo({
      subscribed: true,
      commentCount: 23,
      shareCount: "5",
      bookedCount: 99
    }),
    {
      subscribed: true,
      commentCount: 23,
      shareCount: 5,
      bookedCount: 99
    }
  );

  assert.deepEqual(
    parsePlaylistDynamicInfo({
      data: {
        subed: false,
        commentCount: "7"
      }
    }),
    {
      subscribed: false,
      commentCount: 7,
      shareCount: null,
      bookedCount: null
    }
  );
});

test("parses radio detail subscription metadata used by the SPlayer-style radio page", () => {
  assert.deepEqual(
    parseRadioDetailInfo(
      {
        data: {
          id: 88,
          name: "Night Talk",
          dj: { nickname: "DJ" },
          picUrl: "https://img/radio.jpg",
          desc: "Late night programs",
          programCount: "12",
          subCount: 345,
          subed: true
        }
      },
      {
        id: 88,
        title: "Fallback",
        subtitle: null,
        coverUrl: null,
        playCount: null,
        description: null
      }
    ),
    {
      id: 88,
      title: "Night Talk",
      subtitle: "Late night programs",
      coverUrl: "https://img/radio.jpg",
      playCount: 345,
      description: "Late night programs",
      programCount: 12,
      subscriberCount: 345,
      subscribed: true
    }
  );
});
