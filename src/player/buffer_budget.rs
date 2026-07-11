//! Decoded playback buffer budget checks.

use std::sync::atomic::Ordering;

use crate::diagnostics::{decode_memory_budget, DecodeMemoryBudget};

use super::state::SharedState;
use super::streaming::memory::{reserve_decoded_memory, DecodedMemoryLease, DecodedMemoryOwner};
use std::sync::Arc;

const BYTES_PER_MIB: usize = 1024 * 1024;
const F64_SAMPLE_BYTES: usize = std::mem::size_of::<f64>();
const RESAMPLER_OUTPUT_FRAME_RESERVE: usize = 64;

#[derive(Debug, Clone, Copy)]
pub(super) enum DecodedBufferKind {
    CurrentTrack,
    GaplessPreload,
    ResampleCache,
}

impl DecodedBufferKind {
    fn label(self) -> &'static str {
        match self {
            Self::CurrentTrack => "current track",
            Self::GaplessPreload => "gapless preload",
            Self::ResampleCache => "resample cache",
        }
    }

    fn owner(self) -> DecodedMemoryOwner {
        match self {
            Self::CurrentTrack => DecodedMemoryOwner::LegacyCurrentBuffer,
            Self::GaplessPreload => DecodedMemoryOwner::LegacyPendingBuffer,
            Self::ResampleCache => DecodedMemoryOwner::LoadedResampleCache,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct DecodedBufferEstimate {
    pub samples: usize,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy)]
struct DecodeShape {
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
}

#[cfg(test)]
pub(super) fn estimated_output_sample_capacity(
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
) -> usize {
    checked_estimated_output_samples(DecodeShape {
        input_frames,
        input_sample_rate,
        output_sample_rate,
        channels,
        needs_resample,
    })
    .unwrap_or(usize::MAX)
}

pub(super) fn decoded_buffer_estimate(
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
) -> Result<DecodedBufferEstimate, String> {
    let shape = DecodeShape {
        input_frames,
        input_sample_rate,
        output_sample_rate,
        channels,
        needs_resample,
    };
    let samples = checked_estimated_output_samples(shape)
        .ok_or_else(|| format!("decoded sample estimate overflowed ({})", shape.describe()))?;
    let bytes = sample_bytes(samples)
        .ok_or_else(|| format!("decoded byte estimate overflowed ({})", shape.describe()))?;
    Ok(DecodedBufferEstimate { samples, bytes })
}

pub(super) fn reserve_decoded_buffer_capacity(
    kind: DecodedBufferKind,
    path: &str,
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
    channels: usize,
    needs_resample: bool,
    existing_samples: usize,
) -> Result<usize, String> {
    let shape = DecodeShape {
        input_frames,
        input_sample_rate,
        output_sample_rate,
        channels,
        needs_resample,
    };
    let estimate = decoded_buffer_estimate(
        input_frames,
        input_sample_rate,
        output_sample_rate,
        channels,
        needs_resample,
    )?;
    ensure_samples_fit_budget(kind, path, estimate.samples, existing_samples, Some(shape))?;
    Ok(estimate.samples)
}

pub(super) fn ensure_decoded_samples_fit_budget(
    kind: DecodedBufferKind,
    path: &str,
    samples: usize,
    existing_samples: usize,
) -> Result<(), String> {
    ensure_samples_fit_budget(kind, path, samples, existing_samples, None)
}

pub(super) fn ensure_cache_file_fits_budget(
    kind: DecodedBufferKind,
    path: &str,
    cache_file_bytes: u64,
    existing_samples: usize,
) -> Result<(), String> {
    let cache_bytes = usize::try_from(cache_file_bytes).map_err(|_| {
        format!(
            "{} decoded buffer for '{}' exceeds addressable memory: cache file is {} bytes",
            kind.label(),
            path,
            cache_file_bytes
        )
    })?;
    ensure_bytes_fit_budget(kind, path, cache_bytes, existing_samples, None)
}

pub(super) fn published_decoded_samples(shared: &SharedState) -> usize {
    current_decoded_samples(shared).saturating_add(pending_decoded_samples(shared))
}

pub(super) fn record_budget_rejection<T>(
    shared: &SharedState,
    result: Result<T, String>,
) -> Result<T, String> {
    if result.is_err() {
        shared
            .decode_budget_rejection_count
            .fetch_add(1, Ordering::Relaxed);
    }
    result
}

pub(super) fn reserve_decoded_buffer_bytes(
    kind: DecodedBufferKind,
    bytes: usize,
) -> Result<Arc<DecodedMemoryLease>, String> {
    reserve_decoded_memory(kind.owner(), bytes).map_err(|error| error.to_string())
}

fn current_decoded_samples(shared: &SharedState) -> usize {
    shared.audio_buffer.load().len()
}

fn pending_decoded_samples(shared: &SharedState) -> usize {
    shared
        .pending_buffer
        .load_full()
        .as_ref()
        .map(|buffer| buffer.len())
        .unwrap_or(0)
}

fn ensure_samples_fit_budget(
    kind: DecodedBufferKind,
    path: &str,
    samples: usize,
    existing_samples: usize,
    shape: Option<DecodeShape>,
) -> Result<(), String> {
    let bytes = sample_bytes(samples)
        .ok_or_else(|| format!("{} decoded buffer byte count overflowed", kind.label()))?;
    ensure_bytes_fit_budget(kind, path, bytes, existing_samples, shape)
}

fn ensure_bytes_fit_budget(
    kind: DecodedBufferKind,
    path: &str,
    new_bytes: usize,
    existing_samples: usize,
    shape: Option<DecodeShape>,
) -> Result<(), String> {
    let budget = decode_memory_budget();
    ensure_bytes_fit_budget_with(kind, path, new_bytes, existing_samples, shape, &budget)
}

fn ensure_bytes_fit_budget_with(
    kind: DecodedBufferKind,
    path: &str,
    new_bytes: usize,
    existing_samples: usize,
    shape: Option<DecodeShape>,
    budget: &DecodeMemoryBudget,
) -> Result<(), String> {
    let existing_bytes = sample_bytes(existing_samples).ok_or_else(|| {
        format!(
            "{} existing decoded buffer byte count overflowed",
            kind.label()
        )
    })?;
    let total_bytes = existing_bytes.checked_add(new_bytes).ok_or_else(|| {
        format!(
            "{} decoded buffer for '{}' exceeds addressable memory",
            kind.label(),
            path
        )
    })?;

    if total_bytes <= budget.limit_bytes {
        return Ok(());
    }

    let shape_detail = shape
        .map(|shape| format!(" {}", shape.describe()))
        .unwrap_or_default();
    Err(format!(
        "{} decoded buffer for '{}' exceeds memory budget: new {:.1} MiB, total {:.1} MiB including existing playback buffers (limit: {} MiB via {}).{} Full-buffer playback was refused before allocation; this track needs the streaming fallback path.",
        kind.label(),
        path,
        bytes_to_mib(new_bytes),
        bytes_to_mib(total_bytes),
        budget.limit_mb,
        budget.source,
        shape_detail
    ))
}

fn checked_estimated_output_samples(shape: DecodeShape) -> Option<usize> {
    if shape.input_frames == 0 || shape.channels == 0 {
        return Some(0);
    }

    let output_frames = if shape.needs_resample && shape.input_sample_rate > 0 {
        ceil_resampled_frames(
            shape.input_frames,
            shape.input_sample_rate,
            shape.output_sample_rate,
        )?
        .checked_add(RESAMPLER_OUTPUT_FRAME_RESERVE)?
    } else {
        usize::try_from(shape.input_frames).ok()?
    };

    output_frames.checked_mul(shape.channels)
}

fn ceil_resampled_frames(
    input_frames: u64,
    input_sample_rate: u32,
    output_sample_rate: u32,
) -> Option<usize> {
    let divisor = u128::from(input_sample_rate);
    if divisor == 0 {
        return usize::try_from(input_frames).ok();
    }

    let numerator = u128::from(input_frames).checked_mul(u128::from(output_sample_rate))?;
    let frames = numerator.checked_add(divisor - 1)?.checked_div(divisor)?;
    usize::try_from(frames).ok()
}

fn sample_bytes(samples: usize) -> Option<usize> {
    samples.checked_mul(F64_SAMPLE_BYTES)
}

fn bytes_to_mib(bytes: usize) -> f64 {
    bytes as f64 / BYTES_PER_MIB as f64
}

impl DecodeShape {
    fn describe(self) -> String {
        format!(
            "input_frames={}, sample_rate={} -> {} Hz, channels={}, resample={}",
            self.input_frames,
            self.input_sample_rate,
            self.output_sample_rate,
            self.channels,
            self.needs_resample
        )
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    #[test]
    fn decoded_estimates_cover_common_stereo_rates() {
        assert_estimate_mib(44_100, 2, 40);
        assert_estimate_mib(48_000, 2, 43);
        assert_estimate_mib(96_000, 2, 87);
        assert_estimate_mib(192_000, 2, 175);
    }

    #[test]
    fn decoded_estimate_scales_with_multichannel_audio() {
        let estimate = decoded_buffer_estimate(48_000 * 60, 48_000, 48_000, 6, false).unwrap();

        assert_eq!(estimate.samples, 48_000 * 60 * 6);
        assert_eq!(estimate.bytes / BYTES_PER_MIB, 131);
    }

    #[test]
    fn capacity_estimate_accounts_for_resampler_tail() {
        assert_eq!(
            estimated_output_sample_capacity(48_000, 48_000, 96_000, 2, true),
            (96_000 + 64) * 2
        );
        assert_eq!(
            estimated_output_sample_capacity(48_000, 48_000, 48_000, 2, false),
            48_000 * 2
        );
        assert_eq!(
            estimated_output_sample_capacity(0, 48_000, 96_000, 2, true),
            0
        );
    }

    #[test]
    fn decoded_estimate_reports_overflow() {
        let err = decoded_buffer_estimate(u64::MAX, 1, u32::MAX, usize::MAX, true)
            .expect_err("estimate should overflow");

        assert!(err.contains("overflowed"));
    }

    #[test]
    fn explicit_load_budget_rejects_oversized_buffer() {
        let budget = DecodeMemoryBudget {
            limit_mb: 1,
            limit_bytes: BYTES_PER_MIB,
            source: "test",
        };
        let new_bytes = 2 * BYTES_PER_MIB;
        let err = ensure_bytes_fit_budget_with(
            DecodedBufferKind::CurrentTrack,
            "huge.flac",
            new_bytes,
            0,
            None,
            &budget,
        )
        .expect_err("oversized current track should be rejected");

        assert!(err.contains("current track"));
        assert!(err.contains("huge.flac"));
        assert!(err.contains("limit: 1 MiB"));
    }

    #[test]
    fn gapless_budget_counts_existing_playback_buffers() {
        let budget = DecodeMemoryBudget {
            limit_mb: 1,
            limit_bytes: BYTES_PER_MIB,
            source: "test",
        };
        let existing_samples = BYTES_PER_MIB / F64_SAMPLE_BYTES;
        let err = ensure_bytes_fit_budget_with(
            DecodedBufferKind::GaplessPreload,
            "next.flac",
            F64_SAMPLE_BYTES,
            existing_samples,
            None,
            &budget,
        )
        .expect_err("gapless preload should include current buffer");

        assert!(err.contains("gapless preload"));
        assert!(err.contains("including existing playback buffers"));
    }

    #[test]
    fn published_decoded_samples_counts_current_and_pending_buffers() {
        let shared = SharedState::new();
        shared.audio_buffer.store(Arc::new(vec![0.0; 4]));
        shared.pending_buffer.store(Some(Arc::new(vec![0.0; 6])));

        assert_eq!(published_decoded_samples(&shared), 10);
    }

    #[test]
    fn budget_rejection_counter_only_increments_on_error() {
        let shared = SharedState::new();

        record_budget_rejection(&shared, Ok::<_, String>(())).unwrap();
        assert_eq!(
            shared.decode_budget_rejection_count.load(Ordering::Relaxed),
            0
        );

        let err = record_budget_rejection(&shared, Err::<(), _>("too large".to_string()))
            .expect_err("budget error should be returned");

        assert_eq!(err, "too large");
        assert_eq!(
            shared.decode_budget_rejection_count.load(Ordering::Relaxed),
            1
        );
    }

    fn assert_estimate_mib(sample_rate: u32, channels: usize, expected_mib_floor: usize) {
        let estimate = decoded_buffer_estimate(
            u64::from(sample_rate) * 60,
            sample_rate,
            sample_rate,
            channels,
            false,
        )
        .unwrap();

        assert_eq!(estimate.bytes / BYTES_PER_MIB, expected_mib_floor);
    }
}
