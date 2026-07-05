import assert from "node:assert/strict";
import test from "node:test";
import { coverSizeUrl } from "./coverSize";

test("coverSizeUrl appends NCM size parameter to HTTP image URLs", () => {
  assert.equal(
    coverSizeUrl("http://p1.music.126.net/cover.jpg", "m"),
    "https://p1.music.126.net/cover.jpg?param=300y300"
  );
});

test("coverSizeUrl preserves existing query parameters while setting size", () => {
  assert.equal(
    coverSizeUrl("https://p1.music.126.net/cover.jpg?foo=bar&param=100y100", "m"),
    "https://p1.music.126.net/cover.jpg?foo=bar&param=300y300"
  );
});

test("coverSizeUrl leaves non-network artwork URLs unchanged", () => {
  const dataUrl = "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E";
  assert.equal(coverSizeUrl(dataUrl, "m"), dataUrl);
  assert.equal(coverSizeUrl("blob:http://localhost/cover", "m"), "blob:http://localhost/cover");
  assert.equal(coverSizeUrl("/covers/local.svg", "m"), "/covers/local.svg");
});
