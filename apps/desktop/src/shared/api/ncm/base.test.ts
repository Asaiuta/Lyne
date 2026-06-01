import assert from "node:assert/strict";
import test from "node:test";
import { assertNcmOk, NCM_OK_CODE, readNcmHttpErrorMessage } from "./base";
import { QR_CHECK_ALLOWED_CODES, QR_STATUS } from "./login";

const readThrownMessage = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected function to throw");
};

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
  assert.deepEqual(QR_CHECK_ALLOWED_CODES, [
    QR_STATUS.EXPIRED,
    QR_STATUS.WAITING,
    QR_STATUS.SCANNED,
    QR_STATUS.CONFIRMED
  ]);
});

test("assertNcmOk accepts missing and successful numeric codes", () => {
  assertNcmOk({}, "fallback");
  assertNcmOk({ code: NCM_OK_CODE }, "fallback");
});

test("assertNcmOk surfaces upstream message fields before fallback", () => {
  assert.equal(
    readThrownMessage(() =>
      assertNcmOk({ code: 501, message: "upstream message", msg: "upstream msg" }, "fallback")
    ),
    "upstream message"
  );
  assert.equal(
    readThrownMessage(() => assertNcmOk({ code: 501, msg: "upstream msg" }, "fallback")),
    "upstream msg"
  );
  assert.equal(readThrownMessage(() => assertNcmOk({ code: 501 }, "fallback")), "fallback");
});
