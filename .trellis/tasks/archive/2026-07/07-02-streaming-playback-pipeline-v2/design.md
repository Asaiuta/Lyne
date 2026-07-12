# Streaming Playback Pipeline v2 Design - Preallocated PCM Window

> Rewritten 2026-07-10 after a source-backed performance review. This design
> supersedes the allocated chunk queue + retention ring delta design. It keeps
> the landed generation, callback seek-serial, recovery, and off-RT destruction
> contracts, but replaces the streaming PCM transport and producer lifecycle.

## 1. Design Decision

The streaming path uses one preallocated, random-addressable PCM window per
active track. It is physically block-segmented so a producer and the realtime
callback can exchange ownership without locks or data races. It is logically a
single absolute-output-frame interval containing both decoded-ahead and retained
behind-playhead PCM.

There is no separate forward queue and backward ring. There is no callback
skip loop. There is no replay-prefix extraction/re-push. There is no per-block
heap object.

The active track also has one long-lived producer that owns one long-lived
`StreamingDecoder`. A seek inside the PCM window only changes the callback read
cursor. A seek outside the window asks that producer to seek its existing
decoder and reset the existing window to a new epoch.

## 2. First-Principles Invariants

The architecture follows these non-negotiable truths:

1. The callback cannot allocate, lock, log, perform I/O, block, or do work that
   grows with seek distance.
2. A reader must never observe a slot while the producer writes it.
3. A producer must never reclaim PCM that a pending backward seek can still
   make audible.
4. Every addressable PCM sample needs producer-published output-frame identity.
5. A source already opened by a seekable decoder should remain open across
   seeks unless typed recovery requires otherwise.
6. The process cannot enforce a memory budget by counting only selected
   references; allocation capacity must be reserved before allocation.
7. Command state, realtime state, and telemetry have different owners and
   cache-access patterns and must not be one monolithic bag of atomics.
8. A user-visible seek target and the last audible frame are different while a
   seek is pending. They belong in one playback-clock protocol, not in two
   competing position fields.

## 3. Architecture

```text
server / AudioPlayer command owner
  |
  | create, seek, pause, cancel, settings
  v
StreamingSession -----------------------------------------------+
  | StreamingControl (command-thread only)                      |
  | ProducerHandle + latest-wins source-seek mailbox            |
  | StreamSourceFactory / source identity                       |
  | DecodedMemoryReservation                                    |
  |                                                              |
  +----> persistent producer thread                              |
  |        owns OpenedSource -> StreamingDecoder -> resampler    |
  |        reused scratch -> PcmWindow slot publication          |
  |                                                              |
  +----> StreamingRtView <---------------- audio callback         |
  |        window pointer, generation/epoch, seek mailbox         |
  |        producer cursors, callback result/clock publication    |
  |                                                              |
  +----> StreamingTelemetry (cold counters/histograms)            |
  |                                                              |
  +----> PcmWindow                                                |
           one aligned payload allocation                        |
           slot stamps + valid-frame metadata                    |
           absolute epoch origin                                 |
           [retained_start, audible/requested, produced_end)      |
```

The callback and producer share samples only through `PcmWindow`. The callback
never touches `StreamingControl`, the producer's decoder, source hooks, budget
ledger, or telemetry aggregation locks.

## 4. Ownership and Threads

| Component | Owner | Thread(s) | Synchronization |
| --- | --- | --- | --- |
| `StreamingControl` | `AudioPlayer` | command/server blocking thread | ordinary mutable fields |
| `ProducerHandle` | `StreamingSession` | command owner + producer wake | atomics + `Unparker`; join off-RT |
| decoder/source/resampler | producer | exactly one producer thread | no shared mutation |
| producer publish/reclaim state | producer + command owner | off-RT only | short `parking_lot::Mutex` gate |
| `PcmWindow` samples | session | producer + callback | slot stamp ownership protocol |
| playback clock | shared player clock | callback writer, command readers/requesters | serial-tagged atomics/seqlock shape |
| seek mailbox | command owner + callback | command -> callback -> command/producer | cache-line-isolated atomics |
| telemetry | session | phase-boundary writers, off-RT readers | relaxed counters; no hot logging |
| old window destruction | retire drainer | off-RT audio command loop | existing retired-resource queue |

Only one producer may write a given active window. Only the active audio
callback may claim slots for reading. Tests may construct explicit producer and
consumer handles, but production APIs do not clone those roles.

## 5. Proposed Module Boundaries

```text
src/player/streaming/
  mod.rs                 StreamingSession public player boundary
  pcm_window.rs          storage, slot state machine, reader/writer handles
  producer.rs            persistent worker and latest-wins control mailbox
  source.rs              factory/opened-source contracts and local impl
  memory.rs              DecodedMemoryLedger + RAII reservations
  telemetry.rs           cold counters and benchmark snapshots
```

`state.rs` retains top-level player state but contains only a
`StreamingRtView`, not dozens of public streaming fields. `loading.rs` keeps
legacy non-streaming decode helpers; v2 producer logic moves out so the new
session does not become another large set of free functions.

## 6. PCM Window Geometry

### 6.1 Slot payload

The target payload is 64 KiB of interleaved `f64` PCM per slot. Frame count is
computed once from output channel count:

```text
raw_frames  = 64 KiB / (channels * sizeof(f64))
slot_frames = floor_power_of_two(clamp(raw_frames, 512, 4096))
slot_samples = slot_frames * channels
```

Examples:

| Channels | Slot frames | Payload |
| ---: | ---: | ---: |
| 1 | 4096 | 32 KiB |
| 2 | 4096 | 64 KiB |
| 6 | 1024 | 48 KiB |
| 8 | 1024 | 64 KiB |

Power-of-two frame geometry makes frame-to-sequence and frame-to-offset mapping
a shift/mask operation. Slot count is also rounded down to a power of two so
sequence-to-physical-slot mapping is a mask. The ledger reserves the rounded
physical size, not the requested setting value.

### 6.2 Epoch coordinates

Each window has a monotonically increasing `epoch` and an epoch origin in
absolute output frames:

```text
slot_start(sequence) = origin_frame + sequence * slot_frames
slot_index(sequence) = sequence & (slot_count - 1)
```

Initial load uses origin 0. An out-of-window source seek resets the window to a
new epoch whose origin is the exact requested output frame. The producer
decodes/discards coarse-seek pre-roll and publishes sequence 0 beginning exactly
at that origin.

`retained_start_frame` and `produced_end_frame` are absolute. The logical
resident interval is half-open:

```text
[retained_start_frame, produced_end_frame)
```

The callback's audible frame and a pending requested frame come from the shared
playback-clock protocol. They are not inferred from slot count or queue length.

### 6.3 Physical storage

One 64-byte-aligned allocation owns all sample payload. Slot metadata is a
separate boxed array so callback/producer stamp traffic does not share lines
with sample payload. The payload is represented as `MaybeUninit<f64>` and is not
eagerly cleared or touched at session creation. A reader can reach only the
producer-initialized `valid_frames` span after a `Ready` publication. Reset
changes stamps and cursors and does not clear or read old PCM bytes.

Conceptual shape:

```rust
pub struct PcmWindow {
    storage: AlignedPcmStorage<MaybeUninit<f64>>,
    slots: Box<[PcmSlotMeta]>,
    slot_frames: u32,
    slot_count_mask: usize,
    channels: u16,
    epoch: AtomicU64,
    origin_frame: AtomicU64,
    reservation: DecodedMemoryReservation,
}

#[repr(align(64))]
struct PcmSlotMeta {
    // High bits: sequence + 1. Low two bits: state.
    stamp: AtomicU64,
    valid_frames: AtomicU32,
}
```

The reservation lives with the allocation, so the ledger remains charged until
the last old-window `Arc` is destroyed off-RT.

## 7. Slot Ownership Protocol

### 7.1 Stamp states

The low two stamp bits encode:

```text
00 Vacant
01 Writing
10 Ready
11 Reading
```

Sequence is stored as `sequence + 1` in the remaining bits so all-zero remains
the unique vacant stamp. A sequence cannot wrap in a practical track lifetime;
overflow is a checked visible error, not wrapping ABA behavior.

### 7.2 Producer publication

1. Under the off-RT publish/reclaim gate, select the physical slot.
2. Verify an old `Ready` sequence is reclaimable, or the slot is `Vacant`.
3. CAS the stamp to `Writing(new_sequence)` with `AcqRel`.
4. Release the gate. Copy reused decoder/resampler output into the slot payload.
5. Store `valid_frames`.
6. Store `Ready(new_sequence)` with `Release`.
7. Store `produced_end_frame` with `Release` only after the ready publication.

If the CAS observes `Reading`, the producer cannot write that slot. It retries
or parks off-RT. It never waits in the callback.

### 7.3 Callback claim

1. Compute expected sequence and physical index from the callback-local cursor.
2. Load the exact `Ready(expected_sequence)` stamp.
3. CAS it to `Reading(expected_sequence)` with `AcqRel`.
4. Read `valid_frames` and copy only the requested initialized span into the
   callback's preallocated process scratch.
5. Store `Ready(expected_sequence)` with `Release` before returning or moving to
   another slot.

A failed exact CAS is a bounded miss. The callback does not scan, pop, retry an
unbounded number of slots, or infer another sequence.

### 7.4 Unsafe boundary

`AlignedPcmStorage` requires `UnsafeCell`/raw slices because the producer writes
and callback reads one allocation concurrently. Unsafe code is isolated in
`pcm_window.rs`. Its safety argument is:

- only a `Writing(sequence)` owner obtains a mutable slot slice;
- only a successful `Reading(sequence)` owner obtains a shared slot slice;
- those stamp states are mutually exclusive through one atomic CAS;
- the writer initializes every sample covered by `valid_frames` before publish,
  and the reader never creates an initialized `f64` slice beyond that span;
- producer writes and `valid_frames` happen-before `Ready` release;
- callback's acquire claim happens-after that release;
- reset/reclamation cannot mutate a `Reading` slot;
- reader and writer handles are single-role and not clonable.

Every unsafe block carries this local proof. Miri covers slice bounds/lifetime;
Loom models stamp transitions, publication order, reclaim races, and reset.

## 8. Realtime View and Cache Lines

`StreamingRtView` is stable for the life of `SharedState`; it points to the
current session window and contains three isolated write domains:

```rust
pub struct StreamingRtView {
    pub window: ArcSwapOption<PcmWindow>,
    pub identity: CachePadded<WindowIdentity>,
    pub producer: CachePadded<ProducerPublished>,
    pub callback: CachePadded<CallbackPublished>,
    pub seek: CachePadded<WindowSeekMailbox>,
}

struct WindowIdentity {
    generation: AtomicU64,
    epoch: AtomicU64,
    active: AtomicBool,
}

struct ProducerPublished {
    retained_start_frame: AtomicU64,
    produced_end_frame: AtomicU64,
    decode_state: AtomicU8,
}

struct CallbackPublished {
    applied_seek_serial: AtomicU64,
    applied_seek_result: AtomicU8,
    observed_generation: AtomicU64,
    observed_epoch: AtomicU64,
}

struct WindowSeekMailbox {
    target_frame: AtomicU64,
    request_generation: AtomicU64,
    request_epoch: AtomicU64,
    request_kind: AtomicU8,
    request_serial: AtomicU64,
}
```

The real implementation may use the project's own cache-padding wrapper rather
than adding a crate. The requirement is physical separation verified by
`size_of`/offset tests, not a specific helper name.

The callback caches the current `Arc<PcmWindow>` only when generation changes.
The replaced window `Arc` is moved to the existing off-RT retire queue; no final
reference is dropped in the callback. There is no per-callback Arc load/clone.

Telemetry counters do not share any of these cache lines.

## 9. Playback Clock Contract

The existing seek slot correctly prevents stale callback position writes, but
it conflates requested and audible position by immediately storing the target in
`position_frames`. V2 coordinates with `06-08-shared-state-split` to define one
clock object containing:

```text
requested_frame + request_serial
audible_frame + applied_serial
render span + monotonic anchor
```

- API/UI may expose the requested frame while a seek is pending.
- Producer reclaim decisions use only audible frame plus pending backward
  protection.
- Callback rendering uses a callback-local cursor and publishes audible frame.
- Applied serial/result establishes whether requested and audible positions have
  converged.
- Render-clock span and target belong to the same seqlock/triple-buffer
  publication so readers cannot combine values from different callbacks.

Until the shared-state split lands, v2 may adapt the existing `seek_slot_*`
fields behind typed accessors, but it must not add another public position
atomic.

## 10. Callback Flow

At the top of each output callback:

1. Read current generation/active state.
2. On generation change, obtain and cache the installed window; retire the old
   cached window off-RT.
3. Consume the latest seek mailbox serial.
4. If generation/epoch match, validate target against producer-published bounds
   and the exact slot stamp.
5. On hit, set callback-local cursor to target, publish applied success, and
   request one DSP/resampler discontinuity reset.
6. On miss/stale request, publish typed result without changing the cursor.
7. Render only the number of output frames requested, claiming and releasing
   intersecting slots as described above.
8. Publish audible position/render clock guarded by the observed seek serial.
9. Fill any unavailable tail with silence and update bounded shortfall counters.

The callback never discards intermediate slots to seek. +100 ms and +60 s have
the same mailbox and first-slot operations.

## 11. Window Seek Protocols

### 11.1 Common mailbox ordering

The requester stores target, generation, epoch, and kind with `Release`, then
increments request serial with `AcqRel`. The callback loads request serial with
`Acquire` before reading fields. It stores result first and applied serial last
with `Release`. Command/producer readers load applied serial with `Acquire`.

Requests are latest-wins. A callback that sees a changed serial before position
publication refuses/repairs the old publication, preserving the landed
seek-race contract.

### 11.2 Forward in-window seek

Forward targets satisfy:

```text
audible_frame < target < produced_end_frame
```

The command owner performs a coarse bounds check and publishes the mailbox.
No producer gate is required because advancing the read floor cannot make a
previously safe reclaim unsafe. The callback performs exact epoch/sequence and
valid-frame checks, changes its local cursor, and acknowledges.

The producer continues decoding from `produced_end_frame`; decoder state is not
changed. Frames skipped for playback remain in the same window until normal
reclamation, so an immediate backward seek can address them without waiting for
an off-RT retire drainer.

### 11.3 Backward in-window seek

Backward targets satisfy:

```text
retained_start_frame <= target <= audible_frame
```

The command owner:

1. locks the producer's off-RT publish/reclaim gate;
2. re-reads epoch, retained start, produced end, and the target slot stamp;
3. publishes the backward mailbox request and target protection floor;
4. unlocks the gate.

While a matching backward request is unapplied, producer reclaim uses:

```text
reclaim_floor = min(audible_frame, protected_target_frame)
```

After callback success, it stores the new audible frame before applied serial;
the producer's acquire read therefore safely replaces protection with the new
read floor. A miss/supersession ends protection and moves to source-seek logic.

No callback lock is involved. If playback is paused, the pending request remains
protected until resume invokes the callback.

### 11.4 Target in current slot

Because the callback releases slot claims before returning, seek consumption at
the next callback begins with all slots `Ready` or `Vacant/Writing`. Target
inside a slot is a sequence claim plus sample offset; no partial-block copy or
new allocation is required.

### 11.5 Window miss

Miss results are typed:

- `BeforeRetainedStart`
- `AtOrPastProducedEnd`
- `EpochMismatch`
- `SequenceUnavailable`
- `Superseded`
- `Inactive`

The command owner may retry classification once only when a concurrent producer
publication can turn `AtOrPastProducedEnd` into a hit. Other misses enqueue a
source seek. There is no silent fallback loop.

## 12. Out-of-Window Source Seek

Source seek uses a separate producer mailbox because decoder ownership is
producer-only.

1. Command owner publishes requested frame/serial and marks window output
   inactive/loading for that source-seek serial.
2. Producer wakes and coalesces to the latest serial.
3. Under the publish/reclaim gate, producer prevents new publication and waits
   until no slot stamp is `Reading`. Callback claims last only for one callback
   invocation, so this wait is bounded in a healthy output stream.
4. Producer marks slots vacant, increments epoch, sets origin to requested
   output frame, and resets producer cursors. Sample bytes are not cleared.
5. Producer calls `StreamingDecoder::seek()` on the existing decoder.
6. Using `current_frame()`, integer sample-rate conversion, and reused scratch,
   producer feeds any required pre-roll through the resampler and discards
   output before the exact requested output frame.
7. Producer publishes sequence 0 onward, reaches the source-specific startup
   threshold, then publishes ready for the new epoch.
8. Callback starts at epoch origin and acknowledges audible progress.

If the decoder seek returns a typed non-recoverable/refresh-required error, the
producer asks the opened-source recovery hook to reopen with expected identity.
Successful ordinary source seeks do not reopen or reprobe.

### Exact seek arithmetic

Do not accumulate `f64` time conversions. Track input and output frame positions
with checked integer rational arithmetic:

```text
target_input ~= floor(target_output * input_rate / output_rate)
actual_input = decoder.current_frame()
```

Decoded frames from `actual_input` are passed through the same resampler state
that will produce audible output. An output-frame trim accumulator drops all
frames mapped before `target_output`; the first sample copied into slot sequence
0 is exactly the target. This also prevents a cold resampler transient from
being introduced after the target.

## 13. Producer Lifecycle

### 13.1 One worker per track

The producer is created once after source open and exits only on track switch,
shutdown, or fatal current-generation error. Its main loop owns:

- `OpenedSource`/`StreamingDecoder`
- resampler and producer scratch
- next output frame/slot sequence
- current source-seek serial
- adaptive park state

Window seek does not enter this state machine except through reclaim protection.

### 13.2 Latest-wins control

Producer control is an atomic mailbox plus `Unparker`:

```text
command kind, target, generation, serial, cancel
```

Command owner writes payload then serial and unparks off-RT. Producer checks
serial at every packet, resampler batch, slot claim, and before ready/finished
publication. Multiple rapid seeks collapse to the latest serial.

### 13.3 Decode and copy path

Producer scratch is reserved once:

- decoder output `Vec`
- resampler output/carry capacity
- optional exact-seek trim state

The producer fills slots directly from borrowed/reused output spans. It does not
use `pending_samples.drain`, allocate a chunk `Vec`, wrap it in `Arc`, or clone
PCM between queue and retention.

If a core resampler API currently forces an append-only temporary `Vec`, add a
borrowed/fill API in `audio-engine-core` first. Do not hide a per-slot allocation
behind the new window abstraction.

### 13.4 Decode-ahead policy

Source capabilities return startup minimum and target-ahead duration. Producer
decodes until:

```text
produced_end_frame - audible_frame >= target_ahead_frames
```

For a track whose estimated decoded size fits the window reservation, producer
may continue to EOF so the window becomes whole-track resident. For larger or
unknown tracks it parks at the target-ahead watermark. Remaining window
capacity naturally retains playback history.

When the next physical slot would overwrite old PCM, producer may reclaim only
a `Ready` sequence strictly before `reclaim_floor`. If all capacity is unread or
protected, producer parks; it never drops sequential playback PCM.

### 13.5 Adaptive waiting

Normal callback progress is observed through audible-frame atomics. The
callback does not call an OS wake primitive. Producer wait duration is derived
from buffered-ahead duration and clamped, for example:

```text
near low water: spin/yield only for a short bounded retry
healthy ahead:  0.5..5 ms park timeout
full/high ahead: up to 20 ms park timeout
```

Seek/cancel/load commands explicitly unpark from an off-RT thread. Exact values
are benchmark-selected and become constants with rationale, not arbitrary 2 ms
polling.

### 13.6 Producer retirement

`cancel()` sets a token, bumps command serial, and unparks. The `JoinHandle` is
moved to an off-RT producer reaper so `AudioPlayer` and HTTP handlers never wait
on a blocked source read while holding the player mutex. Diagnostics expose live
and pending-reap counts. A bounded shutdown path joins all producers.

## 14. Source Boundary

### 14.1 Contracts

```rust
pub trait StreamSourceFactory: Send + Sync {
    fn open(&self, request: OpenRequest) -> Result<OpenedSource, StreamSourceError>;
}

pub struct OpenRequest {
    pub generation: u64,
    pub intent: OpenIntent,
    pub cancel: DecodeCancelToken,
    pub expected_identity: Option<SourceIdentity>,
    pub fetch_policy: Option<Arc<dyn FetchPolicy>>,
}

pub struct OpenedSource {
    pub media_source: Box<dyn MediaSource>,
    pub hint: Hint,
    pub capabilities: SourceCapabilities,
    pub identity: SourceIdentity,
    pub recovery: Option<Box<dyn SourceRecovery>>,
}
```

`OpenIntent` distinguishes initial open and identity-checked recovery. It is not
used for ordinary seek because the existing opened decoder handles that.

`SourceCapabilities` includes:

- seekability and reliable range status
- content length/decoded-size hint when known
- startup minimum and target-ahead frames
- probe/identity metadata
- whether a typed failure can attempt one recovery refresh

### 14.2 Decoder construction

`audio-engine-core` needs a constructor that probes/constructs
`StreamingDecoder` from an already-opened media source plus hint, or an
equivalent typed factory result. Ownership moves into the decoder; identity and
capabilities remain in `StreamingSession`.

Remote `RangeStream` keeps provider refresh and block cache internally through
the recovery/policy hooks defined by `07-02-remote-range-seek`. A stable source
identity, not a signed URL, keys reuse.

### 14.3 Typed errors

At minimum:

```text
Cancelled
Unsupported
NotSeekable
RangeUnavailable
CredentialsExpired
IdentityChanged
PolicyRejected
ProbeFailed
DecodeFailed
Io
```

Errors carry operation and sanitized source context. Stale serial/generation
errors are discarded without replacing current playback error state.

## 15. Decoded Memory Ledger

### 15.1 Shape

```rust
pub struct DecodedMemoryLedger {
    limit_bytes: usize,
    state: parking_lot::Mutex<LedgerState>,
}

pub struct DecodedMemoryReservation {
    ledger: Arc<DecodedMemoryLedger>,
    owner: DecodedMemoryOwner,
    bytes: usize,
}
```

Reservations are off-RT. `try_reserve(owner, bytes)` checks addition and records
owner bytes atomically under the ledger mutex. Drop releases the exact amount.

Owners include active window, pending/gapless window or legacy pending buffer,
producer scratch, resampler carry, current legacy buffer, and loaded resample
cache. The ledger counts capacities and alignment/metadata overhead. Disk cache
size is not decoded memory; a cache file loaded into RAM is.

Remote compressed block cache has a separate source-cache budget because it is
not decoded PCM, but both budgets appear in process memory diagnostics.

### 15.2 Window sizing

`streaming_pcm_window_limit_mib` defaults to the existing 256 MiB value. At
session creation:

1. clamp against configured and process limits;
2. reserve fixed producer scratch first;
3. derive slot geometry from output channels;
4. round slot count down to a power of two and enforce the source startup
   minimum plus safety slots;
5. reserve metadata, padding, and payload before allocating;
6. fail visibly or choose the non-streaming compatibility path if the minimum
   cannot be reserved.

Optional gapless preload is lower priority. It may reserve remaining bytes or be
skipped; it cannot overcommit active playback.

### 15.3 Settings migration

Rename persisted/API/UI setting:

```text
streaming_full_buffer_limit_mib -> streaming_pcm_window_limit_mib
```

A one-time deserialization migration reads the old field when the new field is
absent, writes the new field on the next save, and does not maintain two runtime
settings. UI copy changes from "full buffer" to "streaming PCM window". Runtime
changes affect only the next session.

## 16. Session and State Machine

Command-side lifecycle:

```text
Idle
  -> Opening
  -> Priming
  -> Ready/Playing <-> ProducerParked
  -> WindowSeekPending -> Playing/Paused
  -> SourceSeeking -> Priming -> Playing/Paused
  -> Draining -> Ended
  -> Cancelling -> Idle
any -> Error (current generation only)
```

`WindowSeekPending` does not stop producer decode, except that backward
protection may force normal capacity backpressure. `SourceSeeking` deactivates
window output and resets the epoch. Paused state is orthogonal user intent and
is preserved across both seek kinds.

Track generation changes only on track/session replacement. Window epoch changes
on source seek within a track. Seek serial changes on every user seek. This
separation avoids using generation churn to represent cursor movement.

## 17. Ready, EOF, and Resident Behavior

- Ready publishes after source-specific minimum ahead frames are `Ready` and
  producer cursor publication is complete.
- Callback does not start from a count of slots; it starts from exact epoch
  origin and produced end.
- EOF publishes final `produced_end_frame` and `decode_state=Finished`.
- If the entire track remains in the window, all seeks are resident without a
  storage conversion.
- If old slots were reclaimed, EOF does not materialize a second full buffer;
  out-of-window seeks reuse decoder/source seek.
- The streaming path therefore has no `StreamingLoadFinished { Some(samples) }`
  promotion and no `streaming_memory_mode` split.
- With streaming disabled, existing `LoadComplete`/`audio_buffer` behavior is
  unchanged.

## 18. Gapless and Track Switch

This task does not redesign gapless policy, but memory/lifetime must be safe:

- Legacy pending `audio_buffer` remains allowed initially and reserves through
  the ledger.
- A future pending PCM-window session may be installed atomically at the track
  boundary, but that is not required to complete v2.
- Callback releases all slot claims before return. On track switch it swaps the
  cached window once and retires the old window `Arc` off-RT.
- New active-window allocation may overlap old memory only when the ledger has a
  reservation for both. Otherwise stop-for-load first retires the old window,
  then allocates the replacement off-RT.
- Track-switch seek/reset supersedes any mailbox request tagged with the old
  generation.

## 19. Telemetry and Benchmark Evidence

### 19.1 Metrics

Cold metrics include:

- slot capacity, used slots, retained/ahead frames and bytes
- producer publish/reclaim/park counts and park duration
- exact slot claim misses by reason
- seek request/applied/miss/superseded counts and latency histogram
- source seek/reopen/probe-reuse/network-request counts
- reservation bytes by owner, rejects, and preload preemptions
- producer threads live, cancelled, and reaped
- callback shortfall/underrun/recovery counters already exposed

Callback records only bounded relaxed counter increments and timestamp samples
at seek application, not per-slot logs.

### 19.2 Required benchmarks

1. `pcm_window_micro`: current `ArrayQueue<Arc<Vec>>` versus preallocated window
   publication/consume throughput, cross-thread contention, allocations, and
   slot-claim cost.
2. callback perf: streaming render p50/p95/p99/p99.9/p99.99/max and deadline
   misses, with and without DSP/resampling.
3. seek latency: forward/backward target-inside-slot and cross-slot at +100 ms,
   +/-5 s, and +/-60 s where resident; report command-to-applied and
   first-audible-target latency.
4. distance independence: callback operation count/time must not scale with jump
   distance.
5. source seek: persistent decoder seek versus current cancel/spawn/open path.
6. allocation: pipeline-owned allocation count/bytes after warm-up per decoded
   second and per seek.
7. memory: ledger reservations, committed PCM, process private bytes, rapid
   track-switch transient peak, and gapless overlap.
8. stability: queue/window shortfall, underrun, recovery, stale publish, and
   producer-thread counts over long playback and rapid seek.

Test matrix includes 44.1/48/96/192 kHz, stereo and supported multichannel,
local WAV/FLAC/MP3/AAC fixtures, remote range source when available, CPAL shared
mode, and exclusive WASAPI.

### 19.3 Gates

- Window seek p99 <= one callback period + 1 ms.
- Callback p99.99 <= baseline * 1.03 and max <= baseline * 1.05.
- Zero callback allocation/lock and zero pipeline-owned per-slot heap allocation
  after setup.
- Zero decoder seek/open/network request for window seeks.
- Exact first audible target frame in deterministic tests.
- Decoded allocations never exceed reservations or process budget.
- One active producer thread under seek stress; all cancelled workers reaped.
- Controlled benchmark underrun and output-stream recovery counts remain zero.

"No worse than baseline" alone is not enough. The new path must show the
expected allocation and seek-latency improvements, or the old path is not
deleted.

## 20. Failure and Recovery

| Failure | Behavior |
| --- | --- |
| exact slot unavailable for window seek | typed miss, then source seek |
| producer sees protected/unread slot at wrap | park; never overwrite |
| slot remains `Reading` during epoch reset | wait off-RT with watchdog; never force-write |
| minimum window cannot reserve | visible budget error or non-streaming compatibility path before playback starts |
| pending preload cannot reserve | skip/preempt preload; active playback continues |
| decoder ordinary seek fails recoverably | identity-checked source recovery once |
| source identity changes | fail/restart generation visibly; never splice PCM |
| stale producer command/result | ignore by generation/serial |
| producer panic/disconnect | current-generation playback error; reaper accounts thread |
| callback misses not-yet-produced data | loading silence + shortfall metric; no invalid read |

## 21. Migration Strategy

1. Add benchmark and window module with no player integration.
2. Prove the slot state machine with unit/Loom/Miri tests and microbenchmarks.
3. Introduce ownership planes and memory ledger while old streaming behavior is
   still active.
4. Add persistent producer/source session behind a temporary development flag.
5. Integrate callback window rendering and compare old/new callback evidence.
6. Add forward/backward window seek and source-seek reset/reuse.
7. Migrate config/diagnostics and remote source seam.
8. Run full gates, then remove the temporary flag and delete the old chunk queue,
   retention ring, replay prefix, PCM retire routing, and promotion path.
9. Update `.trellis/spec/backend/quality-guidelines.md` to make the PCM-window
   contract authoritative.

The development flag is not a shipped compatibility layer. The task is not
complete while both production streaming transports remain.

## 22. Rejected Alternatives

### Producer-stamped allocated chunks

Adding `start_frame` fixes forward classification but keeps allocation, Arc
traffic, MPMC queue overhead, queue snapshots/drains, retirement, and a second
retention structure. It is an acceptable small patch, not the requested
performance architecture.

### Callback skip-ahead

Popping N chunks makes callback cost proportional to seek distance and can burst
retire FIFO traffic. It also delays immediate backward availability until an
off-RT drainer runs. Rejected.

### Replay the forward queue under a new generation

`ArrayQueue` has no stable snapshot; draining/re-pushing races the callback and
duplicates reference work. Generation churn also restarts producer/source state
for an in-memory cursor change. Rejected.

### Generic consuming SPSC ring

Available SPSC queues are optimized for destructive sequential consumption.
They do not retain random-addressable history or safely move a read cursor
backward. Wrapping one would recreate a second retention store. Rejected.

### Contiguous ring with only read/write atomics

Without per-slot ownership, a backward-seek/reclaim race can make the producer
overwrite memory while the callback reads it. Rust also cannot express the
shared mutable payload safely from cursors alone. The slot stamp protocol is the
minimum mechanism that proves exclusion. Rejected.

### Pooled `Arc<Vec<f64>>` blocks

Pooling removes most allocation but retains atomic refcount traffic, final-drop
retirement, ownership transfer, and O(n) prefix assembly. It is a fallback only
if the preallocated-window benchmark unexpectedly loses, not the primary plan.

### Reopen decoder on every source seek

This discards probe, demuxer, source identity, remote range cache, and thread
warmth. The existing decoder is seekable. Reopen is recovery, not normal flow.

### Monolithic `StreamingSession` atomics

Moving all current fields under one struct without defining writer domains
preserves duplicate truth and false sharing. The session is an aggregate of
control, RT, and telemetry planes, not one cache layout.

## 23. Main Trade-offs

- The slot protocol introduces narrowly-scoped unsafe storage code. That cost is
  justified by eliminating per-block allocation while retaining random access;
  it is contained by a small API, safety proof, Loom, and Miri.
- A CAS claim/release occurs for each slot span copied by the callback. With
  cache-sized slots this is bounded and infrequent relative to sample/DSP work;
  callback benchmarks decide the final slot geometry.
- A 256 MiB default window reserves address space/capacity up front instead of
  growing on demand. This makes the budget truthful and latency deterministic.
  `MaybeUninit` avoids an eager full-window clear, while physical-page commitment
  and lower-memory settings are still measured in the memory gate.
- Persistent producers require explicit cancellation/reaping and a control
  mailbox, but remove repeated thread/open/probe costs and make rapid-seek thread
  count bounded.
- Separating requested and audible positions changes internal clock semantics.
  It is necessary to acknowledge seeks correctly and must be co-designed once
  with `06-08-shared-state-split`.

## 24. Design Readiness

This design resolves the previous blockers:

- forward PCM has producer-published absolute identity;
- both seek directions are O(1) cursor changes;
- RT work is distance-independent;
- skipped forward PCM is immediately available for backward seek;
- memory is one fixed allocation with exact reservation;
- session ownership and hot cache lines are explicit;
- source/decoder reuse is the normal path;
- benchmark gates test tail latency, allocation, memory, and both seek directions.

Implementation remains blocked on user approval of the planning artifacts, not
on an unresolved choice between skip-ahead and replay-prefix strategies.
