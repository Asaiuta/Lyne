# Unify SPlayer color token source of truth

## Goal

Unify the frontend color source-of-truth used by SPlayer parity work so dynamic cover coloring, manual theme color, Naive-compatible controls, shell surfaces, and player/full-player surfaces derive from one canonical token chain instead of multiple peer color systems.

The user-visible goal is stable SPlayer-like color behavior across pages: changing cover/theme settings should not make one page follow `--color-*`, another follow `--splayer-*`, and a third follow stale `--naive-*` overrides.

## Confirmed Facts

- The app currently has overlapping color vocabularies in `apps/desktop/src/shared/styles/tokens.css`: `--color-*`, `--splayer-*`, `--accent*`, `--surface*`, `--naive-*`, and `--player-*`.
- `paletteEngine.applyPalette()` writes both Material role tokens (`--color-*`) and SPlayer-specific tokens (`--splayer-*`).
- `customAppearance.ts` writes dynamic surface/accent variables and also rewrites many `--naive-*` adapter variables.
- `useAppController.ts` extracts the current cover palette when `themeFollowCover` or `playerFollowCoverColor` is enabled.
- `dynamicCover` changes the NCM cover asset request/resolution path, while `themeFollowCover` and `playerFollowCoverColor` control whether cover palette affects theme/player colors.
- SPlayer parity requires screenshot-backed validation; static token inspection is not enough.

## Requirements

1. Define a single canonical color ownership model:
   - Palette/source layer: manual seed or extracted cover palette.
   - App semantic layer: background, surfaces, text, borders, accent, state colors.
   - Component adapter layer: Naive facade tokens, player bar tokens, full-player local tokens.
2. Refactor dynamic coloring so cover/manual theme writes only canonical palette/semantic entry points, while component adapter tokens are derived from those entry points.
3. Preserve existing user-facing controls:
   - `themeMode`
   - `themeFollowCover`
   - `themeGlobalColor`
   - `themeSeedColor`
   - `dynamicCover`
   - `playerFollowCoverColor`
   - custom CSS/JS extension behavior
4. Preserve intentional AudioPlayer differences recorded by the parent SPlayer parity task, including audio-engine settings, SMTC, and custom code injection.
5. Keep player-specific exceptions where they are product-visible:
   - Player bar accent may follow cover independently from global theme.
   - Full-player cover accent may stay scoped because lyric/player contrast requirements differ from shell pages.
6. Add source-level guardrails so future page styling uses semantic/app adapter tokens instead of introducing another independent color system.
7. Validate with code checks and screenshot evidence covering shell pages, Naive controls, settings, player bar, queue/popovers, and full-player surfaces.

## Acceptance Criteria

- [ ] `paletteEngine` and `customAppearance` have a clear contract: dynamic palette application has one canonical write path, and component-specific tokens are adapter outputs.
- [ ] `tokens.css` documents or structurally reflects the token hierarchy so future edits know which variables are source, semantic, and adapter tokens.
- [ ] Naive/Kobalte controls continue to render focus, active, hover, slider, switch, input, popover, dropdown, and tab colors from the unified adapter layer.
- [ ] Player bar and full-player cover accents still respect `playerFollowCoverColor`.
- [ ] Global theme/surface tinting still respects `themeFollowCover` and `themeGlobalColor`.
- [ ] Dynamic cover asset selection still works and remains separate from color-system ownership.
- [ ] No page introduces direct new peer color roots outside the canonical chain.
- [ ] `npm run typecheck` passes.
- [ ] `npm run build` passes.
- [ ] Screenshot evidence is captured before/after for representative states, including at minimum Discover tabs, search input focus, settings appearance controls, player bar, queue/popover, and full-player.

## Notes

This is a child task of `07-04-splayer-ui-parity` and serves the broader screenshot-backed SPlayer alignment goal. It should not introduce a new visual direction; it should make the existing SPlayer-aligned styling more consistent and maintainable.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
