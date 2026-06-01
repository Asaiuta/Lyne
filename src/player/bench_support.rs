//! Benchmark-only facade for playback resource-budget paths.
//!
//! This module intentionally exposes a small stable surface to external
//! `benches/` targets without making the full playback internals public.

use super::buffer_budget::{
    decoded_buffer_estimate, ensure_decoded_samples_fit_budget, DecodedBufferKind,
};
use super::spectrum::SpectrumBatch;

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
