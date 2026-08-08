# Server: offload blocking load/queue handlers to spawn_blocking

## Goal

Stop running decoder opens + blocking SQLite writes inline on the actix executor while holding the player mutex, in the primary transport/queue handlers. The NCM handlers already implement the correct offload pattern — extend it to the remaining callers. (Review finding C1, MAJOR.)

## Requirements

`src/server/netease/playback_actions.rs:35-44` documents that `load_validated_path_for_playback` "acquires the `parking_lot::Mutex<AudioPlayer>` … performs a decoder open plus several blocking SQLite writes" and must be offloaded — and the NCM handlers (`play_ncm_track` / `enqueue_ncm_track`) do it via `actix_web::rt::task::spawn_blocking`. (Wording fix 2026-07-03: the repo contains **zero** `web::block` usages; `spawn_blocking` is the one and only offload pattern here — do not introduce `web::block`.) These callers do NOT:

- `/load` — `src/server/playback/transport.rs:5-33`
- `/domain/queue/play`, `/domain/queue/play_next`, `/domain/queue/play_previous` — `src/server/playback/queue_handlers.rs:62-172` via `load_queue_entry_for_playback`
- `/domain/library/queue_from_media_ids` — `src/server/playback/library.rs:4-20`

For WebDAV/NCM stream URLs this blocks an actix worker on network I/O while holding the player mutex, stalling every other handler that touches the player.

**R1**: every call of `load_validated_path_for_playback` (and any sibling that opens a decoder or does blocking DB work while holding the player mutex) from an async handler goes through the same offload mechanism the NCM handlers use.
**R2**: response semantics unchanged: same status codes, same JSON bodies, same WS events fired in the same order. Error mapping through the offload boundary must not turn typed failures into 500s.
**R3**: audit the remaining direct `data.app_db.*` calls in these specific handlers while you're there; move the ones on the load path into the same offloaded closure (do NOT attempt the full AsyncRepo migration — that's task 06-08-error-types/repo scope). **Scope decision required (2026-07-03):** `queue_next` (`queue_handlers.rs:69-125`) still does `player.lock()` + a `mark_queue_entry_status_by_path` DB write inline on the executor and is NOT among the five listed sites — either add it as a sixth site, or write it into Out-of-scope explicitly with rationale. While deciding, also note the open question of whether `queue_next_with_credentials` performs a decode-open on this path.

## Status (2026-07-03)

All five listed handlers are **already implemented** in the uncommitted working tree: `transport.rs:23`, `queue_handlers.rs:137/:172/:220+`, `library_domain_handlers.rs:244` (queue_from_media_ids' offload lives there now, not in `library.rs`). Remaining work = tests + the queue_next scope decision (R3) + commit.

## Acceptance Criteria

- [ ] No handler among the five listed runs `load_validated_path_for_playback` (or decoder-open/DB-write while holding the player lock) inline on the executor — verified by reading each handler and by a grep for direct calls outside `spawn_blocking` closures.
- [ ] `cargo test` green; existing handler/queue tests unmodified in intent.
- [ ] Manual/scripted check if feasible: during a slow load (or a test double), a concurrent `/state` request returns promptly. If not feasible in this environment, state so; the structural change + tests suffice.
- [ ] No new clippy warnings in touched files.

## Constraints

- Follow the in-repo precedent exactly (NCM handlers in `netease/playback_actions.rs`) — same offload primitive, same error-mapping style. Consistency beats novelty.
- Do not change `load_validated_path_for_playback` itself unless required for Send bounds; if Send issues arise (parking_lot guards across await), restructure so the mutex is acquired INSIDE the blocking closure — never held across await.
- Supersedes the remaining scope of 06-08-server-async-blocking-offload for these handlers; note that in the report so the stale task can be reconciled at parent wrap-up.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
