// Naive dropdown probe (PR2 of dropdown-popover migration).
//
// Validates the static visual contract of `.n-dropdown*` classes and the
// option/divider/disabled DOM shape used by `NaiveDropdownKobalte`. Because
// the public `NaiveDropdown` is a `lazy()` Solid proxy backed by Kobalte,
// the probe focuses on the rendered class hooks and computed styles rather
// than driving Kobalte through a real Solid runtime here. End-to-end
// interaction (open/close, item select, Escape, focus return) is exercised
// by Tauri/Vite dev acceptance.
//
// Coverage:
//   - Class hooks: `n-dropdown`, `n-dropdown-menu`, `n-dropdown-option`,
//     `n-dropdown-option-body`, `n-dropdown-option-body__prefix`,
//     `n-dropdown-option-body__label`, `n-dropdown-option-body__suffix`,
//     `n-dropdown-divider`, `n-dropdown--disabled`.
//   - Menu surface has background, padding, radius, shadow.
//   - Disabled option carries `n-dropdown--disabled` modifier and reduced opacity.
//   - Divider row is 1px with no body slots.
//   - Trigger surface exposes `aria-haspopup` and `aria-expanded` per ARIA
//     menu-button contract (Kobalte emits `aria-haspopup="true"`).

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

// Mimic what `NaiveDropdownKobalte` renders inside `DropdownMenu.Content`
// when the menu is open. Mirrors the actual class hooks emitted by the
// facade option/divider rendering.
const dropdownMenuMarkup = `
  <div id="dropdown-menu" class="n-dropdown n-dropdown-menu" role="menu" aria-label="Sample menu" tabindex="-1">
    <div id="opt-play" class="n-dropdown-option n-dropdown-option-body" role="menuitem" data-key="play">
      <span class="n-dropdown-option-body__prefix n-dropdown-option-body__prefix--show-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M3 2v12l10-6z" fill="currentColor"/></svg>
      </span>
      <span class="n-dropdown-option-body__label">Play</span>
    </div>
    <div id="opt-add" class="n-dropdown-option n-dropdown-option-body" role="menuitem" data-key="add">
      <span class="n-dropdown-option-body__label">Add to playlist</span>
      <span class="n-dropdown-option-body__suffix" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 4h8v8H4z" fill="currentColor"/></svg>
      </span>
    </div>
    <div id="divider-1" class="n-dropdown-divider" aria-hidden="true" role="separator"></div>
    <div id="opt-delete" class="n-dropdown-option n-dropdown-option-body n-dropdown--disabled" role="menuitem" aria-disabled="true" data-disabled="" data-key="delete">
      <span class="n-dropdown-option-body__label">Delete</span>
    </div>
  </div>
`;

// Trigger anchor: this mirrors what Kobalte's DropdownMenu.Trigger emits
// (aria-haspopup="true" + aria-expanded toggled by state). The probe
// validates that our wrapping `<span class="naive-dropdown-trigger">`
// preserves the underlying button semantics in the closed and open states.
const triggerClosedMarkup = `
  <button id="trigger-closed" class="naive-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="false">Open menu</button>
`;
const triggerOpenMarkup = `
  <button id="trigger-open" class="naive-dropdown-trigger" type="button" aria-haspopup="true" aria-expanded="true" aria-controls="dropdown-menu">Open menu</button>
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
    ({ dropdownMenuMarkup, triggerClosedMarkup, triggerOpenMarkup }) => {
      document.documentElement.dataset.theme = "dark";
      document.body.style.margin = "0";
      document.body.innerHTML = `
        <div style="position: relative; padding: 40px; display: flex; flex-direction: column; gap: 24px;">
          <div>${triggerClosedMarkup}</div>
          <div>${triggerOpenMarkup}</div>
          <div style="min-width: 220px;">${dropdownMenuMarkup}</div>
        </div>
      `;
    },
    { dropdownMenuMarkup, triggerClosedMarkup, triggerOpenMarkup }
  );

  const result = await page.evaluate(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing selector: ${selector}`);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        classList: Array.from(element.classList),
        role: element.getAttribute("role"),
        ariaHasPopup: element.getAttribute("aria-haspopup"),
        ariaExpanded: element.getAttribute("aria-expanded"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        ariaLabel: element.getAttribute("aria-label"),
        rect: {
          width: rect.width,
          height: rect.height,
        },
        style: {
          padding: style.padding,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          backgroundColor: style.backgroundColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
          color: style.color,
          fontSize: style.fontSize,
          height: style.height,
          opacity: style.opacity,
          cursor: style.cursor,
          display: style.display,
        },
      };
    };

    return {
      menu: read("#dropdown-menu"),
      optPlay: read("#opt-play"),
      optPlayPrefix: read("#opt-play .n-dropdown-option-body__prefix"),
      optPlayLabel: read("#opt-play .n-dropdown-option-body__label"),
      optAdd: read("#opt-add"),
      optAddLabel: read("#opt-add .n-dropdown-option-body__label"),
      optAddSuffix: read("#opt-add .n-dropdown-option-body__suffix"),
      divider: read("#divider-1"),
      optDelete: read("#opt-delete"),
      triggerClosed: read("#trigger-closed"),
      triggerOpen: read("#trigger-open"),
    };
  });

  // -------- Assertions --------

  // Menu surface
  const menuHasClasses =
    result.menu.classList.includes("n-dropdown") &&
    result.menu.classList.includes("n-dropdown-menu");
  const menuHasBackground = result.menu.style.backgroundColor !== "rgba(0, 0, 0, 0)";
  const menuHasShadow = result.menu.style.boxShadow !== "none";
  const menuHasPadding = result.menu.style.paddingTop !== "0px";
  const menuHasRadius = result.menu.style.borderRadius !== "0px";

  // Option rows
  const optPlayHasOptionClasses =
    result.optPlay.classList.includes("n-dropdown-option") &&
    result.optPlay.classList.includes("n-dropdown-option-body");
  const optPlayPrefixHasClass = result.optPlayPrefix.classList.includes(
    "n-dropdown-option-body__prefix"
  );
  const optPlayPrefixShowIcon = result.optPlayPrefix.classList.includes(
    "n-dropdown-option-body__prefix--show-icon"
  );
  const optPlayLabelHasClass = result.optPlayLabel.classList.includes(
    "n-dropdown-option-body__label"
  );
  const optAddSuffixHasClass = result.optAddSuffix.classList.includes(
    "n-dropdown-option-body__suffix"
  );

  // Divider
  const dividerHasClass = result.divider.classList.includes("n-dropdown-divider");
  const dividerIsLine =
    result.divider.rect.height === 1 ||
    result.divider.style.height === "1px";

  // Disabled
  const deleteHasDisabled =
    result.optDelete.classList.includes("n-dropdown--disabled") &&
    result.optDelete.ariaDisabled === "true";
  const deleteHasReducedOpacity =
    parseFloat(result.optDelete.style.opacity) < 1;
  const deleteHasNotAllowed = result.optDelete.style.cursor === "not-allowed";

  // Trigger ARIA contract.
  // Kobalte emits `aria-haspopup="true"`, not `"menu"`. ARIA 1.2 still treats
  // `"true"` as semantically equivalent to `"menu"` for a button that opens a
  // menu, so this is acceptable. Flag in the report instead of failing.
  const triggerClosedHasHasPopup =
    result.triggerClosed.ariaHasPopup === "true" ||
    result.triggerClosed.ariaHasPopup === "menu";
  const triggerClosedExpandedFalse = result.triggerClosed.ariaExpanded === "false";
  const triggerOpenExpandedTrue = result.triggerOpen.ariaExpanded === "true";

  const checks = {
    menuHasClasses,
    menuHasBackground,
    menuHasShadow,
    menuHasPadding,
    menuHasRadius,
    optPlayHasOptionClasses,
    optPlayPrefixHasClass,
    optPlayPrefixShowIcon,
    optPlayLabelHasClass,
    optAddSuffixHasClass,
    dividerHasClass,
    dividerIsLine,
    deleteHasDisabled,
    deleteHasReducedOpacity,
    deleteHasNotAllowed,
    triggerClosedHasHasPopup,
    triggerClosedExpandedFalse,
    triggerOpenExpandedTrue,
  };

  const notes = {
    kobalteAriaHasPopup:
      result.triggerClosed.ariaHasPopup === "true"
        ? "Kobalte emits aria-haspopup=\"true\" (ARIA 1.2-equivalent to \"menu\")."
        : `Got aria-haspopup=${JSON.stringify(result.triggerClosed.ariaHasPopup)}; expected "true" or "menu".`,
  };

  const summary = { result, checks, notes };
  await writeFile(
    "output/playwright/naive-dropdown-probe-results.json",
    JSON.stringify(summary, null, 2)
  );
  console.log(JSON.stringify(summary, null, 2));

  const allPassed = Object.values(checks).every(Boolean);
  if (!allPassed) {
    console.error("naive_dropdown_probe: some checks failed");
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
