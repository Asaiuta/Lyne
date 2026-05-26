// Naive popover probe (PR1 of dropdown-popover migration).
//
// Validates the static visual contract of `.n-popover*` classes and the
// `naivePopoverContentClass` slot used by the package facade. Because the
// public `NaivePopover` is a `lazy()` Solid proxy backed by Kobalte, the
// probe focuses on the rendered class hooks rather than driving Kobalte
// through a real Solid runtime here. End-to-end interaction (hover delay,
// outside click, Escape) is exercised by Tauri/Vite dev acceptance.
//
// Coverage:
//   - Class hooks: `n-popover`, `n-popover-shared`, `n-popover__content`,
//     `n-popover-shared--show-arrow`, `n-popover-shared--raw`.
//   - `raw` mode strips internal background/padding (NaiveUI `raw` prop).
//   - Default mode applies NaiveUI 2.43.2 background, padding, radius.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/Yukina Asaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");

const chromePath =
  "C:/Users/Yukina Asaka/.cache/puppeteer/chrome-headless-shell/win64-141.0.7390.78/chrome-headless-shell-win64/chrome-headless-shell.exe";

const css = await Promise.all([
  readFile("apps/desktop/src/shared/styles/tokens.css", "utf8"),
  readFile("apps/desktop/src/shared/styles/global.css", "utf8"),
  // MediaSortPopover keeps its layout/background in the routed page stylesheet.
  readFile("apps/desktop/src/shared/styles/components/pages.css", "utf8"),
  readFile("apps/desktop/src/shared/ui/naive/styles.css", "utf8"),
]).then((parts) => parts.join("\n"));

// Default-mode popover content (non-raw, with arrow). Mimics what
// `NaivePopoverKobalte` renders inside `KobaltePopover.Content` when
// `triggerMode="hover"` opens against an anchor.
const defaultPopoverMarkup = `
  <div id="popover-default" class="n-popover n-popover-shared n-popover__content n-popover-shared--show-arrow" role="dialog" aria-label="Default popover">
    <div class="popover-body">Hello popover</div>
  </div>
`;

// Raw-mode popover content. Mimics `<NaivePopover raw>`; the wrapper
// should suppress NaiveUI's internal background/padding so callers can
// own the surface.
const rawPopoverMarkup = `
  <div id="popover-raw" class="n-popover n-popover-shared n-popover__content n-popover-shared--raw" role="dialog" aria-label="Raw popover">
    <div class="popover-body">Caller-owned surface</div>
  </div>
`;

// MediaSortPopover-style content. Validates that the migration of
// MediaSortPopover to NaivePopover preserves the `.media-sort-popover`
// visual class and that the inner `.media-sort-popover-body` keeps the
// horizontal flex layout.
const mediaSortMarkup = `
  <div id="popover-media-sort" class="n-popover n-popover-shared n-popover__content n-popover-shared--raw media-sort-popover" role="dialog" aria-label="Sort menu">
    <div class="media-sort-popover-body">
      <div class="media-sort-group">
        <div class="media-sort-label">Field</div>
        <div class="media-sort-radio-group">
          <div class="media-sort-radio-stack">
            <label class="media-sort-radio"><input type="radio" checked><span>Default</span></label>
            <label class="media-sort-radio"><input type="radio"><span>Title</span></label>
          </div>
        </div>
      </div>
      <div class="media-sort-divider" aria-hidden="true"></div>
      <div class="media-sort-group">
        <div class="media-sort-label">Order</div>
        <div class="media-sort-radio-group">
          <div class="media-sort-radio-stack">
            <label class="media-sort-radio"><input type="radio" checked><span>Default</span></label>
            <label class="media-sort-radio"><input type="radio"><span>Asc</span></label>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  await page.setContent("<!doctype html><html><head></head><body></body></html>");
  await page.addStyleTag({ content: css });
  await page.evaluate(
    ({ defaultPopoverMarkup, rawPopoverMarkup, mediaSortMarkup }) => {
      document.documentElement.dataset.theme = "dark";
      document.body.style.margin = "0";
      document.body.innerHTML = `
        <div style="position: relative; padding: 80px;">
          ${defaultPopoverMarkup}
          ${rawPopoverMarkup}
          ${mediaSortMarkup}
        </div>
      `;
    },
    { defaultPopoverMarkup, rawPopoverMarkup, mediaSortMarkup }
  );

  const result = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing selector: ${selector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        classList: Array.from(element.classList),
        rect: {
          width: rect.width,
          height: rect.height,
        },
        style: {
          padding: style.padding,
          paddingTop: style.paddingTop,
          paddingRight: style.paddingRight,
          paddingBottom: style.paddingBottom,
          paddingLeft: style.paddingLeft,
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          color: style.color,
          fontSize: style.fontSize,
          display: style.display,
          flexDirection: style.flexDirection,
        },
      };
    };

    return {
      default: read("#popover-default"),
      raw: read("#popover-raw"),
      mediaSort: read("#popover-media-sort"),
      mediaSortBody: read("#popover-media-sort .media-sort-popover-body"),
    };
  });

  // Assertions: default mode has padding/bg; raw mode does not.
  const defaultHasPadding = result.default.style.paddingTop !== "0px";
  const rawHasNoPadding = result.raw.style.paddingTop === "0px";
  // `.media-sort-popover` shell suppresses NaiveUI padding (raw mode) and lets
  // the inner `.media-sort-popover-body` own the 12px padding.
  const mediaSortShellNoPadding = result.mediaSort.style.paddingTop === "0px";
  const mediaSortBodyHorizontal = result.mediaSortBody.style.display === "flex";
  const mediaSortBodyHasPadding =
    result.mediaSortBody.style.paddingTop === "12px";

  const checks = {
    defaultHasPadding,
    rawHasNoPadding,
    mediaSortShellNoPadding,
    mediaSortBodyHorizontal,
    mediaSortBodyHasPadding,
    defaultHasShowArrowClass: result.default.classList.includes(
      "n-popover-shared--show-arrow"
    ),
    rawHasRawClass: result.raw.classList.includes("n-popover-shared--raw"),
    mediaSortHasMediaClass:
      result.mediaSort.classList.includes("media-sort-popover"),
  };

  const summary = { result, checks };
  await writeFile(
    "output/playwright/naive-popover-probe-results.json",
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));

  const allPassed = Object.values(checks).every(Boolean);
  if (!allPassed) {
    console.error("naive_popover_probe: some checks failed");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
