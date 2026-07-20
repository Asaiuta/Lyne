import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  untrack,
  type Component
} from "solid-js";
import { useTranslation } from "../../shared/i18n";
import { usePresenceTransition } from "../../shared/ui/usePresenceTransition";
import { IconClose, IconMenuFilled } from "../../components/icons";
import {
  SettingsCategoryNav,
  type SettingsCategoryKey
} from "./components/SettingsCategoryNav";
import { SettingsSearchBox } from "./components/SettingsSearchBox";
import { GeneralSection } from "./sections/GeneralSection";
import {
  APPEARANCE_MANAGER_MODAL_SELECTOR,
  hasVisibleSettingsFloatingSurface
} from "./settingsFloatingSurfaces";
import "../../shared/styles/modals/category-load-settings.css";

interface SettingsPageProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategoryKey;
}

interface SettingsSectionProps {
  highlightId: string | null;
}

type AudioEngineSectionProps = SettingsSectionProps;

const lazySettingsSection = <Props extends object>(
  loader: () => Promise<Component<Props>>
): Component<Props> => lazy(async () => ({ default: await loader() }));

const AppearanceSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/AppearanceSection").then((module) => module.AppearanceSection)
);
const PlaybackSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/PlaybackSection").then((module) => module.PlaybackSection)
);
const LyricsSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/LyricsSection").then((module) => module.LyricsSection)
);
const LocalSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/LocalSection").then((module) => module.LocalSection)
);
const KeyboardSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/KeyboardSection").then((module) => module.KeyboardSection)
);
const NetworkSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/NetworkSection").then((module) => module.NetworkSection)
);
const AudioEngineSection = lazySettingsSection<AudioEngineSectionProps>(() =>
  import("./sections/AudioEngineSection").then((module) => module.AudioEngineSection)
);
const PluginSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/PluginSection").then((module) => module.PluginSection)
);
const AboutSection = lazySettingsSection<SettingsSectionProps>(() =>
  import("./sections/AboutSection").then((module) => module.AboutSection)
);

const HIGHLIGHT_DURATION_MS = 2500;

const SETTINGS_CATEGORY_FADE_MS = 70;

const SETTINGS_MENU_FADE_MS = 100;

const SETTINGS_MOBILE_NAV_SLIDE_MS = 300;

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

const settingsModalMenuShellVisibleClass = "is-visible";

const settingsModalMenuShellClosingClass = "is-closing";

const settingsModalAsideFooterClass = "settings-modal-aside-footer";

const settingsModalAsideNameClass = "settings-modal-aside-name";

const settingsModalAsideVersionClass = "settings-modal-aside-version";

const settingsModalMainClass = "settings-modal-main";

const settingsModalContentClass = "settings-modal-content";

const settingsModalMobileScrimClass = "settings-modal-mobile-scrim";

const settingsCategoryPaneClass = "settings-category-pane";

const settingsCategoryPaneVisibleClass = "is-visible";

const settingsCategoryPaneLeavingClass = "is-leaving";

export function SettingsPage(props: SettingsPageProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = createSignal<SettingsCategoryKey>("general");
  const [highlightId, setHighlightId] = createSignal<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = createSignal(true);
  const [searchActive, setSearchActive] = createSignal(false);
  const [renderedCategory, setRenderedCategory] = createSignal<SettingsCategoryKey>("general");
  const [categoryContentVisible, setCategoryContentVisible] = createSignal<boolean>(true);
  const [categoryContentLeaving, setCategoryContentLeaving] = createSignal<boolean>(false);
  const presence = usePresenceTransition(() => props.isOpen);
  const mobileNavPresence = usePresenceTransition(mobileNavOpen, {
    durationMs: SETTINGS_MOBILE_NAV_SLIDE_MS
  });
  const menuPresence = usePresenceTransition(() => !searchActive(), {
    durationMs: SETTINGS_MENU_FADE_MS
  });
  let contentRef: HTMLDivElement | undefined;
  let highlightTimer: number | undefined;
  let highlightScrollTimer: number | undefined;
  let categoryTransitionTimer: number | undefined;
  let categoryEnterFrame: number | undefined;
  let appliedInitialCategory: SettingsCategoryKey | undefined;

  const clearCategoryTransition = () => {
    if (categoryTransitionTimer !== undefined) {
      window.clearTimeout(categoryTransitionTimer);
      categoryTransitionTimer = undefined;
    }
    if (categoryEnterFrame !== undefined) {
      window.cancelAnimationFrame(categoryEnterFrame);
      categoryEnterFrame = undefined;
    }
  };

  const clearHighlight = () => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer);
      highlightTimer = undefined;
    }
    if (highlightScrollTimer !== undefined) {
      window.clearTimeout(highlightScrollTimer);
      highlightScrollTimer = undefined;
    }
    setHighlightId(null);
  };

  onCleanup(() => {
    if (highlightTimer !== undefined) {
      window.clearTimeout(highlightTimer);
    }
    if (highlightScrollTimer !== undefined) {
      window.clearTimeout(highlightScrollTimer);
    }
    clearCategoryTransition();
  });

  const switchCategory = (key: SettingsCategoryKey) => {
    if (activeCategory() === key && renderedCategory() === key) return;

    clearCategoryTransition();
    setActiveCategory(key);

    if (renderedCategory() === key) {
      contentRef?.scrollTo({ top: 0 });
      setCategoryContentLeaving(false);
      setCategoryContentVisible(true);
      return;
    }

    setCategoryContentLeaving(true);
    setCategoryContentVisible(false);
    categoryTransitionTimer = window.setTimeout(() => {
      categoryTransitionTimer = undefined;
      setRenderedCategory(key);
      contentRef?.scrollTo({ top: 0 });
      setCategoryContentLeaving(false);
      categoryEnterFrame = window.requestAnimationFrame(() => {
        categoryEnterFrame = undefined;
        setCategoryContentVisible(true);
      });
    }, SETTINGS_CATEGORY_FADE_MS);
  };

  const categoryPaneClass = () => {
    const classes = [settingsCategoryPaneClass];
    if (categoryContentVisible() && !categoryContentLeaving()) {
      classes.push(settingsCategoryPaneVisibleClass);
    }
    if (categoryContentLeaving()) {
      classes.push(settingsCategoryPaneLeavingClass);
    }
    return classes.join(" ");
  };

  const mobileScrimClass = () =>
    `${settingsModalMobileScrimClass}${mobileNavPresence.visible() && !mobileNavPresence.closing() ? " is-open" : ""}${mobileNavPresence.closing() ? " is-closing" : ""}`;

  const mobileAsideClass = () =>
    `${settingsModalAsideClass}${mobileNavPresence.visible() && !mobileNavPresence.closing() ? " is-mobile-open" : ""}${mobileNavPresence.closing() ? " is-mobile-closing" : ""}`;

  const menuShellClass = () =>
    `${settingsModalMenuShellBaseClass}${menuPresence.visible() && !menuPresence.closing() ? ` ${settingsModalMenuShellVisibleClass}` : ""}${menuPresence.closing() ? ` ${settingsModalMenuShellClosingClass}` : ""}`;

  // Close on Escape, only when open.
  createEffect(() => {
    if (!props.isOpen) return;
    if (props.initialCategory) {
      const initialCategory = props.initialCategory;
      if (appliedInitialCategory !== initialCategory) {
        appliedInitialCategory = initialCategory;
        untrack(() => {
          clearHighlight();
          switchCategory(initialCategory);
        });
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (hasVisibleSettingsFloatingSurface([APPEARANCE_MANAGER_MODAL_SELECTOR])) return;
      props.onClose();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    onCleanup(() => window.removeEventListener("keydown", onKey, { capture: true }));
  });

  createEffect(() => {
    if (!props.isOpen) {
      appliedInitialCategory = undefined;
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
    switchCategory(key);
    setMobileNavOpen(false);
  };

  const handleSearchJump = (category: SettingsCategoryKey, itemId: string) => {
    const categoryWillChange = activeCategory() !== category || renderedCategory() !== category;
    clearHighlight();
    if (categoryWillChange) {
      switchCategory(category);
    }
    setMobileNavOpen(false);
    setHighlightId(itemId);
    highlightScrollTimer = window.setTimeout(
      () => {
        highlightScrollTimer = undefined;
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
      },
      categoryWillChange ? SETTINGS_CATEGORY_FADE_MS + 50 : 0
    );
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
          <Show when={mobileNavPresence.rendered()}>
            <div
              class={mobileScrimClass()}
              onClick={() => setMobileNavOpen(false)}
              aria-hidden="true"
            />
          </Show>
          <aside
            class={mobileAsideClass()}
            aria-label={t("settings.nav.title")}
          >
            <header class={settingsModalAsideHeaderClass}>
              <h1 class={settingsModalAsideTitleClass}>{t("settings.nav.title")}</h1>
              <span class={settingsModalAsideSubtitleClass}>{t("settings.nav.subtitle")}</span>
            </header>
            <div class={settingsModalAsideSearchClass}>
              <SettingsSearchBox onJump={handleSearchJump} onActiveChange={setSearchActive} />
            </div>
            <Show when={menuPresence.rendered()}>
              <div class={menuShellClass()}>
                <SettingsCategoryNav active={activeCategory()} onSelect={handleSelect} />
              </div>
            </Show>
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
                <IconMenuFilled />
              </button>
              <h1 class={settingsModalMobileTitleClass}>{t("settings.nav.title")}</h1>
              <span class={settingsModalMobileSubtitleClass}>{t("settings.nav.subtitle")}</span>
            </header>
            <div class={settingsModalContentClass} ref={contentRef}>
              <div class={categoryPaneClass()}>
                <Suspense fallback={null}>
                  <Switch>
                    <Match when={renderedCategory() === "general"}>
                      <GeneralSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "appearance"}>
                      <AppearanceSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "playback"}>
                      <PlaybackSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "lyrics"}>
                      <LyricsSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "local"}>
                      <LocalSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "keyboard"}>
                      <KeyboardSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "network"}>
                      <NetworkSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "audio-engine"}>
                      <AudioEngineSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "plugins"}>
                      <PluginSection highlightId={highlightId()} />
                    </Match>
                    <Match when={renderedCategory() === "about"}>
                      <AboutSection highlightId={highlightId()} />
                    </Match>
                  </Switch>
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
