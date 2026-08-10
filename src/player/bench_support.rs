//! Benchmark-only facade for playback resource-budget paths.
//!
//! This module intentionally exposes a small stable surface to external
//! `benches/` targets without making the full playback internals public.

use super::buffer_budget::{
    decoded_buffer_estimate, ensure_decoded_samples_fit_budget, DecodedBufferKind,
};
#[doc(hidden)]
pub use super::callback::AUDIO_PROCESS_BUFFER_FRAMES;

pub fn benchmark_resident_window_seeks_for_bench(
    iterations: usize,
) -> Vec<(&'static str, Vec<u64>)> {
    super::callback::benchmark_resident_window_seeks(iterations)
}
use super::spectrum::SpectrumBatch;
use super::streaming::memory::DecodedMemoryOwner;
use super::streaming::session::{LocalSessionConfig, PersistentStreamingSession};
use super::streaming::source::{
    LocalFileSourceFactory, OpenRequest, StreamFetchPolicy, StreamOpenIntent, StreamSourceFactory,
};
use crate::config::{PhaseResponse, ResampleQuality};
use crate::decoder::{DecodeCancelToken, StreamingDecoder};
use std::io::Write;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

/// Bench wrapper around a persistent streaming session plus its local WAV
/// fixture, so source-seek benchmark can interleave persistent-seek and
/// reopen-probe measures on the SAME session.
pub struct SourceSeekBench {
    fixture: std::path::PathBuf,
    session: PersistentStreamingSession,
}

fn seek_fixture_path() -> std::path::PathBuf {
    std::path::Path::new(".tmp").join(format!("source-seek-bench-{}.wav", std::process::id()))
}

/// Open the fixture + persistent session. Caller is responsible for `finish()`.
pub fn open_source_seek_bench() -> SourceSeekBench {
    let path = seek_fixture_path();
    write_seek_bench_wav(&path);
    let cancel = || DecodeCancelToken::new(Arc::new(AtomicBool::new(false)));
    let opened = LocalFileSourceFactory
        .open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::InitialPlayback,
            path: &path,
            cancel: cancel(),
            credentials: None,
            expected_identity: None,
            fetch_policy: StreamFetchPolicy::LocalOnly,
        })
        .expect("open source-seek benchmark source");
    let session = PersistentStreamingSession::start_local_with_capacity(
        opened,
        1 << 20,
        LocalSessionConfig {
            target_output_sample_rate: Some(44_100),
            epoch: 1,
            origin_frame: 0,
            phase_response: PhaseResponse::Linear,
            resample_quality: ResampleQuality::High,
            window_owner: DecodedMemoryOwner::ActiveWindow,
        },
    )
    .expect("start source-seek benchmark session");
    SourceSeekBench {
        fixture: path,
        session,
    }
}

/// Path to the fixture WAV (for provenance hashing, relative to repo root).
pub fn source_seek_bench_fixture_path(seek_bench: &SourceSeekBench) -> &std::path::Path {
    &seek_bench.fixture
}

impl SourceSeekBench {
    /// Measure one persistent seek on the open session (alternating targets).
    pub fn persistent_seek(&mut self, index: usize) -> u64 {
        let target = if index.is_multiple_of(2) {
            10_000
        } else {
            80_000
        };
        let started = Instant::now();
        let serial = self.session.producer.request_source_seek(target);
        while self.session.producer.applied_source_seek_serial() < serial {
            std::hint::spin_loop();
        }
        started.elapsed().as_nanos().min(u64::MAX as u128) as u64
    }

    /// Measure one fresh reopen + probe on the same source.
    pub fn reopen_probe(&mut self) -> u64 {
        let cancel = || DecodeCancelToken::new(Arc::new(AtomicBool::new(false)));
        let started = Instant::now();
        let opened = LocalFileSourceFactory
            .open(OpenRequest {
                generation: 1,
                intent: StreamOpenIntent::SourceSeekRecovery,
                path: &self.fixture,
                cancel: cancel(),
                credentials: None,
                expected_identity: Some(&self.session.identity),
                fetch_policy: StreamFetchPolicy::LocalOnly,
            })
            .expect("reopen source-seek benchmark source");
        let _ = StreamingDecoder::probe_opened_source(opened.source, None)
            .expect("probe reopened source-seek benchmark source");
        started.elapsed().as_nanos().min(u64::MAX as u128) as u64
    }

    /// Drop the session and remove the fixture.
    pub fn finish(self) {
        let _ = std::fs::remove_file(&self.fixture);
    }
}

/// Right-ordered percentile rank for sorted sample slices.
pub fn pct_rank(sorted: &[u64], rank: f64) -> u64 {
    sorted[((sorted.len() - 1) as f64 * rank).ceil() as usize]
}

/// Relative guard: a persistent seek p50 exceeding reopen+probe p50 by more
/// than `tolerance_ns` is a structural regression (deterministic check).
pub fn relative_guard_violated(
    persistent_p50_ns: u64,
    reopen_p50_ns: u64,
    tolerance_ns: u64,
) -> bool {
    i128::from(persistent_p50_ns) > i128::from(reopen_p50_ns) + i128::from(tolerance_ns)
}

#[cfg(test)]
mod source_seek_bench_tests {
    use super::{pct_rank, relative_guard_violated};

    #[test]
    fn pct_rank_returns_ranked_values() {
        let values = vec![100, 200, 300, 400, 500];
        assert_eq!(pct_rank(&values, 0.50), 300);
        assert_eq!(pct_rank(&values, 0.95), 500);
        assert_eq!(pct_rank(&values, 1.00), 500);
    }

    #[test]
    fn pct_rank_tiny_sample_is_stable() {
        let values = vec![42];
        assert_eq!(pct_rank(&values, 0.50), 42);
        assert_eq!(pct_rank(&values, 0.99), 42);
    }

    #[test]
    fn relative_guard_boundary_is_inclusive() {
        // Exactly at tolerance -> not violated.
        assert!(!relative_guard_violated(
            150_000 + 2_000_000,
            150_000,
            2_000_000
        ));
        // One ns over -> violated.
        assert!(relative_guard_violated(
            150_000 + 2_000_000 + 1,
            150_000,
            2_000_000
        ));
        // Normal healthy state (persistent much faster) -> not violated.
        assert!(!relative_guard_violated(8_000, 150_000, 2_000_000));
    }
}

fn write_seek_bench_wav(path: &std::path::Path) {
    const FRAMES: usize = 132_300;
    let data_bytes = FRAMES * std::mem::size_of::<i16>();
    let mut file = std::fs::File::create(path).expect("create seek benchmark fixture");
    file.write_all(b"RIFF").expect("write RIFF");
    file.write_all(&(36_u32 + data_bytes as u32).to_le_bytes())
        .expect("write size");
    file.write_all(b"WAVEfmt ").expect("write fmt");
    file.write_all(&16_u32.to_le_bytes())
        .expect("write fmt size");
    file.write_all(&1_u16.to_le_bytes()).expect("write format");
    file.write_all(&1_u16.to_le_bytes())
        .expect("write channels");
    file.write_all(&44_100_u32.to_le_bytes())
        .expect("write rate");
    file.write_all(&88_200_u32.to_le_bytes())
        .expect("write byte rate");
    file.write_all(&2_u16.to_le_bytes()).expect("write align");
    file.write_all(&16_u16.to_le_bytes()).expect("write bits");
    file.write_all(b"data").expect("write data");
    file.write_all(&(data_bytes as u32).to_le_bytes())
        .expect("write data size");
    file.write_all(&vec![0; data_bytes]).expect("write samples");
}

#[doc(hidden)]
pub use super::streaming::pcm_window::{
    PcmWindow, PcmWindowAccessError, PcmWindowError, PcmWindowGeometry, PcmWindowParts,
    PcmWindowReader, PcmWindowWriter, PublishedSlot, ReadSlot, SlotState, WriteSlot,
};

pub type SpectrumBenchSender = crossbeam::channel::Sender<SpectrumBatch>;
pub type SpectrumBenchReceiver = crossbeam::channel::Receiver<SpectrumBatch>;

pub fn spectrum_channel_for_bench(capacity: usize) -> (SpectrumBenchSender, SpectrumBenchReceiver) {
    crossbeam::channel::bounded(capacity)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DecodedBudgetBenchEstimate {
    pub samples: usize,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodedBudgetBenchKind {
    CurrentTrack,
    GaplessPreload,
}

pub fn estimate_decoded_buffer_for_bench(
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
) -> Result<DecodedBudgetBenchEstimate, String> {
    decoded_buffer_estimate(
        input_frames,
        input_sample_rate,
        output_sample_rate,
        channels,
        needs_resample,
    )
    .map(|estimate| DecodedBudgetBenchEstimate {
        samples: estimate.samples,
        bytes: estimate.bytes,
    })
}

pub fn ensure_decoded_samples_fit_budget_for_bench(
    kind: DecodedBudgetBenchKind,
    path: &str,
    samples: usize,
    existing_samples: usize,
) -> Result<(), String> {
    ensure_decoded_samples_fit_budget(
        match kind {
            DecodedBudgetBenchKind::CurrentTrack => DecodedBufferKind::CurrentTrack,
            DecodedBudgetBenchKind::GaplessPreload => DecodedBufferKind::GaplessPreload,
        },
        path,
        samples,
        existing_samples,
    )
}
