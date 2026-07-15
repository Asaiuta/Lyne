import assert from "node:assert/strict";
import test from "node:test";
import { parseApiRuntimeConfig } from "./env";

const TOKEN = "a".repeat(64);

const readThrownMessage = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected function to throw");
};

test("parseApiRuntimeConfig accepts one loopback endpoint and token contract", () => {
  assert.deepEqual(
    parseApiRuntimeConfig({
      baseUrl: "http://127.0.0.1:18083",
      port: 18083,
      token: TOKEN
    }),
    {
      baseUrl: "http://127.0.0.1:18083",
      port: 18083,
      token: TOKEN
    }
  );
});

test("parseApiRuntimeConfig rejects mismatched and non-loopback endpoints", () => {
  assert.equal(
    readThrownMessage(() =>
      parseApiRuntimeConfig({
        baseUrl: "http://127.0.0.1:18084",
        port: 18083,
        token: TOKEN
      })
    ),
    "Invalid API runtime baseUrl 'http://127.0.0.1:18084': expected a loopback HTTP origin using port 18083."
  );
  assert.equal(
    readThrownMessage(() =>
      parseApiRuntimeConfig({
        baseUrl: "https://example.com:18083",
        port: 18083,
        token: TOKEN
      })
    ),
    "Invalid API runtime baseUrl 'https://example.com:18083': expected a loopback HTTP origin using port 18083."
  );
});

test("parseApiRuntimeConfig rejects invalid ports and tokens", () => {
  assert.equal(
    readThrownMessage(() =>
      parseApiRuntimeConfig({
        baseUrl: "http://127.0.0.1:18083",
        port: 0,
        token: TOKEN
      })
    ),
    "Invalid API runtime config: port must be an integer between 1 and 65535."
  );
  assert.equal(
    readThrownMessage(() =>
      parseApiRuntimeConfig({
        baseUrl: "http://127.0.0.1:18083",
        port: 18083,
        token: "not-a-token"
      })
    ),
    "Invalid API runtime config: token must be a 64-character hexadecimal string."
  );
});
