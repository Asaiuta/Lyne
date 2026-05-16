import assert from "node:assert/strict";
import test from "node:test";
import { readNcmHttpErrorMessage } from "./base";
import { QR_CHECK_ALLOWED_CODES } from "./login";

test("readNcmHttpErrorMessage surfaces raw NCM msg bodies", async () => {
  const response = new Response(JSON.stringify({ code: 406, msg: "request risk blocked" }), {
    status: 406,
    headers: { "Content-Type": "application/json" }
  });

  assert.equal(await readNcmHttpErrorMessage(response), "request risk blocked");
});

test("readNcmHttpErrorMessage falls back to HTTP status for empty bodies", async () => {
  const response = new Response("", { status: 406 });

  assert.equal(await readNcmHttpErrorMessage(response), "NCM request failed: 406");
});

test("QR polling allows all expected waiting and completion states", () => {
  assert.deepEqual(QR_CHECK_ALLOWED_CODES, [800, 801, 802, 803]);
});
