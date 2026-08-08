# Bug Analysis: audio settings overwrote one another across surfaces

## 1. Root Cause Category

- **Primary category: B — Cross-Layer Contract.** The same logical setting had
  no explicit ownership or lifecycle across JSON persistence, player mirrors,
  DSP atomics, HTTP handlers, SQLite projections, playback responses, and UI
  drafts.
- **Secondary category: C — Change Propagation Failure.** Each endpoint updated
  a different subset of those mirrors. Adding or fixing a setter did not force
  every other writer/readback to change.
- **Secondary category: D — Test Coverage Gap.** Unit tests covered individual
  setters, but not the interleaving “PlayerBar volume commit → unrelated global
  settings save”. Preview expiry, different-session ordering, and superseded
  failures were also absent.
- **Specific cause:** full stale snapshots were treated as commands, runtime
  caches were treated as authorities, and one committed revision was incorrectly
  assumed to order both durable state and transient preview state.
- **Confidence:** high. Repository-wide writer searches, startup readback tests,
  deterministic reordered-response tests, and the original regression all
  discriminate this cause from a DSP-algorithm or rendering-only defect.

## 2. Why Earlier-Style Fixes Fail

1. **Update only `/volume`:** runtime volume changes immediately, but a later
   full `/save_settings` still replays persisted stale volume.
2. **Refresh settings after every save:** introduces another unordered GET and
   can replace a newer response or dirty draft.
3. **Synchronize more mirrors manually:** every new field/endpoint must remember
   the same fan-out and rollback order; partial failures remain dishonest.
4. **Use only committed revision for previews:** preview, cancel, and expiry do
   not commit, so snapshots with equal revision can still represent different
   effective states.
5. **Suppress errors for superseded commands:** suppressing UI noise is valid,
   but skipping cleanup leaves an older preview overlay able to resurface.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific action | Status |
|---|---|---|---|
| P0 | Architecture | One coordinator owns persistent commits and typed runtime application | DONE |
| P0 | Protocol | Expose desired/effective/apply status plus committed `revision` and observable `state_revision` | DONE |
| P0 | Persistence | Candidate → atomic replace → publish ordering | DONE |
| P0 | Runtime | Preview session/sequence, cancel/expiry rollback, and closed-session tombstones | DONE |
| P0 | Frontend | One store, dirty patches, conflict snapshots, effective PlayerState projection | DONE |
| P0 | Tests | Interleaving, reordered responses, expiry resurrection, and superseded failure cleanup | DONE |
| P1 | Runtime acknowledgement | Decoder/output acknowledgements advance effective state for next-track/rebuild fields | TODO |
| P1 | Schema coverage | Decide persistence contracts for EQ enable, ReplayGain enable, phase response, and advanced saturation/dynamic-loudness fields | TODO |
| P1 | Transport | Add a complete PlayerState transport revision outside audio settings | TODO |

## 4. Systematic Expansion

- **Similar issues:** general playback state responses can still arrive out of
  order; runtime-only EQ/ReplayGain switches and advanced effect parameters do
  not yet have durable schema ownership; next-track/output-rebuild fields need
  revisioned acknowledgements before effective state can converge.
- **Design improvement:** commands carry dirty intent; snapshots carry desired,
  verified effective state, disposition, and a version for every observable
  mutation. Actuator caches never become API authorities.
- **Process improvement:** every new setting requires a field-matrix row,
  one persistence owner, one actuator/readback, an application class, a patch
  parser, and an interleaving test before an endpoint/UI control is added.

## 5. Knowledge Capture

- [x] Added backend audio settings control-plane code-spec.
- [x] Added frontend audio settings store code-spec.
- [x] Added the durable-versus-observable version trigger to the cross-layer
  thinking guide.
- [x] Added task-local field matrix and regression coverage.
- [ ] `src/templates/markdown/spec/` is absent in this repository, so there is
  no template copy to synchronize.
- [ ] Follow-up ownership/transport items remain explicitly listed above.
