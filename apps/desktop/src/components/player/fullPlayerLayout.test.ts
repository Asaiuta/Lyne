import assert from "node:assert/strict";
import test from "node:test";
import { getRootStyle, type FullPlayerLayoutSettings } from "./fullPlayerLayout";

const baseSettings = (overrides: Partial<FullPlayerLayoutSettings> = {}): FullPlayerLayoutSettings => ({
  lyricAlignRight: false,
  lyricsPosition: "flex-start",
  playerStyleRatio: 50,
  playerBackgroundFps: 30,
  playerBackgroundFlowSpeed: 4,
  playerBackgroundRenderScale: 0.5,
  playerFullscreenGradient: 15,
  playerType: "cover",
  fullPlayerLayout: "balanced",
  hiddenCoverPlayer: false,
  fullPlayerCommentMode: "fullscreen",
  playerBackgroundType: "blur",
  playerBackgroundPause: false,
  playerBackgroundLowFreqVolume: false,
  playerExpandAnimation: "up",
  ...overrides
});

test("full player root style maps background blur slider values directly", () => {
  assert.equal(getRootStyle(baseSettings(), 0)["--full-player-background-blur"], "0px");
  assert.equal(getRootStyle(baseSettings(), 32)["--full-player-background-blur"], "32px");
  assert.equal(getRootStyle(baseSettings(), 80)["--full-player-background-blur"], "80px");
});

test("full player root style clamps out-of-range visual settings", () => {
  const lowStyle = getRootStyle(baseSettings({ playerFullscreenGradient: -20 }), -8);
  const highStyle = getRootStyle(baseSettings({ playerFullscreenGradient: 140 }), 120);

  assert.equal(lowStyle["--full-player-fullscreen-gradient"], "0%");
  assert.equal(lowStyle["--full-player-background-blur"], "0px");
  assert.equal(highStyle["--full-player-fullscreen-gradient"], "100%");
  assert.equal(highStyle["--full-player-background-blur"], "80px");
});
