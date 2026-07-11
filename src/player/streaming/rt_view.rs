//! Cache-line-isolated realtime coordination for the streaming PCM window.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;

use arc_swap::ArcSwapOption;

use super::pcm_window::PcmWindow;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum StreamingDecodeState {
    Inactive = 0,
    Loading = 1,
    Ready = 2,
    EndOfStream = 3,
    Failed = 4,
}

impl StreamingDecodeState {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Loading,
            2 => Self::Ready,
            3 => Self::EndOfStream,
            4 => Self::Failed,
            _ => Self::Inactive,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum WindowSeekKind {
    Forward = 0,
    Backward = 1,
}

impl WindowSeekKind {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Backward,
            _ => Self::Forward,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum WindowSeekResult {
    None = 0,
    Applied = 1,
    OutsideResidentRange = 2,
    SlotUnavailable = 3,
    StaleIdentity = 4,
    Superseded = 5,
}

impl WindowSeekResult {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Applied,
            2 => Self::OutsideResidentRange,
            3 => Self::SlotUnavailable,
            4 => Self::StaleIdentity,
            5 => Self::Superseded,
            _ => Self::None,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowIdentitySnapshot {
    pub generation: u64,
    pub epoch: u64,
    pub active: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProducerSnapshot {
    pub retained_start_frame: u64,
    pub produced_end_frame: u64,
    pub decode_state: StreamingDecodeState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct WindowSeekRequest {
    pub serial: u64,
    pub target_frame: u64,
    pub generation: u64,
    pub epoch: u64,
    pub kind: WindowSeekKind,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct AppliedWindowSeek {
    pub serial: u64,
    pub result: WindowSeekResult,
    pub audible_frame: u64,
    pub observed_generation: u64,
    pub observed_epoch: u64,
}

#[repr(C, align(64))]
pub(crate) struct WindowIdentity {
    generation: AtomicU64,
    epoch: AtomicU64,
    active: AtomicBool,
}

#[repr(C, align(64))]
pub(crate) struct ProducerPublished {
    retained_start_frame: AtomicU64,
    produced_end_frame: AtomicU64,
    decode_state: AtomicU8,
}

#[repr(C, align(64))]
pub(crate) struct CallbackPublished {
    applied_seek_serial: AtomicU64,
    applied_seek_result: AtomicU8,
    audible_frame: AtomicU64,
    observed_generation: AtomicU64,
    observed_epoch: AtomicU64,
    render_cursor_frame: AtomicU64,
}

#[repr(C, align(64))]
pub(crate) struct WindowSeekMailbox {
    target_frame: AtomicU64,
    request_generation: AtomicU64,
    request_epoch: AtomicU64,
    request_kind: AtomicU8,
    request_serial: AtomicU64,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct StreamingSeekTelemetrySnapshot {
    pub requests: u64,
    pub applied: u64,
    pub misses: u64,
    pub superseded: u64,
    pub latency_buckets: [u64; 5],
    pub source_seek_requests: u64,
    pub source_seek_applied: u64,
    pub workers_spawned: u64,
    pub workers_live: u64,
    pub workers_cancelled: u64,
    pub workers_failed: u64,
}

#[repr(C, align(64))]
struct StreamingSeekTelemetry {
    request_time_ms: AtomicU64,
    request_time_serial: AtomicU64,
    requests: AtomicU64,
    applied: AtomicU64,
    misses: AtomicU64,
    superseded: AtomicU64,
    latency_buckets: [AtomicU64; 5],
    source_seek_requests: AtomicU64,
    source_seek_applied: AtomicU64,
    workers_spawned: AtomicU64,
    workers_live: AtomicU64,
    workers_cancelled: AtomicU64,
    workers_failed: AtomicU64,
}

/// Stable realtime-facing window state. Each mutable write domain occupies a
/// distinct cache line; telemetry and command-owned lifecycle state live elsewhere.
#[repr(C, align(64))]
pub(crate) struct StreamingRtView {
    window: ArcSwapOption<PcmWindow>,
    identity: WindowIdentity,
    producer: ProducerPublished,
    callback: CallbackPublished,
    seek: WindowSeekMailbox,
    telemetry: StreamingSeekTelemetry,
}

impl StreamingRtView {
    pub(crate) fn new() -> Self {
        Self {
            window: ArcSwapOption::empty(),
            identity: WindowIdentity {
                generation: AtomicU64::new(0),
                epoch: AtomicU64::new(0),
                active: AtomicBool::new(false),
            },
            producer: ProducerPublished {
                retained_start_frame: AtomicU64::new(0),
                produced_end_frame: AtomicU64::new(0),
                decode_state: AtomicU8::new(StreamingDecodeState::Inactive as u8),
            },
            callback: CallbackPublished {
                applied_seek_serial: AtomicU64::new(0),
                applied_seek_result: AtomicU8::new(WindowSeekResult::None as u8),
                audible_frame: AtomicU64::new(0),
                observed_generation: AtomicU64::new(0),
                observed_epoch: AtomicU64::new(0),
                render_cursor_frame: AtomicU64::new(0),
            },
            seek: WindowSeekMailbox {
                target_frame: AtomicU64::new(0),
                request_generation: AtomicU64::new(0),
                request_epoch: AtomicU64::new(0),
                request_kind: AtomicU8::new(WindowSeekKind::Forward as u8),
                request_serial: AtomicU64::new(0),
            },
            telemetry: StreamingSeekTelemetry {
                request_time_ms: AtomicU64::new(0),
                request_time_serial: AtomicU64::new(0),
                requests: AtomicU64::new(0),
                applied: AtomicU64::new(0),
                misses: AtomicU64::new(0),
                superseded: AtomicU64::new(0),
                latency_buckets: std::array::from_fn(|_| AtomicU64::new(0)),
                source_seek_requests: AtomicU64::new(0),
                source_seek_applied: AtomicU64::new(0),
                workers_spawned: AtomicU64::new(0),
                workers_live: AtomicU64::new(0),
                workers_cancelled: AtomicU64::new(0),
                workers_failed: AtomicU64::new(0),
            },
        }
    }

    /// Off-RT installation boundary. Replaced windows must be retired off the
    /// callback thread by the eventual session integration.
    pub(crate) fn install_window(&self, window: Option<Arc<PcmWindow>>) {
        self.window.store(window);
    }

    pub(crate) fn window_snapshot(&self) -> Option<Arc<PcmWindow>> {
        self.window.load_full()
    }

    /// Clone the installed window only after the callback observes a generation
    /// change. Calling this once per callback would add forbidden Arc traffic.
    pub(crate) fn load_window_after_generation_change(&self) -> Option<Arc<PcmWindow>> {
        self.window.load_full()
    }

    /// Producer/session owner publishes epoch and activity before generation.
    pub(crate) fn publish_identity(&self, snapshot: WindowIdentitySnapshot) {
        self.identity.epoch.store(snapshot.epoch, Ordering::Relaxed);
        self.identity
            .active
            .store(snapshot.active, Ordering::Relaxed);
        self.identity
            .generation
            .store(snapshot.generation, Ordering::Release);
    }

    pub(crate) fn identity(&self) -> WindowIdentitySnapshot {
        let generation = self.identity.generation.load(Ordering::Acquire);
        WindowIdentitySnapshot {
            generation,
            epoch: self.identity.epoch.load(Ordering::Relaxed),
            active: self.identity.active.load(Ordering::Relaxed),
        }
    }

    pub(crate) fn publish_producer(&self, snapshot: ProducerSnapshot) {
        self.producer
            .retained_start_frame
            .store(snapshot.retained_start_frame, Ordering::Relaxed);
        self.producer
            .produced_end_frame
            .store(snapshot.produced_end_frame, Ordering::Relaxed);
        self.producer
            .decode_state
            .store(snapshot.decode_state as u8, Ordering::Release);
    }

    pub(crate) fn producer(&self) -> ProducerSnapshot {
        let decode_state =
            StreamingDecodeState::from_raw(self.producer.decode_state.load(Ordering::Acquire));
        ProducerSnapshot {
            retained_start_frame: self.producer.retained_start_frame.load(Ordering::Relaxed),
            produced_end_frame: self.producer.produced_end_frame.load(Ordering::Relaxed),
            decode_state,
        }
    }

    /// Single command owner writes all request fields, then publishes a new serial.
    pub(crate) fn request_seek(
        &self,
        target_frame: u64,
        generation: u64,
        epoch: u64,
        kind: WindowSeekKind,
    ) -> u64 {
        self.seek
            .target_frame
            .store(target_frame, Ordering::Relaxed);
        self.seek
            .request_generation
            .store(generation, Ordering::Relaxed);
        self.seek.request_epoch.store(epoch, Ordering::Relaxed);
        self.seek.request_kind.store(kind as u8, Ordering::Relaxed);
        let serial = self
            .seek
            .request_serial
            .load(Ordering::Relaxed)
            .wrapping_add(1);
        self.telemetry.requests.fetch_add(1, Ordering::Relaxed);
        self.telemetry.request_time_ms.store(
            crate::player::state::playback_phase_time_ms(),
            Ordering::Relaxed,
        );
        self.telemetry
            .request_time_serial
            .store(serial, Ordering::Release);
        let published = self
            .seek
            .request_serial
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        debug_assert_eq!(published, serial);
        serial
    }

    /// Returns no snapshot when a newer request raced the read. The callback can
    /// retry on its next invocation without an unbounded realtime loop.
    pub(crate) fn seek_request(&self) -> Option<WindowSeekRequest> {
        let serial = self.seek.request_serial.load(Ordering::Acquire);
        if serial == 0 {
            return None;
        }
        let request = WindowSeekRequest {
            serial,
            target_frame: self.seek.target_frame.load(Ordering::Relaxed),
            generation: self.seek.request_generation.load(Ordering::Relaxed),
            epoch: self.seek.request_epoch.load(Ordering::Relaxed),
            kind: WindowSeekKind::from_raw(self.seek.request_kind.load(Ordering::Relaxed)),
        };
        (self.seek.request_serial.load(Ordering::Acquire) == serial).then_some(request)
    }

    pub(crate) fn is_latest_seek_serial(&self, serial: u64) -> bool {
        self.seek.request_serial.load(Ordering::Acquire) == serial
    }

    /// Callback owner publishes result fields before the release-store of the
    /// applied serial. Readers acquire that serial before consuming the result.
    pub(crate) fn publish_applied_seek(&self, applied: AppliedWindowSeek) {
        self.callback
            .applied_seek_result
            .store(applied.result as u8, Ordering::Relaxed);
        self.callback
            .audible_frame
            .store(applied.audible_frame, Ordering::Relaxed);
        self.callback
            .observed_generation
            .store(applied.observed_generation, Ordering::Relaxed);
        self.callback
            .observed_epoch
            .store(applied.observed_epoch, Ordering::Relaxed);
        self.callback
            .applied_seek_serial
            .store(applied.serial, Ordering::Release);
        match applied.result {
            WindowSeekResult::Applied => {
                self.telemetry.applied.fetch_add(1, Ordering::Relaxed);
            }
            WindowSeekResult::Superseded => {
                self.telemetry.superseded.fetch_add(1, Ordering::Relaxed);
            }
            _ => {
                self.telemetry.misses.fetch_add(1, Ordering::Relaxed);
            }
        }
        if self.telemetry.request_time_serial.load(Ordering::Acquire) == applied.serial {
            let elapsed_ms = crate::player::state::playback_phase_time_ms()
                .saturating_sub(self.telemetry.request_time_ms.load(Ordering::Relaxed));
            let bucket = match elapsed_ms {
                0 => 0,
                1..=4 => 1,
                5..=19 => 2,
                20..=99 => 3,
                _ => 4,
            };
            self.telemetry.latency_buckets[bucket].fetch_add(1, Ordering::Relaxed);
        }
    }

    pub(crate) fn applied_seek(&self) -> Option<AppliedWindowSeek> {
        let serial = self.callback.applied_seek_serial.load(Ordering::Acquire);
        if serial == 0 {
            return None;
        }
        let applied = AppliedWindowSeek {
            serial,
            result: WindowSeekResult::from_raw(
                self.callback.applied_seek_result.load(Ordering::Relaxed),
            ),
            audible_frame: self.callback.audible_frame.load(Ordering::Relaxed),
            observed_generation: self.callback.observed_generation.load(Ordering::Relaxed),
            observed_epoch: self.callback.observed_epoch.load(Ordering::Relaxed),
        };
        (self.callback.applied_seek_serial.load(Ordering::Acquire) == serial).then_some(applied)
    }

    pub(crate) fn publish_render_cursor(&self, frame: u64) {
        self.callback
            .render_cursor_frame
            .store(frame, Ordering::Release);
    }

    pub(crate) fn render_cursor(&self) -> u64 {
        self.callback.render_cursor_frame.load(Ordering::Acquire)
    }

    pub(crate) fn seek_telemetry(&self) -> StreamingSeekTelemetrySnapshot {
        StreamingSeekTelemetrySnapshot {
            requests: self.telemetry.requests.load(Ordering::Relaxed),
            applied: self.telemetry.applied.load(Ordering::Relaxed),
            misses: self.telemetry.misses.load(Ordering::Relaxed),
            superseded: self.telemetry.superseded.load(Ordering::Relaxed),
            latency_buckets: std::array::from_fn(|index| {
                self.telemetry.latency_buckets[index].load(Ordering::Relaxed)
            }),
            source_seek_requests: self.telemetry.source_seek_requests.load(Ordering::Relaxed),
            source_seek_applied: self.telemetry.source_seek_applied.load(Ordering::Relaxed),
            workers_spawned: self.telemetry.workers_spawned.load(Ordering::Relaxed),
            workers_live: self.telemetry.workers_live.load(Ordering::Relaxed),
            workers_cancelled: self.telemetry.workers_cancelled.load(Ordering::Relaxed),
            workers_failed: self.telemetry.workers_failed.load(Ordering::Relaxed),
        }
    }

    pub(crate) fn record_source_seek_request(&self) {
        self.telemetry
            .source_seek_requests
            .fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn record_source_seek_applied(&self) {
        self.telemetry
            .source_seek_applied
            .fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn record_worker_spawned(&self) {
        self.telemetry
            .workers_spawned
            .fetch_add(1, Ordering::Relaxed);
        self.telemetry.workers_live.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn record_worker_exited(&self, cancelled: bool, failed: bool) {
        self.telemetry.workers_live.fetch_sub(1, Ordering::Relaxed);
        if cancelled {
            self.telemetry
                .workers_cancelled
                .fetch_add(1, Ordering::Relaxed);
        }
        if failed {
            self.telemetry
                .workers_failed
                .fetch_add(1, Ordering::Relaxed);
        }
    }
}

impl Default for StreamingRtView {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::mem::{align_of, size_of};
    use std::sync::Arc;
    use std::thread;

    use super::*;

    #[test]
    fn realtime_write_domains_are_cache_line_isolated() {
        assert_eq!(align_of::<WindowIdentity>(), 64);
        assert_eq!(align_of::<ProducerPublished>(), 64);
        assert_eq!(align_of::<CallbackPublished>(), 64);
        assert_eq!(align_of::<WindowSeekMailbox>(), 64);
        assert_eq!(align_of::<StreamingSeekTelemetry>(), 64);
        assert_eq!(size_of::<WindowIdentity>() % 64, 0);
        assert_eq!(size_of::<ProducerPublished>() % 64, 0);
        assert_eq!(size_of::<CallbackPublished>() % 64, 0);
        assert_eq!(size_of::<WindowSeekMailbox>() % 64, 0);
        assert_eq!(size_of::<StreamingSeekTelemetry>() % 64, 0);

        let view = StreamingRtView::new();
        let base = &view as *const StreamingRtView as usize;
        let offsets = [
            &view.identity as *const WindowIdentity as usize - base,
            &view.producer as *const ProducerPublished as usize - base,
            &view.callback as *const CallbackPublished as usize - base,
            &view.seek as *const WindowSeekMailbox as usize - base,
            &view.telemetry as *const StreamingSeekTelemetry as usize - base,
        ];
        for offset in offsets {
            assert_eq!(offset % 64, 0);
        }
        for pair in offsets.windows(2) {
            assert!(pair[1] - pair[0] >= 64);
        }
    }

    #[test]
    fn request_fields_are_visible_after_request_serial() {
        let view = Arc::new(StreamingRtView::new());
        let reader = Arc::clone(&view);
        let join = thread::spawn(move || loop {
            if let Some(request) = reader.seek_request() {
                return request;
            }
            thread::yield_now();
        });

        assert_eq!(view.request_seek(48_123, 9, 4, WindowSeekKind::Backward), 1);
        assert_eq!(
            join.join().expect("request reader"),
            WindowSeekRequest {
                serial: 1,
                target_frame: 48_123,
                generation: 9,
                epoch: 4,
                kind: WindowSeekKind::Backward,
            }
        );
    }

    #[test]
    fn applied_fields_are_visible_after_applied_serial() {
        let view = Arc::new(StreamingRtView::new());
        let reader = Arc::clone(&view);
        let join = thread::spawn(move || loop {
            if let Some(applied) = reader.applied_seek() {
                return applied;
            }
            thread::yield_now();
        });
        let applied = AppliedWindowSeek {
            serial: 7,
            result: WindowSeekResult::Applied,
            audible_frame: 96_001,
            observed_generation: 3,
            observed_epoch: 8,
        };
        view.publish_applied_seek(applied);
        assert_eq!(join.join().expect("applied reader"), applied);
    }

    #[test]
    fn latest_seek_request_supersedes_older_request() {
        let view = StreamingRtView::new();
        assert_eq!(view.request_seek(100, 1, 2, WindowSeekKind::Forward), 1);
        assert_eq!(view.request_seek(20, 1, 2, WindowSeekKind::Backward), 2);
        assert_eq!(
            view.seek_request(),
            Some(WindowSeekRequest {
                serial: 2,
                target_frame: 20,
                generation: 1,
                epoch: 2,
                kind: WindowSeekKind::Backward,
            })
        );
    }

    #[test]
    fn seek_telemetry_counts_results_and_latest_request_latency() {
        let view = StreamingRtView::new();
        let applied_serial = view.request_seek(100, 1, 2, WindowSeekKind::Forward);
        view.publish_applied_seek(AppliedWindowSeek {
            serial: applied_serial,
            result: WindowSeekResult::Applied,
            audible_frame: 100,
            observed_generation: 1,
            observed_epoch: 2,
        });
        let miss_serial = view.request_seek(200, 1, 2, WindowSeekKind::Forward);
        view.publish_applied_seek(AppliedWindowSeek {
            serial: miss_serial,
            result: WindowSeekResult::SlotUnavailable,
            audible_frame: 100,
            observed_generation: 1,
            observed_epoch: 2,
        });
        let superseded_serial = view.request_seek(300, 1, 2, WindowSeekKind::Forward);
        view.publish_applied_seek(AppliedWindowSeek {
            serial: superseded_serial,
            result: WindowSeekResult::Superseded,
            audible_frame: 100,
            observed_generation: 1,
            observed_epoch: 2,
        });

        let telemetry = view.seek_telemetry();
        assert_eq!(telemetry.requests, 3);
        assert_eq!(telemetry.applied, 1);
        assert_eq!(telemetry.misses, 1);
        assert_eq!(telemetry.superseded, 1);
        assert_eq!(telemetry.latency_buckets.iter().sum::<u64>(), 3);
    }

    #[test]
    fn identity_and_producer_snapshots_use_typed_values() {
        let view = StreamingRtView::new();
        let identity = WindowIdentitySnapshot {
            generation: 11,
            epoch: 5,
            active: true,
        };
        let producer = ProducerSnapshot {
            retained_start_frame: 1_000,
            produced_end_frame: 9_000,
            decode_state: StreamingDecodeState::Ready,
        };
        view.publish_identity(identity);
        view.publish_producer(producer);
        assert_eq!(view.identity(), identity);
        assert_eq!(view.producer(), producer);
    }
}
