# 为性能产物补齐可复现溯源元数据

## Goal

统一 Rust、Electron、Lyne 与 Tauri 性能报告的源码脏树、二进制、profile/toolchain、OS/CPU 与输入 fixture 身份，使历史产物可判定是否能与当前树比较。

## Requirements

- Define one versioned provenance block shared conceptually by Rust benchmark
  JSON, Electron reports, Lyne reports and task-local Tauri probes.
- Record generation time, git HEAD, a privacy-safe dirty-tree fingerprint and
  dirty/clean state, command/mode, build profile/toolchain, OS/architecture and
  CPU class. Record executable path plus SHA-256 for measured native binaries.
- Record relevant fixture/manifest hashes and workload parameters. User-library
  evidence must use a privacy-safe inventory fingerprint rather than embedding
  credentials or an unrestricted path/file listing.
- Preserve runtime-specific fields such as Electron/Chrome/V8, Tauri launch
  mode, viewport, device/audio output mode and process-attribution limits.
- Add comparison eligibility logic that explains which identity mismatch makes
  two reports incomparable; a matching commit alone is insufficient for dirty
  trees.
- Migrate report writers through bounded shared helpers without changing the
  measured workload or turning report-only scripts into gates.

## Acceptance Criteria

- [x] New Rust, Electron, Lyne and Tauri JSON artifacts expose a versioned,
      machine-readable provenance block with the required applicable fields.
- [x] Two reports from different dirty trees or native binaries are detected as
      incomparable even when `gitHead` matches.
- [x] Clean-tree reports remain reproducible from commit, profile/toolchain,
      executable and fixture identity.
- [x] Tokens, credentials and unrestricted user file names are absent from the
      provenance block; redaction/fingerprint tests cover sensitive inputs.
- [x] Existing consumers tolerate or migrate to the new schema without losing
      previous measurement fields.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
