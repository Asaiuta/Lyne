import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appRoot, "..", "..");

const parseArgs = (argv) => {
  const options = {
    url: "http://127.0.0.1:5173",
    routes: ["library", "recommend", "cloud"],
    timeoutMs: 15000,
    headed: false,
    trace: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--url" && next) {
      options.url = next;
      index += 1;
    } else if (arg === "--routes" && next) {
      options.routes = next.split(",").map((route) => route.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      options.timeoutMs = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--trace") {
      options.trace = true;
    } else if (arg === "--help") {
      console.log([
        "Usage: npm run perf:routes -- [options]",
        "",
        "Options:",
        "  --url <url>             Running Vite preview/dev URL (default: http://127.0.0.1:5173)",
        "  --routes <a,b,c>        Sidebar route keys to measure (default: library,recommend,cloud)",
        "  --timeout-ms <ms>       Per-route timeout (default: 15000)",
        "  --headed                Show the browser window",
        "  --trace                 Save a Playwright trace under output/playwright/"
      ].join("\n"));
      process.exit(0);
    }
  }

  return options;
};

const loadPlaywright = async () => {
  try {
    return await import("playwright");
  } catch {
    console.error("[perf:routes] Playwright is not installed for this workspace.");
    console.error("Install it temporarily or as a dev dependency, then rerun:");
    console.error("  npm install --save-dev playwright");
    console.error("  npx playwright install chromium");
    console.error("  npm run perf:routes -- --url http://127.0.0.1:5173");
    process.exit(1);
  }
};

const waitForRoute = async (page, route, timeoutMs) => {
  await page.waitForSelector(
    `[data-perf-active-page="${route}"]:not([data-perf-transition-pending])`,
    { timeout: timeoutMs }
  );
};

const measureRoute = async (page, route, timeoutMs) => {
  const trigger = page.locator(`[data-perf-route-key="${route}"]`).first();
  const triggerCount = await trigger.count();
  if (triggerCount === 0) {
    return { route, status: "skipped", reason: "route trigger not found" };
  }

  const start = await page.evaluate(() => performance.now());
  await trigger.click();
  try {
    await waitForRoute(page, route, timeoutMs);
  } catch {
    const activePage = await page
      .locator("[data-perf-active-page]")
      .first()
      .getAttribute("data-perf-active-page")
      .catch(() => null);
    return {
      route,
      status: "skipped",
      reason: activePage === route ? "transition did not settle before timeout" : "route did not activate"
    };
  }
  const end = await page.evaluate(() => performance.now());
  return { route, status: "ok", durationMs: end - start };
};

const options = parseArgs(process.argv.slice(2));
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: !options.headed });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });

let tracePath = null;
if (options.trace) {
  const traceDir = path.join(repoRoot, "output", "playwright");
  await mkdir(traceDir, { recursive: true });
  tracePath = path.join(traceDir, `route-loads-${Date.now()}.zip`);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
}

const page = await context.newPage();
await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs });
await page.waitForSelector("[data-perf-active-page]", { timeout: options.timeoutMs });

const results = [];
for (const route of options.routes) {
  results.push(await measureRoute(page, route, options.timeoutMs));
}

if (tracePath) {
  await context.tracing.stop({ path: tracePath });
}

await browser.close();

console.log("[perf:routes] route load timing");
for (const result of results) {
  if (result.status === "ok") {
    console.log(`${result.route.padEnd(18)} ${result.durationMs.toFixed(1).padStart(8)} ms`);
  } else {
    console.log(`${result.route.padEnd(18)} skipped  ${result.reason}`);
  }
}
if (tracePath) {
  console.log(`[perf:routes] trace: ${path.relative(appRoot, tracePath)}`);
}
