//! Windows WASAPI exclusive command loop.
//!
//! CPAL stream setup stays in `output_stream`; this module owns the Windows-only
//! exclusive backend lifecycle and delegates shared command semantics to
//! `command_handlers`.

#![cfg(windows)]

use std::cell::Cell;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use crossbeam::channel::{Receiver, RecvTimeoutError, Sender};

use super::callback::{audio_callback_lockfree, CallbackScratch, LockfreeDspContext};
use super::command_handlers::{
    handle_audio_command as handle_shared_audio_command, mark_playback_started,
    AudioCommandBackend, AudioCommandFlow, SharedAudioCommandContext,
};
use super::output_stream::DspParamRefs;
use super::spectrum::SpectrumBatch;
use super::state::{AudioCommand, PlayerState, SharedState};
use crate::config::ResampleQuality;
use crate::processor::{AtomicDynamicLoudnessTelemetry, AtomicLoudnessState};
use crate::wasapi_output::{WasapiExclusivePlayer, WasapiState};

const WASAPI_STARTUP_POLL: Duration = Duration::from_millis(10);
const WASAPI_COMMAND_POLL: Duration = Duration::from_millis(50);
const MAX_WASAPI_STARTUP_POLLS: usize = 300;

pub(super) enum WasapiPlaybackOutcome {
    Handled,
    Fallback,
    ShutdownThread,
}

struct WasapiCommandBackend<'a> {
    player: &'a WasapiExclusivePlayer,
}

impl<'a> WasapiCommandBackend<'a> {
    fn new(player: &'a WasapiExclusivePlayer) -> Self {
        Self { player }
    }
}

impl AudioCommandBackend for WasapiCommandBackend<'_> {
    fn play(&mut self, shared_state: &SharedState) -> AudioCommandFlow {
        if shared_state.state.load() == PlayerState::Paused {
            let _ = self.player.play();
            mark_playback_started(shared_state);
        }

        AudioCommandFlow::Continue
    }

    fn pause(&mut self) {
        let _ = self.player.pause();
    }

    fn seek(&mut self, frame: u64) {
        let _ = self.player.seek(frame);
    }

    fn stop(&mut self) {
        let _ = self.player.stop();
    }

    fn stop_for_load(&mut self) {
        let _ = self.player.stop();
    }

    fn shutdown(&mut self, shared_state: &SharedState) {
        let _ = self.player.stop();
        shared_state.state.store(PlayerState::Stopped);
    }

    fn output_label(&self) -> &'static str {
        "WASAPI path"
    }
}

fn wasapi_dsp_refs<'a>(
    dsp_ctx: &'a Arc<LockfreeDspContext>,
    dynamic_loudness_telemetry: &'a Arc<AtomicDynamicLoudnessTelemetry>,
) -> DspParamRefs<'a> {
    DspParamRefs {
        eq_params: &dsp_ctx.eq_params,
        saturation_params: &dsp_ctx.saturation_params,
        crossfeed_params: &dsp_ctx.crossfeed_params,
        limiter_params: &dsp_ctx.limiter_params,
        volume_params: &dsp_ctx.volume_params,
        noise_shaper_params: &dsp_ctx.noise_shaper_params,
        dynamic_loudness_params: &dsp_ctx.dynamic_loudness_params,
        dynamic_loudness_telemetry,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn handle_wasapi_exclusive(
    cmd_rx: &Receiver<AudioCommand>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    spectrum_tx: &Sender<SpectrumBatch>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    resample_quality: ResampleQuality,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
) -> WasapiPlaybackOutcome {
    log::info!("Starting TRUE WASAPI exclusive mode playback...");

    let sample_rate = shared_state.sample_rate.load(Ordering::Relaxed) as u32;
    let channels = shared_state.channels.load(Ordering::Relaxed) as usize;

    if channels == 0 {
        log::error!("Invalid channels");
        shared_state.state.store(PlayerState::Stopped);
        return WasapiPlaybackOutcome::Handled;
    }

    let dsp_callback = build_wasapi_callback(
        shared_state,
        dsp_ctx,
        loudness_state,
        spectrum_tx,
        sample_rate,
        channels,
    );
    let wasapi_device_id = selected_wasapi_device_id(shared_state);

    match WasapiExclusivePlayer::new(
        wasapi_device_id,
        sample_rate,
        channels,
        resample_quality,
        Arc::clone(&dsp_ctx.noise_shaper_params),
        dsp_callback,
    ) {
        Ok(wasapi_player) => run_wasapi_player_loop(
            cmd_rx,
            shared_state,
            dsp_ctx,
            loudness_state,
            dynamic_loudness_telemetry,
            target_lufs,
            replaygain_reference_lufs,
            wasapi_player,
        ),
        Err(e) => {
            log::error!(
                "Failed to create WASAPI player: {}. Falling back to cpal.",
                e
            );
            WasapiPlaybackOutcome::Fallback
        }
    }
}

fn selected_wasapi_device_id(shared_state: &SharedState) -> Option<usize> {
    let device_id_value = shared_state.device_id.load(Ordering::Relaxed);
    if device_id_value >= 0 {
        Some(device_id_value as usize)
    } else {
        None
    }
}

fn build_wasapi_callback(
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    spectrum_tx: &Sender<SpectrumBatch>,
    sample_rate: u32,
    channels: usize,
) -> crate::wasapi_output::DspCallback {
    let cb_shared = Arc::clone(shared_state);
    let cb_loudness_state = Arc::clone(loudness_state);
    let cb_spectrum_tx = spectrum_tx.clone();

    let mut callback_scratch = CallbackScratch::new(channels);

    let mut wasapi_dsp_chain = LockfreeDspContext::build_dsp_chain(
        channels,
        sample_rate as f64,
        Arc::clone(&dsp_ctx.eq_params),
        Arc::clone(&dsp_ctx.saturation_params),
        Arc::clone(&dsp_ctx.crossfeed_params),
        Arc::clone(&dsp_ctx.limiter_params),
        Arc::clone(&dsp_ctx.volume_params),
        Arc::clone(&dsp_ctx.noise_shaper_params),
        Arc::clone(&dsp_ctx.dynamic_loudness_params),
        Arc::new(AtomicDynamicLoudnessTelemetry::new()),
        Arc::clone(&dsp_ctx.merged_convolver),
        Arc::clone(&dsp_ctx.merged_convolver_enabled),
    );

    let mut unused_resampler = None;

    Box::new(move |data: &mut [f32], cb_channels: usize| -> bool {
        audio_callback_lockfree(
            data,
            &cb_shared,
            &mut wasapi_dsp_chain,
            None,
            &cb_loudness_state,
            &cb_spectrum_tx,
            cb_channels,
            &mut unused_resampler,
            &mut callback_scratch,
        );

        cb_shared.state.load() == PlayerState::Stopped
    })
}

#[allow(clippy::too_many_arguments)]
fn run_wasapi_player_loop(
    cmd_rx: &Receiver<AudioCommand>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    wasapi_player: WasapiExclusivePlayer,
) -> WasapiPlaybackOutcome {
    if let Err(e) = wasapi_player.play() {
        log::error!("Failed to start WASAPI playback: {}", e);
        shared_state.state.store(PlayerState::Stopped);
        return WasapiPlaybackOutcome::Handled;
    }

    if shared_state.state.load() == PlayerState::Paused {
        let _ = wasapi_player.pause();
    } else {
        mark_playback_started(shared_state);
    }

    if !wait_for_wasapi_start(&wasapi_player) {
        log::error!("WASAPI: Failed to start playback after waiting");
        shared_state.state.store(PlayerState::Stopped);
        return WasapiPlaybackOutcome::Handled;
    }

    log::info!("WASAPI: Playback started, entering monitoring loop");
    monitor_wasapi_commands(
        cmd_rx,
        shared_state,
        dsp_ctx,
        loudness_state,
        dynamic_loudness_telemetry,
        target_lufs,
        replaygain_reference_lufs,
        &wasapi_player,
    )
}

fn wait_for_wasapi_start(wasapi_player: &WasapiExclusivePlayer) -> bool {
    let mut wait_count = 0;
    while wasapi_player.get_state() == WasapiState::Stopped && wait_count < MAX_WASAPI_STARTUP_POLLS
    {
        std::thread::sleep(WASAPI_STARTUP_POLL);
        wait_count += 1;
    }

    wasapi_player.get_state() != WasapiState::Stopped
}

#[allow(clippy::too_many_arguments)]
fn monitor_wasapi_commands(
    cmd_rx: &Receiver<AudioCommand>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    target_lufs: f64,
    replaygain_reference_lufs: f64,
    wasapi_player: &WasapiExclusivePlayer,
) -> WasapiPlaybackOutcome {
    let target_lufs = Cell::new(target_lufs);

    loop {
        match cmd_rx.recv_timeout(WASAPI_COMMAND_POLL) {
            Ok(command) => {
                let mut backend = WasapiCommandBackend::new(wasapi_player);
                let context = SharedAudioCommandContext {
                    shared_state,
                    dsp_ctx,
                    loudness_state,
                    dsp_params: wasapi_dsp_refs(dsp_ctx, dynamic_loudness_telemetry),
                    target_lufs: &target_lufs,
                    replaygain_reference_lufs,
                };

                match handle_shared_audio_command(command, &mut backend, &context) {
                    AudioCommandFlow::Continue | AudioCommandFlow::StartPlayback => {}
                    AudioCommandFlow::StopPlayback => break,
                    AudioCommandFlow::ShutdownThread => {
                        return WasapiPlaybackOutcome::ShutdownThread
                    }
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                log::warn!("WASAPI command channel disconnected; stopping playback");
                let _ = wasapi_player.stop();
                break;
            }
        }

        if shared_state.state.load() == PlayerState::Stopped {
            log::info!("WASAPI playback finished");
            let _ = wasapi_player.stop();
            break;
        }
    }

    WasapiPlaybackOutcome::Handled
}
