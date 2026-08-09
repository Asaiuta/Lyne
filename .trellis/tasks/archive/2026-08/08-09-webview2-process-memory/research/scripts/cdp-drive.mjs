// cdp-drive.mjs — zero-dependency CDP driver for WebView2 (Node >= 21)
// Usage: node cdp-drive.mjs <script.mjs> [args...]
// A scenario script exports async function run(ctx) where ctx = { evalJs, wait, cdp, log, argv }
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const PORT = process.env.CDP_PORT || "9222";

async function getPageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await res.json();
  const page = targets.find((t) => t.type === "page" && (t.url.includes("tauri.localhost") || t.url.includes("localhost") || t.url.startsWith("http")));
  if (!page) throw new Error("no app page target: " + JSON.stringify(targets.map((t) => t.url)));
  return page;
}

export async function connect() {
  const page = await getPageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error("ws error: " + (e?.message || "")));
  });
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    async evalJs(expression) {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) {
        throw new Error("eval exception: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
      }
      return r.result ? r.result.value : undefined;
    },
    async wait(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },
    async sleep(ms) {
      await new Promise((r) => setTimeout(r, ms));
    },
    get events() {
      return events;
    },
  };
}

async function main() {
  const [scenarioPath, ...argv] = process.argv.slice(2);
  if (!scenarioPath) {
    console.error("usage: node cdp-drive.mjs <scenario.mjs> [--port N] [args...]");
    process.exit(2);
  }
  const cdp = await connect();
  const absPath = resolve(process.cwd(), scenarioPath);
  const mod = await import(pathToFileURL(absPath).href);
  const ctx = {
    ...cdp,
    argv,
    log: (...a) => console.log(new Date().toISOString().slice(11, 19), ...a),
  };
  await mod.run(ctx);
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("FATAL:", e.stack || e);
    process.exit(1);
  });
}