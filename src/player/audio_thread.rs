//! Audio thread implementation
//!
//! Contains the main audio thread that handles commands and manages playback.

use std::cell::Cell;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::StreamTrait;
use cpal::Stream;
use crossbeam::channel::{Receiver, RecvTimeoutError, Sender};

use super::callback::LockfreeDspContext;
use super::command_handlers::{
    handle_audio_command as handle_shared_audio_command, AudioCommandFlow, CpalCommandBackend,
    SharedAudioCommandContext,
};
use super::output_stream::{
    activate_started_stream, build_fallback_output_stream, build_requested_output_stream,
    detect_output_bits, prepare_playback_output, DspParamRefs, OutputStreamContext,
    ResamplerConfig,
};
use super::spectrum::SpectrumBatch;
use super::state::{AudioCommand, PlayerState, SharedState};
#[cfg(windows)]
use super::wasapi_loop::{handle_wasapi_exclusive, WasapiPlaybackOutcome};
use crate::config::{PhaseResponse, ResampleQuality};
use crate::processor::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicLoudnessState, AtomicNoiseShaperParams, AtomicPeakLimiterParams,
    AtomicSaturationParams, AtomicVolumeParams,
};

const PARKED_STREAM_IDLE_RELEASE_INTERVAL: Duration = Duration::from_millis(500);

struct AudioThreadDspParams {
    eq_params: Arc<AtomicEqParams>,
    saturation_params: Arc<AtomicSaturationParams>,
    crossfeed_params: Arc<AtomicCrossfeedParams>,
    limiter_params: Arc<AtomicPeakLimiterParams>,
    volume_params: Arc<AtomicVolumeParams>,
    noise_shaper_params: Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
}

pub(super) struct AudioThreadStartup {
    pub cmd_rx: Receiver<AudioCommand>,
    pub shared_state: Arc<SharedState>,
    pub eq_params: Arc<AtomicEqParams>,
    pub saturation_params: Arc<AtomicSaturationParams>,
    pub crossfeed_params: Arc<AtomicCrossfeedParams>,
    pub limiter_params: Arc<AtomicPeakLimiterParams>,
    pub volume_params: Arc<AtomicVolumeParams>,
    pub noise_shaper_params: Arc<AtomicNoiseShaperParams>,
    pub dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
    pub dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
    pub loudness_state: Arc<AtomicLoudnessState>,
    pub noise_shaper_bits: u32,
    pub spectrum_tx: Sender<SpectrumBatch>,
    pub phase_response: PhaseResponse,
    pub resample_quality: ResampleQuality,
    pub target_lufs: f64,
    pub replaygain_reference_lufs: f64,
}

impl AudioThreadDspParams {
    fn refs(&self) -> DspParamRefs<'_> {
        DspParamRefs {
            eq_params: &self.eq_params,
            saturation_params: &self.saturation_params,
            crossfeed_params: &self.crossfeed_params,
            limiter_params: &self.limiter_params,
            volume_params: &self.volume_params,
            noise_shaper_params: &self.noise_shaper_params,
            dynamic_loudness_params: &self.dynamic_loudness_params,
            dynamic_loudness_telemetry: &self.dynamic_loudness_telemetry,
        }
    }
}

enum ThreadControl {
    Continue,
    Shutdown,
}

struct AudioThreadRuntime {
    cmd_rx: Receiver<AudioCommand>,
    stream: Option<Stream>,
    parked_streams: Vec<Stream>,
    owned_dsp_chain: Option<crate::processor::DspChain>,
    shared_state: Arc<SharedState>,
    dsp_ctx: Arc<LockfreeDspContext>,
    dsp_params: AudioThreadDspParams,
    loudness_state: Arc<AtomicLoudnessState>,
    noise_shaper_bits: u32,
    spectrum_tx: Sender<SpectrumBatch>,
    phase_response: PhaseResponse,
    resample_quality: ResampleQuality,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
}

impl AudioThreadRuntime {
    fn run(&mut self) {
        loop {
            match self
                .cmd_rx
                .recv_timeout(PARKED_STREAM_IDLE_RELEASE_INTERVAL)
            {
                Ok(command) => {
                    if matches!(self.handle_audio_command(command), ThreadControl::Shutdown) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => self.maintain_parked_streams(),
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }

        self.release_parked_streams();
    }

    fn handle_audio_command(&mut self, command: AudioCommand) -> ThreadControl {
        if matches!(command, AudioCommand::Play) {
            log::info!("Received Play command");
        }

        let target_lufs = Cell::new(self.target_lufs);
        let flow = {
            let mut backend = CpalCommandBackend::new(&mut self.stream, &mut self.parked_streams);
            let context = SharedAudioCommandContext {
                shared_state: &self.shared_state,
                dsp_ctx: &self.dsp_ctx,
                loudness_state: &self.loudness_state,
                dsp_params: self.dsp_params.refs(),
                target_lufs: &target_lufs,
                replaygain_reference_lufs: self.replaygain_reference_lufs,
            };

            handle_shared_audio_command(command, &mut backend, &context)
        };
        self.target_lufs = target_lufs.get();

        match flow {
            AudioCommandFlow::Continue | AudioCommandFlow::StopPlayback => ThreadControl::Continue,
            AudioCommandFlow::StartPlayback => self.start_playback(),
            AudioCommandFlow::ShutdownThread => ThreadControl::Shutdown,
        }
    }

    fn start_playback(&mut self) -> ThreadControl {
        let use_exclusive = self.shared_state.exclusive_mode.load(Ordering::Relaxed);

        #[cfg(windows)]
        if use_exclusive {
            match handle_wasapi_exclusive(
                &self.cmd_rx,
                &self.shared_state,
                &self.dsp_ctx,
                &self.loudness_state,
                &self.spectrum_tx,
                self.target_lufs,
                self.replaygain_reference_lufs,
                self.resample_quality,
                &self.dsp_params.dynamic_loudness_telemetry,
            ) {
                WasapiPlaybackOutcome::Handled => return ThreadControl::Continue,
                WasapiPlaybackOutcome::Fallback => {}
                WasapiPlaybackOutcome::ShutdownThread => return ThreadControl::Shutdown,
            }
        }

        self.shared_state.mark_output_prepare_started();
        let output_plan = match prepare_playback_output(&self.shared_state, use_exclusive) {
            Some(output_plan) => {
                self.shared_state.mark_output_prepare_finished();
                output_plan
            }
            None => {
                self.shared_state.mark_output_prepare_finished();
                return ThreadControl::Continue;
            }
        };

        let stream_context = OutputStreamContext {
            shared_state: &self.shared_state,
            dsp_ctx: &self.dsp_ctx,
            loudness_state: &self.loudness_state,
            spectrum_tx: &self.spectrum_tx,
        };
        let dsp_params = self.dsp_params.refs();

        self.shared_state.mark_stream_build_started();
        match build_requested_output_stream(
            &output_plan,
            &mut self.owned_dsp_chain,
            &stream_context,
            &dsp_params,
            ResamplerConfig {
                phase_response: self.phase_response,
                quality: self.resample_quality,
            },
        ) {
            Ok(s) => {
                self.shared_state.mark_stream_build_finished();
                activate_started_stream(&mut self.stream, s, &self.shared_state);
                let detected_bits = detect_output_bits(&output_plan.device, self.noise_shaper_bits);

                self.shared_state
                    .output_bits
                    .store(detected_bits, Ordering::Relaxed);
                log::info!(
                    "Stream started successfully at {} Hz, {}-bit output",
                    output_plan.actual_sample_rate,
                    detected_bits
                );
            }
            Err(e) => {
                log::error!(
                    "Failed to build stream: {}. Trying device default config...",
                    e
                );

                match build_fallback_output_stream(
                    &output_plan,
                    &stream_context,
                    &dsp_params,
                    ResamplerConfig {
                        phase_response: self.phase_response,
                        quality: self.resample_quality,
                    },
                ) {
                    Ok(s) => {
                        self.shared_state.mark_stream_build_finished();
                        activate_started_stream(&mut self.stream, s, &self.shared_state);
                        let detected_bits =
                            detect_output_bits(&output_plan.device, self.noise_shaper_bits);
                        self.shared_state
                            .output_bits
                            .store(detected_bits, Ordering::Relaxed);

                        log::info!(
                            "Stream started with device default config, {}-bit output",
                            detected_bits
                        );
                    }
                    Err(e2) => {
                        log::error!("Failed to start stream even with device default: {}", e2);
                        self.shared_state.mark_stream_build_finished();
                        self.shared_state.state.store(PlayerState::Stopped);
                    }
                }
            }
        }

        ThreadControl::Continue
    }

    fn maintain_parked_streams(&mut self) {
        if self.parked_streams.is_empty() {
            return;
        }

        if self.shared_state.state.load() != PlayerState::Playing
            && !self.shared_state.is_loading.load(Ordering::Acquire)
        {
            self.release_parked_streams();
        }
    }

    fn release_parked_streams(&mut self) {
        let count = self.parked_streams.len();
        if count == 0 {
            return;
        }

        let parked_streams = std::mem::take(&mut self.parked_streams);
        for stream in &parked_streams {
            let _ = stream.pause();
        }
        drop(parked_streams);
        self.shared_state.mark_parked_output_streams_released(count);
        log::debug!("Released {} parked output stream(s)", count);
    }
}

/// Main audio thread entry point
///
/// Handles:
/// - Command processing (Play/Pause/Stop/Seek/Shutdown)
/// - Device enumeration and selection
/// - Stream creation and management
/// - WASAPI exclusive mode (Windows only)
pub fn audio_thread_main(startup: AudioThreadStartup) {
    let AudioThreadStartup {
        cmd_rx,
        shared_state,
        eq_params,
        saturation_params,
        crossfeed_params,
        limiter_params,
        volume_params,
        noise_shaper_params,
        dynamic_loudness_params,
        dynamic_loudness_telemetry,
        loudness_state,
        noise_shaper_bits,
        spectrum_tx,
        phase_response,
        resample_quality,
        target_lufs,
        replaygain_reference_lufs,
    } = startup;

    log::info!("Audio thread started, initializing cpal host...");
    let dsp_params = AudioThreadDspParams {
        eq_params,
        saturation_params,
        crossfeed_params,
        limiter_params,
        volume_params,
        noise_shaper_params,
        dynamic_loudness_params,
        dynamic_loudness_telemetry,
    };

    // Keep a default output bit-depth hint for downstream components.
    shared_state
        .output_bits
        .store(noise_shaper_bits.max(16), Ordering::Relaxed);
    dsp_params
        .noise_shaper_params
        .set_bits(noise_shaper_bits.max(16));

    let initial_channels = shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
    let initial_sample_rate = shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;

    let (dsp_ctx, initial_dsp_chain) = LockfreeDspContext::new(
        initial_channels,
        initial_sample_rate,
        Arc::clone(&dsp_params.eq_params),
        Arc::clone(&dsp_params.saturation_params),
        Arc::clone(&dsp_params.crossfeed_params),
        Arc::clone(&dsp_params.limiter_params),
        Arc::clone(&dsp_params.volume_params),
        Arc::clone(&dsp_params.noise_shaper_params),
        Arc::clone(&dsp_params.dynamic_loudness_params),
        Arc::clone(&dsp_params.dynamic_loudness_telemetry),
    );

    let mut runtime = AudioThreadRuntime {
        cmd_rx,
        stream: None,
        parked_streams: Vec::new(),
        owned_dsp_chain: Some(initial_dsp_chain),
        shared_state,
        dsp_ctx: Arc::new(dsp_ctx),
        dsp_params,
        loudness_state,
        noise_shaper_bits,
        spectrum_tx,
        phase_response,
        resample_quality,
        target_lufs,
        replaygain_reference_lufs,
    };
    runtime.run();
}
