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
use super::streaming::producer::{PersistentProducerHandle, ProducerReaper};
use super::streaming::session::PersistentStreamingSession;
#[cfg(windows)]
use super::wasapi_loop::{handle_wasapi_exclusive, WasapiPlaybackOutcome};
use crate::config::PhaseResponse;
use crate::processor::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicLoudnessState, AtomicNoiseShaperParams, AtomicPeakLimiterParams,
    AtomicSaturationParams, AtomicVolumeParams,
};

const PARKED_STREAM_IDLE_RELEASE_INTERVAL: Duration = Duration::from_millis(500);
const STREAMING_SESSION_STATE_POLL_INTERVAL: Duration = Duration::from_millis(10);

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
    pub spectrum_tx: Sender<SpectrumBatch>,
    pub phase_response: PhaseResponse,
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
    spectrum_tx: Sender<SpectrumBatch>,
    phase_response: PhaseResponse,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    streaming_session: Option<PersistentStreamingSession>,
    pending_streaming_session: Option<PersistentStreamingSession>,
    streaming_reaper: ProducerReaper,
    pending_streaming_retire: Vec<PersistentProducerHandle>,
    streaming_autoplay_pending: bool,
    streaming_ready_generation: u64,
}

impl AudioThreadRuntime {
    fn run(&mut self) {
        loop {
            let timeout = if self.streaming_session.is_some() {
                STREAMING_SESSION_STATE_POLL_INTERVAL
            } else {
                PARKED_STREAM_IDLE_RELEASE_INTERVAL
            };
            match self.cmd_rx.recv_timeout(timeout) {
                Ok(command) => {
                    self.sync_pending_swap();
                    self.drain_abandoned_pending_streaming();
                    if matches!(self.handle_audio_command(command), ThreadControl::Shutdown) {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    self.sync_pending_swap();
                    self.drain_abandoned_pending_streaming();
                    self.maintain_parked_streams();
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
            // Free resources the audio callback retired (old buffers, replaced DSP
            // chains, consumed streaming chunks) here on the non-realtime audio thread.
            self.shared_state.drain_retired_audio_resources();
            self.retry_streaming_retire();
            if self.maintain_streaming_session()
                && matches!(self.start_playback(), ThreadControl::Shutdown)
            {
                break;
            }
        }

        self.shared_state
            .streaming_v2_enabled
            .store(false, Ordering::Release);
        self.shared_state.publish_streaming_v2_rt(None);
        self.clear_pending_streaming(true);
        if let Some(session) = self.streaming_session.take() {
            self.retire_streaming_session(session);
        }
        self.retry_streaming_retire();
        self.shared_state.drain_retired_audio_resources();
        self.release_parked_streams();
    }

    fn handle_audio_command(&mut self, command: AudioCommand) -> ThreadControl {
        let command = match command {
            AudioCommand::InstallStreamingV2Session {
                generation,
                autoplay,
                session,
            } => {
                // A fresh active session supersedes any gapless preload target.
                self.clear_pending_streaming(true);
                self.install_streaming_session(generation, autoplay, *session);
                return ThreadControl::Continue;
            }
            AudioCommand::InstallPendingStreamingV2Session { generation, session } => {
                self.install_pending_streaming_session(generation, *session);
                return ThreadControl::Continue;
            }
            AudioCommand::CancelPendingStreamingV2Session => {
                self.clear_pending_streaming(true);
                return ThreadControl::Continue;
            }
            AudioCommand::Seek(time) => {
                log::info!(
                    "v2 src-seek: Seek cmd time={time} v2_session={}",
                    self.streaming_session.is_some()
                );
                if let Some(session) = self.streaming_session.as_ref() {
                    if request_resident_window_seek(&self.shared_state, session, time).is_none() {
                        request_persistent_source_seek(session, time);
                    }
                    return ThreadControl::Continue;
                }
                AudioCommand::Seek(time)
            }
            command => command,
        };
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

    fn install_streaming_session(
        &mut self,
        generation: u64,
        autoplay: bool,
        session: PersistentStreamingSession,
    ) {
        if self.shared_state.load_generation.load(Ordering::Acquire) != generation {
            self.retire_streaming_session(session);
            return;
        }
        if let Some(previous) = self.streaming_session.replace(session) {
            self.retire_streaming_session(previous);
        }
        let active = self
            .streaming_session
            .as_ref()
            .expect("session was just installed");
        self.shared_state
            .sample_rate
            .store(u64::from(active.output_sample_rate), Ordering::Release);
        self.shared_state
            .channels
            .store(active.channels as u64, Ordering::Release);
        self.shared_state
            .total_frames
            .store(active.total_frames, Ordering::Release);
        self.streaming_autoplay_pending = autoplay;
        self.streaming_ready_generation = 0;
        self.shared_state
            .publish_streaming_v2_rt(Some(Arc::clone(&active.rt)));
        self.shared_state
            .streaming_v2_enabled
            .store(true, Ordering::Release);
        self.shared_state
            .streaming_active
            .store(true, Ordering::Release);
    }

    /// Install a gapless-preloaded v2 streaming session as the pending swap
    /// target. The callback consumes `streaming_pending_v2_rt` at the current
    /// track's EOF; until then the session is owned here (producer parks once
    /// the window is full, session.rs backpressure).
    fn install_pending_streaming_session(
        &mut self,
        generation: u64,
        session: PersistentStreamingSession,
    ) {
        if self.shared_state.load_generation.load(Ordering::Acquire) != generation {
            log::debug!(
                "v2 gapless: pending install stale (gen {} vs load {}), retiring",
                generation,
                self.shared_state.load_generation.load(Ordering::Acquire)
            );
            self.retire_streaming_session(session);
            self.shared_state
                .streaming_pending_ready
                .store(false, Ordering::Release);
            return;
        }
        log::debug!("v2 gapless: pending session installed (gen {})", generation);
        if let Some(previous) = self.pending_streaming_session.replace(session) {
            self.retire_streaming_session(previous);
        }
        let pending = self
            .pending_streaming_session
            .as_ref()
            .expect("pending session was just installed");
        self.shared_state
            .streaming_pending_total_frames
            .store(pending.total_frames, Ordering::Release);
        self.shared_state
            .streaming_pending_generation
            .store(generation, Ordering::Release);
        self.shared_state
            .streaming_pending_channels
            .store(pending.channels as u64, Ordering::Release);
        self.shared_state
            .streaming_pending_v2_rt
            .store(Some(Arc::clone(&pending.rt)));
        self.shared_state
            .streaming_pending_ready
            .store(true, Ordering::Release);
    }

    /// Drop the pending gapless-preload session and its publication slot.
    ///
    /// If the callback already swapped the pending RT into the active slot
    /// (`streaming_swap_requested`), the displaced active session is owned by
    /// the swap-sync path and must NOT be retired here — retrying it would
    /// kill freshly-swapped playback.
    fn clear_pending_streaming(&mut self, retire_if_unswapped: bool) {
        let had_pending = self.shared_state.streaming_pending_v2_rt.load_full().is_some();
        self.shared_state.streaming_pending_v2_rt.store(None);
        self.shared_state
            .streaming_pending_ready
            .store(false, Ordering::Release);
        let Some(session) = self.pending_streaming_session.take() else {
            if had_pending {
                log::debug!("v2 gapless: clear_pending dropped slot without session");
            }
            return;
        };
        if retire_if_unswapped && self.shared_state.streaming_swap_requested.load(Ordering::Acquire)
        {
            log::debug!("v2 gapless: clear_pending deferred to swap-sync");
            return;
        }
        log::debug!(
            "v2 gapless: clear_pending retiring session (retire_if_unswapped={})",
            retire_if_unswapped
        );
        self.retire_streaming_session(session);
    }

    /// Consume a callback-requested pending→active swap (one shot per swap).
    /// The callback already republished the RT; here we only swap the
    /// expensive owning session so seek/maintain/retire keep working, and
    /// retire the displaced one.
    /// Consume the callback's end-of-queue abandon signal and retire any
    /// staged v2 preload session (ledger hygiene: no dead pending window).
    fn drain_abandoned_pending_streaming(&mut self) {
        if self
            .shared_state
            .streaming_pending_abandon
            .swap(false, Ordering::AcqRel)
        {
            self.clear_pending_streaming(true);
        }
    }

    fn sync_pending_swap(&mut self) {
        if !self
            .shared_state
            .streaming_swap_requested
            .swap(false, Ordering::AcqRel)
        {
            return;
        }
        let Some(pending) = self.pending_streaming_session.take() else {
            return;
        };
        self.shared_state
            .streaming_pending_ready
            .store(false, Ordering::Release);
        if let Some(previous) = self.streaming_session.replace(pending) {
            self.retire_streaming_session(previous);
        }
        // The promoted window is now the live one: charge its bytes under the
        // active owner so ledger balances mirror what is playing.
        if let Some(session) = self.streaming_session.as_ref() {
            session.reown_window(
                crate::player::streaming::memory::DecodedMemoryOwner::ActiveWindow,
            );
        }
    }

    fn maintain_streaming_session(&mut self) -> bool {
        let Some(session) = self.streaming_session.as_ref() else {
            return false;
        };
        apply_streaming_session_state(
            &self.shared_state,
            session,
            &mut self.streaming_ready_generation,
            &mut self.streaming_autoplay_pending,
        )
    }

    fn retire_streaming_session(&mut self, session: PersistentStreamingSession) {
        let PersistentStreamingSession { producer, .. } = session;
        let handle = self
            .streaming_reaper
            .handle()
            .expect("streaming reaper handle remains available");
        if let Err(producer) = producer.retire(&handle) {
            self.pending_streaming_retire.push(producer);
        }
    }

    fn retry_streaming_retire(&mut self) {
        let Some(handle) = self.streaming_reaper.handle() else {
            return;
        };
        let index = 0;
        while index < self.pending_streaming_retire.len() {
            let producer = self.pending_streaming_retire.swap_remove(index);
            if let Err(producer) = producer.retire(&handle) {
                self.pending_streaming_retire.push(producer);
                break;
            }
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
                self.shared_state.resample_quality(),
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
        let requested = build_requested_output_stream(
            &output_plan,
            &mut self.owned_dsp_chain,
            &stream_context,
            &dsp_params,
            ResamplerConfig {
                phase_response: self.phase_response,
                quality: self.shared_state.resample_quality(),
            },
        )
        .and_then(|s| {
            self.shared_state.mark_stream_build_finished();
            activate_started_stream(&mut self.stream, s, &self.shared_state)
        });

        match requested {
            Ok(()) => {
                let output_bits = self.shared_state.output_bits.load(Ordering::Relaxed);
                let detected_bits = detect_output_bits(&output_plan.device, output_bits);

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
                    "Failed to start stream: {}. Trying device default config...",
                    e
                );

                let fallback = build_fallback_output_stream(
                    &output_plan,
                    &stream_context,
                    &dsp_params,
                    ResamplerConfig {
                        phase_response: self.phase_response,
                        quality: self.shared_state.resample_quality(),
                    },
                )
                .and_then(|s| {
                    self.shared_state.mark_stream_build_finished();
                    activate_started_stream(&mut self.stream, s, &self.shared_state)
                });

                match fallback {
                    Ok(()) => {
                        let output_bits = self.shared_state.output_bits.load(Ordering::Relaxed);
                        let detected_bits = detect_output_bits(&output_plan.device, output_bits);
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

pub(crate) fn apply_streaming_session_state(
    shared_state: &SharedState,
    session: &PersistentStreamingSession,
    ready_generation: &mut u64,
    autoplay_pending: &mut bool,
) -> bool {
    let generation = session.producer.generation();
    let producer = session.rt.producer();
    if producer.decode_state == super::streaming::rt_view::StreamingDecodeState::Failed {
        shared_state.is_loading.store(false, Ordering::Release);
        shared_state.state.store(PlayerState::Stopped);
        *autoplay_pending = false;
        return false;
    }
    let ready = matches!(
        producer.decode_state,
        super::streaming::rt_view::StreamingDecodeState::Ready
            | super::streaming::rt_view::StreamingDecodeState::EndOfStream
    );
    shared_state.streaming_decode_finished.store(
        producer.decode_state == super::streaming::rt_view::StreamingDecodeState::EndOfStream,
        Ordering::Release,
    );
    if !ready || *ready_generation == generation {
        return false;
    }
    *ready_generation = generation;
    shared_state.is_loading.store(false, Ordering::Release);
    std::mem::take(autoplay_pending)
}

pub(crate) fn request_resident_window_seek(
    shared_state: &SharedState,
    session: &PersistentStreamingSession,
    time_secs: f64,
) -> Option<u64> {
    let identity = session.rt.identity();
    if !identity.active || identity.generation != session.producer.generation() {
        return None;
    }
    let target_frame = (time_secs.max(0.0) * f64::from(session.output_sample_rate)) as u64;
    let producer = session.rt.producer();
    if target_frame < producer.retained_start_frame || target_frame >= producer.produced_end_frame {
        return None;
    }
    let current_frame = shared_state
        .playback_clock
        .callback
        .position_frames
        .load(Ordering::Acquire);
    let kind = if target_frame < current_frame {
        super::streaming::rt_view::WindowSeekKind::Backward
    } else {
        super::streaming::rt_view::WindowSeekKind::Forward
    };
    Some(
        session
            .rt
            .request_seek(target_frame, identity.generation, identity.epoch, kind),
    )
}

pub(crate) fn request_persistent_source_seek(
    session: &PersistentStreamingSession,
    time_secs: f64,
) -> u64 {
    log::info!("v2 src-seek: persistent path time={time_secs}");
    let identity = session.rt.identity();
    let target_frame = (time_secs.max(0.0) * f64::from(session.output_sample_rate)) as u64;
    session
        .rt
        .publish_identity(super::streaming::rt_view::WindowIdentitySnapshot {
            active: false,
            ..identity
        });
    session.rt.record_source_seek_request();
    session.producer.request_source_seek(target_frame)
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
        spectrum_tx,
        phase_response,
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
    let initial_output_bits = shared_state.output_bits.load(Ordering::Relaxed).max(16);
    shared_state
        .output_bits
        .store(initial_output_bits, Ordering::Relaxed);
    dsp_params.noise_shaper_params.set_bits(initial_output_bits);

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
        pending_streaming_session: None,
        dsp_ctx: Arc::new(dsp_ctx),
        dsp_params,
        loudness_state,
        spectrum_tx,
        phase_response,
        target_lufs,
        replaygain_reference_lufs,
        streaming_session: None,
        streaming_reaper: ProducerReaper::new().expect("start streaming producer reaper"),
        pending_streaming_retire: Vec::new(),
        streaming_autoplay_pending: false,
        streaming_ready_generation: 0,
    };
    runtime.run();
}
