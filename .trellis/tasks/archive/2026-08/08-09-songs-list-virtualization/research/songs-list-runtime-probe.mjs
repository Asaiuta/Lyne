import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  connectPage,
  ensureDir,
  focusMainWindow,
  readCdpPerformanceMetrics,
  readDomCounters
} from "../../07-12-frontend-tauri-performance-trace/research/tauri-perf/cdp-lib.mjs";

const CDP_URL = process.env.CDP_URL ?? "http://127.0.0.1:9233";
const APP_URL_PREFIX = process.env.APP_URL_PREFIX ?? "http://tauri.localhost/";
const OUTPUT_DIR = path.resolve(
  process.env.PROBE_OUTPUT_DIR ??
    ".trellis/tasks/08-09-songs-list-virtualization/research/runtime-baseline"
);
const FORCE_UNBOUNDED_PANEL = process.env.FORCE_UNBOUNDED_PANEL === "1";

const configurePanelOverride = async (page) => {
  await page.evaluate((forceUnbounded) => {
    const styleId = "songs-list-probe-unbounded-panel";
    document.getElementById(styleId)?.remove();
    if (!forceUnbounded) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
      ".panel-library { height: auto !important; min-height: 100% !important; overflow: visible !important; }";
    document.head.append(style);
  }, FORCE_UNBOUNDED_PANEL);
  await page.waitForTimeout(750);
};

const waitForSongsList = async (page) => {
  const existing = page.locator(".media-list-viewport[data-virtualized='true']");
  if ((await existing.count()) === 0) {
    const route = page
      .locator(
        "[data-perf-route-key='library:songs'], [data-perf-route-key='library']"
      )
      .first();
    await route.waitFor({ state: "visible" });
    await route.click();
  }

  await page.locator(".local-library-router").waitFor({ state: "visible" });
  const viewport = page.locator(".media-list-viewport[data-virtualized='true']");
  await viewport.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => document.querySelectorAll(".media-list-viewport .media-row").length > 0
  );
  return viewport;
};

const readListDom = async (page) =>
  page.evaluate(() => {
    const viewport = document.querySelector(".media-list-viewport");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("media list viewport is unavailable");
    }
    const rows = [...viewport.querySelectorAll(".media-row")];
    const images = [...viewport.querySelectorAll("img")].filter(
      (candidate) => candidate instanceof HTMLImageElement
    );
    const spacer = viewport.querySelector(".media-list-spacer");
    const rowGroup = viewport.querySelector(".media-list-rows");
    const table = viewport.closest(".media-list-table");
    const router = viewport.closest(".local-library-router");
    const panel = viewport.closest(".panel-library");
    const contentArea = viewport.closest(".content-area");
    const selectedRows = rows.filter((row) => row.classList.contains("is-selected"));
    const currentRows = rows.filter((row) => row.classList.contains("is-current"));
    const box = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        rectHeight: Number(rect.height.toFixed(3)),
        overflowY: style.overflowY
      };
    };

    return {
      href: location.href,
      viewport: {
        virtualized: viewport.dataset.virtualized ?? null,
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollTop: Number(viewport.scrollTop.toFixed(3))
      },
      rendered: {
        rowCount: rows.length,
        firstIndexText:
          rows[0]?.querySelector(".media-row-index")?.textContent?.trim() ?? null,
        lastIndexText:
          rows.at(-1)?.querySelector(".media-row-index")?.textContent?.trim() ?? null,
        imageCount: images.length,
        decodedImageCount: images.filter(
          (image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0
        ).length,
        selectedRowCount: selectedRows.length,
        currentRowCount: currentRows.length
      },
      geometry: {
        spacerInlineHeight:
          spacer instanceof HTMLElement ? spacer.style.height || null : null,
        rowGroupTransform:
          rowGroup instanceof HTMLElement ? rowGroup.style.transform || null : null,
        table: box(table),
        router: box(router),
        panel: box(panel),
        contentArea: box(contentArea)
      },
      document: {
        elementCount: document.querySelectorAll("*").length,
        imageCount: document.images.length,
        mediaRowCount: document.querySelectorAll(".media-row").length
      }
    };
  });

const readSample = async (page, session, label) => {
  const performanceMetrics = await readCdpPerformanceMetrics(session);
  return {
    label,
    capturedAt: new Date().toISOString(),
    domCounters: await readDomCounters(session),
    jsHeap: {
      usedBytes: performanceMetrics.JSHeapUsedSize ?? null,
      totalBytes: performanceMetrics.JSHeapTotalSize ?? null
    },
    list: await readListDom(page)
  };
};

const scrollToRatio = async (page, ratio) => {
  await page.evaluate((nextRatio) => {
    const viewport = document.querySelector(".media-list-viewport");
    if (!(viewport instanceof HTMLElement)) {
      throw new Error("media list viewport is unavailable");
    }
    viewport.scrollTop = Math.max(
      0,
      (viewport.scrollHeight - viewport.clientHeight) * nextRatio
    );
  }, ratio);
  await page.waitForTimeout(750);
};

const browserResult = await connectPage({
  cdpUrl: CDP_URL,
  appUrlPrefix: APP_URL_PREFIX
});
const { browser, page } = browserResult;

try {
  await ensureDir(OUTPUT_DIR);
  await focusMainWindow(page);
  await page.waitForLoadState("domcontentloaded");
  await configurePanelOverride(page);
  await waitForSongsList(page);
  const session = await page.context().newCDPSession(page);
  await session.send("Performance.enable");

  await scrollToRatio(page, 0);
  const initial = await readSample(page, session, "initial");
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "songs-initial.png"),
    fullPage: false
  });

  await scrollToRatio(page, 0.5);
  const middle = await readSample(page, session, "middle");
  await page.screenshot({
    path: path.join(OUTPUT_DIR, "songs-middle.png"),
    fullPage: false
  });

  const scrollSweep = [];
  for (const ratio of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    await scrollToRatio(page, ratio);
    const sample = await readListDom(page);
    scrollSweep.push({ ratio, ...sample });
  }

  const result = {
    schemaVersion: 1,
    cdpUrl: CDP_URL,
    appUrlPrefix: APP_URL_PREFIX,
    initial,
    middle,
    scrollSweep
  };
  const resultPath = path.join(OUTPUT_DIR, "songs-list-runtime.json");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ resultPath, initial, middle, scrollSweep }, null, 2));
} finally {
  await browser.close();
}
