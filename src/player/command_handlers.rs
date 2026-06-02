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
        if let Some(stream) = self.stream {
            if shared_state.exclusive_mode.load(Ordering::Relaxed) {
                let _ = stream.play();
                shared_state.mark_stream_play_returned();
            }
            mark_playback_started(shared_state);
            return AudioCommandFlow::Continue;
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
        AudioCommand::StreamingLoadReady { generation, track } => {
            handle_streaming_load_ready_command(
                context.shared_state,
                context.dsp_ctx,
                context.loudness_state,
                context.dsp_params,
                context.target_lufs.get(),
                context.replaygain_reference_lufs,
                generation,
                track,
            );
            AudioCommandFlow::Continue
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
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale streaming load ready for '{}' (generation {})",
            track.file_path,
            generation
        );
        return;
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
    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
}

#[allow(clippy::too_many_arguments)]
fn handle_streaming_load_finished_command(
    shared_state: &Arc<SharedState>,
    loudness_state: &Arc<AtomicLoudnessState>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    generation: u64,
    samples: Vec<f64>,
    total_frames: u64,
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        log::info!(
            "Ignoring stale streaming load finish for generation {}",
            generation
        );
        return;
    }

    let samples = Arc::new(samples);
    shared_state.audio_buffer.store(Arc::clone(&samples));
    shared_state
        .total_frames
        .store(total_frames, Ordering::Relaxed);
    shared_state
        .streaming_decode_finished
        .store(true, Ordering::Release);
    shared_state.streaming_active.store(false, Ordering::Release);
    while shared_state.streaming_chunks.pop().is_some() {}
    shared_state.mark_streaming_finished();

    refresh_loaded_loudness(
        shared_state,
        loudness_state,
        target_lufs,
        replaygain_reference_lufs,
    );
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
    shared_state.position_frames.store(0, Ordering::Relaxed);
    shared_state
        .streaming_generation
        .store(generation, Ordering::Release);
    shared_state
        .streaming_decode_finished
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

    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
    log::debug!("DSP context updated for {} Hz sample rate", sample_rate);
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::state::StreamingAudioChunk;
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

        fn stop(&mut self) {}

        fn stop_for_load(&mut self) {}

        fn shutdown(&mut self, _shared_state: &SharedState) {}

        fn output_label(&self) -> &'static str {
            "test"
        }
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
                    file_path: "stale.mp3".to_string(),
                    cached_loudness: None,
                    metadata: TrackMetadata::default(),
                },
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(fixture.shared_state.sample_rate.load(Ordering::Relaxed), 48_000);
        assert_eq!(
            fixture.shared_state.file_path.read().as_deref(),
            Some("current.flac")
        );
        assert!(!fixture.shared_state.streaming_active.load(Ordering::Relaxed));
        assert_eq!(fixture.shared_state.event_flags.load(Ordering::Relaxed), 0);
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
                samples: vec![0.1, 0.2, 0.3, 0.4],
                total_frames: 2,
            },
            &mut backend,
            &fixture.context(),
        );

        assert_eq!(fixture.shared_state.audio_buffer.load().as_slice(), &[0.9, 0.8]);
        assert_eq!(fixture.shared_state.total_frames.load(Ordering::Relaxed), 1);
        assert!(!fixture
            .shared_state
            .streaming_decode_finished
            .load(Ordering::Relaxed));
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
                samples: vec![0.1, 0.2, 0.3, 0.4],
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
        assert_eq!(fixture.shared_state.position_frames.load(Ordering::Relaxed), 7);
        assert!(!fixture.shared_state.streaming_active.load(Ordering::Relaxed));
        assert!(fixture
            .shared_state
            .streaming_decode_finished
            .load(Ordering::Relaxed));
        assert!(fixture.shared_state.streaming_chunks.is_empty());
        assert!(fixture.shared_state.streaming_finished_ms.load(Ordering::Relaxed) > 0);
    }
}
