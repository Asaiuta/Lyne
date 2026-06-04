//! Audio callback implementation (lock-free version)
//!
//! Contains the real-time audio processing callback using lock-free DSP chain.
//! All parameter updates use atomic operations, eliminating lock contention
//! between the audio thread and main thread.

use arc_swap::ArcSwapOption;
use crossbeam::channel::Sender;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::spectrum::{SpectrumBatch, SPECTRUM_BATCH_CAPACITY};
use super::state::{
    PlayerState, RetiredAudioResource, SharedState, StreamingAudioChunk, EVENT_NEEDS_PRELOAD_RESET,
    EVENT_TRACK_CHANGED, EVENT_TRACK_EOF,
};
use crate::processor::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicLoudnessState, AtomicNoiseShaperParams, AtomicPeakLimiterParams,
    AtomicSaturationParams, AtomicVolumeParams, AudioProcessor, ConvolverProcessor,
    CrossfeedProcessor, DspChain, DynamicLoudnessProcessor, EqProcessor, FFTConvolver,
    NoiseShaperProcessor, PeakLimiterProcessor, SaturationProcessor, StreamingResampler,
    VolumeProcessor,
};

pub const AUDIO_PROCESS_BUFFER_FRAMES: usize = 8192;
pub const AUDIO_RESAMPLE_BUFFER_FRAMES: usize = 16384;
const MIN_RESAMPLE_SOURCE_FRAMES: usize = 256;

pub struct CallbackScratch {
    process_buffer: Vec<f64>,
    resample_leftover: Vec<f64>,
    resample_leftover_pos: usize,
    streaming_local_generation: u64,
    streaming_chunk: Option<StreamingAudioChunk>,
    streaming_chunk_pos: usize,
    final_output: Vec<f64>,
    spectrum_batch: SpectrumBatch,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CallbackScratchCapacities {
    process_buffer: usize,
    resample_leftover: usize,
    final_output: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputPath {
    Direct,
    ShaperOnly,
    ResamplerOnly,
    Full,
}

impl OutputPath {
    fn new(has_resampler: bool, has_shaper: bool) -> Self {
        match (has_resampler, has_shaper) {
            (false, false) => Self::Direct,
            (false, true) => Self::ShaperOnly,
            (true, false) => Self::ResamplerOnly,
            (true, true) => Self::Full,
        }
    }

    fn uses_resampler(self) -> bool {
        matches!(self, Self::ResamplerOnly | Self::Full)
    }

    fn uses_shaper(self) -> bool {
        matches!(self, Self::ShaperOnly | Self::Full)
    }

    fn uses_final_buffer(self) -> bool {
        matches!(self, Self::ShaperOnly | Self::Full)
    }
}

impl CallbackScratch {
    pub fn new(channels: usize) -> Self {
        let process_samples = AUDIO_PROCESS_BUFFER_FRAMES * channels;
        let resample_samples = AUDIO_RESAMPLE_BUFFER_FRAMES * channels;

        let mut process_buffer = Vec::with_capacity(process_samples);
        process_buffer.resize(process_samples, 0.0);

        Self {
            process_buffer,
            resample_leftover: Vec::with_capacity(resample_samples),
            resample_leftover_pos: 0,
            streaming_local_generation: 0,
            streaming_chunk: None,
            streaming_chunk_pos: 0,
            final_output: Vec::with_capacity(resample_samples),
            spectrum_batch: SpectrumBatch::new(),
        }
    }

    /// Release the currently held streaming chunk to the non-realtime drop queue
    /// instead of freeing its `Arc<Vec<f64>>` on the audio thread.
    fn release_streaming_chunk(&mut self, shared: &SharedState) {
        if let Some(chunk) = self.streaming_chunk.take() {
            shared.retire_audio_resource(RetiredAudioResource::Chunk(chunk.samples));
        }
        self.streaming_chunk_pos = 0;
    }

    #[cfg(test)]
    fn capacities(&self) -> CallbackScratchCapacities {
        CallbackScratchCapacities {
            process_buffer: self.process_buffer.capacity(),
            resample_leftover: self.resample_leftover.capacity(),
            final_output: self.final_output.capacity(),
        }
    }
}

fn clear_streaming_scratch(shared: &SharedState, scratch: &mut CallbackScratch) {
    scratch.resample_leftover.clear();
    scratch.resample_leftover_pos = 0;
    scratch.release_streaming_chunk(shared);
}

fn refresh_streaming_scratch_generation(
    shared: &SharedState,
    scratch: &mut CallbackScratch,
    resampler: &mut Option<StreamingResampler>,
    generation: u64,
) {
    if scratch.streaming_local_generation == generation {
        return;
    }
    clear_streaming_scratch(shared, scratch);
    if let Some(ref mut rs) = resampler {
        rs.reset();
    }
    scratch.streaming_local_generation = generation;
}

// ============================================================================
// CHANNEL NORMALIZATION
// ============================================================================

/// Channel normalization for gapless playback
///
/// Handles mono ↔ stereo conversion:
/// - mono → stereo: duplicate each sample to L/R
/// - stereo → mono: average L+R
pub fn normalize_channels(samples: Vec<f64>, from: usize, to: usize) -> Vec<f64> {
    if from == 1 && to == 2 {
        // mono → stereo: duplicate each sample to L/R
        let mut out = Vec::with_capacity(samples.len() * 2);
        for s in &samples {
            out.push(*s);
            out.push(*s);
        }
        out
    } else if from == 2 && to == 1 {
        // stereo → mono: average L+R
        let frames = samples.len() / 2;
        let mut out = Vec::with_capacity(frames);
        for i in 0..frames {
            out.push((samples[i * 2] + samples[i * 2 + 1]) * 0.5);
        }
        out
    } else {
        // Other cases: truncate or zero-pad to 'to' channels
        let frames = samples.len() / from;
        let mut out = Vec::with_capacity(frames * to);
        for i in 0..frames {
            for ch in 0..to {
                out.push(if ch < from {
                    samples[i * from + ch]
                } else {
                    0.0
                });
            }
        }
        out
    }
}

// ============================================================================
// LOCK-FREE DSP CONTEXT
// ============================================================================

/// Lock-free DSP context for audio callback
///
/// This structure manages DSP processing state. The DspChain and convolver
/// are owned by the audio callback closure (&mut), NOT shared via Mutex.
///
/// - DspChain: owned exclusively by callback closure (created once, moved in)
/// - ConvolverProcessor: owned by DspChain, updated via ArcSwapOption
/// - IR kernels: stored for rebuild on non-realtime path only
/// - Parameters: read atomically from shared AtomicXxxParams
///
/// # Architecture
///
/// ```text
/// Main Thread                    Audio Thread
///     |                              |
///     v                              v
/// LoudnessState.process_gain()
///                    |
///                    v
/// AtomicParams ───> DspChain.process() (owned &mut, no Mutex)
/// (non-blocking)     |
///                    v
///               [EQ → Saturation → Crossfeed → Convolver → Volume → DynamicLoudness → PeakLimiter]
///                    |
///                    v
///               resampler → NoiseShaper → output
/// ```
pub struct LockfreeDspContext {
    /// Lock-free parameter references (shared with main thread, read atomically)
    pub eq_params: Arc<AtomicEqParams>,
    pub saturation_params: Arc<AtomicSaturationParams>,
    pub crossfeed_params: Arc<AtomicCrossfeedParams>,
    pub limiter_params: Arc<AtomicPeakLimiterParams>,
    pub volume_params: Arc<AtomicVolumeParams>,
    pub noise_shaper_params: Arc<AtomicNoiseShaperParams>,
    pub dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,

    /// Merged convolver — updated via ArcSwap (wait-free pointer swap from main thread,
    /// wait-free load from audio thread). No Mutex needed.
    pub merged_convolver: Arc<ArcSwapOption<FFTConvolver>>,
    pub merged_convolver_enabled: Arc<AtomicBool>,

    /// IR kernel sources — only accessed from non-realtime command handling path.
    /// Protected by Mutex because they are only read/written from the audio thread's
    /// command processing loop (not from the audio callback itself).
    external_ir_kernel: parking_lot::Mutex<Option<(Vec<f64>, usize)>>,
    fir_ir_kernel: parking_lot::Mutex<Option<(Vec<f64>, usize)>>,
}

impl LockfreeDspContext {
    #[allow(clippy::too_many_arguments)]
    pub fn build_dsp_chain(
        channels: usize,
        sample_rate: f64,
        eq_params: Arc<AtomicEqParams>,
        saturation_params: Arc<AtomicSaturationParams>,
        crossfeed_params: Arc<AtomicCrossfeedParams>,
        limiter_params: Arc<AtomicPeakLimiterParams>,
        volume_params: Arc<AtomicVolumeParams>,
        _noise_shaper_params: Arc<AtomicNoiseShaperParams>,
        dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
        dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
        convolver_swap: Arc<ArcSwapOption<FFTConvolver>>,
        convolver_enabled: Arc<AtomicBool>,
    ) -> DspChain {
        let mut chain = DspChain::new(sample_rate);
        chain.add(EqProcessor::new(channels, sample_rate, eq_params));
        chain.add(SaturationProcessor::new(saturation_params));
        chain.add(CrossfeedProcessor::new(sample_rate, crossfeed_params));
        chain.add(ConvolverProcessor::new(convolver_swap, convolver_enabled));
        chain.add(VolumeProcessor::new(volume_params));
        chain.add(DynamicLoudnessProcessor::new(
            channels,
            sample_rate as u32,
            dynamic_loudness_params,
            dynamic_loudness_telemetry,
        ));
        chain.add(PeakLimiterProcessor::new(
            channels,
            sample_rate as u32,
            limiter_params,
        ));
        chain
    }

    /// Create a new lock-free DSP context.
    ///
    /// Returns (Self, DspChain) — the caller must move the DspChain into the
    /// audio callback closure. The DspChain is exclusively owned by the audio
    /// thread and never shared.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        channels: usize,
        sample_rate: f64,
        eq_params: Arc<AtomicEqParams>,
        saturation_params: Arc<AtomicSaturationParams>,
        crossfeed_params: Arc<AtomicCrossfeedParams>,
        limiter_params: Arc<AtomicPeakLimiterParams>,
        volume_params: Arc<AtomicVolumeParams>,
        noise_shaper_params: Arc<AtomicNoiseShaperParams>,
        dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
        dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
    ) -> (Self, DspChain) {
        let merged_convolver = Arc::new(ArcSwapOption::empty());
        let merged_convolver_enabled = Arc::new(AtomicBool::new(false));
        let chain = Self::build_dsp_chain(
            channels,
            sample_rate,
            Arc::clone(&eq_params),
            Arc::clone(&saturation_params),
            Arc::clone(&crossfeed_params),
            Arc::clone(&limiter_params),
            Arc::clone(&volume_params),
            Arc::clone(&noise_shaper_params),
            Arc::clone(&dynamic_loudness_params),
            Arc::clone(&dynamic_loudness_telemetry),
            Arc::clone(&merged_convolver),
            Arc::clone(&merged_convolver_enabled),
        );

        let ctx = Self {
            eq_params,
            saturation_params,
            crossfeed_params,
            limiter_params,
            volume_params,
            noise_shaper_params,
            dynamic_loudness_params,
            merged_convolver,
            merged_convolver_enabled,
            external_ir_kernel: parking_lot::Mutex::new(None),
            fir_ir_kernel: parking_lot::Mutex::new(None),
        };

        (ctx, chain)
    }

    fn rebuild_merged_convolver(&self) -> Result<(), String> {
        let external = self.external_ir_kernel.lock().clone();
        let fir = self.fir_ir_kernel.lock().clone();

        let merged = match (external, fir) {
            (None, None) => None,
            (Some((ir, channels)), None) | (None, Some((ir, channels))) => {
                Some(Arc::new(FFTConvolver::new(&ir, channels)))
            }
            (Some((external_ir, ext_channels)), Some((fir_ir, fir_channels))) => {
                if ext_channels != fir_channels {
                    return Err(format!(
                        "Cannot merge kernels with different channels: external={}, fir={}",
                        ext_channels, fir_channels
                    ));
                }

                let merged_ir = convolve_interleaved_ir(&external_ir, &fir_ir, ext_channels)?;
                Some(Arc::new(FFTConvolver::new(&merged_ir, ext_channels)))
            }
        };

        // Wait-free pointer swap — audio callback will pick up new convolver
        // on next invocation via ArcSwap::load()
        match merged {
            Some(conv) => {
                // Publish the pointer before flipping the flag so a reader that
                // observes `enabled == true` is guaranteed to also see the convolver.
                self.merged_convolver.store(Some(conv));
                self.merged_convolver_enabled.store(true, Ordering::Release);
            }
            None => {
                // Clear the flag before dropping the pointer so a reader never
                // observes `enabled == true` with an absent convolver.
                self.merged_convolver_enabled
                    .store(false, Ordering::Release);
                self.merged_convolver.store(None);
            }
        }
        Ok(())
    }

    /// Load/update external IR convolver (non-realtime path)
    pub fn set_external_ir_convolver(
        &self,
        ir_data: &[f64],
        channels: usize,
    ) -> Result<(), String> {
        if ir_data.is_empty() {
            return Err("IR data is empty".to_string());
        }
        {
            let mut guard = self.external_ir_kernel.lock();
            *guard = Some((ir_data.to_vec(), channels));
        }
        self.rebuild_merged_convolver()
    }

    /// Disable and clear external IR convolver
    pub fn clear_external_ir_convolver(&self) {
        {
            let mut guard = self.external_ir_kernel.lock();
            *guard = None;
        }
        let _ = self.rebuild_merged_convolver();
    }

    /// Load/update FIR convolver (non-realtime path)
    pub fn set_fir_convolver(&self, ir_data: &[f64], channels: usize) -> Result<(), String> {
        if ir_data.is_empty() {
            return Err("FIR data is empty".to_string());
        }
        {
            let mut guard = self.fir_ir_kernel.lock();
            *guard = Some((ir_data.to_vec(), channels));
        }
        self.rebuild_merged_convolver()
    }

    /// Disable and clear FIR convolver
    pub fn clear_fir_convolver(&self) {
        {
            let mut guard = self.fir_ir_kernel.lock();
            *guard = None;
        }
        let _ = self.rebuild_merged_convolver();
    }

    /// Get parameter references for main thread updates
    pub fn eq_params(&self) -> &Arc<AtomicEqParams> {
        &self.eq_params
    }

    pub fn saturation_params(&self) -> &Arc<AtomicSaturationParams> {
        &self.saturation_params
    }

    pub fn crossfeed_params(&self) -> &Arc<AtomicCrossfeedParams> {
        &self.crossfeed_params
    }

    pub fn limiter_params(&self) -> &Arc<AtomicPeakLimiterParams> {
        &self.limiter_params
    }

    pub fn volume_params(&self) -> &Arc<AtomicVolumeParams> {
        &self.volume_params
    }

    pub fn dynamic_loudness_params(&self) -> &Arc<AtomicDynamicLoudnessParams> {
        &self.dynamic_loudness_params
    }

    pub fn noise_shaper_params(&self) -> &Arc<AtomicNoiseShaperParams> {
        &self.noise_shaper_params
    }
}

fn output_sample_rate(shared: &SharedState, resampler: &Option<StreamingResampler>) -> f64 {
    resampler
        .as_ref()
        .map(|rs| rs.to_rate() as f64)
        .unwrap_or_else(|| shared.sample_rate.load(Ordering::Relaxed).max(1) as f64)
}

fn convolve_interleaved_ir(a: &[f64], b: &[f64], channels: usize) -> Result<Vec<f64>, String> {
    if channels == 0 {
        return Err("channels must be > 0".to_string());
    }
    if a.is_empty() || b.is_empty() {
        return Err("IR data must not be empty".to_string());
    }
    if a.len() % channels != 0 || b.len() % channels != 0 {
        return Err("IR data length is not divisible by channels".to_string());
    }

    let a_len = a.len() / channels;
    let b_len = b.len() / channels;
    let out_len = a_len + b_len - 1;
    let mut out = vec![0.0; out_len * channels];

    for ch in 0..channels {
        for i in 0..a_len {
            let ai = a[i * channels + ch];
            if ai == 0.0 {
                continue;
            }
            for j in 0..b_len {
                out[(i + j) * channels + ch] += ai * b[j * channels + ch];
            }
        }
    }

    Ok(out)
}

// ============================================================================
// AUDIO CALLBACK
// ============================================================================

fn rebuild_dsp_chain_if_requested(
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    mut final_noise_shaper: Option<&mut NoiseShaperProcessor>,
    resampler: &Option<StreamingResampler>,
) {
    if shared
        .dsp_needs_rebuild
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    if let Some(new_chain) = shared.pending_dsp_chain.pop() {
        // Swap the old chain out and offload its drop: freeing a DspChain (and its
        // processors' buffers) on the audio thread would hit the allocator.
        let retired_chain = std::mem::replace(dsp_chain, new_chain);
        shared.retire_audio_resource(RetiredAudioResource::Chain(retired_chain));
    } else {
        let new_sr = shared.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        dsp_chain.set_sample_rate(new_sr);
        dsp_chain.reset();
    }

    if let Some(noise_shaper) = final_noise_shaper.as_deref_mut() {
        noise_shaper.set_sample_rate(output_sample_rate(shared, resampler));
        noise_shaper.reset();
    }
}

fn reset_dsp_state_if_requested(
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    mut final_noise_shaper: Option<&mut NoiseShaperProcessor>,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
) {
    if shared
        .dsp_reset_pending
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }

    dsp_chain.reset();
    if let Some(noise_shaper) = final_noise_shaper.as_deref_mut() {
        noise_shaper.reset();
    }
    if let Some(ref mut rs) = resampler {
        rs.reset();
    }
    clear_streaming_scratch(shared, scratch);
}

fn request_gapless_preload_if_needed(shared: &SharedState, total: usize, current_pos: usize) {
    // Signal preload early enough to allow full decode + optional resampling
    // before EOF. Five seconds also covers slower remote streams.
    let sr = shared.sample_rate.load(Ordering::Relaxed) as usize;
    let remaining_frames = total.saturating_sub(current_pos);
    if remaining_frames > 0
        && remaining_frames < sr * 5
        && !shared.pending_ready.load(Ordering::Relaxed)
        && !shared.needs_preload.load(Ordering::Acquire)
    {
        shared.needs_preload.store(true, Ordering::Release);
    }
}

fn streaming_has_buffered_samples(
    shared: &SharedState,
    scratch: &mut CallbackScratch,
    generation: u64,
) -> bool {
    let stale_current = scratch
        .streaming_chunk
        .as_ref()
        .is_some_and(|chunk| chunk.generation != generation);
    if stale_current {
        scratch.release_streaming_chunk(shared);
    }

    let current_chunk_has_samples = scratch
        .streaming_chunk
        .as_ref()
        .is_some_and(|chunk| scratch.streaming_chunk_pos < chunk.samples.len());
    if current_chunk_has_samples {
        return true;
    }

    while let Some(chunk) = shared.streaming_chunks.pop() {
        shared.mark_streaming_queue_chunk_popped(shared.streaming_chunks.len());
        if chunk.generation == generation {
            // Offload any exhausted/empty chunk still in the slot before replacing it,
            // so no `Arc<Vec<f64>>` is ever freed on the audio thread.
            scratch.release_streaming_chunk(shared);
            scratch.streaming_chunk = Some(chunk);
            scratch.streaming_chunk_pos = 0;
            return true;
        }
        // Stale chunk from a superseded generation: offload its drop.
        shared.retire_audio_resource(RetiredAudioResource::Chunk(chunk.samples));
    }

    false
}

fn finish_streaming_if_drained(shared: &SharedState, scratch: &mut CallbackScratch) -> bool {
    if !shared.streaming_active.load(Ordering::Acquire) {
        return false;
    }
    if !shared.streaming_decode_finished.load(Ordering::Acquire) {
        return true;
    }

    let generation = shared.streaming_generation.load(Ordering::Acquire);
    if streaming_has_buffered_samples(shared, scratch, generation) {
        return true;
    }

    shared.streaming_active.store(false, Ordering::Release);
    false
}

#[allow(clippy::too_many_arguments)]
fn try_activate_pending_gapless(
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    mut final_noise_shaper: Option<&mut NoiseShaperProcessor>,
    loudness_state: &Arc<AtomicLoudnessState>,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
) -> bool {
    if !shared.pending_ready.load(Ordering::Acquire) {
        return false;
    }

    let Some(next) = shared.pending_buffer.swap(None) else {
        return false;
    };

    let next_frames = shared.pending_total_frames.load(Ordering::Relaxed);
    let next_sr = shared.pending_sample_rate.load(Ordering::Relaxed);
    let next_ch = shared.pending_channels.load(Ordering::Relaxed);

    // Offload the outgoing buffer's drop to the command loop; freeing a large
    // decoded `Vec<f64>` on the audio thread would hit the allocator.
    let retired_buffer = shared.audio_buffer.swap(next);
    shared.retire_audio_resource(RetiredAudioResource::Buffer(retired_buffer));
    shared.total_frames.store(next_frames, Ordering::Relaxed);
    shared.sample_rate.store(next_sr, Ordering::Relaxed);
    shared.channels.store(next_ch, Ordering::Relaxed);
    shared.position_frames.store(0, Ordering::Relaxed);

    shared.pending_ready.store(false, Ordering::Release);
    shared.needs_preload.store(false, Ordering::Relaxed);
    shared.dsp_reset_pending.store(true, Ordering::Release);

    // Metadata is copied by the non-realtime side after the atomic buffer swap.
    shared.gapless_swap_pending.store(true, Ordering::Release);
    shared.event_flags.fetch_or(
        EVENT_TRACK_CHANGED | EVENT_NEEDS_PRELOAD_RESET,
        Ordering::Release,
    );

    let pending_gain_bits = shared.pending_target_gain_db.load(Ordering::Relaxed);
    let pending_gain_db = f64::from_bits(pending_gain_bits);
    loudness_state.set_target_gain(pending_gain_db);

    dsp_chain.reset();
    if let Some(noise_shaper) = final_noise_shaper.as_deref_mut() {
        noise_shaper.reset();
    }
    if let Some(ref mut rs) = resampler {
        rs.reset();
    }
    scratch.resample_leftover.clear();
    scratch.resample_leftover_pos = 0;
    shared.dsp_reset_pending.store(false, Ordering::Release);

    true
}

#[allow(clippy::too_many_arguments)]
fn handle_eof_or_gapless(
    data: &mut [f32],
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    final_noise_shaper: Option<&mut NoiseShaperProcessor>,
    loudness_state: &Arc<AtomicLoudnessState>,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
    channels: usize,
    total: usize,
    current_pos: usize,
) -> bool {
    let has_leftover = scratch.resample_leftover_pos < scratch.resample_leftover.len();
    // `total` is the advertised track length. For streaming-first-buffer loads it
    // can be a ceil estimate that exceeds the actually-decoded buffer, and for a
    // drained memory-mode stream the buffer is empty. Never wait past the real
    // decoded frames: otherwise the render loop below can never satisfy the read
    // and spins forever on the audio thread.
    let buffered_frames = shared.audio_buffer.load().len() / channels.max(1);
    let playable_end = total.min(buffered_frames);
    if current_pos < playable_end || has_leftover {
        return false;
    }

    if try_activate_pending_gapless(
        shared,
        dsp_chain,
        final_noise_shaper,
        loudness_state,
        resampler,
        scratch,
    ) {
        data.fill(0.0);
        return true;
    }

    data.fill(0.0);
    if shared.state.load() == PlayerState::Playing {
        shared.state.store(PlayerState::Stopped);
        shared.playback_end_count.fetch_add(1, Ordering::AcqRel);
        shared
            .event_flags
            .fetch_or(EVENT_TRACK_EOF, Ordering::Release);
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn render_audio_output(
    data: &mut [f32],
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    loudness_state: &Arc<AtomicLoudnessState>,
    channels: usize,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
    output_path: OutputPath,
    total: usize,
    current_pos: &mut usize,
) -> usize {
    let output_len = data.len();
    let mut samples_written = 0;
    // Never read past the actual decoded buffer: `total` may be a ceil estimate
    // larger than the real sample count (streaming-first-buffer loads). Clamping
    // keeps `available_source` honest so the loop terminates instead of spinning.
    let total = total.min(shared.audio_buffer.load().len() / channels.max(1));

    if output_path.uses_final_buffer() && scratch.final_output.len() < output_len {
        scratch.final_output.resize(output_len, 0.0);
    }

    if output_path.uses_resampler()
        && scratch.resample_leftover_pos < scratch.resample_leftover.len()
    {
        let available = scratch.resample_leftover.len() - scratch.resample_leftover_pos;
        let take = available.min(output_len);
        let start = scratch.resample_leftover_pos;
        let end = start + take;
        if matches!(output_path, OutputPath::ResamplerOnly) {
            for (dst, src) in data[..take]
                .iter_mut()
                .zip(scratch.resample_leftover[start..end].iter())
            {
                *dst = *src as f32;
            }
        } else {
            for (dst, src) in scratch.final_output[..take]
                .iter_mut()
                .zip(scratch.resample_leftover[start..end].iter())
            {
                *dst = *src;
            }
        }
        scratch.resample_leftover_pos += take;
        if scratch.resample_leftover_pos >= scratch.resample_leftover.len() {
            scratch.resample_leftover.clear();
            scratch.resample_leftover_pos = 0;
        }
        samples_written = take;
    }

    while samples_written < output_len {
        let frames_needed_out = (output_len - samples_written) / channels;
        if frames_needed_out == 0 {
            break;
        }

        let source_frames_needed = if let Some(rs) = resampler.as_ref() {
            rs.input_frames_for_output_frames(frames_needed_out)
                .max(MIN_RESAMPLE_SOURCE_FRAMES)
                .min(AUDIO_PROCESS_BUFFER_FRAMES)
        } else {
            frames_needed_out
        };

        let available_source = total.saturating_sub(*current_pos);
        if available_source == 0 {
            break;
        }

        let max_frames_from_capacity = scratch.process_buffer.capacity() / channels;
        let frames_to_read = source_frames_needed
            .min(available_source)
            .min(max_frames_from_capacity);
        debug_assert!(frames_to_read * channels <= scratch.process_buffer.capacity());

        let start_sample = *current_pos * channels;
        let end_sample = start_sample + frames_to_read * channels;

        scratch.process_buffer.clear();
        {
            let buf = shared.audio_buffer.load();
            if end_sample <= buf.len() {
                scratch
                    .process_buffer
                    .extend_from_slice(&buf[start_sample..end_sample]);
            }
        }

        if scratch.process_buffer.is_empty() {
            // With `total` clamped to the real buffer this is unreachable, but if the
            // buffer is ever shorter than expected, stop instead of spinning: a read
            // that fails now would fail identically on every later iteration.
            break;
        }

        *current_pos += frames_to_read;
        shared
            .position_frames
            .store(*current_pos as u64, Ordering::Relaxed);
        shared.mark_first_position_advanced_after_play();

        let frames_in_chunk = scratch.process_buffer.len() / channels;
        let linear_gain = loudness_state.process_gain(frames_in_chunk);
        for sample in scratch.process_buffer.iter_mut() {
            *sample *= linear_gain;
        }
        dsp_chain.process(&mut scratch.process_buffer, channels);

        if let Some(rs) = resampler.as_mut() {
            let resampled = rs.process_chunk_borrowed(&scratch.process_buffer);
            let resampled_samples = resampled.samples;

            let mut chunk_idx = 0;
            while samples_written < output_len && chunk_idx < resampled_samples.len() {
                if matches!(output_path, OutputPath::ResamplerOnly) {
                    data[samples_written] = resampled_samples[chunk_idx] as f32;
                } else {
                    scratch.final_output[samples_written] = resampled_samples[chunk_idx];
                }
                samples_written += 1;
                chunk_idx += 1;
            }

            if chunk_idx < resampled_samples.len() {
                scratch
                    .resample_leftover
                    .extend_from_slice(&resampled_samples[chunk_idx..]);
                scratch.resample_leftover_pos = 0;
            }
        } else {
            let take = scratch
                .process_buffer
                .len()
                .min(output_len - samples_written);
            if matches!(output_path, OutputPath::Direct) {
                for (dst, src) in data[samples_written..samples_written + take]
                    .iter_mut()
                    .zip(scratch.process_buffer[..take].iter())
                {
                    *dst = *src as f32;
                }
            } else {
                for (dst, src) in scratch.final_output[samples_written..samples_written + take]
                    .iter_mut()
                    .zip(scratch.process_buffer[..take].iter())
                {
                    *dst = *src;
                }
            }
            samples_written += take;
        }
    }

    if samples_written < output_len {
        let silence_frames = ((output_len - samples_written) / channels) as u64;
        shared.audio_underrun_count.fetch_add(1, Ordering::Relaxed);
        shared
            .audio_underrun_silence_frames
            .fetch_add(silence_frames, Ordering::Relaxed);
        shared.mark_audio_buffer_output_shortfall(silence_frames);
        if output_path.uses_final_buffer() {
            scratch.final_output[samples_written..output_len].fill(0.0);
        } else {
            data[samples_written..output_len].fill(0.0);
        }
    }

    samples_written
}

fn fill_streaming_process_buffer(
    shared: &SharedState,
    scratch: &mut CallbackScratch,
    generation: u64,
    channels: usize,
    frames_to_read: usize,
) -> usize {
    scratch.process_buffer.clear();
    let target_samples = frames_to_read * channels;

    while scratch.process_buffer.len() < target_samples {
        let stale_current = scratch
            .streaming_chunk
            .as_ref()
            .is_some_and(|chunk| chunk.generation != generation);
        if stale_current {
            scratch.release_streaming_chunk(shared);
        }

        if let Some(chunk) = scratch.streaming_chunk.as_ref() {
            let chunk_len = chunk.samples.len();
            let available = chunk_len.saturating_sub(scratch.streaming_chunk_pos);
            if available > 0 {
                let take = available.min(target_samples - scratch.process_buffer.len());
                let start = scratch.streaming_chunk_pos;
                let end = start + take;
                scratch
                    .process_buffer
                    .extend_from_slice(&chunk.samples[start..end]);
                scratch.streaming_chunk_pos += take;
                // `chunk` is no longer used past this point, so the borrow ends and
                // `release_streaming_chunk` (which takes `&mut scratch`) is allowed.
                if scratch.streaming_chunk_pos >= chunk_len {
                    scratch.release_streaming_chunk(shared);
                }
                continue;
            }
        }

        match shared.streaming_chunks.pop() {
            Some(chunk) if chunk.generation == generation => {
                shared.mark_streaming_queue_chunk_popped(shared.streaming_chunks.len());
                // Offload any exhausted/empty chunk still in the slot before
                // replacing it, so no `Arc<Vec<f64>>` is freed on the audio thread.
                scratch.release_streaming_chunk(shared);
                scratch.streaming_chunk = Some(chunk);
                scratch.streaming_chunk_pos = 0;
            }
            Some(stale) => {
                shared.mark_streaming_queue_chunk_popped(shared.streaming_chunks.len());
                // Stale chunk from a superseded generation: offload its drop.
                shared.retire_audio_resource(RetiredAudioResource::Chunk(stale.samples));
                continue;
            }
            None => break,
        }
    }

    scratch.process_buffer.len() / channels
}

#[allow(clippy::too_many_arguments)]
fn render_streaming_audio_output(
    data: &mut [f32],
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    loudness_state: &Arc<AtomicLoudnessState>,
    channels: usize,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
    output_path: OutputPath,
    current_pos: &mut usize,
) -> usize {
    let output_len = data.len();
    let mut samples_written = 0;
    let generation = shared.streaming_generation.load(Ordering::Acquire);
    refresh_streaming_scratch_generation(shared, scratch, resampler, generation);

    if output_path.uses_final_buffer() && scratch.final_output.len() < output_len {
        scratch.final_output.resize(output_len, 0.0);
    }

    if output_path.uses_resampler()
        && scratch.resample_leftover_pos < scratch.resample_leftover.len()
    {
        let available = scratch.resample_leftover.len() - scratch.resample_leftover_pos;
        let take = available.min(output_len);
        let start = scratch.resample_leftover_pos;
        let end = start + take;
        if matches!(output_path, OutputPath::ResamplerOnly) {
            for (dst, src) in data[..take]
                .iter_mut()
                .zip(scratch.resample_leftover[start..end].iter())
            {
                *dst = *src as f32;
            }
        } else {
            for (dst, src) in scratch.final_output[..take]
                .iter_mut()
                .zip(scratch.resample_leftover[start..end].iter())
            {
                *dst = *src;
            }
        }
        scratch.resample_leftover_pos += take;
        if scratch.resample_leftover_pos >= scratch.resample_leftover.len() {
            scratch.resample_leftover.clear();
            scratch.resample_leftover_pos = 0;
        }
        samples_written = take;
    }

    while samples_written < output_len {
        let frames_needed_out = (output_len - samples_written) / channels;
        if frames_needed_out == 0 {
            break;
        }

        let source_frames_needed = if let Some(rs) = resampler.as_ref() {
            rs.input_frames_for_output_frames(frames_needed_out)
                .max(MIN_RESAMPLE_SOURCE_FRAMES)
                .min(AUDIO_PROCESS_BUFFER_FRAMES)
        } else {
            frames_needed_out
        };
        let max_frames_from_capacity = scratch.process_buffer.capacity() / channels;
        let frames_to_read = source_frames_needed.min(max_frames_from_capacity);
        let frames_read =
            fill_streaming_process_buffer(shared, scratch, generation, channels, frames_to_read);

        if frames_read == 0 {
            if shared.streaming_decode_finished.load(Ordering::Acquire) {
                shared.streaming_active.store(false, Ordering::Release);
            } else if !shared.is_loading.load(Ordering::Acquire) {
                let silence_frames = ((output_len - samples_written) / channels) as u64;
                shared.audio_underrun_count.fetch_add(1, Ordering::Relaxed);
                shared
                    .audio_underrun_silence_frames
                    .fetch_add(silence_frames, Ordering::Relaxed);
                shared.mark_streaming_queue_empty_during_decode(silence_frames);
            }
            break;
        }

        *current_pos += frames_read;
        shared
            .position_frames
            .store(*current_pos as u64, Ordering::Relaxed);
        shared.mark_first_position_advanced_after_play();

        let linear_gain = loudness_state.process_gain(frames_read);
        for sample in scratch.process_buffer.iter_mut() {
            *sample *= linear_gain;
        }
        dsp_chain.process(&mut scratch.process_buffer, channels);

        if let Some(rs) = resampler.as_mut() {
            let resampled = rs.process_chunk_borrowed(&scratch.process_buffer);
            let resampled_samples = resampled.samples;

            let mut chunk_idx = 0;
            while samples_written < output_len && chunk_idx < resampled_samples.len() {
                if matches!(output_path, OutputPath::ResamplerOnly) {
                    data[samples_written] = resampled_samples[chunk_idx] as f32;
                } else {
                    scratch.final_output[samples_written] = resampled_samples[chunk_idx];
                }
                samples_written += 1;
                chunk_idx += 1;
            }

            if chunk_idx < resampled_samples.len() {
                scratch
                    .resample_leftover
                    .extend_from_slice(&resampled_samples[chunk_idx..]);
                scratch.resample_leftover_pos = 0;
            }
        } else {
            let take = scratch
                .process_buffer
                .len()
                .min(output_len - samples_written);
            if matches!(output_path, OutputPath::Direct) {
                for (dst, src) in data[samples_written..samples_written + take]
                    .iter_mut()
                    .zip(scratch.process_buffer[..take].iter())
                {
                    *dst = *src as f32;
                }
            } else {
                for (dst, src) in scratch.final_output[samples_written..samples_written + take]
                    .iter_mut()
                    .zip(scratch.process_buffer[..take].iter())
                {
                    *dst = *src;
                }
            }
            samples_written += take;
        }
    }

    if samples_written < output_len {
        let silence_frames = ((output_len - samples_written) / channels) as u64;
        shared.mark_streaming_output_shortfall(silence_frames);
        if output_path.uses_final_buffer() {
            scratch.final_output[samples_written..output_len].fill(0.0);
        } else {
            data[samples_written..output_len].fill(0.0);
        }
    }

    samples_written
}

fn publish_spectrum_batch(
    data: &[f32],
    spectrum_tx: &Sender<SpectrumBatch>,
    scratch: &mut CallbackScratch,
    channels: usize,
    samples_written: usize,
) {
    if samples_written == 0 {
        return;
    }

    // Cap the source span so the downmixed mono count never exceeds the batch's
    // fixed capacity. The whole `SpectrumBatch` is copied by value into the channel
    // each callback, so sizing capacity to one stereo callback's mono output (rather
    // than the full buffer) keeps that copy small. The spectrum thread accumulates
    // batches into its FFT window regardless of per-batch size.
    let take = samples_written.min(SPECTRUM_BATCH_CAPACITY * channels.max(1));
    scratch.spectrum_batch.clear();
    for i in (0..take).step_by(channels) {
        let mut sum = 0.0;
        for c in 0..channels {
            if i + c < data.len() {
                sum += data[i + c] as f64;
            }
        }
        if !scratch.spectrum_batch.push(sum / channels as f64) {
            break;
        }
    }
    if !scratch.spectrum_batch.is_empty() {
        let _ = spectrum_tx.try_send(scratch.spectrum_batch.clone());
    }
}

/// Main audio callback for cpal output stream (lock-free)
///
/// Zero-Mutex audio processing:
/// - `dsp_chain`: exclusively owned by this closure (&mut), no lock needed
/// - Parameters: read atomically from shared AtomicXxxParams
#[allow(clippy::too_many_arguments)]
pub fn audio_callback_lockfree(
    data: &mut [f32],
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    mut final_noise_shaper: Option<&mut NoiseShaperProcessor>,
    loudness_state: &Arc<AtomicLoudnessState>,
    spectrum_tx: &Sender<SpectrumBatch>,
    channels: usize,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
) {
    rebuild_dsp_chain_if_requested(
        shared,
        dsp_chain,
        final_noise_shaper.as_deref_mut(),
        resampler,
    );
    reset_dsp_state_if_requested(
        shared,
        dsp_chain,
        final_noise_shaper.as_deref_mut(),
        resampler,
        scratch,
    );
    shared.mark_output_callback_activity();

    let shaper_enabled = match final_noise_shaper.as_deref_mut() {
        Some(noise_shaper) => noise_shaper.refresh_is_enabled(),
        None => false,
    };
    let output_path = OutputPath::new(resampler.is_some(), shaper_enabled);

    if shared.state.load() != PlayerState::Playing {
        shared.mark_output_callback_silenced_inactive();
        data.fill(0.0);
        return;
    }
    if shared.is_loading.load(Ordering::Acquire) && !shared.streaming_active.load(Ordering::Acquire)
    {
        shared.mark_output_callback_silenced_loading();
        data.fill(0.0);
        return;
    }
    if shared
        .active_stream_source_sample_rate
        .load(Ordering::Acquire)
        != 0
        && !shared.active_output_stream_matches_current()
    {
        shared.mark_output_callback_silenced_stream_mismatch();
        data.fill(0.0);
        return;
    }
    shared.mark_first_callback_after_play();

    let total = shared.total_frames.load(Ordering::Relaxed) as usize;
    let mut current_pos = shared.position_frames.load(Ordering::Relaxed) as usize;
    let streaming_active = finish_streaming_if_drained(shared, scratch);
    if !streaming_active {
        request_gapless_preload_if_needed(shared, total, current_pos);
    }

    if !streaming_active {
        if handle_eof_or_gapless(
            data,
            shared,
            dsp_chain,
            final_noise_shaper.as_deref_mut(),
            loudness_state,
            resampler,
            scratch,
            channels,
            total,
            current_pos,
        ) {
            return;
        }
    }

    let samples_written = if streaming_active {
        render_streaming_audio_output(
            data,
            shared,
            dsp_chain,
            loudness_state,
            channels,
            resampler,
            scratch,
            output_path,
            &mut current_pos,
        )
    } else {
        render_audio_output(
            data,
            shared,
            dsp_chain,
            loudness_state,
            channels,
            resampler,
            scratch,
            output_path,
            total,
            &mut current_pos,
        )
    };

    let output_len = data.len();
    if output_path.uses_final_buffer() && output_len > 0 {
        if output_path.uses_shaper() {
            // `uses_shaper()` implies the shaper was present when `OutputPath` was
            // computed, but the audio thread must never panic (error-handling.md):
            // if it is somehow absent, skip shaping and emit the unshaped buffer.
            if let Some(noise_shaper) = final_noise_shaper.as_deref_mut() {
                noise_shaper.process_cached(&mut scratch.final_output[..output_len], channels);
            }
        }
        for (dst, src) in data
            .iter_mut()
            .zip(scratch.final_output[..output_len].iter())
        {
            *dst = *src as f32;
        }
    }

    publish_spectrum_batch(data, spectrum_tx, scratch, channels, samples_written);
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_CHANNELS: usize = 2;
    const TEST_SAMPLE_RATE: u32 = 44_100;
    const TEST_FRAMES: usize = 512;

    fn build_test_buffer(frames: usize, channels: usize) -> Vec<f64> {
        (0..frames * channels)
            .map(|sample| (sample as f64 % 17.0) / 17.0 - 0.5)
            .collect()
    }

    fn prepare_playing_shared(frames: usize, channels: usize) -> SharedState {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(build_test_buffer(frames, channels)));
        shared.total_frames.store(frames as u64, Ordering::Relaxed);
        shared
            .sample_rate
            .store(TEST_SAMPLE_RATE as u64, Ordering::Relaxed);
        shared.channels.store(channels as u64, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared
    }

    fn run_capacity_probe(
        scratch: &mut CallbackScratch,
        use_resampler: bool,
        use_shaper: bool,
    ) -> CallbackScratchCapacities {
        let shared = prepare_playing_shared(TEST_FRAMES, TEST_CHANNELS);
        let mut chain = DspChain::new(TEST_SAMPLE_RATE as f64);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 256 * TEST_CHANNELS];
        let mut resampler = use_resampler
            .then(|| StreamingResampler::new(TEST_CHANNELS, TEST_SAMPLE_RATE, 48_000).unwrap());
        let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
        noise_shaper_params.set_enabled(use_shaper);
        let mut final_noise_shaper = NoiseShaperProcessor::new(
            TEST_CHANNELS,
            if use_resampler {
                48_000
            } else {
                TEST_SAMPLE_RATE
            },
            Arc::clone(&noise_shaper_params),
        );

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            TEST_CHANNELS,
            &mut resampler,
            scratch,
        );

        scratch.capacities()
    }

    fn run_streaming_capacity_probe(
        scratch: &mut CallbackScratch,
        use_resampler: bool,
        use_shaper: bool,
        generation: u64,
    ) -> CallbackScratchCapacities {
        let shared = SharedState::new();
        shared.total_frames.store(10_000, Ordering::Relaxed);
        shared
            .sample_rate
            .store(TEST_SAMPLE_RATE as u64, Ordering::Relaxed);
        shared
            .channels
            .store(TEST_CHANNELS as u64, Ordering::Relaxed);
        shared
            .streaming_generation
            .store(generation, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(false, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation,
                samples: Arc::new(build_test_buffer(TEST_FRAMES, TEST_CHANNELS)),
            })
            .expect("streaming queue should have capacity");

        let mut chain = DspChain::new(TEST_SAMPLE_RATE as f64);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 256 * TEST_CHANNELS];
        let mut resampler = use_resampler
            .then(|| StreamingResampler::new(TEST_CHANNELS, TEST_SAMPLE_RATE, 48_000).unwrap());
        let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
        noise_shaper_params.set_enabled(use_shaper);
        let mut final_noise_shaper = NoiseShaperProcessor::new(
            TEST_CHANNELS,
            if use_resampler {
                48_000
            } else {
                TEST_SAMPLE_RATE
            },
            Arc::clone(&noise_shaper_params),
        );

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            TEST_CHANNELS,
            &mut resampler,
            scratch,
        );

        scratch.capacities()
    }

    fn assert_capacity_stable_after_warmup(use_resampler: bool, use_shaper: bool) {
        let mut scratch = CallbackScratch::new(TEST_CHANNELS);
        let warmed = run_capacity_probe(&mut scratch, use_resampler, use_shaper);
        let steady = run_capacity_probe(&mut scratch, use_resampler, use_shaper);

        assert_eq!(steady, warmed);
    }

    fn assert_streaming_capacity_stable_after_warmup(use_resampler: bool, use_shaper: bool) {
        let mut scratch = CallbackScratch::new(TEST_CHANNELS);
        let warmed = run_streaming_capacity_probe(&mut scratch, use_resampler, use_shaper, 21);
        let steady = run_streaming_capacity_probe(&mut scratch, use_resampler, use_shaper, 22);

        assert_eq!(steady, warmed);
    }

    #[test]
    fn test_normalize_channels_mono_to_stereo() {
        let mono = vec![1.0, 2.0, 3.0];
        let stereo = normalize_channels(mono, 1, 2);
        assert_eq!(stereo, vec![1.0, 1.0, 2.0, 2.0, 3.0, 3.0]);
    }

    #[test]
    fn test_normalize_channels_stereo_to_mono() {
        let stereo = vec![1.0, 3.0, 2.0, 4.0];
        let mono = normalize_channels(stereo, 2, 1);
        assert_eq!(mono, vec![2.0, 3.0]); // (1+3)/2, (2+4)/2
    }

    #[test]
    fn callback_scratch_preallocates_hot_path_buffers() {
        let scratch = CallbackScratch::new(2);

        assert_eq!(
            scratch.process_buffer.len(),
            AUDIO_PROCESS_BUFFER_FRAMES * 2
        );
        assert_eq!(
            scratch.process_buffer.capacity(),
            AUDIO_PROCESS_BUFFER_FRAMES * 2
        );
        assert_eq!(
            scratch.resample_leftover.capacity(),
            AUDIO_RESAMPLE_BUFFER_FRAMES * 2
        );
        assert_eq!(
            scratch.final_output.capacity(),
            AUDIO_RESAMPLE_BUFFER_FRAMES * 2
        );
        assert_eq!(scratch.resample_leftover_pos, 0);
    }

    #[test]
    fn callback_direct_path_reuses_scratch_capacity_after_warmup() {
        assert_capacity_stable_after_warmup(false, false);
    }

    #[test]
    fn callback_shaper_only_path_reuses_scratch_capacity_after_warmup() {
        assert_capacity_stable_after_warmup(false, true);
    }

    #[test]
    fn callback_resampler_only_path_reuses_scratch_capacity_after_warmup() {
        assert_capacity_stable_after_warmup(true, false);
    }

    #[test]
    fn callback_full_output_path_reuses_scratch_capacity_after_warmup() {
        assert_capacity_stable_after_warmup(true, true);
    }

    #[test]
    fn callback_streaming_full_output_path_reuses_scratch_capacity_after_warmup() {
        assert_streaming_capacity_stable_after_warmup(true, true);
    }

    #[test]
    fn callback_downsample_resampler_buffers_startup_output_without_panic() {
        let channels = 2;
        let frames = 4096;
        let shared = SharedState::new();
        let samples = (0..frames * channels)
            .map(|sample| (sample as f64 % 97.0) / 97.0 - 0.5)
            .collect::<Vec<_>>();
        shared.audio_buffer.store(Arc::new(samples));
        shared.total_frames.store(frames as u64, Ordering::Relaxed);
        shared.sample_rate.store(96_000, Ordering::Relaxed);
        shared.channels.store(channels as u64, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(96_000.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut resampler = Some(StreamingResampler::new(channels, 96_000, 48_000).unwrap());
        let mut scratch = CallbackScratch::new(channels);
        let mut out = vec![0.0f32; 2112 * channels];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            channels,
            &mut resampler,
            &mut scratch,
        );

        assert!(shared.position_frames.load(Ordering::Relaxed) > 0);
        assert!(scratch.resample_leftover_pos <= scratch.resample_leftover.len());

        let leftover_len = scratch.resample_leftover.len();
        let mut next_out = vec![0.0f32; 256 * channels];
        audio_callback_lockfree(
            &mut next_out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            channels,
            &mut resampler,
            &mut scratch,
        );

        if leftover_len > 0 {
            assert!(scratch.resample_leftover_pos <= scratch.resample_leftover.len());
        }
    }

    #[test]
    fn callback_upsample_resampler_reads_demand_sized_source_chunk() {
        let channels = 2;
        let frames = 8192;
        let shared = SharedState::new();
        let samples = (0..frames * channels)
            .map(|sample| (sample as f64 % 113.0) / 113.0 - 0.5)
            .collect::<Vec<_>>();
        shared.audio_buffer.store(Arc::new(samples));
        shared.total_frames.store(frames as u64, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(channels as u64, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut resampler = Some(StreamingResampler::new(channels, 44_100, 384_000).unwrap());
        let mut scratch = CallbackScratch::new(channels);
        let mut out = vec![0.0f32; 512 * channels];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            channels,
            &mut resampler,
            &mut scratch,
        );

        let position = shared.position_frames.load(Ordering::Relaxed) as usize;
        assert!(position >= MIN_RESAMPLE_SOURCE_FRAMES);
        assert!(
            position < 4096,
            "demand-sized resampling should avoid the old fixed 4096-frame chunk"
        );
        assert!(scratch.resample_leftover.len() < scratch.resample_leftover.capacity());
    }

    #[test]
    fn callback_streaming_chunk_advances_position_without_full_audio_buffer() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.streaming_generation.store(7, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 7,
                samples: Arc::new(vec![0.25, -0.25, 0.5, -0.5]),
            })
            .expect("streaming queue should have capacity");

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 4];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.25, -0.25, 0.5, -0.5]);
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), 2);
        assert!(shared.audio_buffer.load().is_empty());
    }

    #[test]
    fn callback_loading_without_streaming_outputs_silence_without_eof() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(0, Ordering::Relaxed);
        shared.position_frames.store(0, Ordering::Relaxed);
        shared.is_loading.store(true, Ordering::Release);
        shared.streaming_active.store(false, Ordering::Release);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![1.0f32; 8];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 8]);
        assert_eq!(shared.state.load(), PlayerState::Playing);
        assert_eq!(shared.playback_end_count.load(Ordering::Relaxed), 0);
        assert_eq!(shared.audio_underrun_count.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.first_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
    }

    #[test]
    fn callback_warm_stream_format_mismatch_outputs_silence_without_progress() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.5, -0.5, 0.25, -0.25]));
        shared.sample_rate.store(48_000, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.position_frames.store(0, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared.mark_stream_play_returned();
        shared.mark_active_output_stream(44_100, 44_100, 2);

        let mut chain = DspChain::new(48_000.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![1.0f32; 4];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 4]);
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.first_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
        assert_eq!(shared.playback_end_count.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn callback_streaming_generation_change_discards_resampler_leftover() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(200, Ordering::Relaxed);
        shared.streaming_generation.store(2, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 2,
                samples: Arc::new(vec![0.25, -0.25, 0.5, -0.5]),
            })
            .expect("streaming queue should have capacity");

        let mut scratch = CallbackScratch::new(2);
        scratch.streaming_local_generation = 1;
        scratch
            .resample_leftover
            .extend_from_slice(&[0.9, 0.9, 0.9, 0.9]);
        scratch.resample_leftover_pos = 0;
        scratch.streaming_chunk = Some(StreamingAudioChunk {
            generation: 1,
            samples: Arc::new(vec![0.8, 0.8, 0.8, 0.8]),
        });
        scratch.streaming_chunk_pos = 0;

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let mut resampler = Some(StreamingResampler::new(2, 44_100, 44_100).unwrap());
        let mut out = vec![0.0f32; 4];
        let mut current_pos = 100;

        let written = render_streaming_audio_output(
            &mut out,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut resampler,
            &mut scratch,
            OutputPath::ResamplerOnly,
            &mut current_pos,
        );

        assert_eq!(written, 4);
        assert_eq!(out, vec![0.25, -0.25, 0.5, -0.5]);
        assert_eq!(current_pos, 102);
        assert_eq!(scratch.streaming_local_generation, 2);
        assert!(scratch.resample_leftover.is_empty());
        assert!(scratch.streaming_chunk.is_none());
    }

    #[test]
    fn callback_streaming_empty_queue_records_underrun_before_decode_finishes() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(100, Ordering::Relaxed);
        shared.streaming_generation.store(9, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(false, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![1.0f32; 8];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 8]);
        assert_eq!(shared.audio_underrun_count.load(Ordering::Relaxed), 1);
        assert_eq!(
            shared.audio_underrun_silence_frames.load(Ordering::Relaxed),
            4
        );
        assert_eq!(
            shared
                .streaming_queue_empty_during_decode_count
                .load(Ordering::Relaxed),
            1
        );
        assert_eq!(
            shared
                .streaming_queue_empty_during_decode_frames
                .load(Ordering::Relaxed),
            4
        );
        assert_eq!(
            shared
                .streaming_output_shortfall_count
                .load(Ordering::Relaxed),
            1
        );
        assert_eq!(
            shared
                .streaming_output_shortfall_frames
                .load(Ordering::Relaxed),
            4
        );
        assert_eq!(shared.streaming_queue_min_len(), Some(0));
        assert!(shared.streaming_active.load(Ordering::Relaxed));
    }

    #[test]
    fn callback_streaming_finished_empty_queue_switches_back_to_full_buffer() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.streaming_generation.store(11, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut first = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut first,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(first, vec![0.1, 0.2, 0.3, 0.4]);
        assert!(!shared.streaming_active.load(Ordering::Relaxed));
        assert_eq!(shared.audio_underrun_count.load(Ordering::Relaxed), 0);
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn callback_streaming_finished_discards_stale_chunks_before_full_buffer_fallback() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.streaming_generation.store(12, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 11,
                samples: Arc::new(vec![0.9, 0.9, 0.9, 0.9]),
            })
            .expect("streaming queue should have capacity");

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut out = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4]);
        assert!(!shared.streaming_active.load(Ordering::Relaxed));
        assert_eq!(shared.audio_underrun_count.load(Ordering::Relaxed), 0);
        assert!(shared.streaming_chunks.is_empty());
    }

    #[test]
    fn callback_memory_streaming_finished_empty_queue_stops_at_eof() {
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.position_frames.store(2, Ordering::Relaxed);
        shared.streaming_generation.store(13, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(true, Ordering::Relaxed);
        shared.streaming_memory_mode.store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut out = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 4]);
        assert_eq!(shared.state.load(), PlayerState::Stopped);
        assert!(!shared.streaming_active.load(Ordering::Relaxed));
        assert_eq!(shared.audio_underrun_count.load(Ordering::Relaxed), 0);
        assert_eq!(shared.playback_end_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn callback_memory_streaming_drained_with_estimate_total_stops_without_spinning() {
        // Regression for the audio-thread hang: in memory streaming mode the full
        // buffer is never published (it stays empty) yet `total_frames` is a ceil
        // *estimate* that can exceed any real frame count. Once the chunk queue
        // drains, the render loop must stop at EOF instead of spinning forever trying
        // to read frames that were never decoded. If the bug regresses this test hangs.
        let shared = SharedState::new();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        // Estimate far beyond the (empty) buffer, with playback not yet at `total`.
        shared.total_frames.store(100, Ordering::Relaxed);
        shared.position_frames.store(0, Ordering::Relaxed);
        shared.streaming_generation.store(21, Ordering::Relaxed);
        shared.streaming_active.store(true, Ordering::Relaxed);
        shared
            .streaming_decode_finished
            .store(true, Ordering::Relaxed);
        shared.streaming_memory_mode.store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut out = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 4]);
        assert_eq!(shared.state.load(), PlayerState::Stopped);
        assert!(!shared.streaming_active.load(Ordering::Relaxed));
        assert_eq!(shared.playback_end_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn callback_full_buffer_estimate_exceeds_decoded_stops_at_eof() {
        // Regression for the audio-thread hang in full-buffer mode: when the decoded
        // buffer is shorter than the advertised `total_frames` estimate, reaching the
        // end of the real samples must stop at EOF instead of spinning on reads that
        // can never be satisfied.
        let shared = SharedState::new();
        // Two real frames decoded...
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        // ...but the advertised length is a larger estimate, and we are already at
        // the end of the real data.
        shared.total_frames.store(10, Ordering::Relaxed);
        shared.position_frames.store(2, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut out = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.0; 4]);
        assert_eq!(shared.state.load(), PlayerState::Stopped);
        assert_eq!(shared.playback_end_count.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn gapless_activation_retires_previous_buffer_off_realtime_thread() {
        // The audio callback must not free the outgoing decoded buffer inline (that
        // would hit the allocator on the realtime thread). At a gapless swap it hands
        // the old buffer to the retire queue for the command loop to drop.
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.position_frames.store(2, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        // Arm a pending gapless track so EOF activates it instead of stopping.
        shared
            .pending_buffer
            .store(Some(Arc::new(vec![0.5, 0.6, 0.7, 0.8])));
        shared.pending_total_frames.store(2, Ordering::Relaxed);
        shared.pending_sample_rate.store(44_100, Ordering::Relaxed);
        shared.pending_channels.store(2, Ordering::Relaxed);
        shared.pending_ready.store(true, Ordering::Release);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut scratch = CallbackScratch::new(2);
        let mut out = vec![1.0f32; 4];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        // The new buffer is now active and the old one was retired, not dropped in RT.
        assert_eq!(shared.audio_buffer.load().as_slice(), &[0.5, 0.6, 0.7, 0.8]);
        assert_eq!(
            shared
                .retired_resource_drop_in_rt_count
                .load(Ordering::Relaxed),
            0
        );
        assert!(
            matches!(
                shared.retired_resources.pop(),
                Some(RetiredAudioResource::Buffer(_))
            ),
            "expected the previous buffer to be retired for off-thread drop"
        );

        // The command loop drains the rest without panicking.
        shared.drain_retired_audio_resources();
    }

    #[test]
    fn direct_output_path_skips_final_buffer_when_no_resampler_or_shaper() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.25, -0.5, 0.75, -1.0]));
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 4];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.25, -0.5, 0.75, -1.0]);
        assert_eq!(scratch.final_output.len(), 0);
    }

    #[test]
    fn disabled_final_shaper_uses_direct_output_path() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
        noise_shaper_params.set_enabled(false);
        let mut final_noise_shaper =
            NoiseShaperProcessor::new(2, 44_100, Arc::clone(&noise_shaper_params));
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 4];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4]);
        assert_eq!(scratch.final_output.len(), 0);
    }

    #[test]
    fn disabled_final_shaper_with_resampler_skips_final_buffer() {
        let shared = SharedState::new();
        shared
            .audio_buffer
            .store(Arc::new(vec![0.1, 0.2, 0.3, 0.4]));
        shared.total_frames.store(2, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
        noise_shaper_params.set_enabled(false);
        let mut final_noise_shaper =
            NoiseShaperProcessor::new(2, 44_100, Arc::clone(&noise_shaper_params));
        let mut resampler = Some(StreamingResampler::new(2, 44_100, 44_100).unwrap());
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 4];
        let mut scratch = CallbackScratch::new(2);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            2,
            &mut resampler,
            &mut scratch,
        );

        assert_eq!(out, vec![0.1, 0.2, 0.3, 0.4]);
        assert_eq!(scratch.final_output.len(), 0);
    }

    #[test]
    fn test_lockfree_dsp_context() {
        let eq_params = Arc::new(AtomicEqParams::new());
        let sat_params = Arc::new(AtomicSaturationParams::new());
        let cross_params = Arc::new(AtomicCrossfeedParams::new());
        let limiter_params = Arc::new(AtomicPeakLimiterParams::new());
        let vol_params = Arc::new(AtomicVolumeParams::new());
        let ns_params = Arc::new(AtomicNoiseShaperParams::new());
        let dl_params = Arc::new(AtomicDynamicLoudnessParams::new());
        let dl_telemetry = Arc::new(AtomicDynamicLoudnessTelemetry::new());

        let (_ctx, mut chain) = LockfreeDspContext::new(
            2,
            44100.0,
            Arc::clone(&eq_params),
            Arc::clone(&sat_params),
            Arc::clone(&cross_params),
            Arc::clone(&limiter_params),
            Arc::clone(&vol_params),
            Arc::clone(&ns_params),
            Arc::clone(&dl_params),
            Arc::clone(&dl_telemetry),
        );

        // Test that we can update params while processing
        eq_params.set_band_gain(0, 3.0);

        let mut buffer = vec![0.5; 100];
        // Process through owned chain (no Mutex!)
        chain.process(&mut buffer, 2);

        // Should not panic
    }

    #[test]
    fn test_gapless_swap_reuses_pending_arc() {
        let shared = SharedState::new();
        let pending = Arc::new(vec![0.25, 0.5, 0.75, 1.0]);
        let pending_ptr = Arc::as_ptr(&pending);
        shared.pending_buffer.store(Some(Arc::clone(&pending)));
        shared.pending_total_frames.store(2, Ordering::Relaxed);
        shared.pending_sample_rate.store(44100, Ordering::Relaxed);
        shared.pending_channels.store(2, Ordering::Relaxed);
        shared.pending_ready.store(true, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);
        shared.position_frames.store(2, Ordering::Relaxed);

        let eq_params = Arc::new(AtomicEqParams::new());
        let sat_params = Arc::new(AtomicSaturationParams::new());
        let cross_params = Arc::new(AtomicCrossfeedParams::new());
        let limiter_params = Arc::new(AtomicPeakLimiterParams::new());
        let vol_params = Arc::new(AtomicVolumeParams::new());
        let ns_params = Arc::new(AtomicNoiseShaperParams::new());
        let dl_params = Arc::new(AtomicDynamicLoudnessParams::new());
        let dl_telemetry = Arc::new(AtomicDynamicLoudnessTelemetry::new());
        let (_ctx, mut chain) = LockfreeDspContext::new(
            2,
            44100.0,
            eq_params,
            sat_params,
            cross_params,
            limiter_params,
            vol_params,
            ns_params,
            dl_params,
            dl_telemetry,
        );
        let loudness = Arc::new(AtomicLoudnessState::default());
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 16];
        let mut scratch = CallbackScratch::new(2);
        let mut final_noise_shaper =
            NoiseShaperProcessor::new(2, 44100, Arc::new(AtomicNoiseShaperParams::new()));

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            2,
            &mut None,
            &mut scratch,
        );

        let current = shared.audio_buffer.load_full();
        assert_eq!(Arc::as_ptr(&current), pending_ptr);
        assert!(shared.pending_buffer.load_full().is_none());
    }

    #[test]
    fn test_dsp_rebuild_swaps_prebuilt_chain() {
        let shared = SharedState::new();
        let initial = LockfreeDspContext::build_dsp_chain(
            2,
            44100.0,
            Arc::new(AtomicEqParams::new()),
            Arc::new(AtomicSaturationParams::new()),
            Arc::new(AtomicCrossfeedParams::new()),
            Arc::new(AtomicPeakLimiterParams::new()),
            Arc::new(AtomicVolumeParams::new()),
            Arc::new(AtomicNoiseShaperParams::new()),
            Arc::new(AtomicDynamicLoudnessParams::new()),
            Arc::new(AtomicDynamicLoudnessTelemetry::new()),
            Arc::new(ArcSwapOption::empty()),
            Arc::new(AtomicBool::new(false)),
        );
        let rebuilt = LockfreeDspContext::build_dsp_chain(
            1,
            48000.0,
            Arc::new(AtomicEqParams::new()),
            Arc::new(AtomicSaturationParams::new()),
            Arc::new(AtomicCrossfeedParams::new()),
            Arc::new(AtomicPeakLimiterParams::new()),
            Arc::new(AtomicVolumeParams::new()),
            Arc::new(AtomicNoiseShaperParams::new()),
            Arc::new(AtomicDynamicLoudnessParams::new()),
            Arc::new(AtomicDynamicLoudnessTelemetry::new()),
            Arc::new(ArcSwapOption::empty()),
            Arc::new(AtomicBool::new(false)),
        );
        let _ = shared.pending_dsp_chain.push(rebuilt);
        shared.dsp_needs_rebuild.store(true, Ordering::Relaxed);

        let loudness = Arc::new(AtomicLoudnessState::default());
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut out = vec![0.0f32; 8];
        let mut chain = initial;
        let mut scratch = CallbackScratch::new(1);
        let mut final_noise_shaper =
            NoiseShaperProcessor::new(1, 44100, Arc::new(AtomicNoiseShaperParams::new()));

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            Some(&mut final_noise_shaper),
            &loudness,
            &tx,
            1,
            &mut None,
            &mut scratch,
        );

        assert_eq!(chain.len(), 7);
        assert!(!shared.dsp_needs_rebuild.load(Ordering::Relaxed));
        assert!(shared.pending_dsp_chain.is_empty());
    }
}
