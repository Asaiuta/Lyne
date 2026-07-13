import { render } from "solid-js/web";
import { DesktopLyricApp } from "./DesktopLyricApp";

export function mountDesktopLyricWindow(target: HTMLElement): void {
  render(() => <DesktopLyricApp />, target);
}
