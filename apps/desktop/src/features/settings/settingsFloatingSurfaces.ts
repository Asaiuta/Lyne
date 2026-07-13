const SETTINGS_POPUP_SURFACE_SELECTOR = [
  ".naive-select-menu.n-base-select-menu",
  ".n-popselect-menu.n-base-select-menu",
  ".n-dropdown.n-dropdown-menu",
  ".n-popover.n-popover-shared",
  ".n-dialog-mask",
  ".n-modal-mask"
].join(",");

export const APPEARANCE_MANAGER_MODAL_SELECTOR = ".appearance-manager-modal";

const isVisibleSurface = (el: HTMLElement): boolean => {
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    rect.width > 0 &&
    rect.height > 0
  );
};

export const hasVisibleSettingsFloatingSurface = (
  extraSelectors: readonly string[] = []
): boolean => {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return false;
  }

  const selector = [SETTINGS_POPUP_SURFACE_SELECTOR, ...extraSelectors].join(",");
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).some(isVisibleSurface);
};
