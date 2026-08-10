# Offline local-library navigation

## 1. Scope / Trigger

Apply this contract when changing any of the following in `apps/desktop`:

- a local-library destination or the `library` navigation history;
- offline sidebar ordering, visibility, collapse behavior, or active state;
- navigation persistence for a library tab or a specific local playlist;
- local-playlist detail loading, deletion, or missing-playlist recovery;
- `ui.sidebar.hiddenItems` keys for local-library entries;
- title or content motion between two destinations that share top-level page `library`;
- the persistent local-playlists trigger or its second-level row/resource geometry.
- local songs-list virtualization, its scroll owner, or the panel/router height chain.

The goal is to keep the sidebar, rendered library view, back/forward history,
and restored session on one typed source of truth. Local data availability must
not silently change the information architecture.

## 2. Signatures

The shared navigation contract lives in `shared/ui/navigation.ts`:

```ts
export const LIBRARY_TABS = [
  "songs",
  "artists",
  "albums",
  "playlists",
  "folders"
] as const;

export type LibraryDestination =
  | { readonly kind: "tab"; readonly tab: LibraryTab }
  | { readonly kind: "playlist"; readonly playlistId: string };

export interface NavigationLocation {
  readonly page: ActivePage;
  readonly libraryDestination: LibraryDestination;
}
```

The persisted snapshot always carries the complete destination:

```ts
export interface NavigationStateSnapshot {
  readonly activePage: ActivePage;
  readonly libraryDestination: LibraryDestination;
  readonly selectedPlaylistId: number | null;
  readonly discoverTab: DiscoverTab;
  readonly likedCollectionTab: PersistedLikedCollectionTab;
}
```

History mutations operate on `NavigationLocation`, not only `ActivePage`:

```ts
createNavigationHistory(initial: NavigationLocation): NavigationHistoryState;
pushNavigationLocation(state, location): NavigationHistoryState;
replaceNavigationLocation(state, location): NavigationHistoryState;
enterOfflineNavigation(state): NavigationHistoryState;
```

Local-playlist requests use a generation and playlist identity together:

```ts
interface LocalPlaylistRequestCoordinator {
  begin(playlistId: string | null): LocalPlaylistRequestToken;
  invalidate(): void;
  isCurrent(
    token: LocalPlaylistRequestToken,
    selectedPlaylistId: string | null
  ): boolean;
}
```

Library motion identity and the shared out-in primitive are explicit:

```ts
libraryDestinationMotionKey(destination: LibraryDestination): string;

interface KeyedOutInTransitionProps<Value> {
  value: Value;
  transitionKey: string;
  transitionName: string | null;
  onDisplayedValueChange?: (value: Value) => void;
  children: (displayedValue: Accessor<Value>) => JSX.Element;
}
```

Whole-sidebar playlist content uses an explicit resource lifecycle:

```ts
type SidebarCollapsePhase =
  | "expanded"
  | "collapsing"
  | "collapsed-retained"
  | "collapsed-unmounted"
  | "expanding";

interface SidebarCollapseLifecycle {
  beginTransition(targetCollapsed: boolean, settleByNextFrame: boolean): number;
  requestSettle(generation: number, targetCollapsed: boolean): void;
  dispose(): void;
}
```

## 3. Contracts

### Navigation ownership

- `NavigationController` is the only writable owner of `LibraryDestination`.
- Sidebar active state and `LibraryPage` content derive from the same destination.
- A specific playlist is `{ kind: "playlist", playlistId }`; the online
  playlist overview remains `{ kind: "tab", tab: "playlists" }`.
- `normalizeLibraryDestination(unknown)` trims playlist IDs and falls back to
  `DEFAULT_LIBRARY_DESTINATION` (`songs`) for malformed input.
- Back, forward, and replace compare both page and destination. Replace must
  remove adjacent duplicates on either side of the replaced entry.

### Offline sidebar

When `useOnlineService === false`, the stable block order is:

1. `library / songs` (Music Library)
2. local-playlists group
3. `library / albums`
4. `library / artists`
5. `library / folders`
6. `recent`

All six blocks remain present when songs, roots, playlists, or history are
empty. Visibility is controlled only by the corresponding explicit setting:
`library`, `createdPlaylists`, `libraryAlbums`, `libraryArtists`,
`libraryFolders`, or `recent`. The local-playlists group defaults expanded;
the `created` entry in `ui.sidebar.collapsedSections` is the persisted user
override. Offline mode fixes the group to local semantics and hides its source
selector.

When `useOnlineService === true`, retain one local-library sidebar entry and
the page-level five-view selector. Do not render the split offline entries.

The offline local-playlists block has two separate ownership boundaries:

- Its first-level trigger is a normal `SidebarNavButton`. It uses the same row,
  icon, label, hover, active, and whole-sidebar collapse trajectory as the
  other offline destinations, stays mounted in every collapse phase, and is
  never replaced by a compact fallback.
- Specific playlists remain a second-level list. Only that list participates
  in retained/idle resource management and may be hidden or unmounted.
- While the list is visible, its selected row owns active styling. When the
  list is hidden by the section preference or whole-sidebar collapse, the
  persistent first-level trigger owns active styling.
- In an expanded sidebar, activating the trigger toggles the persisted
  `created` section preference. In a user-collapsed sidebar, it clears that
  preference and expands the sidebar. Responsive forced-narrow mode still
  owns width below its breakpoint. The create action is a sibling button and
  never toggles either state.

First-level icon geometry has one collapsed-rail contract. Keep the icon at
`22px`, derive its inline start from the rail width, and use the same value for
both a user-collapsed desktop sidebar and the `<980px` forced-narrow layout:

```css
.sidebar {
  --sidebar-nav-icon-size: 22px;
  --sidebar-collapsed-item-indent: calc(
    (var(--sidebar-width-collapsed) - var(--sidebar-nav-icon-size)) / 2
  );
}

.sidebar.is-collapsed .sidebar-nav-item {
  padding-right: 18px;
  padding-left: var(--sidebar-collapsed-item-indent);
}
```

The narrow layout must not add inline padding to the full-width
`.sidebar-scroll`; otherwise a mathematically centered `64px` child is shifted
by the parent's padding. Do not use `justify-content: center` as a desktop
substitute while an opacity-hidden label still participates in flex layout.
The local-playlists `82px` action reserve is expanded-state-only and must
transition back to the normal `18px` end padding when the rail collapses.
Runtime acceptance requires every first-level icon-box center to be within
`0.25px` of the rail center, with every first-level row equal to the rail width.

Second-level button-height correction is scoped to
`.sidebar-local-playlists-body`; online playlist rows keep their existing
contract. Preserve the established SPlayer-sized child presentation:

- cover on: `34px` cover, `13px` label, `12px` gap, `50px` item and button;
- cover off: `22px` fallback icon, `13px` label, `12px` gap, and
  `--sidebar-item-height` for both item and button.

The fix aligns the outer hit/active box with the already-rendered child row; it
does not resize the cover or text:

```css
.sidebar-local-playlists-body .sidebar-playlist-button {
  height: 50px;
}

.sidebar-local-playlists-body .sidebar-playlist-button.is-cover-hidden {
  height: var(--sidebar-item-height);
}
```

Do not shrink the visual column, label, or row merely to match the first-level
entry. Their different sizes communicate the parent/child hierarchy. The bug is
specifically a `50px` covered child overflowing a `42px` outer button, which
shifts the perceived center and active surface.

The second-level list keeps the expanded `--sidebar-width` while whole-sidebar
geometry moves. The existing sidebar overflow clips it; the managed body still
owns the exact grid-row and opacity trajectory. This prevents every offscreen
playlist row from re-laying out on every rail-width frame without changing the
first-level rail, child sizes, or expanded endpoint:

```css
.sidebar-local-playlists-body .sidebar-playlist-list {
  width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  max-width: var(--sidebar-width);
}
```

Keep row-level `content-visibility: auto` and the cover-aware intrinsic height.
Do not add `contain: layout paint` to the list; the measured candidate did not
reduce layout and increased style work.

### Whole-sidebar collapse resource lifecycle

- The registered non-inherited `--sidebar-inline-size` remains owned and
  consumed only by `.sidebar`; percentage descendants follow the containing
  block. A transient WAAPI driver on that same owner starts geometry at the
  current document-timeline time and reverses one active animation. CSS remains
  the unsupported-browser fallback. Do not move state ownership to
  `.app-body`, replace the shell with scale/translate, or delete the playlist
  opacity motion.
- `expanded`, `collapsing`, and `expanding` keep managed second-level playlist content mounted and visible. The offline local-playlists first-level trigger is outside this managed subtree. Online playlist groups may keep their existing independently mounted compact entry.
- A matching WAAPI finish or CSS-fallback `transitionend` requests settlement
  but does not synchronously swap DOM. `collapsed-retained` begins on the next
  RAF with the managed body `hidden`, `inert`, and `aria-hidden="true"`. The
  offline first-level trigger remains visible; only online groups expose their
  compact variant.
- Retain the hidden expanded tree for 1500ms. Then call the shared `scheduleIdlePreload` contract with `{ idleTimeout: 500, fallbackDelay: 0 }`; the idle callback enters `collapsed-unmounted` and releases playlist rows, covers, observers, and component listeners.
- Expanding during retention or pending idle cancels the release and reuses the same DOM. Expanding after `collapsed-unmounted` remounts it before geometry grows.
- Each target owns a generation plus at most one fallback, settle RAF, retention timer, and idle handle. A new target/dispose cancels all older handles. An old `transitioncancel` never commits the current target.
- The sidebar exposes `data-collapse-phase` for runtime evidence only. Visibility, navigation, and active state must not read that attribute.
- Expansion starts real shell geometry and first-level controls immediately.
  Managed second-level content may return one painted shell frame later through
  a generation-cancellable double RAF; this is presentation staging, not a new
  resource phase.

Solid may batch a retained-body unhide or idle-body remount with removal of the
whole-sidebar collapsed class. A CSS transition then has no painted zero state
to interpolate from. Under
`.sidebar.is-collapse-motion-active:not(.is-collapsed)`, apply a finite entry
keyframe from `grid-template-rows: 0fr; opacity: 0` to `1fr; opacity: 1` to the
visible, non-section-collapsed body. Use the spatial duration/easing tokens so
reduced motion still resolves to `0ms`; do not add a preflight RAF or another
resource-lifecycle phase only to manufacture a start frame.

### Offline transition and persistence

- Entering offline mode from an online-only page or from the library playlist
  overview replaces the current target with `library / songs`.
- Representable local tabs and a specific local playlist remain selected.
- Forward entries are discarded, online-only history entries are filtered,
  and adjacent normalized locations are deduplicated.
- A legacy or malformed persisted destination restores as `songs`; a valid
  specific local playlist may restore across restart.

### Sidebar visibility migration

`ui.sidebar.hiddenItems` is read as a boolean record. If an existing record
lacks `libraryAlbums`, `libraryArtists`, or `libraryFolders`, each missing key
inherits the normalized legacy `library` value. An explicitly persisted new
key wins. A later whole-record save writes independent values; reading does not
perform an implicit migration write.

### Local-playlist request lifecycle

- Switching playlists clears the old rows immediately and starts a token with
  both a new generation and the requested playlist ID.
- Leaving playlist detail invalidates the in-flight request.
- `LibraryPage.routeActive` participates in request identity because
  `PageTransition` deliberately keeps the outgoing route mounted during its
  leave animation. A hidden outgoing page must not recover navigation.
- When the top-level library route starts leaving, invalidate the request
  generation without clearing `selectedPlaylistId` or displayed rows. The
  outgoing playlist detail must remain visually intact until PageTransition
  unmounts it. Clearing selection is reserved for an actual displayed
  destination swap away from playlist detail.
- A response may mutate view state only when its generation and playlist ID
  still match the selected destination.
- Only `ApiHttpError` status `404` means the playlist is missing: remove its
  stale summary and replace the destination with `songs`.
- Other failures retain the destination, sidebar highlight, and cached summary,
  and expose error feedback for retry.

### Library destination motion

- Do not invent top-level `ActivePage` values for songs, albums, artists,
  folders, or a specific playlist. They remain typed `LibraryDestination`
  values under page `library`.
- `libraryDestinationMotionKey()` returns `tab:<tab>` or
  `playlist:<playlistId>`; playlist overview and a playlist with the same text
  cannot collide.
- The whole title row is keyed by its displayed title and uses
  `local-library-title-fade` out-in. The content router is keyed by the complete
  destination and reuses `page-${routeAnimation}`.
- `LibraryTabContent`, controller `activeTab`, and local-playlist request
  identity consume the transition's displayed destination. The sidebar and
  navigation target may update immediately, but outgoing content remains the
  old destination until leave completes.
- Changing the target or animation cancels the previous generation, resolves
  its pending animation as cancelled, and removes all `from` / `active` / `to`
  classes. A cancelled generation cannot swap content or start enter later.
- `routeAnimation="none"` swaps content without a visible intermediate.
  Reduced-motion tokens resolve to `0ms`; title and content must be idle on the
  next animation frame without waiting for transition events.
- Runtime observability uses `data-motion-scope`, `data-motion-phase`,
  `data-motion-displayed-key`, and `data-motion-target-key`. These attributes
  are test hooks only and never drive application state.

### Local songs-list viewport

- `.panel-library` closes the shell height chain with `height: 100%`,
  `min-height: 0`, and `overflow: hidden`.
- `.local-library-router` remains a shrinking flex child with `min-height: 0`
  and `overflow: hidden`. The nested `.media-list-viewport` is the songs
  table's vertical scroll owner.
- `data-virtualized="true"` only reports that virtual-row code is selected. It
  does not prove the viewport is bounded. Runtime acceptance must also show a
  finite `clientHeight`, `clientHeight < scrollHeight`, and a rendered row
  window near the visible range plus overscan.
- A spacer height equal to the full result set must contribute scroll extent,
  not expand `.panel-library`, `.local-library-router`, or the viewport itself.
  When all rows render, inspect this geometry chain before changing worker
  range ownership or adding another client-side list.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Missing, unknown, or malformed `libraryDestination` | Normalize to `library / songs` |
| Empty or whitespace playlist ID | Normalize to `library / songs` |
| Offline mode entered from an online-only page | Replace current target with `library / songs`; do not keep an unreachable forward entry |
| Offline mode entered from the `playlists` overview | Replace with `library / songs` |
| Offline mode entered from albums, artists, folders, or a specific playlist | Preserve that destination |
| Library data arrays are empty | Keep all non-hidden offline blocks and render their existing empty states |
| Old hidden-items record lacks new library keys | Each missing key inherits `library`; explicit new booleans win |
| Hidden-items JSON is invalid or not an object | Report the read error and use the complete default record |
| Playlist response belongs to an older generation or another ID | Ignore it without changing rows, destination, or feedback |
| Playlist response arrives while the library route is leaving | Ignore it; preserve the newly selected page and its history |
| Top-level route leaves from a displayed playlist detail | Invalidate the request but keep the detail rows/selection through every visible leave frame; never flash the playlist overview |
| Local-playlist request returns HTTP 404 | Remove stale summary and replace navigation with `songs` |
| Local-playlist request returns HTTP 5xx or another temporary error | Retain playlist destination/highlight and show feedback |
| Destination changes while content is leaving | Cancel the old generation, clean its classes, and animate toward only the newest target |
| Destination changes between two specific playlists | Use distinct `playlist:<id>` keys even when both map to tab `playlists` |
| `routeAnimation` is `none` | Swap content directly; keep the independent title fade |
| `prefers-reduced-motion: reduce` | Settle title/content and cleanup by the next RAF; do not depend on `transitionend` |
| Parent sidebar `transitionend` while playlist copy also transitions | Keep the playlist tree through event bubbling; hide it on the following RAF so Kobalte body-level bookkeeping can delete the target |
| Reopen within 1500ms retention | Cancel release and reuse the same `.sidebar-section-body` identity |
| Stay collapsed through retention plus idle | Enter `collapsed-unmounted`; expanded wrapper and playlist buttons are absent while compact entry remains operable |
| Rapid collapse/expand reversal | Ignore the old `transitioncancel`; only the latest generation and endpoint may settle |
| 100 complete open/close cycles followed by forced GC | `Nodes`, `JSEventListeners`, and non-template detached-root counts have zero growth slope |
| Selected local playlist with its second-level list visible | Keep the first-level trigger neutral and the selected child row active |
| Selected local playlist with its section or whole sidebar collapsed | Transfer active styling to the persistent first-level trigger |
| User-collapsed sidebar trigger activation | Expand the sidebar and the `created` section; do not toggle only an invisible preference |
| Responsive forced-narrow trigger activation | Preserve the expanded section preference without bypassing the responsive width owner |
| User-collapsed desktop rail | Keep every `22px` first-level icon box centered in the `64px` rail within `0.25px`; local-playlists row width remains `64px` |
| Responsive forced-narrow rail | Reuse the same center calculation with zero scroll inline padding; icon-center and row-width deltas remain within `0.25px` |
| Offline child row with cover on | Preserve `34px` cover and `13px` text; button/item heights are both `50px`, and visual/label centers align |
| Offline child row with cover off | Preserve `22px` fallback icon and `13px` text; button/item heights both equal `--sidebar-item-height` |
| Retained or idle-unmounted body expands in the same render batch | Run the explicit `0fr/0` to `1fr/1` entry keyframe; do not snap to final height |
| Virtualized songs viewport has `clientHeight === scrollHeight` | Treat the height chain as broken even when `data-virtualized="true"`; bound `.panel-library` and keep the viewport as scroll owner |
| Virtualized songs list is scrolled through the corpus | Keep rendered rows bounded to the viewport plus overscan and preserve absolute row indexes and selection |

## 5. Good / Base / Bad Cases

- Good: offline with no roots or playlists still shows the six ordered entries;
  selecting folders persists and restores `library / folders`.
- Base: online mode shows one local-library entry and the existing view menu;
  switching offline from online search lands on Music Library.
- Bad: hide albums because the album count is zero, keep a Sidebar-only
  selected-playlist signal, treat every request failure as 404, or allow an old
  playlist response to overwrite the newly selected playlist.
- Good motion: albums leaves under `tab:albums`, then artists swaps to
  `tab:artists` and enters; controller projection changes at the swap.
- Base motion: `routeAnimation="none"` swaps content immediately while the
  independently keyed title still fades.
- Bad motion: animate only top-level `activePage="library"`, update
  `controller.activeTab` from the target before leave, or leave cancelled CSS
  classes on the old router node.
- Good collapse: the parent end event schedules a RAF, a short hidden/inert cache
  absorbs immediate reopen, and idle later unmounts only the second-level
  playlist tree while the first-level trigger keeps the same DOM identity.
- Base collapse: an initially persisted collapsed sidebar starts at
  `collapsed-unmounted` with the offline first-level trigger mounted and no
  playlist rows.
- Bad collapse: synchronously replace the playlist tree from the parent
  `transitionend`/`transitioncancel`, permanently retain all playlist rows, or
  replace the offline trigger with a compact node, or let a stale cancel
  complete the latest target.
- Good rail geometry: derive the `21px` collapsed indent from the `64px` rail
  and `22px` icon, transition both inline paddings on the spatial cadence, and
  reuse that contract below the responsive breakpoint.
- Bad rail geometry: keep the expanded `26px` indent in a `64px` rail, retain
  the local trigger's `82px` action reserve, or add `8px` parent padding around
  a still-`64px` child row.
- Good child geometry: preserve the `34px / 13px / 50px` covered row and make
  its outer button `50px`; switch both layers back to the existing `42px`
  contract only when covers are hidden.
- Bad child geometry: keep a `42px` button around a `50px` item, or shrink the
  cover/text/row to disguise that mismatch.
- Good songs virtualization: a `514px` viewport over a `53,280px` spacer keeps
  16 rows mounted and moves the absolute row window while scrolling.
- Bad songs virtualization: expose `data-virtualized="true"` while the viewport
  expands to the full spacer height and mounts every row and cover.

## 6. Tests Required

- `navigation.test.ts`: normalize every tab and playlist; reject malformed and
  empty IDs; normalize only the playlist overview for offline mode.
- `navigationHistory.test.ts`: distinct same-page destinations, push/forward
  truncation, back/forward, two-sided replace deduplication, and offline history
  filtering.
- `navigationPersistence.test.ts`: valid tabs/playlists round-trip, legacy
  snapshots default to songs, and invalid payloads fail safely.
- `offlineSidebarModel.test.ts`: exact six-block order, empty-data stability,
  independent visibility switches, and destination-derived active state.
- `useUISettings.test.ts`: legacy `library` inheritance, explicit new-key
  precedence, complete records, and invalid JSON/object fallback.
- `localPlaylistRequestState.test.ts`: generation plus ID matching, invalidation
  on destination or route leave, and 404-only classification.
- `navigation.test.ts`: stable, non-colliding motion keys for every tab and a
  specific playlist.
- `KeyedOutInTransition.test.ts`: CSS time-list parsing, repeated duration /
  delay semantics, zero-duration resolution, and generated class names.
- Browser acceptance at `1280x720`: empty and filled offline libraries, all six
  visibility switches, group and whole-sidebar collapse, navigation/reload,
  online compatibility, online-to-offline fallback, playlist 404, and playlist
  500. Pause one playlist request, start a non-zero route leave animation,
  release a 404, and assert that the destination remains on the new page.
  Assert no page errors and no online API requests in offline states.
- Browser motion acceptance samples every RAF for songs → albums → artists →
  folders → playlist. Assert non-zero title/content intermediate frames,
  leave-before-swap-before-enter ordering, final key/heading/active agreement,
  rapid three-target convergence, `none`, reduced motion, playlist-group
  collapse, and whole-sidebar geometry.
- `sidebarCollapseLifecycle.test.ts`: phase projection, generation rejection,
  duplicate completion coalescing, next-RAF settlement, 1500ms retention,
  idle cancellation/unmount, reduced motion, and dispose cleanup.
- Sidebar resource acceptance with at least one local playlist: 100 complete
  collapse/expand pairs (200 clicks), forced GC every 20 pairs, retained-node
  identity reuse, idle unmount/remount, 30-click rapid reversal, and reduced
  motion. Before each GC checkpoint, wait in one in-page RAF loop for every
  finite sidebar-subtree animation to stop, then wait two RAFs. Assert strict
  zero node/listener growth, unchanged non-template detached roots, and no
  stale `is-collapse-motion-active` class. Do not use repeated external
  `wait_for_function` polling for this checkpoint; its utility-world templates
  contaminate the DOM-node metric.
- Offline local-playlists trigger/row acceptance: assert trigger and icon DOM
  identity through collapse/expand, active-state handoff, retained and remounted
  body entry frames, and expanded/collapsed click semantics. For row geometry,
  assert the covered button/item are both `50px`, cover is `34px`, text remains
  `13px`, and visual/label center-Y delta is at most `0.5px`. Static coverage
  must also assert the coverless button/item both use
  `--sidebar-item-height` without changing the `13px` label.
- Collapsed first-level geometry acceptance: at `1280px` user-collapsed and
  `900px` forced-narrow viewports, assert every icon-box center/rail-center
  delta and every row-width/rail-width delta are at most `0.25px`; the
  local-playlists row must not expand beyond the rail. RAF samples must show a
  monotonic, non-zero icon trajectory in both collapse directions.
- Performance scaling acceptance uses `0/1/50/200` local playlists. Assert the
  second-level list stays at `--sidebar-width`, row-level content visibility
  preserves scroll/focus/accessibility, handler P95 is `<=1.5ms`, first visible
  P95 is `<=20.7ms`, and 100-pair memory slopes remain zero. Final RAF/Long
  Task release claims come from foreground Tauri with a healthy idle cadence;
  headless software rendering remains a repeatable CPU/scaling comparison and
  must not replace the real-window gate.
- Local songs virtualization: statically assert the complete `.panel-library`
  and `.local-library-router` height-chain rules. In a production-equivalent
  Tauri run, assert `clientHeight < scrollHeight`, bounded row/image counts at
  the start and midpoint, five real wheel steps without blank windows,
  selection persistence, and viewport-contained context-menu geometry.
- Final commands: `npm run typecheck`, `npm test`, and `npm run build:measure` in
  `apps/desktop`.

## 7. Wrong vs Correct

### Wrong

```ts
// Sidebar and LibraryPage now have different owners.
setSelectedLocalPlaylistId(playlistId);
controller.setActiveTab("playlists");

// All local destinations still report the same top-level key, so nothing moves.
<PageTransition activePage="library">...</PageTransition>

// Any temporary failure destroys a valid route.
catch {
  onReplaceDestination(DEFAULT_LIBRARY_DESTINATION);
}
```

### Correct

```ts
onNavigateToLibrary({ kind: "playlist", playlistId });

<KeyedOutInTransition
  value={destination}
  transitionKey={libraryDestinationMotionKey(destination)}
  transitionName={`page-${routeAnimation}`}
>
  {(displayed) => <LibraryTabContent destination={displayed()} />}
</KeyedOutInTransition>

if (isLocalPlaylistNotFoundError(error)) {
  onReplaceDestination(DEFAULT_LIBRARY_DESTINATION);
} else {
  setFeedback("error", readErrorMessage(error));
}
```

Wrong whole-sidebar settlement:

```ts
if (event.type === "transitionend" || event.type === "transitioncancel") {
  setCollapsedContent(collapsed());
}
```

Correct whole-sidebar settlement:

```ts
if (event.type === "transitioncancel") return;
if (event.type === "transitionend" && collapseTargetReached(sidebar)) {
  lifecycle.requestSettle(runningGeneration, collapsed());
}
```

Wrong offline child geometry:

```css
.sidebar-playlist-button { height: 42px; }
.sidebar-playlist-item { min-height: 50px; gap: 12px; }
.sidebar-playlist-cover { width: 34px; height: 34px; }
```

Correct scoped child geometry:

```css
.sidebar-local-playlists-body .sidebar-playlist-button {
  height: 50px;
}

.sidebar-local-playlists-body .sidebar-playlist-button.is-cover-hidden {
  height: var(--sidebar-item-height);
}
```

Wrong collapsed first-level geometry:

```css
.sidebar-nav-item { padding-left: 26px; }
.sidebar-local-playlists-entry .sidebar-nav-item { padding-right: 82px; }
@media (max-width: 980px) { .sidebar-scroll { padding-inline: 8px; } }
```

Correct collapsed first-level geometry:

```css
.sidebar.is-collapsed .sidebar-nav-item {
  padding-right: 18px;
  padding-left: var(--sidebar-collapsed-item-indent);
}

@media (max-width: 980px) {
  .sidebar .sidebar-nav-item {
    padding: 0 18px 0 var(--sidebar-collapsed-item-indent);
  }
}
```

Wrong virtualized viewport geometry:

```css
.panel-library {
  min-height: 100%;
  overflow: visible;
}
```

Correct bounded viewport geometry:

```css
.panel-library {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
```
