# SPlayer detail pages visual parity pass 2

## Goal

Finish the remaining S1 visual gap on NetEase detail pages against the SPlayer
reference screenshots:

- artist detail: songs, albums, videos
- album detail
- playlist detail

The first visual-parity pass made these routes standalone and closer in density,
but the 2026-07-05 re-audit still judged them visibly off in first-viewport
screenshots. This pass should prioritize screenshot-level convergence for the
detail experience without broad player, streaming, or settings work.

## Confirmed Facts

- Parent task: `07-04-splayer-ui-parity`.
- Current audit source:
  `.trellis/tasks/07-04-splayer-ui-visual-audit/research/gap-list-2026-07-05-reaudit.md`.
- Current evidence directory:
  `.trellis/tasks/07-04-splayer-ui-visual-audit/research/screenshots/2026-07-05-reaudit/`.
- Player-surface parity was handled separately and marked completed in
  `07-05-splayer-player-surfaces-visual-parity`.
- Prior detail visual pass exists in
  `.trellis/tasks/archive/2026-07/07-05-splayer-detail-pages-visual-parity/`;
  this task is a second pass, not a route-independence retry.
- `ArtistDetail` and `AlbumDetail` share `NcmListDetail`; `PlaylistDetail`
  keeps a separate header because it owns search, edit, refresh, batch, reorder,
  subscribe, and comment behavior.
- Detail rows already hide the size column, but current screenshots still differ
  in hero rhythm, artwork/fallback treatment, tab/toolbar balance, resource grid
  density, row surface weight, and live artwork/data fidelity.

## Requirements

- Align artist detail first viewport with SPlayer:
  - songs tab: more compact header rhythm, real-image/fallback treatment that
    does not read as a generic placeholder, full-width primary tabs, secondary
    hot/latest ordering, and dense SPlayer-like rows.
  - albums tab: denser resource grid, tighter metadata rhythm, and artwork cards
    that better match SPlayer's list/card proportions.
  - videos tab: 16:9 thumbnails, tighter grid, and SPlayer-like spacing.
- Align album detail first viewport with SPlayer:
  - header cover/title/meta/actions should feel closer to SPlayer in height,
    spacing, title scale, and toolbar placement.
  - songs/comments tabs and inline search must remain usable and visually quiet.
  - song rows should be less card-like/heavily outlined than current evidence.
- Align playlist detail first viewport with SPlayer:
  - converge header, cover, title/meta/action row, search, songs/comments tabs,
    and row density with album detail where behavior permits.
  - keep playlist-specific functions available, but compact or group them if
    they are the reason the first viewport diverges from SPlayer.
- Keep all changes scoped to the affected detail surfaces unless a small shared
  primitive reduces real duplication.
- Preserve route independence, playback actions, subscribe/follow, comments,
  inline search, context menu actions, drag/reorder, hidden-cover settings, and
  responsive behavior.
- Produce after screenshots and compare them with the SPlayer reference images.
- Supplement motion/interaction evidence for the same detail surfaces:
  - sticky hero compacting while scrolling;
  - detail tab switching for artist albums/videos and album/playlist comments;
  - search focus/filter state for album/playlist detail;
  - playlist more-menu opening if playlist controls are visually changed.
  Static screenshots are still the primary parity gate, but this pass must not
  leave transition/hover/popover behavior unobserved.

## Acceptance Criteria

- [ ] `artist-lin-junjie-songs` after screenshot shows a visibly more
      SPlayer-like header/tab/list composition than the 2026-07-05 AudioPlayer
      re-audit capture.
- [ ] `artist-lin-junjie-albums` and `artist-lin-junjie-videos` after
      screenshots show denser resource grids and thumbnail/card proportions
      closer to SPlayer.
- [ ] `album-detail-targeted` after screenshot converges on SPlayer header,
      toolbar, tabs/search, and row surface density without losing comments tab
      or search behavior.
- [ ] `playlist-detail-targeted` after screenshot converges with SPlayer and
      remains functionally complete for search, more menu, comments, and reorder
      eligibility.
- [ ] Artist/album/playlist details do not render under Discover/search parent
      chrome and do not regress TopNav/back navigation.
- [ ] Motion evidence exists for the affected detail surfaces, either as short
      captures/GIF/video files or a screenshot sequence plus metadata showing
      scroll compacting, tab switch, search focus/filter, and any changed menu
      animation state.
- [ ] Validation includes `npm run typecheck`, `npm run build`, focused tests if
      code paths beyond CSS are touched, and screenshot capture for the affected
      detail pages. Any skipped command is documented.

## Out of Scope

- Streaming page parity.
- Settings option inventory.
- Full player, lyrics, comments half-panel, desktop lyric, queue drawer, and
  active bottom-player surfaces.
- Replacing all mock audit data with live NetEase data. This pass may improve
  fallback artwork presentation, but exact live-data parity is environment
  dependent.

## Open Questions

- None blocking. The user delegated large-change/refactor judgment to the agent;
  the implementation should prefer SPlayer first-viewport visual convergence
  while preserving existing AudioPlayer functions.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
