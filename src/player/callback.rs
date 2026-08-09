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
    PlayerState, RetiredAudioResource, SharedState, EVENT_NEEDS_PRELOAD_RESET, EVENT_TRACK_CHANGED,
    EVENT_TRACK_EOF,
};
use super::streaming::callback_window::{
    render_window_frames, CallbackWindowCache, WindowRenderProgress,
};
use super::streaming::memory::DecodedMemoryOwner;
use super::streaming::rt_view::{
    AppliedWindowSeek, StreamingRtView, WindowSeekKind, WindowSeekResult,
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
    callback_window: CallbackWindowCache,
    window_seek_serial: u64,
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
            callback_window: CallbackWindowCache::default(),
            window_seek_serial: 0,
            final_output: Vec::with_capacity(resample_samples),
            spectrum_batch: SpectrumBatch::new(),
        }
    }

    /// Grow the `resample_leftover` reserve off the audio thread so a single
    /// resampler output chunk can never reallocate inside the callback.
    ///
    /// Per-call Soxr output is now capped to the naive ratio bound (the resampler
    /// slices its scratch), so the reserve is driven by
    /// `StreamingResampler::max_output_len_for_input(AUDIO_PROCESS_BUFFER_FRAMES * channels)`
    /// — the output ceiling for the largest input chunk the render loop feeds in
    /// one call. Call this whenever a resampler is attached to this scratch (off
    /// the realtime path); it is a no-op once the capacity is already large enough.
    pub fn reserve_resample_leftover(&mut self, max_chunk_samples: usize) {
        if max_chunk_samples > self.resample_leftover.capacity() {
            let additional = max_chunk_samples - self.resample_leftover.len();
            self.resample_leftover.reserve_exact(additional);
        }
    }

    /// Install a freshly popped chunk into the active slot, stamping its
    /// output-frame start position from the running consumed playhead.
    #[cfg(test)]
    fn capacities(&self) -> CallbackScratchCapacities {
        CallbackScratchCapacities {
            process_buffer: self.process_buffer.capacity(),
            resample_leftover: self.resample_leftover.capacity(),
            final_output: self.final_output.capacity(),
        }
    }
}

#[allow(dead_code)]
fn render_callback_window_output(
    output: &mut [f64],
    shared: &SharedState,
    rt: &StreamingRtView,
    scratch: &mut CallbackScratch,
    start_frame: u64,
) -> WindowRenderProgress {
    let identity = scratch.callback_window.refresh(rt, |window| {
        shared.retire_audio_resource(RetiredAudioResource::Window(window));
    });
    if !identity.active {
        return WindowRenderProgress {
            rendered_frames: 0,
            next_frame: start_frame,
            shortfall: None,
        };
    }
    let Some(reader) = scratch.callback_window.reader_mut() else {
        return WindowRenderProgress {
            rendered_frames: 0,
            next_frame: start_frame,
            shortfall: None,
        };
    };
    render_window_frames(reader, identity.epoch, start_frame, output)
}

fn fill_callback_window_process_buffer(
    shared: &SharedState,
    rt: &StreamingRtView,
    scratch: &mut CallbackScratch,
    start_frame: u64,
    channels: usize,
    frames_to_read: usize,
) -> WindowRenderProgress {
    let requested_samples = frames_to_read * channels;
    scratch.process_buffer.clear();
    scratch.process_buffer.resize(requested_samples, 0.0);
    let identity = scratch.callback_window.refresh(rt, |window| {
        shared.retire_audio_resource(RetiredAudioResource::Window(window));
    });
    let progress = if identity.active {
        match scratch.callback_window.reader_mut() {
            Some(reader) => render_window_frames(
                reader,
                identity.epoch,
                start_frame,
                &mut scratch.process_buffer,
            ),
            None => WindowRenderProgress {
                rendered_frames: 0,
                next_frame: start_frame,
                shortfall: None,
            },
        }
    } else {
        WindowRenderProgress {
            rendered_frames: 0,
            next_frame: start_frame,
            shortfall: None,
        }
    };
    scratch
        .process_buffer
        .truncate(progress.rendered_frames * channels);
    progress
}

fn consume_window_seek(
    shared: &SharedState,
    rt: &StreamingRtView,
    scratch: &mut CallbackScratch,
    current_pos: &mut usize,
) -> bool {
    consume_window_seek_with_before_publish(shared, rt, scratch, current_pos, || {})
}

fn consume_window_seek_with_before_publish(
    shared: &SharedState,
    rt: &StreamingRtView,
    scratch: &mut CallbackScratch,
    current_pos: &mut usize,
    before_publish: impl FnOnce(),
) -> bool {
    let Some(request) = rt.seek_request() else {
        return false;
    };
    if request.serial == scratch.window_seek_serial {
        return false;
    }
    let identity = scratch.callback_window.refresh(rt, |window| {
        shared.retire_audio_resource(RetiredAudioResource::Window(window));
    });
    let producer = rt.producer();
    let _direction = match request.kind {
        WindowSeekKind::Forward => WindowSeekKind::Forward,
        WindowSeekKind::Backward => WindowSeekKind::Backward,
    };
    let mut result = if !identity.active
        || request.generation != identity.generation
        || request.epoch != identity.epoch
    {
        WindowSeekResult::StaleIdentity
    } else if request.target_frame < producer.retained_start_frame
        || request.target_frame >= producer.produced_end_frame
    {
        WindowSeekResult::OutsideResidentRange
    } else {
        match scratch.callback_window.reader_mut().and_then(|reader| {
            reader
                .try_claim_frame(identity.epoch, request.target_frame)
                .ok()
        }) {
            Some(slot) => {
                slot.release();
                WindowSeekResult::Applied
            }
            None => WindowSeekResult::SlotUnavailable,
        }
    };
    before_publish();
    if !rt.is_latest_seek_serial(request.serial) {
        result = WindowSeekResult::Superseded;
    }
    scratch.window_seek_serial = request.serial;
    rt.publish_applied_seek(AppliedWindowSeek {
        serial: request.serial,
        result,
        audible_frame: if result == WindowSeekResult::Applied {
            request.target_frame
        } else {
            *current_pos as u64
        },
        observed_generation: identity.generation,
        observed_epoch: identity.epoch,
    });
    if result != WindowSeekResult::Applied {
        return false;
    }
    *current_pos = request.target_frame.min(usize::MAX as u64) as usize;
    shared
        .playback_clock
        .callback
        .position_frames
        .store(request.target_frame, Ordering::Release);
    true
}

pub(crate) fn benchmark_resident_window_seeks(iterations: usize) -> Vec<(&'static str, Vec<u64>)> {
    use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
    use crate::player::streaming::rt_view::{
        ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
    };
    use std::time::Instant;

    const SAMPLE_RATE: u64 = 48_000;
    const GENERATION: u64 = 1;
    const EPOCH: u64 = 1;

    let geometry = PcmWindowGeometry::for_slot_count(2, 2_048).expect("seek bench geometry");
    let parts = PcmWindow::create(geometry, EPOCH, 0, DecodedMemoryOwner::ActiveWindow).expect("seek bench window");
    let mut writer = parts.writer;
    let base = SAMPLE_RATE * 60;
    let scenarios = [
        ("forward_100ms", base + SAMPLE_RATE / 10),
        ("forward_5s", base + SAMPLE_RATE * 5),
        ("forward_60s", base + SAMPLE_RATE * 60),
        ("backward_100ms", base - SAMPLE_RATE / 10),
        ("backward_5s", base - SAMPLE_RATE * 5),
        ("backward_60s", 0),
    ];
    let mut published_sequences = Vec::with_capacity(scenarios.len());
    for (_, target) in scenarios {
        let sequence = target / geometry.slot_frames() as u64;
        if published_sequences.contains(&sequence) {
            continue;
        }
        let mut slot = writer
            .try_claim_owned(EPOCH, sequence, 0)
            .expect("claim seek bench slot");
        slot.append_interleaved(&vec![0.0; geometry.slot_samples()])
            .expect("fill seek bench slot");
        slot.publish().expect("publish seek bench slot");
        published_sequences.push(sequence);
    }

    let rt = StreamingRtView::new();
    rt.install_window(Some(parts.window));
    rt.publish_identity(WindowIdentitySnapshot {
        generation: GENERATION,
        epoch: EPOCH,
        active: true,
    });
    rt.publish_producer(ProducerSnapshot {
        retained_start_frame: 0,
        produced_end_frame: base + SAMPLE_RATE * 60 + geometry.slot_frames() as u64,
        decode_state: StreamingDecodeState::Ready,
    });
    let shared = SharedState::new();
    let mut scratch = CallbackScratch::new(2);
    let mut current_pos = base as usize;
    let mut rows = Vec::with_capacity(scenarios.len());

    for (name, target) in scenarios {
        let mut samples = Vec::with_capacity(iterations);
        for _ in 0..iterations {
            let kind = if target >= current_pos as u64 {
                WindowSeekKind::Forward
            } else {
                WindowSeekKind::Backward
            };
            let started = Instant::now();
            let serial = rt.request_seek(target, GENERATION, EPOCH, kind);
            assert!(consume_window_seek(
                &shared,
                &rt,
                &mut scratch,
                &mut current_pos,
            ));
            samples.push(started.elapsed().as_nanos().min(u64::MAX as u128) as u64);
            let applied = rt.applied_seek().expect("applied resident seek");
            assert_eq!(applied.serial, serial);
            assert_eq!(applied.result, WindowSeekResult::Applied);
            assert_eq!(applied.audible_frame, target);
            assert_eq!(current_pos as u64, target);
        }
        rows.push((name, samples));
    }
    rows
}

fn clear_streaming_scratch(shared: &SharedState, scratch: &mut CallbackScratch) {
    scratch.resample_leftover.clear();
    scratch.resample_leftover_pos = 0;
    let _ = shared;
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
    // A new generation restarts the consumed-frame playhead. Seed it from the
    // absolute output position this generation resumes at (`position_frames`)
    // rather than 0, so each retained chunk's `start_frame` is an absolute
    // track-output-frame — directly comparable to an in-window seek target. This
    // is the only callback-path change for PR2: a single atomic load plus integer
    // assignment, with no allocation, lock, or drop on the audio thread.
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
    } else if from > 2 && (to == 1 || to == 2) {
        // Multichannel (5.1/7.1/…) → mono/stereo. The naive truncate path below
        // would silently drop the center, LFE, and surround channels. Use
        // audio-engine-core's layout-aware `Downmixer` (ITU-R BS.775 fold) so
        // those channels are mixed into L/R instead of discarded. The 1↔2 paths
        // above are intentionally left untouched (BS.775 would shift their
        // gain). On any error we fall back to the legacy truncate/pad below.
        match downmix_multichannel(&samples, from, to) {
            Some(out) => out,
            None => truncate_or_pad_channels(&samples, from, to),
        }
    } else {
        truncate_or_pad_channels(&samples, from, to)
    }
}

/// Legacy channel fit: copy the first `to` source channels per frame, zero-pad
/// when `to > from`. Used for layouts the layout-aware downmixer does not cover
/// (e.g. upmix beyond stereo) and as a fallback if the downmixer fails to build.
fn truncate_or_pad_channels(samples: &[f64], from: usize, to: usize) -> Vec<f64> {
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

/// Layout-aware multichannel downmix to mono/stereo via core's `Downmixer`.
/// Returns `None` (so the caller can fall back) if the downmixer cannot be
/// built or the buffer is not frame-aligned.
fn downmix_multichannel(samples: &[f64], from: usize, to: usize) -> Option<Vec<f64>> {
    use crate::processor::{DownmixCoefficients, Downmixer};
    use audio_engine_core::ChannelLayout;

    let downmixer = Downmixer::new(
        ChannelLayout::from_count(from),
        ChannelLayout::from_count(to),
        DownmixCoefficients::default(),
    )
    .ok()?;

    let mut out = vec![0.0; downmixer.output_len(samples.len())];
    downmixer.process_into(samples, &mut out).ok()?;
    Some(out)
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
///               [Volume → EQ → Saturation → Crossfeed → Convolver → DynamicLoudness → PeakLimiter]
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

    /// Disposal slots of every `ConvolverProcessor` built for this context
    /// (main chain, WASAPI chain, fallback chains, rebuilds). The audio thread
    /// parks retired kernels in its chain's slot; per the core contract at most
    /// two park before further kernel adoptions are deferred, so the publisher
    /// must drain these before installing a new kernel. Only touched from
    /// non-realtime paths.
    convolver_disposal_slots: parking_lot::Mutex<Vec<Arc<ArcSwapOption<FFTConvolver>>>>,
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
    ) -> (DspChain, Arc<ArcSwapOption<FFTConvolver>>) {
        // Stage order follows audio-engine-core's canonical output chain
        // (`canonical_output_stage_descriptors`): Volume → EQ → Saturation →
        // Crossfeed → Convolver → DynamicLoudness → PeakLimiter. NoiseShaper is
        // intentionally NOT added here: the realtime path applies it separately
        // after resampling (at the output rate) via `final_noise_shaper`, so it
        // must not also live inside the source-rate DSP chain.
        let mut chain = DspChain::with_capacity(7, sample_rate);
        chain.add(VolumeProcessor::new(volume_params));
        chain.add(EqProcessor::new(channels, sample_rate, eq_params));
        chain.add(SaturationProcessor::new(channels, saturation_params));
        chain.add(CrossfeedProcessor::new(sample_rate, crossfeed_params));
        let convolver = ConvolverProcessor::new(convolver_swap, convolver_enabled);
        let convolver_disposal = convolver.disposal_slot();
        chain.add(convolver);
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
        (chain, convolver_disposal)
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
        let (chain, convolver_disposal) = Self::build_dsp_chain(
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
            convolver_disposal_slots: parking_lot::Mutex::new(vec![convolver_disposal]),
        };

        (ctx, chain)
    }

    /// Track a chain's convolver disposal slot so retired kernels get drained.
    /// Every caller of [`Self::build_dsp_chain`] that installs the chain for
    /// playback must register the returned slot here. Slots whose processor is
    /// gone and that hold no kernel are pruned on the way in.
    pub fn register_convolver_disposal_slot(&self, slot: Arc<ArcSwapOption<FFTConvolver>>) {
        let mut slots = self.convolver_disposal_slots.lock();
        slots.retain(|s| Arc::strong_count(s) > 1 || s.load().is_some());
        slots.push(slot);
    }

    /// Drain retired kernels parked by the audio thread. Called from
    /// non-realtime paths before publishing a new kernel so the large
    /// deallocations happen here, and so kernel adoption never stalls on a
    /// full disposal slot (core parks at most two retirees).
    fn drain_retired_convolver_kernels(&self) {
        for slot in self.convolver_disposal_slots.lock().iter() {
            drop(slot.swap(None));
        }
    }

    fn rebuild_merged_convolver(&self) -> Result<(), String> {
        self.drain_retired_convolver_kernels();
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

/// Consume the lock-free seek-request slot at the top of a callback
/// invocation (M1 fix).
///
/// Requesters ([`SharedState::request_seek_to_frame`]) store the target frame
/// (`Release`) and then bump `seek_slot_serial` (`AcqRel`); the `Acquire`
/// serial load here therefore guarantees the target read below is at least as
/// new as the request that bumped the observed serial. Consumption re-stores
/// the target into `position_frames` so this invocation starts from the
/// authoritative frame even if a non-slot legacy writer or an older build's
/// stale callback publish disturbed the requester's immediate UI store.
///
/// Setting `dsp_reset_pending` makes the DSP/resampler state reset part of
/// seek consumption itself (m3 fix): `reset_dsp_state_if_requested` runs
/// right after this in the same invocation and resets the chain, noise
/// shaper, and resampler, and clears `scratch.resample_leftover`, so no
/// pre-seek audio leaks across the discontinuity.
///
/// Returns the serial observed for this invocation; every later
/// `position_frames` publish in the same invocation must re-check it via
/// [`publish_callback_position`]. Atomics only: no lock, no allocation.
fn consume_pending_seek_slot(shared: &SharedState) -> u64 {
    let (serial, consumed) = shared.playback_clock.consume_pending_seek();
    if consumed {
        shared.dsp_reset_pending.store(true, Ordering::Release);
    }
    serial
}

/// Publish a callback-derived `position_frames` value unless a fresh seek
/// request landed after `observed_serial` was read at the top of this
/// invocation (M1 fix). On a serial mismatch the publish is refused: the
/// seek target must remain authoritative, and the callback picks the new
/// target up at its next invocation via [`consume_pending_seek_slot`]. A
/// second post-store check closes the tiny check/store window by immediately
/// restoring the seek target if the serial changed after the pre-store check.
///
/// Returns whether the position was published; callers must also skip their
/// render-clock span publication when this returns `false` so the
/// interpolated position display cannot run past a refused publish.
#[inline]
fn publish_callback_position(shared: &SharedState, new_pos: u64, observed_serial: u64) -> bool {
    publish_callback_position_after_precheck(shared, new_pos, observed_serial, || {})
}

#[inline]
fn publish_callback_position_after_precheck(
    shared: &SharedState,
    new_pos: u64,
    observed_serial: u64,
    after_precheck: impl FnOnce(),
) -> bool {
    if !shared
        .playback_clock
        .publish_callback_position_after_precheck(new_pos, observed_serial, after_precheck)
    {
        return false;
    }
    shared.mark_first_position_advanced_after_play();
    true
}

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
    // Works for both engines: legacy preload consumes `pending_ready`,
    // streaming-v2 preload consumes `streaming_pending_ready`.
    let sr = shared.sample_rate.load(Ordering::Relaxed) as usize;
    let remaining_frames = total.saturating_sub(current_pos);
    if remaining_frames > 0
        && remaining_frames < sr * 5
        && !shared.pending_ready.load(Ordering::Relaxed)
        && !shared.streaming_pending_ready.load(Ordering::Acquire)
        && !shared.needs_preload.load(Ordering::Acquire)
    {
        shared.needs_preload.store(true, Ordering::Release);
    }
}

/// Swap in a gapless-preloaded v2 streaming session at the current track's
/// EOF, mirroring [`try_activate_pending_gapless`] for the windowed engine.
///
/// Protocol (single audio-callback thread):
/// 1. Validate the pending slot still belongs to the current load generation.
/// 2. Claim the pending RT exclusively and publish the swap signal to the
///    audio thread BEFORE republishing the RT, so a concurrent
///    `clear_pending_streaming` can never retire the session that is about to
///    become active (`sync_pending_swap` owns it from now on).
/// 3. Republish the RT into the active slot (displacing the finished session's
///    RT into the retire queue) and reset track-position state.
fn try_activate_pending_v2(
    shared: &SharedState,
    dsp_chain: &mut DspChain,
    resampler: &mut Option<StreamingResampler>,
    scratch: &mut CallbackScratch,
) -> bool {
    if shared
        .streaming_pending_generation
        .load(Ordering::Acquire)
        != shared.load_generation.load(Ordering::Acquire)
    {
        log::debug!(
            "v2 gapless: stale pending generation {} vs load {}",
            shared.streaming_pending_generation.load(Ordering::Acquire),
            shared.load_generation.load(Ordering::Acquire)
        );
        shared.streaming_pending_v2_rt.store(None);
        shared.streaming_pending_ready.store(false, Ordering::Release);
        return false;
    }
    let pending_guard = shared.streaming_pending_v2_rt.load();
    let Some(pending_arc) = pending_guard.as_ref() else {
        log::debug!("v2 gapless: no pending RT at EOF");
        return false;
    };
    if pending_arc.producer().decode_state
        == super::streaming::rt_view::StreamingDecodeState::Loading
        || pending_arc.producer().decode_state
            == super::streaming::rt_view::StreamingDecodeState::Inactive
    {
        log::debug!(
            "v2 gapless: pending not ready (state {}), deferring",
            pending_arc.producer().decode_state as u8
        );
        // Leave the preload in place; a later EOF frame will reap it.
        return false;
    }
    let pending = Arc::clone(pending_arc);
    drop(pending_guard);

    shared.streaming_pending_v2_rt.store(None);
    shared.streaming_pending_ready.store(false, Ordering::Release);
    shared.streaming_swap_requested.store(true, Ordering::Release);

    let displaced = shared.streaming_v2_rt.swap(Some(pending));
    if let Some(old) = displaced {
        shared.retire_audio_resource(RetiredAudioResource::StreamingRtView(old));
    }

    shared.request_seek_to_frame(0);
    shared.dsp_reset_pending.store(true, Ordering::Release);
    shared
        .total_frames
        .store(
            shared.streaming_pending_total_frames.load(Ordering::Acquire),
            Ordering::Release,
        );
    shared
        .channels
        .store(
            shared.streaming_pending_channels.load(Ordering::Acquire),
            Ordering::Release,
        );
    shared.needs_preload.store(false, Ordering::Relaxed);
    shared.pending_ready.store(false, Ordering::Relaxed);
    shared.gapless_swap_pending.store(true, Ordering::Release);
    shared.event_flags.fetch_or(
        EVENT_TRACK_CHANGED | EVENT_NEEDS_PRELOAD_RESET,
        Ordering::Release,
    );

    // Format state stays as published by the active session: the preload
    // session is built at the same target sample rate / channel count.
    dsp_chain.reset();
    if let Some(rs) = resampler.as_mut() {
        rs.reset();
    }
    scratch.resample_leftover.clear();
    scratch.resample_leftover_pos = 0;
    true
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
    let next_reservation = shared.pending_buffer_reservation.swap(None);

    let next_frames = shared.pending_total_frames.load(Ordering::Relaxed);
    let next_sr = shared.pending_sample_rate.load(Ordering::Relaxed);
    let next_ch = shared.pending_channels.load(Ordering::Relaxed);

    // Offload the outgoing buffer's drop to the command loop; freeing a large
    // decoded `Vec<f64>` on the audio thread would hit the allocator.
    let retired_buffer = shared.audio_buffer.swap(next);
    let retired_reservation = shared.audio_buffer_reservation.swap(next_reservation);
    shared.retire_audio_resource(RetiredAudioResource::Buffer {
        samples: retired_buffer,
        reservation: retired_reservation,
    });
    shared.total_frames.store(next_frames, Ordering::Relaxed);
    shared.sample_rate.store(next_sr, Ordering::Relaxed);
    shared.channels.store(next_ch, Ordering::Relaxed);
    // Route the track-boundary position reset through the seek slot: this
    // supersedes any not-yet-consumed seek request that targeted the outgoing
    // track, so it can never be applied to the new one. Atomics only — safe on
    // the audio thread.
    shared.request_seek_to_frame(0);

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
    observed_seek_serial: u64,
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

        let rendered_start_frame = *current_pos as u64;
        *current_pos += frames_to_read;
        let position_published =
            publish_callback_position(shared, *current_pos as u64, observed_seek_serial);

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

            let rendered_output_frames = chunk_idx / channels;
            if position_published && rendered_output_frames > 0 && samples_written > 0 {
                let source_frames_rendered =
                    frames_to_read.saturating_mul(rendered_output_frames) / frames_needed_out;
                shared.mark_render_clock_span(
                    rendered_start_frame,
                    rendered_start_frame.saturating_add(source_frames_rendered.max(1) as u64),
                );
            }

            if chunk_idx < resampled_samples.len() {
                // Safety net: leftover is drained (and cleared) before this render
                // loop runs, so this extend is the only writer per callback. The
                // reserve is sized off the realtime thread (at resampler-attach
                // time) to the resampler's naive per-call output bound
                // (`max_output_len_for_input(AUDIO_PROCESS_BUFFER_FRAMES * channels)`),
                // which is now a valid single-call ceiling because per-call Soxr
                // output is capped via slicing. A failure here means the attach-time
                // reserve was skipped or undersized, which would otherwise reallocate
                // on the real-time audio thread.
                let added = resampled_samples.len() - chunk_idx;
                debug_assert!(
                    scratch.resample_leftover.len() + added <= scratch.resample_leftover.capacity(),
                    "resample_leftover would realloc in the audio callback: len {} + {} > cap {} \
                     (attach-time reserve_resample_leftover was skipped or undersized)",
                    scratch.resample_leftover.len(),
                    added,
                    scratch.resample_leftover.capacity()
                );
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
            let rendered_output_frames = take / channels;
            if position_published && rendered_output_frames > 0 {
                shared.mark_render_clock_span(
                    rendered_start_frame,
                    rendered_start_frame.saturating_add(rendered_output_frames as u64),
                );
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
    observed_seek_serial: u64,
) -> usize {
    let output_len = data.len();
    let mut samples_written = 0;
    let generation = shared.streaming_generation.load(Ordering::Acquire);
    refresh_streaming_scratch_generation(shared, scratch, resampler, generation);
    let v2_rt = shared
        .streaming_v2_enabled
        .load(Ordering::Acquire)
        .then(|| shared.streaming_v2_rt.load());
    if let Some(rt) = v2_rt.as_ref().and_then(|guard| guard.as_ref()) {
        if consume_window_seek(shared, rt, scratch, current_pos) {
            dsp_chain.reset();
            if let Some(resampler) = resampler.as_mut() {
                resampler.reset();
            }
            scratch.resample_leftover.clear();
            scratch.resample_leftover_pos = 0;
        }
    }

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
        let frames_read = if let Some(rt) = v2_rt.as_ref().and_then(|guard| guard.as_ref()) {
            let producer = rt.producer();
            let available_frames = producer
                .produced_end_frame
                .saturating_sub(*current_pos as u64)
                .min(usize::MAX as u64) as usize;
            let bounded_frames = frames_to_read.min(available_frames);
            if bounded_frames == 0 {
                scratch.process_buffer.clear();
                0
            } else {
                fill_callback_window_process_buffer(
                    shared,
                    rt,
                    scratch,
                    *current_pos as u64,
                    channels,
                    bounded_frames,
                )
                .rendered_frames
            }
        } else {
            scratch.process_buffer.clear();
            0
        };

        if frames_read == 0 {
            let v2_producer = v2_rt
                .as_ref()
                .and_then(|guard| guard.as_ref())
                .map(|rt| rt.producer());
            let v2_at_eof = v2_producer.is_some_and(|producer| {
                producer.decode_state
                    == super::streaming::rt_view::StreamingDecodeState::EndOfStream
                    && (*current_pos as u64) >= producer.produced_end_frame
            });
            if v2_at_eof && try_activate_pending_v2(shared, dsp_chain, resampler, scratch) {
                // Gapless: this callback emits silence for the final frames of
                // the outgoing track; the next callback renders from the
                // swapped-in pending window at frame 0.
                data.fill(0.0);
                return output_len;
            }
            if v2_at_eof {
                if shared.state.load() == PlayerState::Playing {
                    shared.state.store(PlayerState::Stopped);
                    shared.playback_end_count.fetch_add(1, Ordering::AcqRel);
                    shared
                        .event_flags
                        .fetch_or(EVENT_TRACK_EOF, Ordering::Release);
                }
                // End-of-queue: no pending swap is coming. Tell the audio
                // thread to retire the staged preload window so the ledger
                // does not keep charging 128 MiB of dead pending playback.
                shared
                    .streaming_pending_abandon
                    .store(true, Ordering::Release);
            } else if !shared.is_loading.load(Ordering::Acquire) {
                let silence_frames = ((output_len - samples_written) / channels) as u64;
                shared.audio_underrun_count.fetch_add(1, Ordering::Relaxed);
                shared
                    .audio_underrun_silence_frames
                    .fetch_add(silence_frames, Ordering::Relaxed);
            }
            break;
        }

        let rendered_start_frame = *current_pos as u64;
        *current_pos += frames_read;
        if let Some(rt) = v2_rt.as_ref().and_then(|guard| guard.as_ref()) {
            rt.publish_render_cursor(*current_pos as u64);
        }
        let position_published =
            publish_callback_position(shared, *current_pos as u64, observed_seek_serial);

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

            let rendered_output_frames = chunk_idx / channels;
            if position_published && rendered_output_frames > 0 && samples_written > 0 {
                let source_frames_rendered =
                    frames_read.saturating_mul(rendered_output_frames) / frames_needed_out;
                shared.mark_render_clock_span(
                    rendered_start_frame,
                    rendered_start_frame.saturating_add(source_frames_rendered.max(1) as u64),
                );
            }

            if chunk_idx < resampled_samples.len() {
                // Safety net: leftover is drained (and cleared) before this render
                // loop runs, so this extend is the only writer per callback. The
                // reserve is sized off the realtime thread (at resampler-attach
                // time) to the resampler's naive per-call output bound
                // (`max_output_len_for_input(AUDIO_PROCESS_BUFFER_FRAMES * channels)`),
                // which is now a valid single-call ceiling because per-call Soxr
                // output is capped via slicing. A failure here means the attach-time
                // reserve was skipped or undersized, which would otherwise reallocate
                // on the real-time audio thread.
                let added = resampled_samples.len() - chunk_idx;
                debug_assert!(
                    scratch.resample_leftover.len() + added <= scratch.resample_leftover.capacity(),
                    "resample_leftover would realloc in the audio callback: len {} + {} > cap {} \
                     (attach-time reserve_resample_leftover was skipped or undersized)",
                    scratch.resample_leftover.len(),
                    added,
                    scratch.resample_leftover.capacity()
                );
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
            let rendered_output_frames = take / channels;
            if position_published && rendered_output_frames > 0 {
                shared.mark_render_clock_span(
                    rendered_start_frame,
                    rendered_start_frame.saturating_add(rendered_output_frames as u64),
                );
            }
            samples_written += take;
        }
    }

    if samples_written < output_len {
        let silence_frames = ((output_len - samples_written) / channels) as u64;
        if !shared.is_loading.load(Ordering::Acquire) {
            shared.mark_streaming_output_shortfall(silence_frames);
        }
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
    // Consume any pending seek request BEFORE the DSP reset check: consumption
    // sets `dsp_reset_pending`, so the reset (including the resample-leftover
    // clear) is applied in this same invocation, ahead of any rendering.
    let observed_seek_serial = consume_pending_seek_slot(shared);
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
    let mut current_pos = shared
        .playback_clock
        .callback
        .position_frames
        .load(Ordering::Relaxed) as usize;
    let streaming_active = shared.streaming_active.load(Ordering::Acquire);
    // Windowed-v2 playback also needs the gapless preload signal (its EOF swap
    // consumes `streaming_pending_ready`), so the 5s-before-end trigger runs
    // for both engines.
    let streaming_v2 = shared.streaming_v2_enabled.load(Ordering::Acquire);
    if !streaming_active || streaming_v2 {
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
            observed_seek_serial,
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
            observed_seek_serial,
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

    fn assert_capacity_stable_after_warmup(use_resampler: bool, use_shaper: bool) {
        let mut scratch = CallbackScratch::new(TEST_CHANNELS);
        let warmed = run_capacity_probe(&mut scratch, use_resampler, use_shaper);
        let steady = run_capacity_probe(&mut scratch, use_resampler, use_shaper);

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
    fn normalize_channels_5_1_to_stereo_folds_center_and_surround() {
        // 5.1 layout order (from_count(6)): FL, FR, FC, LFE, RL, RR.
        // One frame with energy only in the center channel must reach BOTH
        // L and R (the old truncate path dropped FC/LFE/surround entirely).
        const INV_SQRT2: f64 = std::f64::consts::FRAC_1_SQRT_2;
        let frame = vec![0.0, 0.0, 1.0, 0.0, 0.0, 0.0]; // FC = 1.0
        let stereo = normalize_channels(frame, 6, 2);
        assert_eq!(stereo.len(), 2);
        // BS.775: center contributes INV_SQRT2 to each of L and R.
        assert!((stereo[0] - INV_SQRT2).abs() < 1e-9, "L = {}", stereo[0]);
        assert!((stereo[1] - INV_SQRT2).abs() < 1e-9, "R = {}", stereo[1]);
    }

    #[test]
    fn normalize_channels_5_1_surround_reaches_output() {
        // Surround channels (RL/RR) must not be discarded. Put energy only in
        // RL and confirm it lands in the left output.
        let frame = vec![0.0, 0.0, 0.0, 0.0, 1.0, 0.0]; // RL = 1.0
        let stereo = normalize_channels(frame, 6, 2);
        assert!(stereo[0].abs() > 1e-6, "rear-left should reach L output");
    }

    #[test]
    fn normalize_channels_multichannel_to_mono_frame_count() {
        // Two 5.1 frames → two mono samples (no dropped/extra frames).
        let two_frames = vec![0.1; 12];
        let mono = normalize_channels(two_frames, 6, 1);
        assert_eq!(mono.len(), 2);
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
    fn seek_slot_request_wins_over_concurrent_callback_position_publish() {
        // Deterministic M1 interleaving: the callback read the slot serial at
        // the top of its invocation, a seek request lands mid-render, and the
        // callback then tries to publish an incremented position derived from
        // its stale pre-seek read. The serial re-check must refuse the publish
        // so the seek's `position_frames` store survives.
        let shared = SharedState::new();
        shared
            .playback_clock
            .callback
            .position_frames
            .store(1_000, Ordering::Relaxed);
        let observed_serial = consume_pending_seek_slot(&shared);

        // Seek from another thread, after the callback's top-of-invocation read.
        shared.request_seek_to_frame(44_100);

        // Callback-derived publish computed from the stale pre-seek position.
        let published = publish_callback_position(&shared, 1_000 + 512, observed_serial);

        assert!(
            !published,
            "a publish after a fresh seek request must be refused"
        );
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            44_100,
            "the seek target must never be overwritten by a stale callback position"
        );

        // The next invocation consumes the seek and publishes from the target.
        let next_serial = consume_pending_seek_slot(&shared);
        assert_ne!(next_serial, observed_serial);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            44_100
        );
        assert!(publish_callback_position(
            &shared,
            44_100 + 512,
            next_serial
        ));
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            44_100 + 512
        );
    }

    #[test]
    fn seek_slot_request_wins_if_it_lands_between_publish_check_and_store() {
        // Even after the pre-store serial check passes, a requester can land in
        // the tiny window before the callback stores its stale position. The
        // post-store check must repair that overwrite immediately.
        let shared = SharedState::new();
        shared
            .playback_clock
            .callback
            .position_frames
            .store(1_000, Ordering::Relaxed);
        let observed_serial = consume_pending_seek_slot(&shared);

        let published =
            publish_callback_position_after_precheck(&shared, 1_000 + 512, observed_serial, || {
                shared.request_seek_to_frame(44_100)
            });

        assert!(
            !published,
            "a publish raced by a fresh seek request must be refused"
        );
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            44_100,
            "the post-store serial check must immediately restore the seek target"
        );
    }

    #[test]
    fn seek_slot_consumption_requests_dsp_reset_and_repairs_position() {
        let shared = SharedState::new();
        shared.request_seek_to_frame(22_050);
        // Simulate the residual tail window: a previous callback's publish
        // passed the guard just before the request and its store landed on top
        // of the requester's position store.
        shared
            .playback_clock
            .callback
            .position_frames
            .store(9_999, Ordering::Relaxed);

        let serial = consume_pending_seek_slot(&shared);

        assert_eq!(
            serial,
            shared
                .playback_clock
                .callback
                .seek_slot_consumed_serial
                .load(Ordering::Acquire)
        );
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            22_050,
            "consumption must repair a clobbered requester position store"
        );
        assert!(
            shared.dsp_reset_pending.load(Ordering::Acquire),
            "m3: seek consumption must schedule a DSP/resampler state reset"
        );

        // Same serial again is a no-op (no repeated reset or position rewrite).
        shared.dsp_reset_pending.store(false, Ordering::Release);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(23_000, Ordering::Relaxed);
        let repeat_serial = consume_pending_seek_slot(&shared);
        assert_eq!(repeat_serial, serial);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            23_000
        );
        assert!(!shared.dsp_reset_pending.load(Ordering::Acquire));
    }

    #[test]
    fn callback_renders_from_seek_slot_target_after_request() {
        let shared = prepare_playing_shared(TEST_FRAMES, TEST_CHANNELS);
        let mut chain = DspChain::new(TEST_SAMPLE_RATE as f64);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut resampler: Option<StreamingResampler> = None;
        let mut scratch = CallbackScratch::new(TEST_CHANNELS);
        let out_frames = 256;
        let mut out = vec![0.0f32; out_frames * TEST_CHANNELS];

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            TEST_CHANNELS,
            &mut resampler,
            &mut scratch,
        );
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            out_frames as u64
        );

        // Seek backward through the slot; the next callback must adopt the
        // target at its top and render audio from exactly that frame.
        let target_frame = 64u64;
        shared.request_seek_to_frame(target_frame);

        audio_callback_lockfree(
            &mut out,
            &shared,
            &mut chain,
            None,
            &loudness,
            &tx,
            TEST_CHANNELS,
            &mut resampler,
            &mut scratch,
        );

        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            target_frame + out_frames as u64,
            "the callback must resume rendering from the seek target"
        );
        let buffer = shared.audio_buffer.load();
        let expected = buffer[target_frame as usize * TEST_CHANNELS] as f32;
        assert_eq!(
            out[0], expected,
            "the first rendered sample must come from the seek target frame"
        );
        assert!(
            !shared.dsp_reset_pending.load(Ordering::Acquire),
            "the reset scheduled by consumption is applied within the same invocation"
        );
    }

    #[test]
    fn seek_slot_stress_interleaved_requests_converge_to_last_target() {
        // Bounded secondary stress: a writer thread issues slot seeks while a
        // simulated callback follows the consume/publish protocol. The final
        // consume must land on the last requested target — under the old
        // bare-store protocol a request could be silently lost to a stale
        // callback store instead.
        const ITERS: u64 = 5_000;
        const STEP: u64 = 1_000;
        let shared = Arc::new(SharedState::new());
        let writer_shared = Arc::clone(&shared);
        let writer = std::thread::spawn(move || {
            for i in 1..=ITERS {
                writer_shared.request_seek_to_frame(i * STEP);
            }
        });

        let mut done = false;
        while !done {
            done = writer.is_finished();
            let serial = consume_pending_seek_slot(&shared);
            let pos = shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed);
            let _ = publish_callback_position(&shared, pos + 128, serial);
        }
        writer.join().expect("writer thread must not panic");

        consume_pending_seek_slot(&shared);
        let final_target = ITERS * STEP;
        assert_eq!(
            shared
                .playback_clock
                .requested
                .seek_slot_target_frames
                .load(Ordering::Acquire),
            final_target
        );
        assert!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed)
                >= final_target,
            "the last seek must never be lost to a stale callback position store"
        );
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

        assert!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed)
                > 0
        );
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

        let position = shared
            .playback_clock
            .callback
            .position_frames
            .load(Ordering::Relaxed) as usize;
        assert!(position >= MIN_RESAMPLE_SOURCE_FRAMES);
        assert!(
            position < 4096,
            "demand-sized resampling should avoid the old fixed 4096-frame chunk"
        );
        assert!(scratch.resample_leftover.len() < scratch.resample_leftover.capacity());
    }

    #[test]
    fn callback_dynamic_leftover_reserve_absorbs_soxr_burst_without_realloc() {
        // Worst *supported* upsample ratio: 8 kHz source -> 384 kHz target (48x).
        // A tiny output buffer pins each source read at MIN_RESAMPLE_SOURCE_FRAMES.
        // Per-call Soxr output is now capped to the naive ratio bound (the resampler
        // slices its scratch), so the per-call burst can no longer exceed
        // max_output_len_for_input(AUDIO_PROCESS_BUFFER_FRAMES * channels). The
        // leftover reserve, sized from that same bound at attach time, must absorb
        // every call without reallocating, and the per-call cap must hold.
        let channels = 2;
        let frames = 8192;
        let shared = SharedState::new();
        let samples = (0..frames * channels)
            .map(|sample| (sample as f64 % 113.0) / 113.0 - 0.5)
            .collect::<Vec<_>>();
        shared.audio_buffer.store(Arc::new(samples));
        shared.total_frames.store(frames as u64, Ordering::Relaxed);
        shared.sample_rate.store(8_000, Ordering::Relaxed);
        shared.channels.store(channels as u64, Ordering::Relaxed);
        shared.state.store(PlayerState::Playing);

        let mut chain = DspChain::new(8_000.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        loudness.set_enabled(false);
        let (tx, _rx) = crossbeam::channel::bounded(16);
        let mut resampler = Some(StreamingResampler::new(channels, 8_000, 384_000).unwrap());
        let per_call_cap = resampler
            .as_ref()
            .unwrap()
            .max_output_len_for_input(AUDIO_PROCESS_BUFFER_FRAMES * channels);
        let mut scratch = CallbackScratch::new(channels);
        // Mirror the production attach path (output_stream.rs): size the leftover
        // reserve to the resampler's per-call (naive ratio) output bound.
        scratch.reserve_resample_leftover(per_call_cap);
        let initial_capacity = scratch.resample_leftover.capacity();

        // Tiny output buffer => maximum burst per producing callback. Run enough
        // callbacks to cover more than one full produce + drain cycle.
        let mut out = vec![0.0f32; 32 * channels];
        let mut peak_leftover = 0;
        for _ in 0..512 {
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
            peak_leftover = peak_leftover.max(scratch.resample_leftover.len());
            assert!(
                scratch.resample_leftover.len() <= scratch.resample_leftover.capacity(),
                "leftover exceeded capacity: {} > {}",
                scratch.resample_leftover.len(),
                scratch.resample_leftover.capacity()
            );
            assert_eq!(
                scratch.resample_leftover.capacity(),
                initial_capacity,
                "resample_leftover reallocated in the audio callback"
            );
        }

        // The per-call output cap must hold: slicing the resampler scratch bounds
        // each callback's leftover to the naive ratio bound, so it never exceeds
        // the attach-time reserve.
        assert!(
            peak_leftover <= per_call_cap,
            "per-call Soxr output cap violated: peak {} > naive bound {}",
            peak_leftover,
            per_call_cap
        );
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
        shared
            .playback_clock
            .callback
            .position_frames
            .store(2, Ordering::Relaxed);
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
        shared
            .playback_clock
            .callback
            .position_frames
            .store(2, Ordering::Relaxed);
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
                Some(RetiredAudioResource::Buffer { .. })
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
    fn dsp_chain_order_matches_core_canonical_callback_order() {
        // The realtime chain must follow audio-engine-core's canonical callback
        // stage order, except that NoiseShaper is applied separately after
        // resampling (at the output rate) rather than inside the source-rate
        // chain. Pinning to the core descriptor list makes any upstream
        // reordering a visible, deliberate change here instead of silent drift.
        let (chain, _disposal) = LockfreeDspContext::build_dsp_chain(
            2,
            48_000.0,
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

        let expected: Vec<&'static str> = crate::processor::callback_stage_names()
            .into_iter()
            .filter(|name| *name != "NoiseShaper")
            .collect();

        assert_eq!(chain.processor_names(), expected);
    }

    #[test]
    fn publishing_kernel_drains_parked_retired_convolvers() {
        let (ctx, _chain) = LockfreeDspContext::new(
            2,
            48000.0,
            Arc::new(AtomicEqParams::new()),
            Arc::new(AtomicSaturationParams::new()),
            Arc::new(AtomicCrossfeedParams::new()),
            Arc::new(AtomicPeakLimiterParams::new()),
            Arc::new(AtomicVolumeParams::new()),
            Arc::new(AtomicNoiseShaperParams::new()),
            Arc::new(AtomicDynamicLoudnessParams::new()),
            Arc::new(AtomicDynamicLoudnessTelemetry::new()),
        );

        // Simulate the audio thread having parked a retired kernel in a
        // registered disposal slot (an extra chain's slot, like WASAPI's).
        let extra_slot: Arc<ArcSwapOption<FFTConvolver>> = Arc::new(ArcSwapOption::empty());
        extra_slot.store(Some(Arc::new(FFTConvolver::new(&[1.0, 0.0, 0.0, 0.0], 2))));
        ctx.register_convolver_disposal_slot(Arc::clone(&extra_slot));

        // Publishing a new kernel must drain every registered slot first, so
        // adoption never stalls on a full disposal slot (core parks max two).
        ctx.set_external_ir_convolver(&[0.5, 0.0, 0.0, 0.0], 2)
            .expect("kernel publish");
        assert!(
            extra_slot.load().is_none(),
            "retired kernel must be drained before a new kernel is published"
        );
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
        shared
            .playback_clock
            .callback
            .position_frames
            .store(2, Ordering::Relaxed);

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
        let (initial, _disposal) = LockfreeDspContext::build_dsp_chain(
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
        let (rebuilt, _disposal) = LockfreeDspContext::build_dsp_chain(
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

    #[test]
    fn callback_window_helper_renders_and_retires_displaced_generation() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::WindowIdentitySnapshot;

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");
        let first = PcmWindow::create(geometry, 1, 100, DecodedMemoryOwner::ActiveWindow).expect("first window");
        let mut writer = first.writer;
        let mut slot = writer.try_claim_owned(1, 0, 0).expect("claim slot");
        let samples = vec![0.25; geometry.slot_samples()];
        slot.append_interleaved(&samples).expect("append samples");
        slot.publish().expect("publish slot");

        let rt = StreamingRtView::new();
        rt.install_window(Some(Arc::clone(&first.window)));
        rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        let shared = SharedState::new();
        let mut scratch = CallbackScratch::new(2);
        let mut output = [0.0; 8];
        let progress = render_callback_window_output(&mut output, &shared, &rt, &mut scratch, 100);
        assert_eq!(progress.rendered_frames, 4);
        assert_eq!(output, [0.25; 8]);

        let second = PcmWindow::create(geometry, 2, 200, DecodedMemoryOwner::ActiveWindow).expect("second window");
        rt.install_window(Some(Arc::clone(&second.window)));
        rt.publish_identity(WindowIdentitySnapshot {
            generation: 2,
            epoch: 2,
            active: true,
        });
        let _ = render_callback_window_output(&mut output, &shared, &rt, &mut scratch, 200);

        assert!(matches!(
            shared.retired_resources.pop(),
            Some(RetiredAudioResource::Window(_))
        ));
    }

    #[test]
    fn streaming_render_selects_v2_window_and_advances_position() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::{
            ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
        };

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");
        let parts = PcmWindow::create(geometry, 1, 100, DecodedMemoryOwner::ActiveWindow).expect("window");
        let mut writer = parts.writer;
        let mut slot = writer.try_claim_owned(1, 0, 0).expect("claim slot");
        slot.append_interleaved(&vec![0.5; geometry.slot_samples()])
            .expect("append samples");
        slot.publish().expect("publish slot");

        let rt = Arc::new(StreamingRtView::new());
        rt.install_window(Some(parts.window));
        rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 100,
            produced_end_frame: 100 + geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::Ready,
        });

        let shared = SharedState::new();
        shared.streaming_generation.store(1, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);
        shared.streaming_v2_enabled.store(true, Ordering::Release);
        shared.publish_streaming_v2_rt(Some(Arc::clone(&rt)));
        let mut scratch = CallbackScratch::new(2);
        let mut chain = DspChain::with_capacity(0, 44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        let (spectrum_tx, _spectrum_rx) = crossbeam::channel::bounded(4);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(100, Ordering::Release);
        shared.state.store(PlayerState::Paused);
        let mut paused_output = [1.0; 8];
        audio_callback_lockfree(
            &mut paused_output,
            &shared,
            &mut chain,
            None,
            &loudness,
            &spectrum_tx,
            2,
            &mut None,
            &mut scratch,
        );
        assert_eq!(paused_output, [0.0; 8]);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Acquire),
            100
        );
        shared.state.store(PlayerState::Playing);
        let seek_serial = rt.request_seek(102, 1, 1, WindowSeekKind::Forward);
        let mut output = [0.0; 8];
        let mut current_pos = 100;

        let written = render_streaming_audio_output(
            &mut output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );

        assert_eq!(written, 8);
        assert!(output.iter().all(|sample| (*sample - 0.5).abs() < 0.000_1));
        assert_eq!(current_pos, 106);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Acquire),
            106
        );
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: seek_serial,
                result: WindowSeekResult::Applied,
                audible_frame: 102,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let backward_serial = rt.request_seek(101, 1, 1, WindowSeekKind::Backward);
        let mut backward_output = [0.0; 8];
        let backward_written = render_streaming_audio_output(
            &mut backward_output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(backward_written, 8);
        assert_eq!(current_pos, 105);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: backward_serial,
                result: WindowSeekResult::Applied,
                audible_frame: 101,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let superseded_serial = rt.request_seek(104, 1, 1, WindowSeekKind::Backward);
        let latest_serial = rt.request_seek(103, 1, 1, WindowSeekKind::Backward);
        assert!(latest_serial > superseded_serial);
        let mut latest_output = [0.0; 8];
        assert_eq!(
            render_streaming_audio_output(
                &mut latest_output,
                &shared,
                &mut chain,
                &loudness,
                2,
                &mut None,
                &mut scratch,
                OutputPath::Direct,
                &mut current_pos,
                0,
            ),
            8
        );
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: latest_serial,
                result: WindowSeekResult::Applied,
                audible_frame: 103,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let stale_serial = rt.request_seek(102, 99, 1, WindowSeekKind::Backward);
        assert!(!consume_window_seek(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
        ));
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: stale_serial,
                result: WindowSeekResult::StaleIdentity,
                audible_frame: 107,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let epoch_stale_serial = rt.request_seek(102, 1, 99, WindowSeekKind::Backward);
        assert!(!consume_window_seek(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
        ));
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: epoch_stale_serial,
                result: WindowSeekResult::StaleIdentity,
                audible_frame: 107,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let before_retained_serial = rt.request_seek(99, 1, 1, WindowSeekKind::Backward);
        assert!(!consume_window_seek(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
        ));
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: before_retained_serial,
                result: WindowSeekResult::OutsideResidentRange,
                audible_frame: 107,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let at_produced_end_serial = rt.request_seek(
            100 + geometry.slot_frames() as u64,
            1,
            1,
            WindowSeekKind::Forward,
        );
        assert!(!consume_window_seek(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
        ));
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: at_produced_end_serial,
                result: WindowSeekResult::OutsideResidentRange,
                audible_frame: 107,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );

        let superseded_during_apply_serial = rt.request_seek(102, 1, 1, WindowSeekKind::Backward);
        let mut newer_serial = 0;
        assert!(!consume_window_seek_with_before_publish(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
            || {
                newer_serial = rt.request_seek(103, 1, 1, WindowSeekKind::Backward);
            },
        ));
        assert!(newer_serial > superseded_during_apply_serial);
        assert_eq!(current_pos, 107);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: superseded_during_apply_serial,
                result: WindowSeekResult::Superseded,
                audible_frame: 107,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );
        assert!(consume_window_seek(
            &shared,
            &rt,
            &mut scratch,
            &mut current_pos,
        ));
        assert_eq!(current_pos, 103);
        assert_eq!(
            rt.applied_seek(),
            Some(AppliedWindowSeek {
                serial: newer_serial,
                result: WindowSeekResult::Applied,
                audible_frame: 103,
                observed_generation: 1,
                observed_epoch: 1,
            })
        );
        current_pos = 107;
        shared
            .playback_clock
            .callback
            .position_frames
            .store(107, Ordering::Release);

        rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 100,
            produced_end_frame: 107,
            decode_state: StreamingDecodeState::EndOfStream,
        });
        shared.state.store(PlayerState::Playing);
        let mut eof_output = [1.0; 8];
        let eof_written = render_streaming_audio_output(
            &mut eof_output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(eof_written, 0);
        assert_eq!(eof_output, [0.0; 8]);
        assert_eq!(shared.state.load(), PlayerState::Stopped);
        assert_eq!(shared.playback_end_count.load(Ordering::Acquire), 1);
        assert_ne!(
            shared.event_flags.load(Ordering::Acquire) & EVENT_TRACK_EOF,
            0
        );
        assert!(shared.streaming_active.load(Ordering::Acquire));
    }

#[test]
    fn v_gapless_swap_consumes_pending_rt_and_resets_position() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::{
            ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
        };

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");

        // Active session at EOF.
        let active_parts = PcmWindow::create(geometry, 1, 0, DecodedMemoryOwner::ActiveWindow).expect("active window");
        let mut active_writer = active_parts.writer;
        let mut active_slot = active_writer.try_claim_owned(1, 0, 0).expect("active claim");
        active_slot
            .append_interleaved(&vec![0.5; geometry.slot_samples()])
            .expect("append");
        active_slot.publish().expect("publish");
        let active_rt = Arc::new(StreamingRtView::new());
        active_rt.install_window(Some(active_parts.window));
        active_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        active_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::EndOfStream,
        });

        // Pending preloaded session, Ready.
        let pending_parts = PcmWindow::create(geometry, 1, 0, DecodedMemoryOwner::ActiveWindow).expect("pending window");
        let mut pending_writer = pending_parts.writer;
        let mut pending_slot =
            pending_writer.try_claim_owned(1, 0, 0).expect("pending claim");
        pending_slot
            .append_interleaved(&vec![0.25; geometry.slot_samples()])
            .expect("pending append");
        pending_slot.publish().expect("pending publish");
        let pending_rt = Arc::new(StreamingRtView::new());
        pending_rt.install_window(Some(pending_parts.window));
        pending_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        pending_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::Ready,
        });

        let shared = SharedState::new();
        shared.streaming_generation.store(1, Ordering::Release);
        shared.load_generation.store(1, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);
        shared.streaming_v2_enabled.store(true, Ordering::Release);
        shared.publish_streaming_v2_rt(Some(Arc::clone(&active_rt)));
        shared.streaming_pending_v2_rt.store(Some(Arc::clone(&pending_rt)));
        shared.streaming_pending_ready.store(true, Ordering::Release);
        shared.streaming_pending_generation.store(1, Ordering::Release);
        shared.streaming_pending_total_frames.store(2_000, Ordering::Release);
        shared.streaming_pending_channels.store(2, Ordering::Release);
        shared.total_frames.store(500, Ordering::Release);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(geometry.slot_frames() as u64, Ordering::Release);
        shared.state.store(PlayerState::Playing);

        let mut scratch = CallbackScratch::new(2);
        let mut chain = DspChain::with_capacity(0, 44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        let mut current_pos = geometry.slot_frames();

        // EOF frame: swap fires, this callback is silent.
        let mut swap_frame = [1.0; 8];
        let written = render_streaming_audio_output(
            &mut swap_frame,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(written, 8);
        assert_eq!(swap_frame, [0.0; 8]);
        assert!(shared.streaming_swap_requested.load(Ordering::Acquire));
        assert!(!shared.streaming_pending_ready.load(Ordering::Acquire));
        assert!(shared.streaming_pending_v2_rt.load_full().is_none());
        assert!(
            Arc::ptr_eq(
                shared.streaming_v2_rt.load_full().as_ref().unwrap(),
                &pending_rt
            ),
            "pending RT must be promoted to the active slot"
        );
        assert_eq!(shared.total_frames.load(Ordering::Acquire), 2_000);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Acquire),
            0
        );
        assert!(shared.gapless_swap_pending.load(Ordering::Acquire));

        // Next callback renders from the swapped-in pending window at frame 0.
        shared.streaming_swap_requested.store(false, Ordering::Release);
        let mut next_output = [0.0; 8];
        let mut next_pos = 0;
        let second_written = render_streaming_audio_output(
            &mut next_output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut next_pos,
            0,
        );
        assert_eq!(second_written, 8);
        assert!(next_output.iter().all(|s| (*s - 0.25).abs() < 0.000_1));
        assert_eq!(next_pos, 4);
        assert!(shared.streaming_active.load(Ordering::Acquire));
    }

    #[test]
    fn v_gapless_swap_ignores_stale_pending_generation() {
        use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};
        use crate::player::streaming::rt_view::{
            ProducerSnapshot, StreamingDecodeState, WindowIdentitySnapshot,
        };

        let geometry = PcmWindowGeometry::for_slot_count(2, 1).expect("geometry");
        let active_parts = PcmWindow::create(geometry, 1, 0, DecodedMemoryOwner::ActiveWindow).expect("active window");
        let mut active_writer = active_parts.writer;
        let mut active_slot = active_writer.try_claim_owned(1, 0, 0).expect("active claim");
        active_slot
            .append_interleaved(&vec![0.5; geometry.slot_samples()])
            .expect("append");
        active_slot.publish().expect("publish");
        let active_rt = Arc::new(StreamingRtView::new());
        active_rt.install_window(Some(active_parts.window));
        active_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        active_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::EndOfStream,
        });

        let pending_parts = PcmWindow::create(geometry, 2, 0, DecodedMemoryOwner::ActiveWindow).expect("pending window");
        let mut pending_writer = pending_parts.writer;
        let mut pending_slot =
            pending_writer.try_claim_owned(2, 0, 0).expect("pending claim");
        pending_slot
            .append_interleaved(&vec![0.25; geometry.slot_samples()])
            .expect("append");
        pending_slot.publish().expect("publish");
        let pending_rt = Arc::new(StreamingRtView::new());
        pending_rt.install_window(Some(pending_parts.window));
        pending_rt.publish_identity(WindowIdentitySnapshot {
            generation: 1,
            epoch: 1,
            active: true,
        });
        pending_rt.publish_producer(ProducerSnapshot {
            retained_start_frame: 0,
            produced_end_frame: geometry.slot_frames() as u64,
            decode_state: StreamingDecodeState::Ready,
        });

        let shared = SharedState::new();
        shared.streaming_generation.store(1, Ordering::Release);
        shared.load_generation.store(2, Ordering::Release); // track changed
        shared.streaming_v2_enabled.store(true, Ordering::Release);
        shared.publish_streaming_v2_rt(Some(Arc::clone(&active_rt)));
        shared.streaming_pending_v2_rt.store(Some(Arc::clone(&pending_rt)));
        shared.streaming_pending_ready.store(true, Ordering::Release);
        shared.streaming_pending_generation.store(1, Ordering::Release);
        shared.streaming_pending_total_frames.store(2_000, Ordering::Release);
        shared.streaming_pending_channels.store(2, Ordering::Release);
        shared
            .playback_clock
            .callback
            .position_frames
            .store(geometry.slot_frames() as u64, Ordering::Release);
        shared.state.store(PlayerState::Playing);

        let mut scratch = CallbackScratch::new(2);
        let mut chain = DspChain::with_capacity(0, 44_100.0);
        let loudness = Arc::new(AtomicLoudnessState::default());
        let mut current_pos = geometry.slot_frames();
        let mut output = [1.0; 8];
        let written = render_streaming_audio_output(
            &mut output,
            &shared,
            &mut chain,
            &loudness,
            2,
            &mut None,
            &mut scratch,
            OutputPath::Direct,
            &mut current_pos,
            0,
        );
        assert_eq!(written, 0); // EOF path: no frames rendered
        assert_eq!(output, [0.0; 8]);
        // Stale pending is reaped, never swapped in.
        assert!(!shared.streaming_swap_requested.load(Ordering::Acquire));
        assert!(shared.streaming_pending_v2_rt.load_full().is_none());
        assert!(
            !Arc::ptr_eq(
                shared.streaming_v2_rt.load_full().as_ref().unwrap(),
                &pending_rt
            )
        );
        assert_eq!(shared.state.load(), PlayerState::Stopped);
    }
}
