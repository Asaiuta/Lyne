# SPlayer Naive UI Inventory

Source snapshot: `D:\AI\SPlayer`, inspected on 2026-05-26.

This package is an app-local facade layer for SPlayer/NaiveUI parity. The route is:

- Simple display components stay handwritten facades.
- Complex interaction components are gradually backed by Kobalte.
- UnoCSS, tokens, and component CSS own the visual parity.
- Public imports should go through `src/shared/ui/naive/index.ts`.

## Current Package Boundary

| AudioPlayer facade | SPlayer source | Implementation route | Status |
| --- | --- | --- | --- |
| `NaiveButton` | `NButton` | handwritten semantic facade, CSS owns visual variants | initial |
| `NaiveAlert` | `NAlert` | handwritten display facade, no provider behavior | initial |
| `NaiveFlex` | `NFlex` | handwritten layout facade; keep layout-specific classes at call sites | initial |
| `NaiveGrid` / `NaiveGridItem` / `NaiveGi` | `NGrid` / `NGi` | handwritten source-backed CSS grid facade with NaiveUI responsive cols/gaps, item span/offset, collapsed suffix overflow signal | source-backed |
| `NaiveCard` | `NCard` | handwritten surface facade; CSS/tokens own the visual shell | initial |
| `NaiveList` | `NList` | handwritten list container facade; CSS owns hover/border visuals | initial |
| `NaiveListItem` | `NListItem` | handwritten list row facade with prefix/main/suffix slots | initial |
| `NaiveThing` | `NThing` | handwritten title/description display facade | initial |
| `NaiveScrollbar` | `NScrollbar` | handwritten native scroll container facade with Naive-compatible class hooks | initial |
| `SidebarNavButton` | `NMenu` menu option rendering | handwritten facade plus shell CSS | implemented for Sidebar |
| `SidebarIconButton` | `NButton` in menu actions | shell-specific wrapper over `NaiveButton` plus shell CSS | implemented for Sidebar |
| `SidebarPlaylistItem` | `NAvatar` + `NEllipsis` playlist labels | handwritten facade using display primitives | implemented for Sidebar |
| `NaivePopselect` | `NPopselect` | package-level facade with first-open fallback plus lazy Kobalte `DropdownMenu` implementation | initial |
| `NaivePopover` | `NPopover` | package-level facade with startup-light `lazy()` proxy plus lazy Kobalte `Popover` implementation; supports `click` / `hover` / `focus` / `manual` triggers, `raw`, `showArrow`, `placement`, `gutter`, `to`, `getAnchorRect`, and controlled `open` / `onOpenChange` | source-backed |
| `SidebarPopselect` | `NPopselect` source selector | thin Sidebar wrapper over `NaivePopselect` with shell class slots | implemented for Sidebar |
| `NaiveTabs` | `NTabs` / `NTab` / `NTabPane` | source-backed NaiveUI 2.43.2 tablist facade with lightweight fallback plus lazy Kobalte `Tabs`; segment type uses `n-tabs-rail` / moving `n-tabs-capsule` | source-backed segment |
| `NaiveSwitch` | `NSwitch` | source-backed NaiveUI 2.43.2 state/class facade with lightweight fallback plus lazy Kobalte `Switch`; Kobalte DOM semantics are preserved and `.n-switch` visuals live on the visible control | source-backed |
| `NaiveInput` | `NInput` | source-backed NaiveUI 2.43.2 form-control facade with lightweight fallback plus lazy Kobalte `TextField`; Kobalte DOM semantics are preserved and `.n-input` visuals live on the visible shell | source-backed |
| `NaiveSelect` | `NSelect` | source-backed NaiveUI 2.43.2 selection/menu facade with a startup-light `lazy()` public proxy plus lazy Kobalte `Select`/`Combobox`; Kobalte DOM semantics are preserved and `.n-select` / `.n-base-selection` / `.n-base-select-menu` visuals live on the visible shell/menu | source-backed single/filterable |
| `NaiveAvatar` | `NAvatar` | handwritten display facade | initial |
| `NaiveBadge` | `NBadge` | handwritten display facade | initial |
| `NaiveDivider` | `NDivider` | handwritten display facade | initial |
| `NaiveEllipsis` | `NEllipsis` | handwritten display facade | initial |
| `NaiveText` | `NText` | handwritten display facade | initial |
| `NaiveH1` | `NH1` | handwritten typography facade, supports `prefix="bar"` | initial |
| `NaiveH2` | `NH2` | handwritten typography facade, supports `prefix="bar"` | initial |
| `NaiveH3` | `NH3` | handwritten typography facade, supports `prefix="bar"` | initial |
| `NaiveP` | `NP` | handwritten paragraph facade | initial |
| `NaiveOl` | `NOl` | handwritten ordered-list facade | initial |
| `NaiveLi` | `NLi` | handwritten list-item facade | initial |
| `NaiveAnchor` | `NA` | handwritten native anchor facade with safe blank-target rel default | initial |
| `NaiveEmpty` | `NEmpty` | handwritten display facade, app wrapper owns i18n default text | initial |
| `NaiveProgress` | `NProgress` | handwritten display facade for line progress | initial |
| `NaiveResult` | `NResult` | handwritten display facade for status pages and error states | initial |
| `NaiveSkeleton` | `NSkeleton` | handwritten display facade, existing list/grid wrappers compose it | initial |
| `NaiveSpin` | `NSpin` | handwritten CSS spinner facade, no app icon dependency | initial |
| `NaiveTag` | `NTag` | handwritten display facade, existing media-row classes remain visual source | initial |

## Sidebar Reference

`D:\AI\SPlayer\src\components\Layout\Menu.vue` imports `NMenu`, `NAvatar`, `NBadge`, `NButton`, `NEllipsis`, `NText`, and `NPopselect`.

The created-playlist source selector uses `NPopselect` with:

- `online`: `在线歌单`
- `local`: `本地歌单`

Playlist rows use `NAvatar` plus `NEllipsis` when covers are visible, and icon plus `NEllipsis` when covers are hidden.

Existing browser probe assets are under `output/playwright/`:

- `sidebar_interaction_compare.py`
- `sidebar-interaction-results.json`
- `sidebar-interaction-audioplayer-source-menu.png`
- `sidebar-interaction-splayer-source-menu.png`

The latest recorded source-menu geometry matched the reference:

| Surface | Trigger | Popover | Options | Selected |
| --- | --- | --- | --- | --- |
| SPlayer | `99.109375,387.984375,36x22` | `67,420,100x76` | 2 | `在线歌单` |
| AudioPlayer | `99.109375,388,36x22` | `67,420,100x76` | 2 | `在线歌单` |

## Actual SPlayer Usage

`components.d.ts` is generated by `unplugin-vue-components` with `NaiveUiResolver`, so it lists every auto-resolved component seen by the app. The table below is filtered by actual source usage in `src/**/*.vue`, `src/**/*.ts`, and `src/**/*.tsx`.

Current tag-occurrence refresh, counted from `D:\AI\SPlayer\src` with `rg --no-filename -o "<n-[a-z0-9-]+" ... | Group-Object` on 2026-05-26:

| Rank | Component | Tag occurrences | Route |
| ---: | --- | ---: | --- |
| 1 | `NText` | 309 | keep migrating text-only spans to `NaiveText` when page classes own layout |
| 2 | `NFlex` | 195 | use `NaiveFlex` only where it simplifies repeated layout stacks |
| 3 | `NButton` | 155 | keep handwritten button facade plus page/shell classes |
| 4 | `NCard` | 66 | handwritten surface facade; avoid nested-card visual churn |
| 5 | `NTag` | 47 | handwritten display facade, but keep interactive filter buttons as buttons |
| 6 | `NInput` | 44 | `NaiveInput` source-backed/Kobalte facade; migrate high-frequency search/form fields first |
| 7 | `NScrollbar` | 34 | CSS/browser scrollbar first |
| 8 | `NTab` | 33 | `NaiveTabs` source-backed/Kobalte facade; migrate focused tab strips first |
| 9 | `NH3` | 31 | handwritten typography facade; `prefix="bar"` supported |
| 10 | `NFormItem` | 30 | defer with form-control registry |
| 11 | `NLi` | 28 | handwritten native list facade |
| 12 | `NEmpty` | 25 | handwritten display facade |
| 13 | `NSkeleton` | 23 | handwritten display facade |
| 14 | `NInputNumber` / `NImage` | 20 each | defer numeric controls; route image work through `SImage`/preview contract |
| 15 | `NSwitch` | 19 | `NaiveSwitch` source-backed/Kobalte facade |

| Component | Source-file count | Migration bucket |
| --- | ---: | --- |
| `NText` | 75 | handwritten display facade |
| `NFlex` | 62 | `NaiveFlex` initial facade; migrate repeated layout stacks without changing page class contracts |
| `NButton` | 61 | `NaiveButton` facade first; shell/page wrappers can layer visual classes |
| `NCard` | 35 | `NaiveCard` initial facade; page-specific cards can keep their local visual classes |
| `NScrollbar` | 31 | CSS/browser scrollbar first; structured facade only if behavior diverges |
| `NEmpty` | 24 | `NaiveEmpty` handwritten display facade |
| `NTag` | 22 | `NaiveTag` handwritten display facade |
| `NInput` | 18 | `NaiveInput` source-backed/Kobalte facade |
| `NSwitch` | 15 | `NaiveSwitch` source-backed/Kobalte facade |
| `NTabs` | 14 | `NaiveTabs` source-backed/Kobalte facade |
| `NDropdown` | 13 | Kobalte candidate |
| `NImage` | 13 | existing `SImage` route; do not duplicate without preview contract |
| `NSkeleton` | 13 | `NaiveSkeleton` handwritten display facade |
| `NAlert` | 11 | `NaiveAlert` handwritten display facade |
| `NInputNumber` | 11 | Kobalte/form-control candidate or custom numeric control |
| `NCollapseTransition` | 10 | CSS transition primitive |
| `NDivider` | 10 | `NaiveDivider` handwritten display facade |
| `NSelect` | 10 | `NaiveSelect` source-backed/Kobalte facade; single/filterable now, multiple/tag deferred |
| `NH3` | 9 | `NaiveH3` handwritten typography facade |
| `NTab` | 9 | `NaiveTabs` source-backed/Kobalte facade |
| `NPopover` | 8 | Kobalte popover candidate |
| `NForm` | 7 | form facade once validation/runtime contract is needed |
| `NFormItem` | 7 | form facade once validation/runtime contract is needed |
| `NGrid` | 6 | `NaiveGrid` source-backed handwritten layout facade |
| `NNumberAnimation` | 6 | custom display/animation primitive candidate |
| `NSlider` | 6 | Kobalte/custom range candidate |
| `NA` | 5 | `NaiveAnchor` handwritten native anchor facade |
| `NAvatar` | 5 | handwritten display facade |
| `NH1` | 5 | `NaiveH1` handwritten typography facade |
| `NCollapse` | 4 | Kobalte disclosure/collapsible candidate |
| `NCollapseItem` | 4 | Kobalte disclosure/collapsible candidate |
| `NFormItemGi` | 4 | CSS/grid plus form facade |
| `NInputGroup` | 4 | CSS/layout only unless behavior appears |
| `NPopconfirm` | 4 | Kobalte popover/dialog candidate |
| `NEllipsis` | 4 | handwritten display facade |
| `NBadge` | 3 | handwritten display facade |
| `NConfigProvider` | 3 | tokens/provider decision, not component facade |
| `NDrawer` | 3 | Kobalte/dialog candidate |
| `NDrawerContent` | 3 | Kobalte/dialog candidate |
| `NList` | 3 | `NaiveList` handwritten list container facade |
| `NListItem` | 3 | `NaiveListItem` handwritten list row facade |
| `NMenu` | 3 | structured facade; Sidebar is first implementation |
| `NPopselect` | 3 | `NaivePopselect` facade; Kobalte-backed interaction, CSS/tokens for visual parity |
| `NResult` | 3 | `NaiveResult` handwritten display facade |
| `NSpin` | 3 | `NaiveSpin` handwritten display facade |
| `NCheckbox` | 3 | Kobalte/form-control candidate |
| `NColorPicker` | 2 | feature-specific custom/Kobalte candidate |
| `NDynamicTags` | 2 | Kobalte/custom tag input candidate |
| `NH2` | 3 | `NaiveH2` handwritten typography facade |
| `NIcon` | 2 | local icon contract; no Naive dependency |
| `NModal` | 2 | existing modal route, Kobalte dialog candidate later |
| `NProgress` | 2 | `NaiveProgress` handwritten line progress facade |
| `NRadio` | 2 | Kobalte/form-control candidate |
| `NRadioGroup` | 2 | Kobalte/form-control candidate |
| `NTabPane` | 6 | `NaiveTabs` facade covers tablist semantics; panel ownership remains at call sites until full tab-panel migration is needed |
| `NThing` | 2 | `NaiveThing` handwritten title/description facade |
| `NBackTop` | 1 | page utility candidate |
| `NCheckboxGroup` | 1 | Kobalte/form-control candidate |
| `NDataTable` | 1 | feature-specific table, not early package primitive |
| `NDialogProvider` | 1 | feedback provider, future app service |
| `NFloatButton` | 1 | page utility candidate |
| `NFloatButtonGroup` | 1 | page utility candidate |
| `NGi` | 4 | `NaiveGridItem` / `NaiveGi` source-backed handwritten layout facade |
| `NGlobalStyle` | 1 | tokens/provider decision |
| `NImageGroup` | 1 | `SImage` preview/lightbox route |
| `NLayout` | 1 | app shell CSS only |
| `NLayoutHeader` | 1 | app shell CSS only |
| `NLayoutSider` | 1 | app shell CSS only |
| `NLi` | 1 | `NaiveLi` handwritten native list facade |
| `NLoadingBarProvider` | 1 | feedback provider, future app service |
| `NMessageProvider` | 1 | feedback provider, future app service |
| `NModalProvider` | 1 | feedback provider, future app service |
| `NNotificationProvider` | 1 | feedback provider, future app service |
| `NOl` | 1 | `NaiveOl` handwritten native list facade |
| `NP` | 1 | `NaiveP` handwritten paragraph facade |
| `NQrCode` | 1 | feature-specific QR component |
| `NTree` | 1 | Kobalte/custom tree candidate |

## Migration Rules

- Do not import Kobalte at the top level of startup-critical modules unless the component is always visible at startup.
- Keep Kobalte wrappers in lazy component files, like `NaivePopselectKobalte.tsx`, when the interaction is first-open or route-specific.
- Keep route-specific public exports startup-light. If a facade is reached through `index.ts` from lazy pages only, its public entry may `lazy()` import the heavier Kobalte-backed implementation while shared class helpers live in a non-Kobalte core module.
- Shell wrappers such as `SidebarPopselect` should stay thin and pass class slots/render slots into package-level facades.
- Keep simple display facades small and DOM-stable. The class contract should remain owned by CSS and tokens.
- Add package exports before adding new call sites. Future extraction should not require rewriting every consumer import.
- Validate interaction migrations with a browser probe when focus, outside click, Escape, placement, or animation behavior changes.
- Keep the local package's own CSS in `src/shared/ui/naive/styles.css`; app-level style bundles may import it through compatibility shims.

## Migration Log

- 2026-05-26: Added `NaiveSelect` against SPlayer `SettingItemRenderer.vue`, playlist/theme/login/font/streaming/local select usage, and NaiveUI 2.43.2 `Select.mjs` plus internal selection/select-menu styles. The public facade keeps NaiveUI class hooks (`n-select`, `n-base-selection`, label/input/placeholder/suffix/clear/loading/border/state-border, `n-base-select-menu`, option content/check/state modifiers), while the lazy implementation preserves Kobalte `Select`/`Combobox` root semantics and lets CSS/tokens recreate the visual shell; settings `SelectSettingItem` now consumes the package-level select facade. The public `select.tsx` entry is intentionally a startup-light `lazy()` proxy, with shared visual helpers in `select-core.tsx`. Multiple/tag select remains deferred.
- 2026-05-26: Added `NaiveGrid`, `NaiveGridItem`, and `NaiveGi` against SPlayer playlist footer, toplists, radio categories, copy-song-info forms, and NaiveUI 2.43.2 `Grid.mjs` / `GridItem.mjs`. The facade keeps the `n-grid` / `n-gi` class hooks plus NaiveUI's inline grid contract for responsive cols/gaps, item span/offset, collapsed rows, and suffix overflow state; no Kobalte wrapper is needed because this is pure layout.
- 2026-05-26: Added `NaiveInput` against SPlayer `SettingSearch.vue`, `SearchInp.vue`, `UI\s-input.vue`, `Modal\Setting\CustomCode.vue`, `Local\layout.vue`, and NaiveUI 2.43.2 `Input.mjs` / `styles/input.cssr.mjs`. The public facade keeps NaiveUI class hooks (`n-input`, wrapper/input/textarea/placeholder/prefix/suffix/border/state-border, clear/loading/status modifiers), while the lazy implementation preserves Kobalte `TextField` semantics and lets CSS/tokens recreate the visual shell; `SettingsSearchBox` is the first representative migration.
- 2026-05-26: Added `NaiveSwitch` against SPlayer `SettingItemRenderer.vue` / `CreatePlaylist.vue` and NaiveUI 2.43.2 `Switch.mjs` / `styles/index.cssr.mjs`. The public facade keeps NaiveUI class hooks (`n-switch`, rail/button/content/icon/state modifiers), while the lazy implementation preserves Kobalte's `Switch.Root role="group"` plus hidden `Switch.Input role="switch"` structure and places NaiveUI visuals on `Switch.Control`; settings boolean rows now consume the package-level switch facade.
- 2026-05-26: Reworked `NaiveTabs` against SPlayer `Download/layout.vue` and NaiveUI 2.43.2 `Tabs.mjs` / `Tab.mjs` / `styles/index.cssr.mjs`. The facade now emits NaiveUI-compatible `n-tabs` class hooks, supports `type="segment"`, and measures the active tab to move `n-tabs-capsule`; `DownloadPage` is the first focused segment-tab migration and targets `.n-tabs` / `.n-tabs-rail` rather than legacy `segmented-tabs` classes.
- 2026-05-26: Migrated `ResourceCommentsPanel` comments display to `NaiveH3`, `NaiveText`, `NaiveP`, and `NaiveSpin`. Kept sort controls as native buttons because they are interactive filters, not display tags.
- 2026-05-26: Migrated `SongWikiPage` title/section headings/loading state/skeleton blocks to `NaiveH2`, `NaiveH3`, `NaiveSpin`, and `NaiveSkeleton`. Kept existing page classes so `pages.css` remains the visual owner.
- 2026-05-26: Migrated additional online display surfaces in `PersonalFmPage`, `CloudPage`, `NeteaseRadioPage`, and `RecommendMode` to `NaiveH2`, `NaiveH3`, `NaiveP`, and `NaiveSpin`. Kept page-level buttons, tabs, search fields, and menus native until their interaction contracts are migrated deliberately.
- 2026-05-26: Migrated shared page titles and comment text in `PageHeader`, `HorizontalCardRow`, `LibraryPage`, `SearchMode`, `LikedCollectionMode`, `MediaList`, and `FullPlayerComments` to `NaiveH1`, `NaiveH2`, `NaiveH3`, and `NaiveP`. Existing class names and descendant CSS selectors remain the visual owner; `Modal` remains on the native heading until dialog/focus behavior is migrated deliberately.
- 2026-05-26: Migrated `NeteaseHomeFeed` loading placeholders from handwritten skeleton spans to `NaiveSkeleton`. Kept the original `card-row-title`, `album-card-art`, and `skeleton-line` classes so the existing home-feed CSS remains the visual owner.
- 2026-05-26: Added `NaiveScrollbar` as a thin `NScrollbar` facade with `n-scrollbar-container` / `n-scrollbar-content` compatibility hooks, then migrated `ManageRootsModal`'s directory list scroll shell while preserving the `local-directory-scroll` class.
- 2026-05-26: Added `NaivePopover` against SPlayer `PlayerData.vue` (`trigger="hover"` + `raw`), `ShortcutRecorder.vue` (`trigger="focus"`), `PlayerLyric/index.vue` (`trigger="click"` controlled), and NaiveUI 2.43.2 `Popover.mjs` / `styles/index.cssr.mjs`. The public `popover.tsx` entry is a startup-light `lazy()` proxy; the lazy implementation wraps Kobalte's `Popover` primitive and keeps NaiveUI class hooks (`n-popover`, `n-popover-shared`, `n-popover__content`, `n-popover__arrow`, `n-popover-shared--raw`, `n-popover-shared--show-arrow`). The facade exposes `triggerMode` covering `click` / `hover` / `focus` / `manual`, `raw`, `showArrow`, `placement`, `gutter`, `to`, `getAnchorRect`, and controlled `open` / `onOpenChange`. `MediaSortPopover` is the first representative migration: the virtual `(x, y)` callsite now anchors through `getAnchorRect` while existing `.media-sort-popover` visual classes remain the visual owner.
