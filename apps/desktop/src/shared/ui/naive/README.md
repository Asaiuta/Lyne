# Naive Facade Package

This directory is the local package boundary for SPlayer/NaiveUI-compatible UI facades.

## Public Entry Points

- `index.ts` exports components and types. Heavy route-specific facade internals may be reached through a public lightweight proxy so startup imports do not absorb the full interaction shell.
- `styles.css` exports the base CSS contract for the facades.
- App code should import components from `../shared/ui/naive`.
- App startup currently imports CSS through `src/shared/styles/components/naive.css`, which is a compatibility shim to this directory.

## Implementation Route

- Display-only primitives are handwritten facades: `NaiveAlert`, `NaiveAnchor`, `NaiveButton`, `NaiveAvatar`, `NaiveBadge`, `NaiveDivider`, `NaiveEllipsis`, `NaiveH1`, `NaiveH2`, `NaiveH3`, `NaiveLi`, `NaiveOl`, `NaiveP`, `NaiveText`, `NaiveEmpty`, `NaiveProgress`, `NaiveResult`, `NaiveSkeleton`, `NaiveSpin`, `NaiveTag`.
- Layout/surface/list primitives stay thin and handwritten: `NaiveFlex`, `NaiveGrid`, `NaiveGridItem` / `NaiveGi`, `NaiveCard`, `NaiveList`, `NaiveListItem`, `NaiveThing`, `NaiveScrollbar`.
- Complex interaction primitives can wrap Kobalte behind lazy files. Keep those wrappers out of startup-critical imports. `NaivePopselect`, `NaiveTabs`, `NaiveSwitch`, `NaiveInput`, and `NaiveSelect` are the first package-level examples.
- Visual parity belongs in CSS/tokens. Facade props should model behavior and state, not encode one-off page styling.
- Kobalte DOM semantics are trusted as-is. When Kobalte and NaiveUI disagree on root roles or element shape, keep Kobalte's structure and place NaiveUI class/state hooks on the visible shell/control so UnoCSS, tokens, and CSS can recreate the NaiveUI visuals.
- SPlayer source remains the reference for component semantics. Update `component-inventory.md` when a new NaiveUI surface is audited or migrated.

## Source-Backed Components

- `NaiveTabs` follows SPlayer's `naive-ui@2.43.2` `NTabs` / `NTab` segment branch: `n-tabs`, `n-tabs-nav`, `n-tabs-rail`, `n-tabs-capsule`, `n-tabs-wrapper`, `n-tabs-tab-wrapper`, `n-tabs-tab`, and `n-tabs-tab__label` class hooks are part of the package contract.
- The segment capsule measures the active tab and moves with `translateX`, matching NaiveUI's active-capsule behavior. Page-specific widths and rail outlines should target NaiveUI classes like `.n-tabs` and `.n-tabs-rail`, as SPlayer does.
- Reference files for the current Tabs pass: `D:\AI\SPlayer\src\views\Download\layout.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\tabs\src\Tabs.mjs`, `Tab.mjs`, `styles\index.cssr.mjs`, `styles\_common.mjs`, and `styles\light.mjs`.
- `NaiveSwitch` follows SPlayer's `NSwitch` usage and NaiveUI 2.43.2's `Switch.mjs` visual/state contract: `.n-switch` contains `.n-switch__rail`, `.n-switch__button`, optional content/icon hooks, and active/disabled/round/loading/pressed/rubber-band modifiers. It is Kobalte-backed: Kobalte keeps its `Switch.Root role="group"` plus hidden `Switch.Input role="switch"` structure, while the visible `Switch.Control` carries the NaiveUI class hooks for CSS/UnoCSS-driven visual parity.
- Reference files for the current Switch pass: `D:\AI\SPlayer\src\components\Setting\SettingItemRenderer.vue`, `D:\AI\SPlayer\src\components\Modal\CreatePlaylist.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\switch\src\Switch.mjs`, `src\styles\index.cssr.mjs`, `styles\_common.mjs`, and `styles\light.mjs`.
- `NaiveInput` follows SPlayer's high-frequency `NInput` usage in settings search, search input, local-library search, the `s-input` wrapper, and textarea custom-code editing. The package contract includes `.n-input`, `.n-input-wrapper`, `.n-input__input`, `.n-input__input-el`, `.n-input__textarea`, `.n-input__textarea-el`, `.n-input__placeholder`, `.n-input__prefix`, `.n-input__suffix`, `.n-input__border`, `.n-input__state-border`, clear/loading hooks, and focus/disabled/textarea/round/status modifiers.
- The current `NaiveInput` scope covers controlled text/search/password/email/url/tel inputs, textarea, clearable, prefix/suffix, disabled/readonly, sizes, warning/error status, round, and basic autosize. It intentionally leaves pair mode, password reveal controls, `NInputGroup`, and `NInputNumber` for later focused passes.
- Reference files for the current Input pass: `D:\AI\SPlayer\src\components\Setting\SettingSearch.vue`, `D:\AI\SPlayer\src\components\Search\SearchInp.vue`, `D:\AI\SPlayer\src\components\UI\s-input.vue`, `D:\AI\SPlayer\src\components\Modal\Setting\CustomCode.vue`, `D:\AI\SPlayer\src\views\Local\layout.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\input\src\Input.mjs`, `src\styles\input.cssr.mjs`, `styles\_common.mjs`, and `styles\light.mjs`.
- `NaiveSelect` follows SPlayer's `NSelect` usage in settings, create/update playlist modals, theme config, login country selection, font manager, local view controls, and streaming layout. The public `select.tsx` entry stays a startup-light `lazy()` proxy; `select-core.tsx` owns the shared NaiveUI class/shell helpers used by the lazy Kobalte implementation. The package contract includes `.n-select`, `.n-base-selection`, `.n-base-selection-label`, `.n-base-selection-input`, placeholder/overlay hooks, suffix/clear/loading hooks, border/state-border hooks, `.n-select-menu`, `.n-base-select-menu`, `.n-base-select-option`, option content/check hooks, and active/focus/disabled/status/selected modifiers.
- Plain single selects use Kobalte `Select`; filterable single selects use Kobalte `Combobox`, because NaiveUI's `filterable` path owns actual input filtering. Kobalte root semantics are preserved as-is, including roots such as `role="group"` when Kobalte emits them; NaiveUI class hooks live on the visible selection shell/menu so UnoCSS, tokens, and CSS recreate the visuals without forcing NaiveUI DOM roles.
- The current `NaiveSelect` scope covers single select, disabled/readonly, clearable, loading, size/status, bordered/unbordered, placement, renderLabel/renderOption, and filterable single select. Multiple/tag select behavior is intentionally deferred for a focused pass.
- Reference files for the current Select pass: `D:\AI\SPlayer\src\components\Setting\SettingItemRenderer.vue`, `D:\AI\SPlayer\src\components\Modal\UpdatePlaylist.vue`, `D:\AI\SPlayer\src\components\Modal\ThemeConfig.vue`, `D:\AI\SPlayer\src\components\Modal\CreatePlaylist.vue`, `D:\AI\SPlayer\src\components\Modal\Login\LoginPhone.vue`, `D:\AI\SPlayer\src\components\Modal\Setting\FontManager.vue`, `D:\AI\SPlayer\src\components\Modal\Setting\StreamingServerConfig.vue`, `D:\AI\SPlayer\src\views\Streaming\layout.vue`, `D:\AI\SPlayer\src\views\Local\layout.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\select\src\Select.mjs`, `_internal\selection\src\styles\index.cssr.mjs`, and `_internal\select-menu\src\styles\index.cssr.mjs`.
- `NaiveGrid` / `NaiveGridItem` / `NaiveGi` follow SPlayer's `NGrid` / `NGi` usage in playlist footer actions, toplists, song wiki info cards, radio categories, and copy-song-info forms. The facade keeps NaiveUI's `n-grid` class and inline CSS grid contract: `grid-template-columns: repeat(cols, minmax(0, 1fr))`, `column-gap`, `row-gap`, item `grid-column`, offset margin math, responsive `cols` strings such as `1 600:2 1000:3` / `1 s:2 m:3`, and the collapsed suffix item overflow signal used by SPlayer radio categories.
- Reference files for the current Grid pass: `D:\AI\SPlayer\src\components\List\SongPlayList.vue`, `D:\AI\SPlayer\src\views\Discover\toplists.vue`, `D:\AI\SPlayer\src\views\Radio\hot.vue`, `D:\AI\SPlayer\src\components\Modal\CopySongInfo.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\grid\src\Grid.mjs`, `GridItem.mjs`, and `config.mjs`.
- `NaivePopover` follows SPlayer's `NPopover` usage in `PlayerMeta/PlayerData.vue` (`trigger="hover"` + `raw`), `Setting/components/ShortcutRecorder.vue` (`trigger="focus"`), and `Player/PlayerLyric/index.vue` (`trigger="click"` with controlled `:show`). The public `popover.tsx` entry is a startup-light `lazy()` proxy; the lazy implementation wraps Kobalte's `Popover` primitive (`Root` / `Trigger` / `Anchor` / `Portal` / `Content` / `Arrow`). The package contract keeps NaiveUI class hooks (`n-popover`, `n-popover-shared`, `n-popover__content`, `n-popover__arrow`, `n-popover-shared--raw`, `n-popover-shared--show-arrow`), plus `triggerMode` covering `click` / `hover` / `focus` / `manual`, `raw`, `showArrow`, `placement`, `gutter`, `to` (teleport target), `getAnchorRect` for virtual anchoring, and controlled `open` / `onOpenChange`.
- Reference files for the current Popover pass: `D:\AI\SPlayer\src\components\Player\PlayerMeta\PlayerData.vue`, `D:\AI\SPlayer\src\components\Setting\components\ShortcutRecorder.vue`, `D:\AI\SPlayer\src\components\Player\PlayerLyric\index.vue`, `D:\AI\SPlayer\node_modules\naive-ui\es\popover\src\Popover.mjs`, and `src\styles\index.cssr.mjs`.

## Existing Probe Assets

Reusable browser probes already live under `output/playwright/`. Treat these as validation entry points when a migrated facade affects the same surface:

- Shell/sidebar: `shell_probe.mjs`, `shell_splayer_a_real_probe.mjs`, `sidebar_compare.py`, `sidebar_interaction_compare.py`.
- Player surfaces: `playerbar_probe.mjs`, `fullplayer_probe.mjs`, `fullplayer_mobile_probe.mjs`.
- Media/content surfaces: `context_menu_probe.mjs`, `media_list_probe.mjs`, `media_sort_probe.mjs`, `queue_drawer_probe.mjs`.
- Route/page surfaces: `home_discover_probe.mjs`, `discover_b_probe.mjs`, `recommend_b_probe.mjs`, `radio_b_probe.mjs`, `library_b_probe.mjs`, `settings_search_probe.mjs`, `login_modal_probe.mjs`.

## Current Guardrails

- Do not import `@kobalte/core` from `index.ts`, `button.tsx`, `display.tsx`, `dropdown.tsx`, `feedback.tsx`, `grid.tsx`, `grid-logic.ts`, `input.tsx`, `layout.tsx`, `list.tsx`, `popover.tsx`, `popselect.tsx`, `select.tsx`, `select-core.tsx`, `sidebar.tsx`, `switch.tsx`, `tabs.tsx`, or `typography.tsx`.
- Keep lazy Kobalte wrappers in dedicated files such as `NaivePopselectKobalte.tsx`, `NaivePopoverKobalte.tsx`, `NaiveDropdownKobalte.tsx`, `NaiveTabsKobalte.tsx`, `NaiveSwitchKobalte.tsx`, `NaiveInputKobalte.tsx`, and `NaiveSelectKobalte.tsx`.
- Keep page or shell-specific wrappers thin: pass class slots and render slots into package-level facades instead of owning generic interaction logic.
- Keep call sites on the public `index.ts` export so future extraction does not require broad import rewrites.
- Run `npm run typecheck` and `npm run build:measure` after package-boundary changes.
