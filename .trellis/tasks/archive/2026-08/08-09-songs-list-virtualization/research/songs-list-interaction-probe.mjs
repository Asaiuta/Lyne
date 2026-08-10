import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import {
  connectPage,
  ensureDir,
  focusMainWindow
} from "../../07-12-frontend-tauri-performance-trace/research/tauri-perf/cdp-lib.mjs";

const OUTPUT_DIR = path.resolve(
  ".trellis/tasks/08-09-songs-list-virtualization/research/interaction"
);

const scrollToRatio = async (page, ratio) => {
  await page.evaluate((nextRatio) => {
    const viewport = document.querySelector(".media-list-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("media list viewport is unavailable");
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) * nextRatio;
  }, ratio);
  await page.waitForTimeout(500);
};

const readWindow = async (page) =>
  page.evaluate(() => {
    const viewport = document.querySelector(".media-list-viewport");
    if (!(viewport instanceof HTMLElement)) throw new Error("media list viewport is unavailable");
    const rows = [...viewport.querySelectorAll(".media-row")];
    return {
      scrollTop: Number(viewport.scrollTop.toFixed(3)),
      clientHeight: viewport.clientHeight,
      rowCount: rows.length,
      firstIndex: rows[0]?.querySelector(".media-row-index")?.textContent?.trim() ?? null,
      lastIndex: rows.at(-1)?.querySelector(".media-row-index")?.textContent?.trim() ?? null,
      selectedIndexes: rows
        .filter((row) => row.classList.contains("is-selected"))
        .map((row) => row.querySelector(".media-row-index")?.textContent?.trim() ?? null),
      currentRowCount: rows.filter((row) => row.classList.contains("is-current")).length
    };
  });

const { browser, page } = await connectPage({
  cdpUrl: process.env.CDP_URL ?? "http://127.0.0.1:9233",
  appUrlPrefix: "http://tauri.localhost/"
});

try {
  await ensureDir(OUTPUT_DIR);
  await focusMainWindow(page);
  await page.evaluate(() => document.getElementById("songs-list-probe-unbounded-panel")?.remove());
  await page.keyboard.press("Escape");
  const viewport = page.locator(".media-list-viewport[data-virtualized='true']");
  await viewport.waitFor({ state: "visible" });

  await scrollToRatio(page, 0.5);
  const target = viewport.locator(".media-row").nth(5);
  const targetIndex = (await target.locator(".media-row-index").textContent())?.trim() ?? null;
  const targetTitle = (await target.locator(".media-row-title-text").textContent())?.trim() ?? null;
  assert.ok(targetIndex, "selected row must expose an absolute index");
  await target.click();
  assert.equal(await target.evaluate((row) => row.classList.contains("is-selected")), true);

  await scrollToRatio(page, 0.75);
  const awayWindow = await readWindow(page);
  assert.equal(awayWindow.rowCount > 0 && awayWindow.rowCount <= 20, true);
  await scrollToRatio(page, 0.5);
  const returnedWindow = await readWindow(page);
  assert.deepEqual(returnedWindow.selectedIndexes, [targetIndex]);

  const selectedRow = viewport.locator(".media-row.is-selected");
  await selectedRow.click({ button: "right" });
  const contextMenu = page.locator(".context-menu:not(.n-dropdown-submenu)");
  await contextMenu.waitFor({ state: "visible" });
  const menuBox = await contextMenu.boundingBox();
  assert.ok(menuBox, "context menu must have visible geometry");
  const pageViewport = page.viewportSize() ?? (await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  })));
  assert.equal(menuBox.x >= 0 && menuBox.y >= 0, true);
  assert.equal(menuBox.x + menuBox.width <= pageViewport.width + 1, true);
  assert.equal(menuBox.y + menuBox.height <= pageViewport.height + 1, true);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "context-menu.png"), fullPage: false });
  await page.keyboard.press("Escape");
  await contextMenu.waitFor({ state: "hidden" });

  await scrollToRatio(page, 0);
  const viewportBox = await viewport.boundingBox();
  assert.ok(viewportBox, "media list viewport must have visible geometry");
  await page.mouse.move(
    viewportBox.x + viewportBox.width / 2,
    viewportBox.y + viewportBox.height / 2
  );
  const wheelWindows = [];
  for (let step = 0; step < 5; step += 1) {
    await page.mouse.wheel(0, viewportBox.height * 0.85);
    await page.waitForTimeout(350);
    const sample = await readWindow(page);
    assert.equal(sample.rowCount > 0 && sample.rowCount <= 20, true);
    wheelWindows.push(sample);
  }
  const firstIndexes = wheelWindows.map((sample) => Number(sample.firstIndex));
  assert.equal(firstIndexes.every(Number.isFinite), true);
  assert.equal(firstIndexes.every((value, index) => index === 0 || value > firstIndexes[index - 1]), true);

  const result = {
    capturedAt: new Date().toISOString(),
    selection: { targetIndex, targetTitle, awayWindow, returnedWindow },
    contextMenu: { ...menuBox, viewport: pageViewport },
    wheelWindows,
    playbackRow:
      returnedWindow.currentRowCount > 0
        ? { status: "observed", count: returnedWindow.currentRowCount }
        : { status: "not-applicable", reason: "measurement sidecar had no active track" }
  };
  const resultPath = path.join(OUTPUT_DIR, "songs-list-interaction.json");
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ resultPath, ...result }, null, 2));
} finally {
  await browser.close();
}
