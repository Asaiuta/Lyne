# 建立可信的实时音频 benchmark 门禁契约

## Goal

重构 canonical realtime benchmark 的 report/gate 语义，为 callback/output/resampler/spectrum 明确定义确定性正确性、主机噪声边界、预算来源与失败条件。

## Requirements

- Inventory every command currently described as a canonical realtime or
  pipeline-v2 performance gate, including callback chain/output, streaming
  resampler, spectrum handoff and Lyne playback latency/matrix scripts.
- Define explicit `report`, deterministic `check`, and performance `gate`
  semantics. Ordinary report mode must not fail on a single noisy comparison;
  gate mode must not pass merely because timings are finite and positive.
- Make the enforced metric/case/budget and budget provenance machine-readable.
  Host-sensitive absolute budgets must identify the approved environment class
  and use enough warmup/trials to support the selected percentile.
- Keep deterministic correctness failures separate from timing regressions so a
  noisy host can be diagnosed without suppressing real correctness defects.
- Make Lyne top-level pass/exit status include enabled stability and control
  sub-gates. Pipeline matrix classification must preserve those failures.
- Do not claim CPAL/WASAPI write, device/DAC or audible end-to-end latency from
  in-process or renderer-only metrics.

## Acceptance Criteria

- [x] A deliberately injected slowdown or over-budget fixture makes each
      applicable canonical realtime gate fail for the documented reason.
- [x] Callback/output gates evaluate declared deadline/tail metrics rather than
      only finite positive timing.
- [x] Lyne latency exits nonzero when an enabled stability/control sub-gate is
      false, and the pipeline-v2 row is classified failed.
- [x] Report-only mode still emits complete measurements without presenting a
      latency-budget verdict.
- [x] Gate schema records mode, cases, metrics, budget source, profile and
      environment class; focused tests cover pass/fail/unsupported outcomes.
- [x] Documentation and all Trellis callers use the same truthful command and
      do not label report-only evidence as a regression gate.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
