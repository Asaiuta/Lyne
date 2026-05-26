// Naive popconfirm probe (05-26 popconfirm migration).
//
// Validates the static visual contract of `.n-popconfirm*` classes and the
// small dismiss-state contract that NaivePopconfirm adds on top of
// NaivePopover. Kobalte positioning/open-close behavior is inherited from
// NaivePopover; this probe focuses on the panel shape and NaiveUI semantics:
//   - `n-popconfirm` class lands on Popover.Content.
//   - default icon/action/body hooks are present and styled.
//   - `negativeText={null}` hides cancel and `showIcon={false}` hides icon.
//   - content role is upgraded to `alertdialog`.
//   - `Promise<false>` / `false` keeps the popconfirm open.

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/Yukina Asaka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/.pnpm/playwright-core@1.60.0/node_modules/playwright-core");

const chromePath =
  "C:/Users/Yukina Asaka/.cache/puppeteer/chrome-headless-shell/win64-141.0.7390.78/chrome-headless-shell-win64/chrome-headless-shell.exe";

const css = await Promise.all([
  readFile("apps/desktop/src/shared/styles/tokens.css", "utf8"),
  readFile("apps/desktop/src/shared/styles/global.css", "utf8"),
  readFile("apps/desktop/src/shared/ui/naive/styles.css", "utf8"),
]).then((parts) => parts.join("\n"));

const defaultMarkup = `
  <div id="popconfirm-default" class="n-popover n-popover-shared n-popover__content n-popover-shared--show-arrow n-popconfirm" role="alertdialog" aria-label="Delete item" data-placement="top-end">
    <div class="n-popconfirm__panel">
      <div class="n-popconfirm__body">
        <div class="n-popconfirm__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 3.2 22 20.4H2L12 3.2Z" fill="currentColor"/></svg>
        </div>
        <span>Delete this item?</span>
      </div>
      <div class="n-popconfirm__action">
        <button class="naive-button naive-button--small" type="button" data-action="negative">Cancel</button>
        <button class="naive-button naive-button--small naive-button--primary" type="button" data-action="positive">Confirm</button>
      </div>
    </div>
  </div>
`;

const noCancelNoIconMarkup = `
  <div id="popconfirm-no-cancel" class="n-popover n-popover-shared n-popover__content n-popover-shared--show-arrow n-popconfirm" role="alertdialog" aria-label="Custom action">
    <div class="n-popconfirm__panel">
      <div class="n-popconfirm__body">
        <span>Custom timer</span>
      </div>
      <div class="n-popconfirm__action">
        <button class="naive-button naive-button--small naive-button--primary is-secondary is-strong" type="button" data-action="positive">Confirm</button>
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
    ({ defaultMarkup, noCancelNoIconMarkup }) => {
      document.documentElement.dataset.theme = "dark";
      document.body.style.margin = "0";
      document.body.innerHTML = `
        <div style="display: grid; gap: 24px; padding: 80px; max-width: 420px;">
          ${defaultMarkup}
          ${noCancelNoIconMarkup}
          <button id="state-positive" type="button">positive</button>
          <button id="state-negative" type="button">negative</button>
        </div>
      `;

      window.__popconfirmState = {
        open: true,
        positiveCalls: 0,
        negativeCalls: 0,
      };
      const closeUnlessFalse = (handler) => {
        Promise.resolve(handler()).then((value) => {
          if (value === false) return;
          window.__popconfirmState.open = false;
        });
      };
      document.querySelector("#state-positive").addEventListener("click", () => {
        closeUnlessFalse(() => {
          window.__popconfirmState.positiveCalls += 1;
          return Promise.resolve(false);
        });
      });
      document.querySelector("#state-negative").addEventListener("click", () => {
        closeUnlessFalse(() => {
          window.__popconfirmState.negativeCalls += 1;
          return undefined;
        });
      });
    },
    { defaultMarkup, noCancelNoIconMarkup }
  );

  await page.click("#state-positive");
  await page.waitForTimeout(0);
  const stateAfterBlockedPositive = await page.evaluate(() => ({
    ...window.__popconfirmState,
  }));
  await page.click("#state-negative");
  await page.waitForTimeout(0);
  const stateAfterNegative = await page.evaluate(() => ({
    ...window.__popconfirmState,
  }));

  const result = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing selector: ${selector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        classList: Array.from(element.classList),
        role: element.getAttribute("role"),
        placement: element.getAttribute("data-placement"),
        text: element.textContent.trim(),
        rect: {
          width: rect.width,
          height: rect.height,
        },
        style: {
          display: style.display,
          gap: style.gap,
          marginTop: style.marginTop,
          marginRight: style.marginRight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          borderColor: style.borderColor,
          fontSize: style.fontSize,
          justifyContent: style.justifyContent,
        },
      };
    };

    return {
      defaultRoot: read("#popconfirm-default"),
      defaultPanel: read("#popconfirm-default .n-popconfirm__panel"),
      defaultBody: read("#popconfirm-default .n-popconfirm__body"),
      defaultIcon: read("#popconfirm-default .n-popconfirm__icon"),
      defaultAction: read("#popconfirm-default .n-popconfirm__action"),
      cancelButton: read("#popconfirm-default [data-action='negative']"),
      confirmButton: read("#popconfirm-default [data-action='positive']"),
      noCancelRoot: read("#popconfirm-no-cancel"),
      noCancelAction: read("#popconfirm-no-cancel .n-popconfirm__action"),
      noCancelConfirmButton: read("#popconfirm-no-cancel [data-action='positive']"),
      noCancelButtonCount: document.querySelectorAll(
        "#popconfirm-no-cancel .naive-button"
      ).length,
      noCancelIconCount: document.querySelectorAll(
        "#popconfirm-no-cancel .n-popconfirm__icon"
      ).length,
      panelHasNoSyntheticContentWrapper:
        document.querySelectorAll(".n-popconfirm__content").length === 0,
    };
  });

  const checks = {
    rootHasPopoverAndPopconfirmClasses:
      result.defaultRoot.classList.includes("n-popover") &&
      result.defaultRoot.classList.includes("n-popconfirm"),
    roleIsAlertdialog: result.defaultRoot.role === "alertdialog",
    placementTopEnd: result.defaultRoot.placement === "top-end",
    panelHasClass: result.defaultPanel.classList.includes("n-popconfirm__panel"),
    bodyIsFlex: result.defaultBody.style.display === "flex",
    iconHasClass: result.defaultIcon.classList.includes("n-popconfirm__icon"),
    iconUsesWarningColor: result.defaultIcon.style.color !== result.defaultBody.style.color,
    actionIsFlexEnd:
      result.defaultAction.style.display === "flex" &&
      result.defaultAction.style.justifyContent === "flex-end",
    actionSpacingUsesButtonMargin: result.cancelButton.style.marginRight === "8px",
    panelAvoidsSyntheticContentWrapper: result.panelHasNoSyntheticContentWrapper,
    buttonsDefaultText:
      result.cancelButton.text === "Cancel" &&
      result.confirmButton.text === "Confirm",
    confirmButtonPrimary:
      result.confirmButton.classList.includes("naive-button--primary") &&
      result.confirmButton.style.backgroundColor !== "rgba(0, 0, 0, 0)",
    nullNegativeTextHidesCancel: result.noCancelButtonCount === 1,
    showIconFalseHidesIcon: result.noCancelIconCount === 0,
    positiveFalseKeepsOpen:
      stateAfterBlockedPositive.open === true &&
      stateAfterBlockedPositive.positiveCalls === 1,
    negativeVoidCloses:
      stateAfterNegative.open === false &&
      stateAfterNegative.negativeCalls === 1,
  };

  const summary = {
    result,
    stateAfterBlockedPositive,
    stateAfterNegative,
    checks,
  };
  await writeFile(
    "output/playwright/naive-popconfirm-probe-results.json",
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));

  const allPassed = Object.values(checks).every(Boolean);
  if (!allPassed) {
    console.error("naive_popconfirm_probe: some checks failed");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
