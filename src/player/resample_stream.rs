//! Application-side drivers for the core `StreamingProcessor` resampler contract.
//!
//! `audio-engine-core` 1.0 exposes `StreamingResampler` only through the unified
//! streaming contract: the caller owns input and output storage and must advance
//! from the returned [`ProcessProgress`]. These helpers are the single place that
//! drives that loop so the realtime callback, the WASAPI loop, the streaming
//! worker, and the offline decode paths cannot each re-derive frame accounting.
//!
//! Nothing here allocates. Callers supply preallocated storage, which keeps the
//! audio callback allocation-free.

use crate::processor::{
    finish_checked, process_checked, AudioBlockMut, AudioBlockRef, ProcessBuffers, ProcessError,
    ProcessState, StreamingResampler,
};

/// Conservative per-call output sample capacity for one input block.
///
/// Mirrors the core's exact rational ceiling plus backend burst allowance, in
/// interleaved samples rather than frames.
pub(crate) fn max_output_samples_for_input(
    resampler: &StreamingResampler,
    input_frames: usize,
    channels: usize,
) -> Result<usize, String> {
    let output_frames = resampler
        .process_output_capacity_frames(input_frames)
        .map_err(|error| format!("Failed to size resampler output capacity: {error}"))?;
    output_frames
        .checked_mul(channels)
        .ok_or_else(|| "resampler output capacity overflowed".to_string())
}

/// Input frames needed to produce roughly `output_frames` output frames.
///
/// Rate conversion is not exact per call, so this is a demand-sizing estimate
/// only; the authoritative accounting is the returned progress of each call.
pub(crate) fn input_frames_for_output_frames(
    resampler: &StreamingResampler,
    output_frames: usize,
) -> usize {
    let from_rate = resampler.from_rate() as u64;
    let to_rate = resampler.to_rate() as u64;
    if from_rate == 0 || to_rate == 0 {
        return output_frames;
    }
    let numerator = (output_frames as u64).saturating_mul(from_rate);
    usize::try_from(numerator.div_ceil(to_rate)).unwrap_or(usize::MAX)
}

/// Resample one complete input block into caller-owned output storage.
///
/// Returns the number of interleaved output samples written. The whole input is
/// consumed, so `output` must have at least
/// [`max_output_samples_for_input`] capacity for `input`.
pub(crate) fn resample_into(
    resampler: &mut StreamingResampler,
    input: &[f64],
    output: &mut [f64],
    channels: usize,
) -> Result<usize, ProcessError> {
    let mut consumed_samples = 0usize;
    let mut produced_samples = 0usize;

    while consumed_samples < input.len() {
        if produced_samples >= output.len() {
            return Err(ProcessError::Backend {
                processor: "StreamingResampler",
                operation: "process",
                message: "caller output capacity exhausted before input was consumed",
            });
        }
        let input_block = AudioBlockRef::new(&input[consumed_samples..], channels)?;
        let output_block = AudioBlockMut::new(&mut output[produced_samples..], channels)?;
        let progress = process_checked(
            resampler,
            ProcessBuffers::out_of_place(input_block, output_block)?,
        )?;
        consumed_samples += progress.consumed_frames() * channels;
        produced_samples += progress.produced_frames() * channels;
    }

    Ok(produced_samples)
}

/// Drain the resampler tail into caller-owned output storage.
///
/// Returns the number of interleaved output samples written and whether the
/// resampler reached its terminal state.
pub(crate) fn drain_into(
    resampler: &mut StreamingResampler,
    output: &mut [f64],
    channels: usize,
) -> Result<(usize, bool), ProcessError> {
    let mut produced_samples = 0usize;
    loop {
        if produced_samples >= output.len() {
            return Ok((produced_samples, false));
        }
        let output_block = AudioBlockMut::new(&mut output[produced_samples..], channels)?;
        let progress = finish_checked(resampler, output_block)?;
        produced_samples += progress.produced_frames() * channels;
        if progress.state() == ProcessState::Finished {
            return Ok((produced_samples, true));
        }
    }
}

/// Resample one input block and append the result to an owned buffer.
///
/// `scratch` is reused across calls so the offline decode loop does not allocate
/// per chunk. Its capacity is grown once to the per-call output bound.
pub(crate) fn resample_append(
    resampler: &mut StreamingResampler,
    input: &[f64],
    output: &mut Vec<f64>,
    scratch: &mut Vec<f64>,
    channels: usize,
) -> Result<(), String> {
    if input.is_empty() {
        return Ok(());
    }
    let input_frames = input.len() / channels.max(1);
    let required = max_output_samples_for_input(resampler, input_frames, channels)?;
    if scratch.len() < required {
        scratch.resize(required, 0.0);
    }

    let produced = resample_into(resampler, input, &mut scratch[..required], channels)
        .map_err(|error| format!("Resampling failed: {error}"))?;
    output.extend_from_slice(&scratch[..produced]);
    Ok(())
}

/// Drain the resampler tail and append it to an owned buffer.
pub(crate) fn flush_append(
    resampler: &mut StreamingResampler,
    output: &mut Vec<f64>,
    scratch: &mut Vec<f64>,
    channels: usize,
) -> Result<(), String> {
    const FLUSH_CHUNK_FRAMES: usize = 4096;
    let required = FLUSH_CHUNK_FRAMES
        .checked_mul(channels.max(1))
        .ok_or_else(|| "resampler flush scratch size overflowed".to_string())?;
    if scratch.len() < required {
        scratch.resize(required, 0.0);
    }

    loop {
        let (produced, finished) = drain_into(resampler, &mut scratch[..required], channels)
            .map_err(|error| format!("Resampler flush failed: {error}"))?;
        output.extend_from_slice(&scratch[..produced]);
        if finished || produced == 0 {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ramp(frames: usize, channels: usize) -> Vec<f64> {
        (0..frames * channels)
            .map(|index| ((index / channels) as f64 * 0.01).sin())
            .collect()
    }

    #[test]
    fn input_frame_estimate_uses_ceiling_of_the_rate_ratio() {
        let resampler = StreamingResampler::new(2, 44_100, 48_000).expect("resampler");
        // 480 * 44100 / 48000 is exactly 441, so no rounding up occurs.
        assert_eq!(input_frames_for_output_frames(&resampler, 480), 441);
        // These do not divide evenly and must round up rather than truncate.
        assert_eq!(input_frames_for_output_frames(&resampler, 479), 441);
        assert_eq!(input_frames_for_output_frames(&resampler, 481), 442);
        assert_eq!(input_frames_for_output_frames(&resampler, 100), 92);
        assert_eq!(input_frames_for_output_frames(&resampler, 0), 0);
    }

    #[test]
    fn resample_into_consumes_the_complete_input_block() {
        let channels = 2;
        let mut resampler = StreamingResampler::new(channels, 44_100, 48_000).expect("resampler");
        let input = ramp(1024, channels);
        let capacity = max_output_samples_for_input(&resampler, 1024, channels).expect("capacity");
        let mut output = vec![0.0; capacity];

        let produced =
            resample_into(&mut resampler, &input, &mut output, channels).expect("resample");
        assert!(produced > 0);
        assert!(produced <= capacity);
    }

    #[test]
    fn resample_into_reports_exhausted_output_instead_of_dropping_input() {
        let channels = 2;
        let mut resampler = StreamingResampler::new(channels, 44_100, 48_000).expect("resampler");
        let input = ramp(4096, channels);
        let mut output = vec![0.0; 16 * channels];

        assert!(resample_into(&mut resampler, &input, &mut output, channels).is_err());
    }

    #[test]
    fn append_helpers_produce_a_complete_resampled_stream() {
        let channels = 2;
        let mut resampler = StreamingResampler::new(channels, 44_100, 48_000).expect("resampler");
        let input = ramp(8192, channels);
        let mut output = Vec::new();
        let mut scratch = Vec::new();

        for chunk in input.chunks(1024 * channels) {
            resample_append(&mut resampler, chunk, &mut output, &mut scratch, channels)
                .expect("append");
        }
        flush_append(&mut resampler, &mut output, &mut scratch, channels).expect("flush");

        let output_frames = output.len() / channels;
        let expected_frames = 8192 * 48_000 / 44_100;
        assert!(
            output_frames.abs_diff(expected_frames) < 512,
            "unexpected output frames {output_frames} (expected about {expected_frames})"
        );
    }
}
