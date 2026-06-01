export const DEFAULT_PAGE_SCROLL_ROOT_SELECTOR = "[data-page-scroll-root]";

export const isScrollableY = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return /(auto|scroll|overlay)/u.test(style.overflowY);
};

export function resolveNearestScrollRoot(
  element: HTMLElement,
  selector = DEFAULT_PAGE_SCROLL_ROOT_SELECTOR
): HTMLElement | null {
  const configuredRoot = element.closest<HTMLElement>(selector);
  if (configuredRoot && isScrollableY(configuredRoot)) {
    return configuredRoot;
  }

  let current = element.parentElement;
  while (current) {
    if (
      (current.matches(selector) || current.classList.contains("content-area")) &&
      isScrollableY(current)
    ) {
      return current;
    }
    current = current.parentElement;
  }

  const contentArea = element.closest<HTMLElement>(".content-area");
  return contentArea && isScrollableY(contentArea) ? contentArea : null;
}
