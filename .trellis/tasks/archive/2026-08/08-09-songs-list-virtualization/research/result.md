# Songs-list virtualization result

Date: 2026-08-10

## Verdict

The current production-equivalent runtime still reproduced full rendering.
The existing virtual-row and worker-range logic was active, but its viewport
had no finite height. Bounding `.panel-library` makes the existing
`.media-list-viewport` the real scroll container; no worker or row-window logic
was changed.

## Build and provenance

- Git HEAD: `2f2f3261d00a3d686b17cdf66f46eb070d3e5a77`.
- Build commands: `npm run build:release-input`, then `cargo build --release
  --manifest-path apps/desktop/src-tauri/Cargo.toml --features custom-protocol
  --target-dir target/virtualization-measurement`.
- Binary: `target/virtualization-measurement/release/audio-desktop.exe`,
  11,435,008 bytes, built `2026-08-10T07:41:31.6588120Z`.
- Binary SHA-256:
  `0BBA2714ABE2619D6B9255BE00F9CA606400868757DAB23FDC89EA9EA178EC2E`.
- Runtime shell/sidecar: PID 22848 / 37512; CDP port 9233. The user's original
  PID 3464 / 14416 instance and port 9222 were excluded.
- The build came from a dirty checkout. `local-library.css` also contains
  unrelated pre-existing stylesheet extraction changes; this task owns only
  the `.panel-library` height rule in that file.

## Root cause and fix

`data-virtualized="true"` was present, but `.media-list-viewport` expanded to
the full 53,280 px spacer. At 592 visible rows, the worker correctly satisfied
the requested range; the fault was the parent geometry, not range ownership.

The production fix is:

```css
.panel-library {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
```

## Runtime result

| Metric at 50% | Failing baseline | Fixed production layout |
|---|---:|---:|
| Rendered rows | 592 | 16 (absolute rows 289-304) |
| Document elements | 19,352 | 927 |
| Document images | 598 | 24 |
| Decoded row images | 595 | 21 |
| Viewport client / scroll height | 53,280 / 53,280 px | 514 / 53,280 px |
| JS heap used | 31.4 MiB | 7.1 MiB |

Five sampled scroll ratios kept 16 rows mounted. Raw JSON and screenshots are
under `runtime-baseline/`, `runtime-post/`, `runtime-forced-unbounded/`, and
`runtime-restored/`.

## Renderer memory

The initial same-process WMI A/B met the conditional gate: forced unbounded
layout was 176.8 MiB WS / 113.8 MiB PB; the bounded layout was 146.9 / 87.6
MiB, a reduction of 29.9 / 26.2 MiB.

A later paired explicit-GC repeat measured 186.523 / 127.652 MiB versus
165.262 / 106.301 MiB, a smaller 21.262 / 21.352 MiB reduction. This repeat is
kept alongside the passing sample because WebView2 process counters are
allocator/cache-sensitive. Row, image, DOM, viewport and JS-heap reductions
remained deterministic. Exact repeat bytes are in `renderer-memory-ab.json`.

## Interaction and visual checks

- Five real wheel events advanced the absolute window with 16 rows throughout.
- Row 294 stayed selected after scrolling away and back.
- The context menu remained inside the 1220 x 780 viewport.
- Initial, midpoint, and context-menu screenshots showed no overlap, blank
  window, or visible layout regression.
- Playback-row styling was not exercised because the measurement sidecar had
  no active track. The current list exposes no row-level Arrow/Home/End handlers
  and does not enable row drag, so those checks are not applicable to this CSS
  correction.

## Verification

- `npm run typecheck`: passed.
- Production frontend build and isolated Rust release build: passed.
- CSS height-chain regression test and virtualization/controller tests: passed.
- Full `npm test`: 520 passed, 1 failed. The sole failure is the pre-existing
  sibling-task contract `streaming PCM window default/max match the Rust
  constants` (`128 !== 256`); no audio constants were changed here.
- `git diff --check`: passed apart from line-ending conversion warnings.

The task is completed but intentionally not archived or committed pending the
user's commit decision.

## Cleanup

- Measurement shell PID 22848 and sidecar PID 37512 were stopped.
- CDP port 9233 is no longer reachable and no measurement WebView2 process
  remains.
- The user's original shell PID 3464, sidecar PID 14416, and CDP port 9222
  remain alive.
