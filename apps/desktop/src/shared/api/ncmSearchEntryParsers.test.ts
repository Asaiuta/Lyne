import assert from "node:assert/strict";
import test from "node:test";
import {
  parseNcmSearchDefaultKeyword,
  parseNcmSearchHotDetail,
  parseNcmSearchSuggestions
} from "./ncmSearchEntryParsers";

test("parses default NetEase search keyword payloads", () => {
  assert.deepEqual(
    parseNcmSearchDefaultKeyword({
      data: {
        showKeyword: "今日推荐",
        realkeyword: "city pop"
      }
    }),
    {
      showKeyword: "今日推荐",
      realKeyword: "city pop"
    }
  );

  assert.deepEqual(
    parseNcmSearchDefaultKeyword({
      data: {
        searchWord: "fallback"
      }
    }),
    {
      showKeyword: "fallback",
      realKeyword: "fallback"
    }
  );
});

test("parses hot search detail items", () => {
  assert.deepEqual(
    parseNcmSearchHotDetail({
      data: [
        {
          searchWord: "Lamp",
          content: "new album",
          score: "12000",
          iconUrl: "https://img/hot.png"
        },
        {
          first: "fallback keyword",
          second: "legacy text"
        },
        {
          searchWord: ""
        }
      ]
    }),
    [
      {
        keyword: "Lamp",
        content: "new album",
        score: 12000,
        iconUrl: "https://img/hot.png"
      },
      {
        keyword: "fallback keyword",
        content: "legacy text",
        score: null,
        iconUrl: null
      }
    ]
  );
});

test("parses ordered search suggestions across NetEase result buckets", () => {
  assert.deepEqual(
    parseNcmSearchSuggestions({
      result: {
        order: ["songs", "artists", "albums", "playlists", "mvs", "djRadios"],
        songs: [
          {
            name: "今夜",
            artists: [{ name: "Lamp" }],
            album: { name: "For Lovers" }
          }
        ],
        artists: [{ name: "Lamp", alias: ["city pop"] }],
        albums: [{ name: "For Lovers", artists: [{ name: "Lamp" }] }],
        playlists: [{ name: "Night Drive", creator: { nickname: "DJ" } }],
        mvs: [{ name: "Live Session", artistName: "Lamp" }],
        djRadios: [{ name: "Night Talk", dj: { nickname: "Host" } }]
      }
    }),
    [
      { keyword: "今夜", type: "song", subtitle: "Lamp" },
      { keyword: "Lamp", type: "artist", subtitle: null },
      { keyword: "For Lovers", type: "album", subtitle: "Lamp" },
      { keyword: "Night Drive", type: "playlist", subtitle: "DJ" },
      { keyword: "Live Session", type: "video", subtitle: "Lamp" },
      { keyword: "Night Talk", type: "radio", subtitle: "Host" }
    ]
  );
});

test("deduplicates suggestions by type and keyword while preserving first occurrence", () => {
  assert.deepEqual(
    parseNcmSearchSuggestions(
      {
        result: {
          songs: [
            { name: "Loop", artists: [{ name: "A" }] },
            { name: "Loop", artists: [{ name: "B" }] }
          ],
          artists: [{ name: "Loop" }]
        }
      },
      2
    ),
    [
      { keyword: "Loop", type: "song", subtitle: "A" },
      { keyword: "Loop", type: "artist", subtitle: null }
    ]
  );
});
