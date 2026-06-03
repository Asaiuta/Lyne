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
    AudioCommand, LoadResult, PlayerState, SharedState, StreamingTrackStart, EVENT_LOAD_COMPLETE,
    EVENT_LOAD_ERROR, EVENT_PLAYBACK_STARTED, EVENT_TRACK_CHANGED,
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
    fn pause(&mut self, shared_state: &SharedState);
    fn seek(&mut self, frame: u64);
    fn stop(&mut self, shared_state: &SharedState);
    fn stop_for_load(&mut self, shared_state: &SharedState);
    fn recover_playback(&mut self, shared_state: &SharedState) -> AudioCommandFlow;
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
    parked_streams: &'a mut Vec<Stream>,
}

impl<'a> CpalCommandBackend<'a> {
    pub fn new(stream: &'a mut Option<Stream>, parked_streams: &'a mut Vec<Stream>) -> Self {
        Self {
            stream,
            parked_streams,
        }
    }
}

impl AudioCommandBackend for CpalCommandBackend<'_> {
    fn play(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
        if self.stream.is_some() {
            if shared_state.active_output_stream_matches_current() {
                if !shared_state.active_stream_running.load(Ordering::Acquire) {
                    let play_result = self.stream.as_ref().map(StreamTrait::play);
                    if let Some(Err(e)) = play_result {
                        log::warn!("Warm output stream play failed, rebuilding stream: {}", e);
                        release_output_stream(self.stream, shared_state);
                        return AudioCommandFlow::StartPlayback;
                    }
                    shared_state.mark_active_output_stream_running();
                }
                shared_state.mark_stream_play_returned();
                mark_playback_started(shared_state);
                return AudioCommandFlow::Continue;
            }

            release_output_stream(self.stream, shared_state);
        }

        AudioCommandFlow::StartPlayback
    }

    fn pause(&mut self, shared_state: &SharedState) {
        if !shared_state.exclusive_mode.load(Ordering::Relaxed) {
            return;
        }
        if let Some(stream) = self.stream {
            let _ = stream.pause();
        }
        shared_state.mark_active_output_stream_paused();
    }

    fn seek(&mut self, _frame: u64) {}

    fn stop(&mut self, shared_state: &SharedState) {
        if should_keep_shared_mode_stream_warm(shared_state) {
            keep_output_stream_running(self.stream, shared_state, "stop");
        } else {
            release_output_stream(self.stream, shared_state);
        }
    }

    fn stop_for_load(&mut self, shared_state: &SharedState) {
        if !should_keep_shared_mode_stream_warm(shared_state) {
            release_output_stream(self.stream, shared_state);
            return;
        }

        keep_output_stream_running(self.stream, shared_state, "track load");
    }

    fn recover_playback(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
        park_output_stream_for_recovery(self.stream, self.parked_streams, shared_state);
        AudioCommandFlow::StartPlayback
    }

    fn shutdown(&mut self, shared_state: &SharedState) {
        release_output_stream(self.stream, shared_state);
    }

    fn output_label(&self) -> &'static str {
        "lock-free path"
    }
}

fn should_keep_shared_mode_stream_warm(shared_state: &SharedState) -> bool {
    !shared_state.exclusive_mode.load(Ordering::Relaxed)
        && shared_state.active_output_stream_matches_current()
}

fn keep_output_stream_running(
    stream_slot: &mut Option<Stream>,
    shared_state: &SharedState,
    operation: &str,
) {
    if shared_state.active_stream_running.load(Ordering::Acquire) {
        return;
    }
    let play_result = stream_slot.as_ref().map(StreamTrait::play);
    if let Some(Err(e)) = play_result {
        log::warn!(
            "Warm output stream could not be kept running during {}: {}",
            operation,
            e
        );
        release_output_stream(stream_slot, shared_state);
        return;
    }
    shared_state.mark_active_output_stream_running();
}

fn release_output_stream(stream_slot: &mut Option<Stream>, shared_state: &SharedState) {
    if let Some(stream) = stream_slot.as_ref() {
        let _ = stream.pause();
    }
    let _stream = stream_slot.take();
    shared_state.clear_active_output_stream();
}

fn park_output_stream_for_recovery(
    stream_slot: &mut Option<Stream>,
    parked_streams: &mut Vec<Stream>,
    shared_state: &SharedState,
) {
    if let Some(stream) = stream_slot.as_ref() {
        let _ = stream.pause();
    }
    if let Some(stream) = stream_slot.take() {
        parked_streams.push(stream);
        shared_state.set_parked_output_stream_count(parked_streams.len());
    }
    shared_state.clear_active_output_stream();
}

pub(super) fn handle_audio_command<B: AudioCommandBackend>(
    command: AudioCommand,
    backend: &mut B,
    context: &SharedAudioCommandContext<'_>,
) -> AudioCommandFlow {
    match command {
        AudioCommand::Play => backend.play(context.shared_state),
        AudioCommand::Pause => {
            context.shared_state.state.store(PlayerState::Paused);
            backend.pause(context.shared_state);
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
        AudioCommand::EnsurePlaybackProgress { generation } => {
            context
                .shared_state
                .mark_audio_command_ensure_progress_received();
            let current_generation = context.shared_state.load_generation.load(Ordering::Acquire);
            let has_progress = context
                .shared_state
                .first_callback_after_play_ms
                .load(Ordering::Acquire)
                != 0
                || context
                    .shared_state
                    .first_position_advanced_ms
                    .load(Ordering::Acquire)
                    != 0;
            if current_generation != generation
                || context.shared_state.state.load() != PlayerState::Playing
                || has_progress
            {
                context
                    .shared_state
                    .mark_audio_command_ensure_progress_completed();
                return AudioCommandFlow::Continue;
            }

            log::warn!(
                "No playback callback observed after streaming ready for generation {}; rebuilding output stream",
                generation
            );
            context.shared_state.mark_playback_recovery_requested();
            context
                .shared_state
                .mark_audio_command_ensure_progress_completed();
            backend.recover_playback(context.shared_state)
        }
        AudioCommand::Stop => {
            context.shared_state.mark_audio_command_stop_received();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            context.shared_state.state.store(PlayerState::Stopped);
            backend.stop(context.shared_state);
            context.shared_state.mark_audio_command_stop_completed();
            AudioCommandFlow::StopPlayback
        }
        AudioCommand::StopForLoad => {
            context
                .shared_state
                .mark_audio_command_stop_for_load_received();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            context.shared_state.state.store(PlayerState::Stopped);
            backend.stop_for_load(context.shared_state);
            context
                .shared_state
                .mark_audio_command_stop_for_load_completed();
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
        AudioCommand::StreamingLoadReady { generation, track } => {
            context
                .shared_state
                .mark_audio_command_streaming_ready_received();
            let applied = handle_streaming_load_ready_command(
                context.shared_state,
                context.dsp_ctx,
                context.loudness_state,
                context.dsp_params,
                context.target_lufs.get(),
                context.replaygain_reference_lufs,
                generation,
                track,
            );
            if !applied {
                context
                    .shared_state
                    .mark_audio_command_streaming_ready_completed();
                return AudioCommandFlow::Continue;
            }
            if context.shared_state.state.load() != PlayerState::Playing {
                context.shared_state.mark_streaming_ready_play_skipped();
                context
                    .shared_state
                    .mark_audio_command_streaming_ready_completed();
                return AudioCommandFlow::Continue;
            }
            context.shared_state.mark_streaming_ready_play_requested();
            let flow = backend.play(context.shared_state);
            match flow {
                AudioCommandFlow::Continue => {
                    context.shared_state.mark_streaming_ready_play_completed();
                }
                AudioCommandFlow::StartPlayback => {
                    context
                        .shared_state
                        .mark_streaming_ready_play_start_playback();
                }
                AudioCommandFlow::StopPlayback | AudioCommandFlow::ShutdownThread => {}
            }
            context
                .shared_state
                .mark_audio_command_streaming_ready_completed();
            flow
        }
        AudioCommand::StreamingLoadFinished {
            generation,
            samples,
            total_frames,
        } => {
            handle_streaming_load_finished_command(
                context.shared_state,
                context.loudness_state,
                context.target_lufs.get(),
                context.replaygain_reference_lufs,
                generation,
                samples,
                total_frames,
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

#[allow(clippy::too_many_arguments)]
fn handle_streaming_load_ready_command(
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    dsp_params: DspParamRefs<'_>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    generation: u64,
    track: StreamingTrackStart,
) -> bool {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale streaming load ready for '{}' (generation {})",
            track.file_path,
            generation
        );
        return false;
    }

    log::info!(
        "Streaming load ready: {} frames @ {} Hz",
        track.total_frames,
        track.sample_rate
    );
    rebuild_pending_dsp_chain(
        shared_state,
        dsp_ctx,
        dsp_params,
        track.channels,
        track.sample_rate,
    );
    apply_streaming_track_state(shared_state, generation, &track);
    *shared_state.current_cached_loudness.write() = track.cached_loudness.clone();

    let empty_samples = Arc::new(Vec::new());
    apply_loaded_track_loudness(
        shared_state,
        loudness_state,
        &track.metadata,
        track.cached_loudness.as_ref(),
        &empty_samples,
        track.channels,
        track.sample_rate,
        target_lufs,
        replaygain_reference_lufs,
    );

    shared_state.mark_load_complete_applied();
    shared_state.mark_streaming_ready();
    shared_state.load_progress.store(100, Ordering::Relaxed);
    shared_state.is_loading.store(false, Ordering::Release);
    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
    true
}

#[allow(clippy::too_many_arguments)]
fn handle_streaming_load_finished_command(
    shared_state: &Arc<SharedState>,
    loudness_state: &Arc<AtomicLoudnessState>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    generation: u64,
    samples: Option<Vec<f64>>,
    total_frames: u64,
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale streaming load finish for generation {}",
            generation
        );
        return;
    }

    shared_state
        .total_frames
        .store(total_frames, Ordering::Relaxed);
    shared_state
        .streaming_decode_finished
        .store(true, Ordering::Release);
    shared_state.mark_streaming_finished();

    if let Some(samples) = samples {
        let samples = Arc::new(samples);
        shared_state.audio_buffer.store(Arc::clone(&samples));
        shared_state
            .streaming_full_buffer_published
            .store(true, Ordering::Release);
        shared_state
            .streaming_memory_mode
            .store(false, Ordering::Release);
        shared_state
            .streaming_active
            .store(false, Ordering::Release);
        while shared_state.streaming_chunks.pop().is_some() {}

        refresh_loaded_loudness(
            shared_state,
            loudness_state,
            target_lufs,
            replaygain_reference_lufs,
        );
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
    shared_state.is_loading.store(false, Ordering::Release);
    shared_state.load_progress.store(0, Ordering::Relaxed);
    shared_state
        .load_error_count
        .fetch_add(1, Ordering::Relaxed);
    *shared_state.load_error.write() = Some(message);
    shared_state.state.store(PlayerState::Stopped);
    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_ERROR, Ordering::Release);
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

fn apply_streaming_track_state(
    shared_state: &SharedState,
    generation: u64,
    track: &StreamingTrackStart,
) {
    shared_state
        .sample_rate
        .store(track.sample_rate as u64, Ordering::Relaxed);
    shared_state
        .channels
        .store(track.channels as u64, Ordering::Relaxed);
    shared_state
        .total_frames
        .store(track.total_frames, Ordering::Relaxed);
    let start_frame = if track.total_frames > 0 {
        track.start_frame.min(track.total_frames)
    } else {
        track.start_frame
    };
    shared_state
        .position_frames
        .store(start_frame, Ordering::Relaxed);
    shared_state
        .streaming_generation
        .store(generation, Ordering::Release);
    shared_state
        .streaming_decode_finished
        .store(false, Ordering::Release);
    shared_state
        .streaming_memory_mode
        .store(track.memory_mode, Ordering::Release);
    shared_state
        .streaming_full_buffer_published
        .store(false, Ordering::Release);
    shared_state.streaming_active.store(true, Ordering::Release);
    shared_state.audio_buffer.store(Arc::new(Vec::new()));

    match shared_state.state.load() {
        PlayerState::Playing | PlayerState::Paused => {}
        _ => shared_state.state.store(PlayerState::Stopped),
    }

    *shared_state.file_path.write() = Some(track.file_path.clone());
    *shared_state.track_metadata.write() = track.metadata.clone();
    *shared_state.current_track_path.write() = Some(track.file_path.clone());
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
        shared_state,
        loudness_state,
        &metadata,
        cached_loudness.as_ref(),
        &samples_arc,
        channels,
        sample_rate,
        target_lufs,
        replaygain_reference_lufs,
    );
    shared_state.mark_load_complete_applied();
    shared_state.is_loading.store(false, Ordering::Release);
    shared_state.load_progress.store(100, Ordering::Relaxed);

    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
    log::debug!("DSP context updated for {} Hz sample rate", sample_rate);
}

#[cfg(test)]
mod tests {
    use super::super::state::StreamingAudioChunk;
    use super::*;
    use crate::decoder::TrackMetadata;
    use crate::processor::{
        AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
        AtomicEqParams, AtomicNoiseShaperParams, AtomicPeakLimiterParams, AtomicSaturationParams,
        AtomicVolumeParams,
    };

    struct CommandFixture {
        shared_state: Arc<SharedState>,
        dsp_ctx: Arc<LockfreeDspContext>,
        loudness_state: Arc<AtomicLoudnessState>,
        eq_params: Arc<AtomicEqParams>,
        saturation_params: Arc<AtomicSaturationParams>,
        crossfeed_params: Arc<AtomicCrossfeedParams>,
        limiter_params: Arc<AtomicPeakLimiterParams>,
        volume_params: Arc<AtomicVolumeParams>,
        noise_shaper_params: Arc<AtomicNoiseShaperParams>,
        dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
        dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
        target_lufs: Cell<f64>,
    }

    impl CommandFixture {
        fn new() -> Self {
            let eq_params = Arc::new(AtomicEqParams::new());
            let saturation_params = Arc::new(AtomicSaturationParams::new());
            let crossfeed_params = Arc::new(AtomicCrossfeedParams::new());
            let limiter_params = Arc::new(AtomicPeakLimiterParams::new());
            let volume_params = Arc::new(AtomicVolumeParams::new());
            let noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
            let dynamic_loudness_params = Arc::new(AtomicDynamicLoudnessParams::new());
            let dynamic_loudness_telemetry = Arc::new(AtomicDynamicLoudnessTelemetry::new());
            let (dsp_ctx, _chain) = LockfreeDspContext::new(
                2,
                44_100.0,
                Arc::clone(&eq_params),
                Arc::clone(&saturation_params),
                Arc::clone(&crossfeed_params),
                Arc::clone(&limiter_params),
                Arc::clone(&volume_params),
                Arc::clone(&noise_shaper_params),
                Arc::clone(&dynamic_loudness_params),
                Arc::clone(&dynamic_loudness_telemetry),
            );

            Self {
                shared_state: Arc::new(SharedState::new()),
                dsp_ctx: Arc::new(dsp_ctx),
                loudness_state: Arc::new(AtomicLoudnessState::default()),
                eq_params,
                saturation_params,
                crossfeed_params,
                limiter_params,
                volume_params,
                noise_shaper_params,
                dynamic_loudness_params,
                dynamic_loudness_telemetry,
                target_lufs: Cell::new(-14.0),
            }
        }

        fn context(&self) -> SharedAudioCommandContext<'_> {
            SharedAudioCommandContext {
                shared_state: &self.shared_state,
                dsp_ctx: &self.dsp_ctx,
                loudness_state: &self.loudness_state,
                dsp_params: DspParamRefs {
                    eq_params: &self.eq_params,
                    saturation_params: &self.saturation_params,
                    crossfeed_params: &self.crossfeed_params,
                    limiter_params: &self.limiter_params,
                    volume_params: &self.volume_params,
                    noise_shaper_params: &self.noise_shaper_params,
                    dynamic_loudness_params: &self.dynamic_loudness_params,
                    dynamic_loudness_telemetry: &self.dynamic_loudness_telemetry,
                },
                target_lufs: &self.target_lufs,
                replaygain_reference_lufs: -18.0,
            }
        }
    }

    struct TestBackend;

    impl AudioCommandBackend for TestBackend {
        fn play(&mut self, _shared_state: &SharedState) -> AudioCommandFlow {
            AudioCommandFlow::Continue
        }

        fn pause(&mut self, _shared_state: &SharedState) {}

        fn seek(&mut self, _frame: u64) {}

        fn stop(&mut self, _shared_state: &SharedState) {}

        fn stop_for_load(&mut self, _shared_state: &SharedState) {}

        fn recover_playback(&mut self, _shared_state: &SharedState) -> AudioCommandFlow {
            AudioCommandFlow::StartPlayback
        }

        fn shutdown(&mut self, _shared_state: &SharedState) {}

        fn output_label(&self) -> &'static str {
            "test"
        }
    }

    struct RecordingBackend {
        play_calls: usize,
        play_flow: AudioCommandFlow,
    }

    impl AudioCommandBackend for RecordingBackend {
        fn play(&mut self, _shared_state: &SharedState) -> AudioCommandFlow {
            self.play_calls += 1;
            match self.play_flow {
                AudioCommandFlow::Continue => AudioCommandFlow::Continue,
                AudioCommandFlow::StartPlayback => AudioCommandFlow::StartPlayback,
                AudioCommandFlow::StopPlayback => AudioCommandFlow::StopPlayback,
                AudioCommandFlow::ShutdownThread => AudioCommandFlow::ShutdownThread,
            }
        }

        fn pause(&mut self, _shared_state: &SharedState) {}

        fn seek(&mut self, _frame: u64) {}

        fn stop(&mut self, _shared_state: &SharedState) {}

        fn stop_for_load(&mut self, _shared_state: &SharedState) {}

        fn recover_playback(&mut self, _shared_state: &SharedState) -> AudioCommandFlow {
            AudioCommandFlow::StartPlayback
        }

        fn shutdown(&mut self, _shared_state: &SharedState) {}

        fn output_label(&self) -> &'static str {
            "recording"
        }
    }

    fn test_load_result(file_path: &str) -> LoadResult {
        LoadResult {
            samples: vec![0.1, -0.1, 0.2, -0.2],
            sample_rate: 44_100,
            channels: 2,
            total_frames: 2,
            file_path: file_path.to_string(),
            cached_loudness: None,
            metadata: TrackMetadata::default(),
        }
    }

    #[test]
    fn shared_mode_matching_stream_can_stay_warm_across_stop() {
        let shared = SharedState::new();
        shared.sample_rate.store(96_000, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.device_id.store(-1, Ordering::Relaxed);
        shared.exclusive_mode.store(false, Ordering::Relaxed);
        shared
            .prefer_default_output_config
            .store(false, Ordering::Relaxed);
        shared.mark_active_output_stream(96_000, 96_000, 2);

        assert!(should_keep_shared_mode_stream_warm(&shared));
    }

    #[test]
    fn exclusive_or_mismatched_stream_must_not_stay_warm() {
        let shared = SharedState::new();
        shared.sample_rate.store(96_000, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.mark_active_output_stream(96_000, 96_000, 2);

        shared.exclusive_mode.store(true, Ordering::Relaxed);
        assert!(!should_keep_shared_mode_stream_warm(&shared));

        shared.exclusive_mode.store(false, Ordering::Relaxed);
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        assert!(!should_keep_shared_mode_stream_warm(&shared));
    }

    #[test]
    fn stale_streaming_ready_does_not_replace_current_track_state() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(2, Ordering::Release);
        fixture
            .shared_state
            .sample_rate
            .store(48_000, Ordering::Relaxed);
        *fixture.shared_state.file_path.write() = Some("current.flac".to_string());

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::StreamingLoadReady {
                generation: 1,
                track: StreamingTrackStart {
                    sample_rate: 44_100,
                    channels: 2,
                    total_frames: 128,
                    start_frame: 0,
                    file_path: "stale.mp3".to_string(),
                    cached_loudness: None,
                    metadata: TrackMetadata::default(),
                    memory_mode: false,
                },
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(
            fixture.shared_state.sample_rate.load(Ordering::Relaxed),
            48_000
        );
        assert_eq!(
            fixture.shared_state.file_path.read().as_deref(),
            Some("current.flac")
        );
        assert!(!fixture
            .shared_state
            .streaming_active
            .load(Ordering::Relaxed));
        assert_eq!(fixture.shared_state.event_flags.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn load_complete_clears_loading_after_apply() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(6, Ordering::Release);
        fixture
            .shared_state
            .is_loading
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .load_progress
            .store(37, Ordering::Relaxed);

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::LoadComplete {
                generation: 6,
                result: test_load_result("loaded.flac"),
            },
            &mut backend,
            &fixture.context(),
        );

        assert!(!fixture.shared_state.is_loading.load(Ordering::Acquire));
        assert_eq!(
            fixture.shared_state.load_progress.load(Ordering::Relaxed),
            100
        );
        assert_eq!(
            fixture.shared_state.audio_buffer.load().as_slice(),
            &[0.1, -0.1, 0.2, -0.2]
        );
        assert_eq!(
            fixture.shared_state.file_path.read().as_deref(),
            Some("loaded.flac")
        );
        assert!(
            fixture
                .shared_state
                .load_complete_applied_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }

    #[test]
    fn load_error_clears_loading_and_records_error_after_generation_match() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(8, Ordering::Release);
        fixture
            .shared_state
            .is_loading
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .load_progress
            .store(61, Ordering::Relaxed);
        fixture.shared_state.state.store(PlayerState::Playing);

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::LoadError {
                generation: 8,
                message: "decode failed".to_string(),
            },
            &mut backend,
            &fixture.context(),
        );

        assert!(!fixture.shared_state.is_loading.load(Ordering::Acquire));
        assert_eq!(
            fixture.shared_state.load_progress.load(Ordering::Relaxed),
            0
        );
        assert_eq!(
            fixture.shared_state.load_error.read().as_deref(),
            Some("decode failed")
        );
        assert_eq!(
            fixture
                .shared_state
                .load_error_count
                .load(Ordering::Relaxed),
            1
        );
        assert_eq!(fixture.shared_state.state.load(), PlayerState::Stopped);
        assert_ne!(
            fixture.shared_state.event_flags.load(Ordering::Relaxed) & EVENT_LOAD_ERROR,
            0
        );
    }

    #[test]
    fn stale_streaming_finish_does_not_publish_full_buffer() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(2, Ordering::Release);
        fixture
            .shared_state
            .audio_buffer
            .store(Arc::new(vec![0.9, 0.8]));
        fixture
            .shared_state
            .total_frames
            .store(1, Ordering::Relaxed);

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::StreamingLoadFinished {
                generation: 1,
                samples: Some(vec![0.1, 0.2, 0.3, 0.4]),
                total_frames: 2,
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(
            fixture.shared_state.audio_buffer.load().as_slice(),
            &[0.9, 0.8]
        );
        assert_eq!(fixture.shared_state.total_frames.load(Ordering::Relaxed), 1);
        assert!(!fixture
            .shared_state
            .streaming_decode_finished
            .load(Ordering::Relaxed));
    }

    #[test]
    fn streaming_ready_applies_seek_start_frame() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(5, Ordering::Release);
        fixture
            .shared_state
            .is_loading
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .load_progress
            .store(42, Ordering::Relaxed);

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::StreamingLoadReady {
                generation: 5,
                track: StreamingTrackStart {
                    sample_rate: 44_100,
                    channels: 2,
                    total_frames: 44_100 * 60,
                    start_frame: 44_100 * 10,
                    file_path: "large.flac".to_string(),
                    cached_loudness: None,
                    metadata: TrackMetadata::default(),
                    memory_mode: true,
                },
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(
            fixture.shared_state.position_frames.load(Ordering::Relaxed),
            44_100 * 10
        );
        assert_eq!(
            fixture
                .shared_state
                .streaming_generation
                .load(Ordering::Acquire),
            5
        );
        assert!(fixture
            .shared_state
            .streaming_active
            .load(Ordering::Acquire));
        assert!(fixture
            .shared_state
            .streaming_memory_mode
            .load(Ordering::Acquire));
        assert!(
            fixture
                .shared_state
                .streaming_ready_ms
                .load(Ordering::Acquire)
                > 0
        );
        assert!(!fixture.shared_state.is_loading.load(Ordering::Acquire));
        assert_eq!(
            fixture.shared_state.load_progress.load(Ordering::Relaxed),
            100
        );
    }

    #[test]
    fn streaming_ready_triggers_playback_start_when_track_is_playing() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(9, Ordering::Release);
        fixture.shared_state.state.store(PlayerState::Playing);
        fixture
            .shared_state
            .is_loading
            .store(true, Ordering::Release);

        let mut backend = RecordingBackend {
            play_calls: 0,
            play_flow: AudioCommandFlow::StartPlayback,
        };
        let flow = handle_audio_command(
            AudioCommand::StreamingLoadReady {
                generation: 9,
                track: StreamingTrackStart {
                    sample_rate: 44_100,
                    channels: 2,
                    total_frames: 44_100 * 60,
                    start_frame: 0,
                    file_path: "playing.flac".to_string(),
                    cached_loudness: None,
                    metadata: TrackMetadata::default(),
                    memory_mode: true,
                },
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(backend.play_calls, 1);
        assert!(matches!(flow, AudioCommandFlow::StartPlayback));
        assert!(!fixture.shared_state.is_loading.load(Ordering::Acquire));
        assert!(fixture
            .shared_state
            .streaming_active
            .load(Ordering::Acquire));
        assert!(
            fixture
                .shared_state
                .streaming_ready_play_requested_ms
                .load(Ordering::Relaxed)
                > 0
        );
        assert!(
            fixture
                .shared_state
                .streaming_ready_play_start_playback_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }

    #[test]
    fn ensure_playback_progress_recovers_when_no_callback_observed() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(12, Ordering::Release);
        fixture.shared_state.state.store(PlayerState::Playing);

        let mut backend = TestBackend;
        let flow = handle_audio_command(
            AudioCommand::EnsurePlaybackProgress { generation: 12 },
            &mut backend,
            &fixture.context(),
        );

        assert!(matches!(flow, AudioCommandFlow::StartPlayback));
        assert_eq!(
            fixture
                .shared_state
                .playback_recovery_count
                .load(Ordering::Relaxed),
            1
        );
        assert!(
            fixture
                .shared_state
                .audio_command_ensure_progress_received_ms
                .load(Ordering::Relaxed)
                > 0
        );
        assert!(
            fixture
                .shared_state
                .audio_command_ensure_progress_completed_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }

    #[test]
    fn streaming_finish_publishes_full_buffer_without_resetting_position() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(3, Ordering::Release);
        fixture
            .shared_state
            .position_frames
            .store(7, Ordering::Relaxed);
        fixture
            .shared_state
            .streaming_active
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 3,
                samples: Arc::new(vec![0.5, 0.5]),
            })
            .expect("streaming queue should have capacity");

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::StreamingLoadFinished {
                generation: 3,
                samples: Some(vec![0.1, 0.2, 0.3, 0.4]),
                total_frames: 2,
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(
            fixture.shared_state.audio_buffer.load().as_slice(),
            &[0.1, 0.2, 0.3, 0.4]
        );
        assert_eq!(fixture.shared_state.total_frames.load(Ordering::Relaxed), 2);
        assert_eq!(
            fixture.shared_state.position_frames.load(Ordering::Relaxed),
            7
        );
        assert!(!fixture
            .shared_state
            .streaming_active
            .load(Ordering::Relaxed));
        assert!(fixture
            .shared_state
            .streaming_decode_finished
            .load(Ordering::Relaxed));
        assert!(fixture.shared_state.streaming_chunks.is_empty());
        assert!(
            fixture
                .shared_state
                .streaming_finished_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }

    #[test]
    fn streaming_finish_without_samples_keeps_queue_for_memory_mode() {
        let fixture = CommandFixture::new();
        fixture
            .shared_state
            .load_generation
            .store(4, Ordering::Release);
        fixture
            .shared_state
            .audio_buffer
            .store(Arc::new(vec![0.9, 0.8]));
        fixture
            .shared_state
            .position_frames
            .store(5, Ordering::Relaxed);
        fixture
            .shared_state
            .streaming_active
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .streaming_memory_mode
            .store(true, Ordering::Release);
        fixture
            .shared_state
            .streaming_chunks
            .push(StreamingAudioChunk {
                generation: 4,
                samples: Arc::new(vec![0.5, 0.5]),
            })
            .expect("streaming queue should have capacity");

        let mut backend = TestBackend;
        handle_audio_command(
            AudioCommand::StreamingLoadFinished {
                generation: 4,
                samples: None,
                total_frames: 100,
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(
            fixture.shared_state.audio_buffer.load().as_slice(),
            &[0.9, 0.8]
        );
        assert_eq!(
            fixture.shared_state.total_frames.load(Ordering::Relaxed),
            100
        );
        assert_eq!(
            fixture.shared_state.position_frames.load(Ordering::Relaxed),
            5
        );
        assert!(fixture
            .shared_state
            .streaming_active
            .load(Ordering::Relaxed));
        assert!(fixture
            .shared_state
            .streaming_decode_finished
            .load(Ordering::Relaxed));
        assert!(fixture
            .shared_state
            .streaming_memory_mode
            .load(Ordering::Relaxed));
        assert!(!fixture
            .shared_state
            .streaming_full_buffer_published
            .load(Ordering::Relaxed));
        assert_eq!(fixture.shared_state.streaming_chunks.len(), 1);
        assert!(
            fixture
                .shared_state
                .streaming_finished_ms
                .load(Ordering::Relaxed)
                > 0
        );
    }
}
