//! Shared audio command semantics.
//!
//! Backend modules own how a command touches their output primitive. This
//! module owns the state, DSP, loudness, and generation semantics that must not
//! drift between CPAL and WASAPI.

use std::cell::Cell;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use cpal::traits::StreamTrait;
use cpal::Stream;

use super::callback::LockfreeDspContext;
use super::output_stream::DspParamRefs;
use super::state::{
    AudioCommand, LoadResult, PlayerState, SharedState, EVENT_LOAD_COMPLETE,
    EVENT_PLAYBACK_STARTED, EVENT_TRACK_CHANGED,
};
use super::track_loudness::{apply_loaded_track_loudness, refresh_loaded_loudness};
use crate::processor::AtomicLoudnessState;

pub(super) enum AudioCommandFlow {
    Continue,
    StartPlayback,
    StopPlayback,
    ShutdownThread,
}

pub(super) trait AudioCommandBackend {
    fn play(&mut self, shared_state: &SharedState) -> AudioCommandFlow;
    fn pause(&mut self);
    fn seek(&mut self, frame: u64);
    fn stop(&mut self);
    fn stop_for_load(&mut self);
    fn shutdown(&mut self, shared_state: &SharedState);
    fn output_label(&self) -> &'static str;
}

pub(super) struct SharedAudioCommandContext<'a> {
    pub shared_state: &'a Arc<SharedState>,
    pub dsp_ctx: &'a Arc<LockfreeDspContext>,
    pub loudness_state: &'a Arc<AtomicLoudnessState>,
    pub dsp_params: DspParamRefs<'a>,
    pub target_lufs: &'a Cell<f64>,
    pub replaygain_reference_lufs: f64,
}

pub(super) struct CpalCommandBackend<'a> {
    stream: &'a mut Option<Stream>,
}

impl<'a> CpalCommandBackend<'a> {
    pub fn new(stream: &'a mut Option<Stream>) -> Self {
        Self { stream }
    }
}

impl AudioCommandBackend for CpalCommandBackend<'_> {
    fn play(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
        if shared_state.state.load() == PlayerState::Paused {
            if let Some(stream) = self.stream {
                let _ = stream.play();
                mark_playback_started(shared_state);
                return AudioCommandFlow::Continue;
            }
        }

        AudioCommandFlow::StartPlayback
    }

    fn pause(&mut self) {
        if let Some(stream) = self.stream {
            let _ = stream.pause();
        }
    }

    fn seek(&mut self, _frame: u64) {}

    fn stop(&mut self) {
        *self.stream = None;
    }

    fn stop_for_load(&mut self) {
        *self.stream = None;
    }

    fn shutdown(&mut self, _shared_state: &SharedState) {}

    fn output_label(&self) -> &'static str {
        "lock-free path"
    }
}

pub(super) fn handle_audio_command<B: AudioCommandBackend>(
    command: AudioCommand,
    backend: &mut B,
    context: &SharedAudioCommandContext<'_>,
) -> AudioCommandFlow {
    match command {
        AudioCommand::Play => backend.play(context.shared_state),
        AudioCommand::Pause => {
            backend.pause();
            context.shared_state.state.store(PlayerState::Paused);
            AudioCommandFlow::Continue
        }
        AudioCommand::Seek(time) => {
            let frame = seek_frame_for_time(context.shared_state, time);
            context
                .shared_state
                .position_frames
                .store(frame, Ordering::Relaxed);
            backend.seek(frame);
            AudioCommandFlow::Continue
        }
        AudioCommand::Stop => {
            backend.stop();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            context.shared_state.state.store(PlayerState::Stopped);
            AudioCommandFlow::StopPlayback
        }
        AudioCommand::StopForLoad => {
            backend.stop_for_load();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            AudioCommandFlow::StopPlayback
        }
        AudioCommand::SetExternalIrConvolver { ir_data, channels } => {
            handle_set_external_ir_convolver_command(context.dsp_ctx, ir_data, channels);
            AudioCommandFlow::Continue
        }
        AudioCommand::ClearExternalIrConvolver => {
            context.dsp_ctx.clear_external_ir_convolver();
            AudioCommandFlow::Continue
        }
        AudioCommand::SetFirConvolver { ir_data, channels } => {
            handle_set_fir_convolver_command(context.dsp_ctx, ir_data, channels);
            AudioCommandFlow::Continue
        }
        AudioCommand::ClearFirConvolver => {
            context.dsp_ctx.clear_fir_convolver();
            AudioCommandFlow::Continue
        }
        AudioCommand::SetNoiseShaperCurve { curve } => {
            *context.shared_state.noise_shaper_curve.write() = curve;
            log::info!(
                "Noise shaper curve set to {:?} ({})",
                curve,
                backend.output_label()
            );
            AudioCommandFlow::Continue
        }
        AudioCommand::SetTargetLufs(target_lufs) => {
            context.target_lufs.set(target_lufs);
            log::info!(
                "Loudness target set to {:.2} LUFS ({})",
                target_lufs,
                backend.output_label()
            );
            AudioCommandFlow::Continue
        }
        AudioCommand::RefreshLoadedLoudness => {
            refresh_loaded_loudness(
                context.shared_state,
                context.loudness_state,
                context.target_lufs.get(),
                context.replaygain_reference_lufs,
            );
            AudioCommandFlow::Continue
        }
        AudioCommand::LoadComplete { generation, result } => {
            handle_load_complete_command(
                context.shared_state,
                context.dsp_ctx,
                context.loudness_state,
                context.dsp_params,
                context.target_lufs.get(),
                context.replaygain_reference_lufs,
                generation,
                result,
            );
            AudioCommandFlow::Continue
        }
        AudioCommand::LoadError {
            generation,
            message,
        } => {
            handle_load_error_command(context.shared_state, generation, message);
            AudioCommandFlow::Continue
        }
        AudioCommand::Shutdown => {
            backend.shutdown(context.shared_state);
            AudioCommandFlow::ShutdownThread
        }
    }
}

pub(super) fn mark_playback_started(shared_state: &SharedState) {
    shared_state.state.store(PlayerState::Playing);
    shared_state
        .event_flags
        .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
}

fn seek_frame_for_time(shared_state: &SharedState, time: f64) -> u64 {
    let sample_rate = shared_state.sample_rate.load(Ordering::Relaxed) as f64;
    let total_frames = shared_state.total_frames.load(Ordering::Relaxed);
    ((time * sample_rate) as u64).min(total_frames)
}

fn handle_set_external_ir_convolver_command(
    dsp_ctx: &Arc<LockfreeDspContext>,
    ir_data: Vec<f64>,
    channels: usize,
) {
    if let Err(e) = dsp_ctx.set_external_ir_convolver(&ir_data, channels) {
        log::error!("Failed to set external IR convolver: {}", e);
    }
}

fn handle_set_fir_convolver_command(
    dsp_ctx: &Arc<LockfreeDspContext>,
    ir_data: Vec<f64>,
    channels: usize,
) {
    if let Err(e) = dsp_ctx.set_fir_convolver(&ir_data, channels) {
        log::error!("Failed to set FIR convolver: {}", e);
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_load_complete_command(
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    dsp_params: DspParamRefs<'_>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    generation: u64,
    result: LoadResult,
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale async load complete for '{}' (generation {})",
            result.file_path,
            generation
        );
        return;
    }
    log::info!(
        "Async load complete: {} frames @ {} Hz",
        result.total_frames,
        result.sample_rate
    );
    apply_loaded_track_result(
        shared_state,
        dsp_ctx,
        loudness_state,
        dsp_params,
        target_lufs,
        replaygain_reference_lufs,
        result,
    );
}

fn handle_load_error_command(shared_state: &Arc<SharedState>, generation: u64, message: String) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale async load error for generation {}: {}",
            generation,
            message
        );
        return;
    }
    log::error!("Async load failed: {}", message);
    shared_state.state.store(PlayerState::Stopped);
}

fn rebuild_pending_dsp_chain(
    shared_state: &SharedState,
    dsp_ctx: &Arc<LockfreeDspContext>,
    dsp_params: DspParamRefs<'_>,
    channels: usize,
    sample_rate: u32,
) {
    while shared_state.pending_dsp_chain.pop().is_some() {}
    let rebuilt_chain = LockfreeDspContext::build_dsp_chain(
        channels,
        sample_rate as f64,
        Arc::clone(dsp_params.eq_params),
        Arc::clone(dsp_params.saturation_params),
        Arc::clone(dsp_params.crossfeed_params),
        Arc::clone(dsp_params.limiter_params),
        Arc::clone(dsp_params.volume_params),
        Arc::clone(dsp_params.noise_shaper_params),
        Arc::clone(dsp_params.dynamic_loudness_params),
        Arc::clone(dsp_params.dynamic_loudness_telemetry),
        Arc::clone(&dsp_ctx.merged_convolver),
        Arc::clone(&dsp_ctx.merged_convolver_enabled),
    );
    let _ = shared_state.pending_dsp_chain.push(rebuilt_chain);
}

fn apply_loaded_track_state(
    shared_state: &SharedState,
    sample_rate: u32,
    channels: usize,
    total_frames: u64,
    file_path: &str,
    metadata: &crate::decoder::TrackMetadata,
    samples: Arc<Vec<f64>>,
) {
    shared_state
        .sample_rate
        .store(sample_rate as u64, Ordering::Relaxed);
    shared_state
        .channels
        .store(channels as u64, Ordering::Relaxed);
    shared_state
        .total_frames
        .store(total_frames, Ordering::Relaxed);
    shared_state.position_frames.store(0, Ordering::Relaxed);

    match shared_state.state.load() {
        PlayerState::Playing | PlayerState::Paused => {}
        _ => shared_state.state.store(PlayerState::Stopped),
    }

    shared_state.audio_buffer.store(samples);
    *shared_state.file_path.write() = Some(file_path.to_string());
    *shared_state.track_metadata.write() = metadata.clone();
    *shared_state.current_track_path.write() = Some(file_path.to_string());
    shared_state
        .dsp_needs_rebuild
        .store(true, Ordering::Release);
}

fn apply_loaded_track_result(
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    dsp_params: DspParamRefs<'_>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    result: LoadResult,
) {
    let LoadResult {
        samples,
        sample_rate,
        channels,
        total_frames,
        file_path,
        cached_loudness,
        metadata,
    } = result;
    let samples_arc = Arc::new(samples);
    rebuild_pending_dsp_chain(shared_state, dsp_ctx, dsp_params, channels, sample_rate);
    apply_loaded_track_state(
        shared_state,
        sample_rate,
        channels,
        total_frames,
        &file_path,
        &metadata,
        Arc::clone(&samples_arc),
    );
    *shared_state.current_cached_loudness.write() = cached_loudness.clone();
    apply_loaded_track_loudness(
        loudness_state,
        &metadata,
        cached_loudness.as_ref(),
        &samples_arc,
        channels,
        sample_rate,
        target_lufs,
        replaygain_reference_lufs,
    );

    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
    log::debug!("DSP context updated for {} Hz sample rate", sample_rate);
}
