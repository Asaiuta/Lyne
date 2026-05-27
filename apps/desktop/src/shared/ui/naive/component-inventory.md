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
| `NaiveDropdown` | `NDropdown` | package-level facade with startup-light public proxy plus lazy Kobalte `DropdownMenu` implementation; trigger-anchored + virtual (x/y/show) modes | source-backed trigger-anchored + virtual |
| `NaivePopconfirm` | `NPopconfirm` | package-level facade composing `NaivePopover` + `NaiveButton`; preserves panel class hooks, null-sentinel action hiding, default warning icon, button-prop mapping, and dismiss-blocking click semantics | source-backed composition |
| `SidebarPopselect` | `NPopselect` source selector | thin Sidebar wrapper over `NaivePopselect` with shell class slots | implemented for Sidebar |
| `NaiveTabs` | `NTabs` / `NTab` / `NTabPane` | source-backed NaiveUI 2.43.2 tablist facade with lightweight fallback plus lazy Kobalte `Tabs`; segment type uses `n-tabs-rail` / moving `n-tabs-capsule` | source-backed segment |
| `NaiveSwitch` | `NSwitch` | source-backed NaiveUI 2.43.2 state/class facade with lightweight fallback plus lazy Kobalte `Switch`; Kobalte DOM semantics are preserved and `.n-switch` visuals live on the visible control | source-backed |
| `NaiveInput` | `NInput` | source-backed NaiveUI 2.43.2 form-control facade with lightweight fallback plus lazy Kobalte `TextField`; includes password reveal, inputProps attribute passthrough, warning/error status, and `.n-input` visual hooks on the visible shell | source-backed gaps partly closed |
| `NaiveInputNumber` | `NInputNumber` | source-backed NaiveUI 2.43.2 numeric form-control facade with startup-light public proxy plus lazy Kobalte `NumberField`; keeps no-grouping formatting, precision, clearable nullable values, showButton controls, and hold-to-repeat | source-backed package ready |
| `NaiveSelect` | `NSelect` | source-backed NaiveUI 2.43.2 selection/menu facade with a startup-light `lazy()` public proxy plus lazy Kobalte `Select`/`Combobox`; covers single, multiple selected tags, filterable single/multiple, and basic `tag` typed-option creation while keeping `.n-select` / `.n-base-selection` / `.n-base-select-menu` visuals on the visible shell/menu | source-backed multiple ready |
| `NaiveSlider` | `NSlider` | source-backed NaiveUI 2.43.2 single-thumb slider facade with startup-light public proxy plus lazy Kobalte `Slider`; emits `.n-slider*` rail, fill, handle, tooltip, marks, vertical, disabled, and with-mark hooks | source-backed PR-1 volume migrated |
| `NaiveCheckbox` / `NaiveCheckboxGroup` | `NCheckbox` / `NCheckboxGroup` | source-backed NaiveUI 2.43.2 checkbox facade with startup-light public proxy plus lazy Kobalte `Checkbox`; group is a handwritten coordinator because Kobalte has no checkbox-group primitive | source-backed package ready |
| `NaiveRadio` / `NaiveRadioGroup` / `NaiveRadioButton` | `NRadio` / `NRadioGroup` / `NRadioButton` | source-backed NaiveUI 2.43.2 radio facade with startup-light public proxy plus lazy Kobalte `RadioGroup`; button skin and splitor hooks are included for inventory parity | source-backed package ready |
| `NaiveCollapse` / `NaiveCollapseItem` | `NCollapse` / `NCollapseItem` | source-backed NaiveUI 2.43.2 disclosure facade with startup-light public proxy plus lazy Kobalte `Accordion`; emits item/header/content class hooks, active/disabled modifiers, and left/right arrow placement | source-backed package ready |
| `NaiveCollapseTransition` | `NCollapseTransition` | handwritten measured max-height transition primitive, no Kobalte dependency; mirrors NaiveUI fade-in-expand behavior enough for package adoption | source-backed package ready |
| `SImage` image route | `NImage` / `NImageGroup` | no Naive facade; base image/media behavior stays in `SImage`, while preview/lightbox/group navigation is owned by `05-24-ui-splayer-n-simage-preview-lightbox` | routed |
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
| `NaiveNumberAnimation` | `NNumberAnimation` | handwritten SolidJS display/tween facade with NaiveUI 2.43.2 `easeOutQuint`, Intl integer/decimal formatting, and an intentional tabular-nums wrapper span | source-backed |
| local icon contract | `NIcon` | no facade; callers pass local icon JSX directly into facade slots/props and let NaiveUI class hooks or page classes own sizing/color | bridge |
| app shell CSS/tokens | `NLayout` / `NLayoutHeader` / `NLayoutSider` | no facade; app shell structure and NaiveUI layout color/border/transition parity are routed to `global.css`, `tokens.css`, and `components/shell.css` | routed |
| appearance/token system | `NConfigProvider` / `NGlobalStyle` | no facade; provider/global reset responsibilities are routed to existing appearance tokens and `global.css` | routed |
| `NaiveFeedbackProvider` services | `NMessageProvider` / `NNotificationProvider` / `NDialogProvider` / `NModalProvider` / `NLoadingBarProvider` | app-root provider plus singleton `message`, `notification`, `dialog`, `modal`, and `loadingBar` APIs; no per-provider facades | app service |
| app dialog and sheet routes | `NDrawer` / `NDrawerContent` / `NModal` | no generic package facade yet; current ownership stays in `Modal.tsx`, `LoginModal.tsx`, `QueueDrawer.tsx`, settings overlay structure, and feedback `dialog` / `modal` services until a consumer-backed Kobalte Dialog consolidation task | routed |
| long-tail feature controls | `NDynamicTags` / `NColorPicker` / `NTree` / `NDataTable` | no package facades yet; implement only from consumer-backed feature tasks so tag editing, color picking, tree navigation, and reusable data-table contracts do not ship as dead exports | deferred |
| `NaiveBackTop` | `NBackTop` | handwritten page utility facade; `BackToTop` consumes it while preserving page placement classes | source-backed |
| `NaiveFloatButton` / `NaiveFloatButtonGroup` | `NFloatButton` / `NFloatButtonGroup` | handwritten floating action stack; `MediaListFloatTools` consumes it while preserving media-list placement classes | source-backed |
| `NaiveQrCode` | `NQrCode` | handwritten wrapper that lazy-loads the existing `qrcode/lib/browser.js` generator | source-backed ready |
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
| `NImage` | 13 | routed to canonical `SImage`; no `NaiveImage` export until preview APIs land |
| `NSkeleton` | 13 | `NaiveSkeleton` handwritten display facade |
| `NAlert` | 11 | `NaiveAlert` handwritten display facade |
| `NInputNumber` | 11 | `NaiveInputNumber` source-backed/Kobalte facade; `passively-activated` accepted as no-op until a real activation-sensitive consumer lands |
| `NCollapseTransition` | 12 active occurrences / 12 total | `NaiveCollapseTransition` handwritten measured max-height primitive |
| `NDivider` | 10 | `NaiveDivider` handwritten display facade |
| `NSelect` | 10 | `NaiveSelect` source-backed/Kobalte facade; single, multiple selected tags, filterable single/multiple, and basic tag creation now; maxTagCount, virtual scroll, remote/grouped menu surfaces deferred |
| `NH3` | 9 | `NaiveH3` handwritten typography facade |
| `NTab` | 9 | `NaiveTabs` source-backed/Kobalte facade |
| `NPopover` | 8 | Kobalte popover candidate |
| `NForm` | 7 | form facade once validation/runtime contract is needed |
| `NFormItem` | 7 | form facade once validation/runtime contract is needed |
| `NGrid` | 6 | `NaiveGrid` source-backed handwritten layout facade |
| `NNumberAnimation` | 9 occurrences / 6 files | `NaiveNumberAnimation` handwritten source-backed display/tween facade; `StreamingPage` is the first representative AudioPlayer migration |
| `NSlider` | 6 | `NaiveSlider` source-backed/Kobalte facade; PR-1 migrated PlayerVolumePopover vertical volume, while settings RangeInput, progress sliders, EQ bands, and long-tail range behavior stay deferred |
| `NA` | 5 | `NaiveAnchor` handwritten native anchor facade |
| `NAvatar` | 5 | handwritten display facade |
| `NH1` | 5 | `NaiveH1` handwritten typography facade |
| `NCollapse` | 5 active occurrences / 6 including commented | `NaiveCollapse` source-backed/Kobalte Accordion facade |
| `NCollapseItem` | 6 active occurrences / 6 total | `NaiveCollapseItem` source-backed/Kobalte Accordion item facade |
| `NFormItemGi` | 4 | CSS/grid plus form facade |
| `NInputGroup` | 4 | CSS/layout only unless behavior appears |
| `NPopconfirm` | 7 instances / 4 files | `NaivePopconfirm` composition facade over `NaivePopover`; first real AudioPlayer call site deferred until a destructive-confirm surface lands |
| `NEllipsis` | 4 | handwritten display facade |
| `NBadge` | 3 | handwritten display facade |
| `NConfigProvider` | 3 | routed to appearance/token system; no facade |
| `NDrawer` | 3 | routed to existing app sheet/dialog surfaces; generic `NaiveDrawer` deferred until consumer-backed consolidation |
| `NDrawerContent` | 3 | routed with `NDrawer`; no package-level content shell until a real drawer consumer migrates |
| `NList` | 3 | `NaiveList` handwritten list container facade |
| `NListItem` | 3 | `NaiveListItem` handwritten list row facade |
| `NMenu` | 3 | structured facade; Sidebar is first implementation |
| `NPopselect` | 3 | `NaivePopselect` facade; Kobalte-backed interaction, CSS/tokens for visual parity |
| `NResult` | 3 | `NaiveResult` handwritten display facade |
| `NSpin` | 3 | `NaiveSpin` handwritten display facade |
| `NCheckbox` | 7 occurrences / 3 files | `NaiveCheckbox` source-backed/Kobalte leaf facade; standalone and group children supported, numeric group values round-trip through string-only Kobalte values |
| `NColorPicker` | 2 | deferred until theme color customization has a real AudioPlayer consumer |
| `NDynamicTags` | 2 | deferred until keyword/tag editing has a real AudioPlayer consumer |
| `NH2` | 3 | `NaiveH2` handwritten typography facade |
| `NIcon` | 2 | routed to local icon contract; no facade |
| `NModal` | 2 | routed to existing `Modal.tsx` and feedback `modal` service; generic `NaiveModal` deferred until modal consolidation |
| `NProgress` | 2 | `NaiveProgress` handwritten line progress facade |
| `NRadio` | 3 occurrences / 2 files | `NaiveRadio` source-backed/Kobalte facade; rich JSX labels and numeric/string values supported |
| `NRadioGroup` | 3 occurrences / 2 files | `NaiveRadioGroup` source-backed/Kobalte facade; group value coercion preserves original string/number values |
| `NTabPane` | 6 | `NaiveTabs` facade covers tablist semantics; panel ownership remains at call sites until full tab-panel migration is needed |
| `NThing` | 2 | `NaiveThing` handwritten title/description facade |
| `NBackTop` | 1 | `NaiveBackTop` handwritten page utility facade |
| `NCheckboxGroup` | 2 occurrences / 1 file | `NaiveCheckboxGroup` handwritten coordinator over Kobalte checkbox children; max/min quota logic ported |
| `NRadioButton` | 0 occurrences | `NaiveRadioButton` source-backed inventory parity facade; no live SPlayer call site, so production migration is deferred |
| `NDataTable` | 1 | deferred; current batch tables stay feature-specific until reusable table requirements repeat |
| `NDialogProvider` | 1 | routed to `dialog` app service; no facade |
| `NFloatButton` | 1 | `NaiveFloatButton` handwritten page utility facade |
| `NFloatButtonGroup` | 1 | `NaiveFloatButtonGroup` handwritten page utility facade |
| `NGi` | 4 | `NaiveGridItem` / `NaiveGi` source-backed handwritten layout facade |
| `NGlobalStyle` | 1 | routed to `global.css`; no facade |
| `NImageGroup` | 1 | routed to canonical `SImage`; preview/lightbox/group navigation owned by `05-24-ui-splayer-n-simage-preview-lightbox` |
| `NLayout` | 1 | routed to app shell CSS/tokens; no facade |
| `NLayoutHeader` | 1 | routed to app shell CSS/tokens; no facade |
| `NLayoutSider` | 1 | routed to app shell CSS/tokens; no facade |
| `NLi` | 1 | `NaiveLi` handwritten native list facade |
| `NLoadingBarProvider` | 1 | routed to `loadingBar` app service; no facade |
| `NMessageProvider` | 1 | routed to `message` app service; no facade |
| `NModalProvider` | 1 | routed to `modal` app service; no facade |
| `NNotificationProvider` | 1 | routed to `notification` app service; no facade |
| `NOl` | 1 | `NaiveOl` handwritten native list facade |
| `NP` | 1 | `NaiveP` handwritten paragraph facade |
| `NQrCode` | 1 | `NaiveQrCode` wrapper over lazy `qrcode` generation |
| `NTree` | 1 | deferred; current folder tree behavior stays feature-specific until generic tree navigation is needed |

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

- 2026-05-27: Added `NaiveSelect` multiple/tag support against SPlayer FontManager and UpdatePlaylist usage plus NaiveUI 2.43.2 `Select.mjs`, `_internal/selection`, `_internal/select-menu`, and `tag` source. The public `select.tsx` prop surface is now a typed single/multiple union; `NaiveSelectKobalte.tsx` renders `.n-base-selection-tags`, `.n-base-selection-tag-wrapper`, `.n-tag--default`, `.n-tag--strong`, close hooks with disabled guards, filterable multiple input-tag hooks, and basic typed-option creation when `tag` is enabled. `maxTagCount`, virtual scroll, remote select, and grouped/header/action menu surfaces remain deferred.
- 2026-05-27: Added `NaiveInputNumber` against SPlayer's 20 `NInputNumber` occurrences across lyric offset, song metadata, login phone/id, auto-close, scaling, and cache-size settings plus NaiveUI 2.43.2 `InputNumber.mjs` / `styles/index.cssr.mjs`. The public `input-number.tsx` entry stays startup-light, `input-number-core.ts` is Kobalte-free, and `NaiveInputNumberKobalte.tsx` wraps Kobalte `NumberField` while preserving no-grouping formatting, precision, min/max clamp, clearable nullable values, showButton, and NaiveUI's 800ms then 100ms hold-to-repeat behavior. `passively-activated` remains a documented no-op.
- 2026-05-27: Closed the first `NaiveInput` form-control gaps: `showPasswordOn="click" | "mousedown"` password reveal, attribute-only `inputProps` passthrough for native/Kobalte input controls, and `.n-input__suffix-icon--password-eye` styling. Existing warning/error status class hooks remain the NaiveUI-aligned status path. Select multiple, word-count, and broader form validation stay in `05-26-naive-package-migrate-form-controls`.
- 2026-05-27: Reconciled long-tail `NDynamicTags`, `NColorPicker`, `NTree`, and `NDataTable` as deferred consumer-backed controls. AudioPlayer has no current DynamicTags/ColorPicker consumers, while folder-tree and batch-table behavior is owned by feature-specific library/online surfaces. Future facades should be introduced only from real tag-editing, theme-color, tree-navigation, or reusable-table feature tasks.
- 2026-05-26: Reconciled `NDrawer`, `NDrawerContent`, and standalone `NModal` as no-facade dialog/sheet boundaries. AudioPlayer keeps current ownership in `Modal.tsx`, `LoginModal.tsx`, `QueueDrawer.tsx`, the settings overlay, and `NaiveFeedbackProvider`'s `dialog` / `modal` services. A future Kobalte `Dialog` facade must be tied to a real consumer migration and own focus trap, focus restore, body scroll lock, Escape/backdrop policy, placement, and NaiveUI class hooks together.
- 2026-05-26: Reconciled `NImage` / `NImageGroup` as a no-facade boundary. Existing `SImage` remains the canonical image/media component for placeholder, loading/error, lazy/decode, release-on-hide, artwork, shape/aspect, object-fit, cross-origin, and class/style slot behavior. NaiveUI preview overlays, grouped navigation, toolbar behavior, and generated image-preview styling remain routed to `05-24-ui-splayer-n-simage-preview-lightbox` before any thin `NaiveImage` alias is considered.
- 2026-05-26: Added `NaiveCollapse`, `NaiveCollapseItem`, and `NaiveCollapseTransition` against SPlayer about/download/wiki disclosure usage plus NaiveUI 2.43.2 `Collapse.mjs` / `CollapseItem.mjs` / `_internal/fade-in-expand-transition`. `collapse.tsx` stays startup-light and lazy-loads Kobalte `Accordion`; `collapse-transition.tsx` is handwritten with no Kobalte import. The facade keeps `.n-collapse*` hooks, active/disabled and left/right arrow-placement modifiers, numeric-name coercion, `expandedNames` union normalization, and derived `onItemHeaderClick` metadata. Inventory counts were corrected from the umbrella rough 4/4/10 to the audited 5/6/12 active footprint.
- 2026-05-26: Added `NaiveCheckbox` and `NaiveCheckboxGroup` against SPlayer close-confirm and copy-lyrics checkbox usage plus NaiveUI 2.43.2 `Checkbox.mjs` / `CheckboxGroup.mjs`. `checkbox.tsx` stays startup-light; `NaiveCheckboxKobalte.tsx` owns the Kobalte leaf, while the group is handwritten because `@kobalte/core@0.13.11` has no checkbox-group primitive. The facade keeps `.n-checkbox*` / `.n-checkbox-group` hooks, controlled indeterminate, label/children fallback, numeric value round trips, and NaiveUI max/min quota behavior.
- 2026-05-26: Added `NaiveRadio`, `NaiveRadioGroup`, and `NaiveRadioButton` against SPlayer song-list sort and download-quality radio usage plus NaiveUI 2.43.2 `Radio.mjs` / `RadioGroup.mjs` / `RadioButton.mjs`. `radio.tsx` stays startup-light; `NaiveRadioKobalte.tsx` owns the Kobalte `RadioGroup` implementation, original string/number value lookup, auto-generated names, and button-mode splitor priority hooks. `NaiveRadioButton` is package-ready for parity even though SPlayer has zero current call sites.
- 2026-05-26: Corrected checkbox/radio inventory counts from the umbrella rough counts to the audited SPlayer footprint: `NCheckbox` 7, `NCheckboxGroup` 2, `NRadio` 3, `NRadioGroup` 3, and `NRadioButton` 0. No AudioPlayer business surface was migrated in this pass; package facade validation is by logic tests, typecheck, build chunk inspection, and future call-site adoption.
- 2026-05-26: Added `NaiveSlider` against SPlayer `PlayerRightMenu.vue` volume usage, the audited `NSlider` call-site set, and NaiveUI 2.43.2 `Slider.mjs` / `styles/index.cssr.mjs`. The public `slider.tsx` entry stays startup-light and lazy-loads `NaiveSliderKobalte.tsx`, which wraps Kobalte `Slider` while emitting NaiveUI class hooks for rail/fill/handle/indicator/marks, vertical and disabled states, `keyboard={false}`, drag callbacks, and the single-thumb active-mark rule. `PlayerVolumePopover` now consumes the vertical facade with `tooltip={false}`; settings `RangeInput`, player progress, and EQ sliders remain deliberate follow-ups.
- 2026-05-26: Added page utility facades for `NBackTop`, `NFloatButton`, `NFloatButtonGroup`, and `NQrCode`. `BackToTop` and `MediaListFloatTools` now consume the package-level button utilities while keeping their existing page/media placement classes; `NaiveQrCode` ships as a ready wrapper that lazy-loads `qrcode/lib/browser.js` instead of adding QR generation to startup.
- 2026-05-26: Added app-level feedback services for NaiveUI provider-only surfaces. `NaiveFeedbackProvider` mounts once near `App` and exposes singleton `message`, `notification`, `dialog`, `modal`, and `loadingBar` APIs; provider rows are marked as app services rather than facades. The implementation is handwritten SolidJS/Portal code and does not import Kobalte.
- 2026-05-26: Audited the shell/provider/global-style NaiveUI surfaces as no-facade routes. `NLayout`, `NLayoutHeader`, and `NLayoutSider` map to AudioPlayer's app shell CSS (`global.css`, `tokens.css`, `components/shell.css`); `NConfigProvider` maps to the existing appearance/token system; `NGlobalStyle` maps to `global.css`. The only source-backed reset gap was WebKit tap highlight, now covered by `body { -webkit-tap-highlight-color: transparent; }`.
- 2026-05-26: Documented the `NIcon` bridge as a no-facade boundary. AudioPlayer keeps local icon components and passes raw JSX through existing facade slots/props (`NaiveButton` children, `NaiveSwitch` icon props, `NaiveTabs` JSX labels, and `NaiveSelect` render hooks); sizing/color remain owned by NaiveUI class hooks or page-level classes.
- 2026-05-26: Added `NaiveNumberAnimation` against SPlayer's 9 `NNumberAnimation` occurrences across 6 files and NaiveUI 2.43.2 `NumberAnimation.mjs` / `utils.mjs`. The facade is handwritten SolidJS, uses the exact JS `easeOutQuint` curve (`t=0.5 -> 0.96875`), keeps NaiveUI's `Intl.NumberFormat` integer/decimal split, and intentionally wraps the output in `.naive-number-animation` with `tabular-nums` plus `aria-live="polite"` instead of NaiveUI's bare 3-node fragment. `StreamingPage` now uses the package facade for the song-count status strip; behavior/style contract is covered by `number-animation.test.ts` and `output/playwright/naive_number_animation_probe.mjs`.
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
- 2026-05-26: Added `NaivePopover` against SPlayer `PlayerData.vue` (`trigger="hover"` + `raw`), `ShortcutRecorder.vue` (`trigger="focus"`), `PlayerLyric/index.vue` (`trigger="click"` controlled), and NaiveUI 2.43.2 `Popover.mjs` / `styles/index.cssr.mjs`. The public `popover.tsx` entry is a startup-light `lazy()` proxy; the lazy implementation wraps Kobalte's `Popover` primitive and keeps NaiveUI class hooks (`n-popover`, `n-popover-shared`, `n-popover__content`, `n-popover__arrow`, `n-popover-shared--raw`, `n-popover-shared--show-arrow`). The facade exposes `triggerMode` covering `click` / `hover` / `focus` / `manual`, `raw`, `showArrow`, `placement`, `gutter`, `to`, `getAnchorRect`, and controlled `open` / `onOpenChange`. `MediaSortPopover` is the first representative migration: the virtual `(x, y)` callsite now anchors through `getAnchorRect` while existing `.media-sort-popover` visual classes remain the visual owner. (PR1 of the dropdown-popover subtask.)
- 2026-05-26: Added `NaiveDropdown` trigger-anchored facade against SPlayer's trigger-anchored `NDropdown` usage (`Layout/Nav.vue`, `Layout/User.vue`) and NaiveUI 2.43.2 `Dropdown.mjs` / `styles/index.cssr.mjs`. The public `dropdown.tsx` entry is a startup-light `lazy()` proxy backed by `NaiveDropdownKobalte.tsx` wrapping Kobalte's `DropdownMenu` primitive (`Root` / `Trigger` / `Portal` / `Content` / `Item` / `Separator`). The package contract keeps NaiveUI class hooks (`n-dropdown`, `n-dropdown-menu`, `n-dropdown-option`, `n-dropdown-option-body{__prefix,__label,__suffix}`, `n-dropdown-divider`, `n-dropdown--disabled`), plus `triggerMode` covering `click` / `hover` / `manual` with hover open/close timers (100ms / 200ms) cleaned up via `onCleanup`. Cascade `option.children` is deferred with a one-shot `console.warn`. `styles.css` reuses the existing `naive-popover-enter` / `naive-popover-leave` keyframes — NaiveUI shares the fade-in-scale-up easing across popover and dropdown. (PR2 of the dropdown-popover subtask.)
- 2026-05-26: Extended `NaiveDropdown` with a virtual-anchor mode covering SPlayer's dominant `:x/:y/:show` right-click `NDropdown` usage (`Menu/SongListMenu.vue`, `Menu/CoverMenu.vue`, `Menu/SearchInpMenu.vue`, `Player/PlayerRightMenu.vue`, `Artist/layout.vue`, `Local/layout.vue`, etc.). The public surface gains `x?`, `y?`, `show?`, `onShowChange?`; when both `x` and `y` are defined the facade auto-detects virtual mode and renders an invisible `0×0` `DropdownMenu.Trigger` positioned `fixed` at `(x, y)`. Kobalte's positioner consumes the real DOM rect so placement / flip / collision behave natively without shimming `getBoundingClientRect`. Trigger `children` are ignored in virtual mode with a one-shot `console.warn`. `show` wins over `open` in virtual mode for SPlayer ergonomics. Right-click `contextmenu` capture and `preventDefault` stay at the caller. No AudioPlayer call site exists yet for a virtual context menu (no right-click surface in the app); the contract is verified by `output/playwright/naive_dropdown_virtual_probe.mjs`. (PR3 of the dropdown-popover subtask.)
- 2026-05-26: Added `NaivePopconfirm` against SPlayer's 7 `NPopconfirm` instances across `StreamingServerList.vue`, `AutoClose.vue`, `ExcludeComment.vue`, and `ExcludeLyrics.vue`, plus NaiveUI 2.43.2 `Popconfirm.mjs` / `PopconfirmPanel.mjs` / `styles/index.cssr.mjs`. The facade composes on the existing `NaivePopover` instead of importing Kobalte directly, injects `n-popconfirm` on popover Content, renders panel hooks (`n-popconfirm__panel`, `__body`, `__icon`, `__action`), uses `NaiveButton` for default actions, preserves the `null` text sentinel, default warning icon, `showIcon`, button prop mapping, controlled `show` / `onUpdateShow`, and `false` / `Promise<false>` dismiss-blocking semantics. No clean AudioPlayer destructive-confirm surface exists yet, so this pass is probe-only and defers the first real call site to the planned destructive settings/streaming surfaces; contract verified by `output/playwright/naive_popconfirm_probe.mjs`.
