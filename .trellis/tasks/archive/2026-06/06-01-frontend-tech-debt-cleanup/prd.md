# Frontend Tech-Debt Cleanup: Magic Codes, Parser DRY, Circular Deps

> Source: frontend review long-tail findings **SMELL-3/4/5/6/7** and **IPC-01/02/03**, priority P3. A grab-bag of independent, low-risk cleanups; each item can land separately.

## Goal

Clear the long-tail technical debt surfaced by the review: unnamed protocol magic numbers, copy-pasted parser/error boilerplate, type-only circular dependencies in the Naive UI layer, and a few IPC robustness papercuts. None are bugs; all are maintainability/robustness improvements.

## Requirements (independent work items)

- **[SMELL-3] Name NCM QR status codes.** Replace bare `800/801/802/803` in `components/login/useQrLoginSession.ts:143-160` with `const QR_STATUS = { EXPIRED: 800, WAITING: 801, SCANNED: 802, CONFIRMED: 803 } as const;`.
- **[SMELL-4] Name + dedupe the NCM success code.** Extract `assertNcmOk(result, fallbackMessage)` (with `NCM_OK_CODE = 200`) and replace the three copies of the `code !== 200` check in `CreatePlaylistModal.tsx:74`, `details/UpdatePlaylistModal.tsx:88`, `online/ncmFavoriteRowAction.ts:73`.
- **[SMELL-5] Reduce parser boilerplate.** Promote the existing `hasFields` helper (`shared/api/apiBoundaryParsers.ts:26`) into a schema-driven `defineParser({ string: [...], integer: [...], nullableString: [...] })` generator and migrate the repetitive `isRecord` + per-field predicate + `as unknown as T` parsers in `apiBoundaryParsers.ts` (8) and `shared/api/library.ts` (4). Keep runtime validation behavior identical (still reject invalid payloads).
- **[SMELL-6] Extract a feedback wrapper.** Add `withFeedback(fn, onSuccess?)` to collapse the ~12 repeated `try/catch { setRawFeedback("error", readErrorMessage(error)); throw }` shells in `features/library/useLibraryDataController.ts`.
- **[SMELL-7] Break the Naive UI circular deps.** For the 13 `shared/ui/naive/*.tsx ↔ Naive*Kobalte.tsx` type re-export cycles, move each shared `NaiveXxxProps` type into a dedicated `xxx.types.ts` so wrapper and Kobalte implementation both import one-directionally.
- **[IPC-02] Log the silenced window catch.** Add a `console.debug(...)` in the silent `catch { return; }` at `components/WindowControls.tsx:30-34`, matching the `env.ts` degradation-log style.
- **[IPC-03] Normalize OS invoke errors.** Wrap the `invoke` errors in `shared/api/os.ts:1-17` (`reveal_path_in_folder`, `delete_file`) into a consistent `Error` so the caller's `readErrorMessage` gets a normalized message instead of a raw Rust string.
- **[IPC-01 — conditional/optional] Chunked library init.** Only if validated as a real bottleneck for very large libraries: stream `getLibraryTrackSummaries` (`shared/api/library.ts:95` → `libraryControllerViewState.ts:240` `workerClient.init`) in chunks so the single full-library `JSON.parse` + per-row parser pass does not block the main thread on cold start / library switch. Treat as a stretch item; may be split into its own task if it grows.

## Acceptance Criteria

- [ ] No bare `800/801/802/803` or `200` NCM/QR magic numbers remain at the cited sites; named constants/helpers are used.
- [ ] Parser definitions for the migrated types go through the schema-driven generator with unchanged validation semantics.
- [ ] `useLibraryDataController` action error handling routes through `withFeedback`; no behavior change in surfaced feedback.
- [ ] `madge` (or equivalent) reports the 13 Naive UI type cycles resolved.
- [ ] `WindowControls` logs on the unavailable-window path; `os.ts` errors are normalized.
- [ ] `npm run typecheck` passes for `apps/desktop`; existing parser/library tests pass (extend as needed).
- [x] IPC-01: explicitly deferred with rationale in `research/ipc-01-library-init.md`; no unmeasured custom chunking in this cleanup.

## Technical Approach

- Land items as small independent commits; each is mechanical and locally verifiable.
- For SMELL-5, keep a thin compatibility layer if any external caller depends on the current parser function signatures.
- For IPC-01, first measure (cold-start parse time on a large library) before implementing; chunk on the worker `init` boundary.

## Decision (ADR-lite)

Context: These are residual papercuts in an otherwise disciplined codebase (zero `any`, runtime-validated IPC boundaries). They share no logic and were grouped only by priority.

Decision: Treat as one cleanup task with independent work items rather than 8 micro-tasks, but keep IPC-01 conditional since it is the only item with real performance/design weight.

Consequences: Reviewer sees one coherent cleanup PR (or a short series). IPC-01 may graduate to its own task if measurement shows it needs real design work.

## Out of Scope

- Replacing the hand-written runtime validation with a `zod` dependency (the in-house parsers are intentional, dependency-free).
- Behavioral changes to NCM flows, library feedback, or window controls.
- Refactors covered by the other four `06-01-*` tasks.

## Technical Notes

- Relevant spec: `.trellis/spec/frontend/index.md`, `.trellis/spec/guides/code-reuse-thinking-guide.md`.
- Anchor files: `components/login/useQrLoginSession.ts`, `shared/api/apiBoundaryParsers.ts`, `shared/api/library.ts`, `features/library/useLibraryDataController.ts`, `shared/ui/naive/*.tsx`, `components/WindowControls.tsx`, `shared/api/os.ts`, `features/library/libraryControllerViewState.ts`.
## 归档一致性注记（2026-08-08）

- 本 PRD 验收框未勾选：该任务归档时未附逐条验收证据（无 validation-evidence.md 或实现验证记录）。
  出于元数据真实性，本任务保留未勾选状态，不作为"已验收"伪证；如需补验，请重新打开任务并补充证据。
