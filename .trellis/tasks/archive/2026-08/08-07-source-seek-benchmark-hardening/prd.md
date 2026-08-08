# 加固 source-seek benchmark 的采样与门禁

## Goal

为 source_seek_perf 增加显式 report/enforce 模式、预热与交错采样，并分别定义绝对服务目标和相对回退判断，消除普通运行的噪声断言。

## Requirements

- Add explicit report and `--enforce` behavior to `source_seek_perf`; a normal
  report run must not unconditionally assert one p50 ordering.
- Warm both persistent and reopen paths and interleave or randomize measurement
  order so filesystem cache and scheduler drift do not always favor one side.
- Report enough samples and at least p50/p95/p99/max for persistent source seek,
  reopen/probe and their paired/relative delta.
- Define an absolute persistent-seek service objective separately from a
  relative regression guard. Document the host/profile/fixture assumptions and
  how a noisy or unsupported environment is represented.
- Retain the generated local fixture for deterministic decoder coverage, while
  explicitly excluding remote fetch, latest-wins activation races, device
  output and first-audible-frame claims.
- Keep product seek-race remediation in its existing owner task; this task owns
  benchmark sampling and gate semantics only.

## Acceptance Criteria

- [ ] Default/report mode prints and optionally writes measurements without a
      noisy unconditional timing assertion.
- [ ] `--enforce` evaluates documented absolute and relative criteria and exits
      nonzero on a deterministic over-budget regression.
- [ ] Warmup, ordering and sample-count behavior has focused coverage or a
      deterministic harness test.
- [ ] Structured output records fixture identity, profile/environment metadata,
      percentiles, criteria and verdict reasons.
- [ ] Benchmark documentation states that local source-seek timing is not remote
      or device-audible latency evidence.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
