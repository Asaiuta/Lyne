import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNeteaseQrLoginUrl,
  resolveLoginQrImageUrl,
  shouldAutoStartQrSession,
  type QrLoginSession
} from "./useQrLoginSession";

const session = (overrides: Partial<QrLoginSession> = {}): QrLoginSession => ({
  key: "qr-key",
  imageUrl: "https://example.com/qr.png",
  phase: "waiting",
  ...overrides
});

test("shouldAutoStartQrSession only starts when the session is pristine", () => {
  assert.equal(
    shouldAutoStartQrSession({
      enabled: true,
      session: null,
      isCreating: false,
      hasAttemptedStart: false
    }),
    true
  );

  assert.equal(
    shouldAutoStartQrSession({
      enabled: true,
      session: null,
      isCreating: false,
      hasAttemptedStart: true
    }),
    false
  );

  assert.equal(
    shouldAutoStartQrSession({
      enabled: true,
      session: session(),
      isCreating: false,
      hasAttemptedStart: false
    }),
    false
  );

  assert.equal(
    shouldAutoStartQrSession({
      enabled: false,
      session: null,
      isCreating: false,
      hasAttemptedStart: false
    }),
    false
  );
});

test("buildNeteaseQrLoginUrl encodes the code key for the NCM login URL", () => {
  assert.equal(
    buildNeteaseQrLoginUrl("key with spaces"),
    "https://music.163.com/login?codekey=key%20with%20spaces"
  );
});

test("resolveLoginQrImageUrl keeps upstream qrimg when present", async () => {
  const imageUrl = await resolveLoginQrImageUrl("qr-key", {
    qrimg: " data:image/png;base64,abc "
  });

  assert.equal(imageUrl, "data:image/png;base64,abc");
});

test("resolveLoginQrImageUrl generates an image from qrurl when qrimg is empty", async () => {
  const imageUrl = await resolveLoginQrImageUrl("qr-key", {
    qrurl: "https://music.163.com/login?codekey=qr-key",
    qrimg: ""
  });

  assert.equal(/^data:image\/svg\+xml/.test(imageUrl), true);
});

test("resolveLoginQrImageUrl falls back to the SPlayer-style login URL", async () => {
  const imageUrl = await resolveLoginQrImageUrl("qr-key", {
    qrimg: ""
  });

  assert.equal(/^data:image\/svg\+xml/.test(imageUrl), true);
});
