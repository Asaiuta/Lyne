# Frontend Performance Measurement

Use these checks when working on the frontend performance backlog.

## Default Gates

Run from `apps/desktop`:

```bash
npm run typecheck
npm test
npm run build:measure
```

`npm test` includes focused unit tests plus the MediaList 3000-row virtual-scroll smoke. `npm run build` builds and gates the standard release input. `npm run build:measure` reuses that release-input pipeline, then emits a separate source-mapped measurement build. Tauri's `build:bundle` entry point reuses the same gate before building the sidecar.

The standard release input is always `dist/` and does not contain sourcemaps.
`build:measure` gates that release input first, then creates an explicit
source-mapped analysis build under `../../output/build-measurement/desktop/`.
That ignored measurement directory is outside Tauri's `frontendDist` and must
not be copied into release packaging.

## Bundle Budgets

Use `npm run perf:bundle` after `npm run build:web` when you only need to re-check the existing `dist/` output. Use `npm run build:measurement` only when you need source maps for analysis.

Budget groups are defined in `scripts/bundle-size-policy.mjs`:

- Startup JS: `index-*.js`
- CSS: `*.css`
- Large route chunks: `NeteasePage-*` and `SettingsPage-*`
- Other JS route/helper chunks

The report also recursively inventories every file under `dist/`, rejects
source maps and native debug-symbol artifacts, and enforces the total raw
frontend release-input budget. Non-JS/CSS files count toward that total even
though they do not have per-chunk gzip budgets.

If a task intentionally raises a budget, record the before/after chunk sizes in that task's notes and update the budget in the same change.

## Route Timing

Route timing is an on-demand browser check, not part of the default test command.

1. Start a dev or preview server:

```bash
npm run dev
```

2. In another terminal:

```bash
npm run perf:routes -- --url http://127.0.0.1:5173 --routes library,recommend,cloud
```

The harness uses `data-perf-route-key` on sidebar items and `data-perf-active-page` on the route transition container. Routes that require login may be reported as skipped unless the app is already in a suitable account state.

Optional trace capture:

```bash
npm run perf:routes -- --url http://127.0.0.1:5173 --trace
```

Traces are written under `output/playwright/`.

## Recording Backlog Results

For each frontend performance child task, add the relevant before/after evidence to the Trellis task notes:

- Bundle tasks: startup chunk raw/gzip and any moved route chunks.
- List tasks: `npm test` MediaList smoke plus any manual scroll profile notes.
- Online data tasks: number of list state commits or fetch pages when relevant.
- FullPlayer/playback tasks: whether closed-state idle avoids playback tick/rAF work.
