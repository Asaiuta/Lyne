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

pub fn benchmark_persistent_source_seeks_for_bench(iterations: usize) -> (Vec<u64>, Vec<u64>) {
    let path =
        std::env::temp_dir().join(format!("lyne-source-seek-bench-{}.wav", std::process::id()));
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
        .expect("open persistent seek benchmark source");
    let session = PersistentStreamingSession::start_local_with_capacity(
        opened,
        1 << 20,
        LocalSessionConfig {
            target_output_sample_rate: Some(44_100),
            epoch: 1,
            origin_frame: 0,
            phase_response: PhaseResponse::Linear,
            resample_quality: ResampleQuality::High,
        },
    )
    .expect("start persistent seek benchmark session");
    let mut persistent = Vec::with_capacity(iterations);
    for iteration in 0..iterations {
        let target = if iteration % 2 == 0 { 10_000 } else { 80_000 };
        let started = Instant::now();
        let serial = session.producer.request_source_seek(target);
        while session.producer.applied_source_seek_serial() < serial {
            std::hint::spin_loop();
        }
        persistent.push(started.elapsed().as_nanos().min(u64::MAX as u128) as u64);
    }
    let mut reopen = Vec::with_capacity(iterations);
    for _ in 0..iterations {
        let started = Instant::now();
        let opened = LocalFileSourceFactory
            .open(OpenRequest {
                generation: 1,
                intent: StreamOpenIntent::SourceSeekRecovery,
                path: &path,
                cancel: cancel(),
                credentials: None,
                expected_identity: Some(&session.identity),
                fetch_policy: StreamFetchPolicy::LocalOnly,
            })
            .expect("reopen seek benchmark source");
        let _ = StreamingDecoder::probe_opened_source(opened.source, None)
            .expect("probe reopened seek benchmark source");
        reopen.push(started.elapsed().as_nanos().min(u64::MAX as u128) as u64);
    }
    let _ = std::fs::remove_file(path);
    (persistent, reopen)
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
