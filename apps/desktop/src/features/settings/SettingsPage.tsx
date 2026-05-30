import { Match, Show, Switch, createEffect, createSignal, onCleanup } from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { usePresenceTransition } from "../../shared/ui/usePresenceTransition";
import { IconClose, IconSPlayerMenu } from "../../components/icons";
import {
  SettingsCategoryNav,
  type SettingsCategoryKey
} from "./components/SettingsCategoryNav";
import { SettingsSearchBox } from "./components/SettingsSearchBox";
import { GeneralSection } from "./sections/GeneralSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { PlaybackSection } from "./sections/PlaybackSection";
import { LyricsSection } from "./sections/LyricsSection";
import { AudioEngineSection } from "./sections/AudioEngineSection";
import { LocalSection } from "./sections/LocalSection";
import { KeyboardSection } from "./sections/KeyboardSection";
import { NetworkSection } from "./sections/NetworkSection";
import { AboutSection } from "./sections/AboutSection";
import "../../shared/styles/modals/category-load-settings.css";

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
  onStateRefresh: () => Promise<void>;
  initialCategory?: SettingsCategoryKey;
}

const HIGHLIGHT_DURATION_MS = 2500;

const settingsModalClass = "settings-modal";

const settingsModalCardClass = "settings-modal-card";

const settingsModalCloseClass = "settings-modal-close";

const settingsModalAsideClass = "settings-modal-aside";

const settingsModalMobileHeaderClass = "settings-modal-mobile-header";

const settingsModalMobileMenuClass = "settings-modal-mobile-menu";

const settingsModalMobileTitleClass = "settings-modal-mobile-title";

const settingsModalMobileSubtitleClass = "settings-modal-mobile-subtitle";

const settingsModalAsideHeaderClass = "settings-modal-aside-header";

const settingsModalAsideTitleClass = "settings-modal-aside-title";

const settingsModalAsideSubtitleClass = "settings-modal-aside-subtitle";

const settingsModalAsideSearchClass = "settings-modal-aside-search";

const settingsModalMenuShellBaseClass = "settings-modal-menu-shell";

const settingsModalMenuShellHiddenClass = "is-search-active";

const settingsModalAsideFooterClass = "settings-modal-aside-footer";

const settingsModalAsideNameClass = "settings-modal-aside-name";

const settingsModalAsideVersionClass = "settings-modal-aside-version";

const settingsModalMainClass = "settings-modal-main";

const settingsModalContentClass = "settings-modal-content";

const SETTINGS_FLOATING_SURFACE_SELECTOR = [
  ".naive-select-menu.n-base-select-menu",
  ".n-popselect-menu.n-base-select-menu",
  ".n-dropdown.n-dropdown-menu",
  ".n-popover.n-popover-shared",
  ".n-dialog-mask",
  ".n-modal-mask"
].join(",");

const hasVisibleFloatingSurface = (): boolean =>
  Array.from(document.querySelectorAll<HTMLElement>(SETTINGS_FLOATING_SURFACE_SELECTOR)).some(
    (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    }
  );

export function SettingsPage(props: SettingsPageProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = createSignal<SettingsCategoryKey>("general");
  const [highlightId, setHighlightId] = createSignal<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = createSignal(true);
  const [searchActive, setSearchActive] = createSignal(false);
  const presence = usePresenceTransition(() => props.isOpen);
  let contentRef: HTMLDivElement | undefined;
  let highlightTimer: number | undefined;

  const clearHighlight = () => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer);
      highlightTimer = undefined;
    }
    setHighlightId(null);
  };

  onCleanup(() => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer);
    }
  });

  // Close on Escape, only when open.
  createEffect(() => {
    if (!props.isOpen) return;
    if (props.initialCategory) {
      clearHighlight();
      setActiveCategory(props.initialCategory);
      contentRef?.scrollTo({ top: 0 });
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hasVisibleFloatingSurface()) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  createEffect(() => {
    if (!props.isOpen) {
      setMobileNavOpen(true);
      setSearchActive(false);
    }
  });

  const handleSelect = (key: SettingsCategoryKey) => {
    if (activeCategory() === key) {
      setMobileNavOpen(false);
      return;
    }
    clearHighlight();
    setActiveCategory(key);
    setMobileNavOpen(false);
    contentRef?.scrollTo({ top: 0 });
  };

  const handleSearchJump = (category: SettingsCategoryKey, itemId: string) => {
    if (activeCategory() !== category) {
      setActiveCategory(category);
    }
    setMobileNavOpen(false);
    setHighlightId(itemId);
    window.requestAnimationFrame(() => {
      const el = document.getElementById(`setting-${itemId}`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      if (highlightTimer !== undefined) window.clearTimeout(highlightTimer);
      highlightTimer = window.setTimeout(() => {
        setHighlightId(null);
        highlightTimer = undefined;
      }, HIGHLIGHT_DURATION_MS);
    });
  };

  const handleBackdropClick = (event: MouseEvent) => {
    if (props.isOpen && event.target === event.currentTarget) props.onClose();
  };

  return (
    <Show when={presence.rendered()}>
      <div
        class={`${settingsModalClass}${presence.visible() && !presence.closing() ? " is-open" : ""}${presence.closing() ? " is-closing" : ""}`}
        role="dialog"
        aria-label={t("settings.nav.title")}
        aria-modal="true"
        onClick={handleBackdropClick}
      >
        <div class={settingsModalCardClass}>
          <button
            type="button"
            class={settingsModalCloseClass}
            onClick={props.onClose}
            aria-label={t("fullPlayer.aria.close")}
            title={t("fullPlayer.aria.close")}
          >
            <IconClose />
          </button>
          <Show when={mobileNavOpen()}>
            <div
              class="settings-modal-mobile-scrim"
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
          </Show>
          <aside
            class={`${settingsModalAsideClass}${mobileNavOpen() ? " is-mobile-open" : ""}`}
            aria-label={t("settings.nav.title")}
          >
            <header class={settingsModalAsideHeaderClass}>
              <h1 class={settingsModalAsideTitleClass}>{t("settings.nav.title")}</h1>
              <span class={settingsModalAsideSubtitleClass}>{t("settings.nav.subtitle")}</span>
            </header>
            <div class={settingsModalAsideSearchClass}>
              <SettingsSearchBox onJump={handleSearchJump} onActiveChange={setSearchActive} />
            </div>
            <div
              class={`${settingsModalMenuShellBaseClass}${searchActive() ? ` ${settingsModalMenuShellHiddenClass}` : ""}`}
            >
              <SettingsCategoryNav active={activeCategory()} onSelect={handleSelect} />
            </div>
            <footer class={settingsModalAsideFooterClass}>
              <span class={settingsModalAsideNameClass}>Lyne</span>
              <span class={settingsModalAsideVersionClass}>v0.1.0</span>
            </footer>
          </aside>
          <div class={settingsModalMainClass}>
            <header class={settingsModalMobileHeaderClass}>
              <button
                type="button"
                class={settingsModalMobileMenuClass}
                onClick={() => setMobileNavOpen(!mobileNavOpen())}
                aria-label={t("settings.nav.title")}
                aria-expanded={mobileNavOpen()}
              >
                <IconSPlayerMenu />
              </button>
              <h1 class={settingsModalMobileTitleClass}>{t("settings.nav.title")}</h1>
              <span class={settingsModalMobileSubtitleClass}>{t("settings.nav.subtitle")}</span>
            </header>
            <div class={settingsModalContentClass} ref={contentRef}>
              <Switch>
                <Match when={activeCategory() === "general"}>
                  <GeneralSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "appearance"}>
                  <AppearanceSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "playback"}>
                  <PlaybackSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "lyrics"}>
                  <LyricsSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "local"}>
                  <LocalSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "keyboard"}>
                  <KeyboardSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "network"}>
                  <NetworkSection highlightId={highlightId()} />
                </Match>
                <Match when={activeCategory() === "audio-engine"}>
                  <AudioEngineSection
                    highlightId={highlightId()}
                    onStateRefresh={props.onStateRefresh}
                  />
                </Match>
                <Match when={activeCategory() === "about"}>
                  <AboutSection highlightId={highlightId()} />
                </Match>
              </Switch>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
