//! Audio thread implementation
//!
//! Contains the main audio thread that handles commands and manages playback.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host, Stream, StreamConfig};
use crossbeam::channel::{Receiver, Sender};

#[cfg(debug_assertions)]
use assert_no_alloc::assert_no_alloc;

use super::callback::{audio_callback_lockfree, LockfreeDspContext};
use super::state::{
    AudioCommand, PlayerState, SharedState, EVENT_LOAD_COMPLETE, EVENT_PLAYBACK_STARTED,
    EVENT_TRACK_CHANGED,
};
use crate::config::PhaseResponse;
use crate::processor::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicLoudnessState, AtomicNoiseShaperParams, AtomicPeakLimiterParams,
    AtomicSaturationParams, AtomicVolumeParams, StreamingResampler,
};

const MAX_DAC_RATE: u32 = 384000;
const AUDIO_PROCESS_BUFFER_FRAMES: usize = 8192;
const AUDIO_RESAMPLE_BUFFER_FRAMES: usize = 16384;
const AUDIO_HEADROOM: f64 = 0.99;

struct PlaybackOutputPlan {
    device: Device,
    requested_sample_rate: u32,
    actual_sample_rate: u32,
    channels: u16,
    config: StreamConfig,
}

struct OutputStreamContext<'a> {
    shared_state: &'a Arc<SharedState>,
    dsp_ctx: &'a Arc<LockfreeDspContext>,
    loudness_state: &'a Arc<AtomicLoudnessState>,
    spectrum_tx: &'a Sender<f64>,
}

struct DspParamRefs<'a> {
    eq_params: &'a Arc<AtomicEqParams>,
    saturation_params: &'a Arc<AtomicSaturationParams>,
    crossfeed_params: &'a Arc<AtomicCrossfeedParams>,
    limiter_params: &'a Arc<AtomicPeakLimiterParams>,
    volume_params: &'a Arc<AtomicVolumeParams>,
    noise_shaper_params: &'a Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: &'a Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: &'a Arc<AtomicDynamicLoudnessTelemetry>,
}

#[cfg(windows)]
use crate::wasapi_output::{WasapiExclusivePlayer, WasapiState};

#[cfg(windows)]
enum WasapiCommandOutcome {
    Continue,
    StopPlayback,
    ShutdownThread,
}

#[cfg(windows)]
enum WasapiPlaybackOutcome {
    Handled,
    Fallback,
    ShutdownThread,
}

#[cfg(windows)]
struct WasapiCommandContext<'a> {
    shared_state: &'a Arc<SharedState>,
    dsp_ctx: &'a Arc<LockfreeDspContext>,
    loudness_state: &'a Arc<AtomicLoudnessState>,
    dynamic_loudness_telemetry: &'a Arc<AtomicDynamicLoudnessTelemetry>,
    target_lufs: f64,
}

/// Main audio thread entry point
///
/// Handles:
/// - Command processing (Play/Pause/Stop/Seek/Shutdown)
/// - Device enumeration and selection
/// - Stream creation and management
/// - WASAPI exclusive mode (Windows only)
#[allow(clippy::too_many_arguments)]
pub fn audio_thread_main(
    cmd_rx: Receiver<AudioCommand>,
    shared_state: Arc<SharedState>,
    eq_params: Arc<AtomicEqParams>,
    saturation_params: Arc<AtomicSaturationParams>,
    crossfeed_params: Arc<AtomicCrossfeedParams>,
    limiter_params: Arc<AtomicPeakLimiterParams>,
    volume_params: Arc<AtomicVolumeParams>,
    noise_shaper_params: Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,
    loudness_state: Arc<AtomicLoudnessState>,
    noise_shaper_bits: u32,
    spectrum_tx: Sender<f64>,
    phase_response: PhaseResponse,
    target_lufs: f64,
) {
    log::info!("Audio thread started, initializing cpal host...");
    let mut stream: Option<Stream> = None;

    // Keep a default output bit-depth hint for downstream components.
    shared_state
        .output_bits
        .store(noise_shaper_bits.max(16), Ordering::Relaxed);
    noise_shaper_params.set_bits(noise_shaper_bits.max(16));

    let initial_channels = shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
    let initial_sample_rate = shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;

    let (dsp_ctx, initial_dsp_chain) = LockfreeDspContext::new(
        initial_channels,
        initial_sample_rate,
        Arc::clone(&eq_params),
        Arc::clone(&saturation_params),
        Arc::clone(&crossfeed_params),
        Arc::clone(&limiter_params),
        Arc::clone(&volume_params),
        Arc::clone(&noise_shaper_params),
        Arc::clone(&dynamic_loudness_params),
        Arc::clone(&dynamic_loudness_telemetry),
    );
    let dsp_ctx = Arc::new(dsp_ctx);
    // The DspChain will be moved into the callback closure below.
    // We hold it here temporarily until stream creation.
    let mut owned_dsp_chain = Some(initial_dsp_chain);

    loop {
        match cmd_rx.recv() {
            Ok(command) => {
                if handle_audio_command(
                    command,
                    &cmd_rx,
                    &mut stream,
                    &mut owned_dsp_chain,
                    &shared_state,
                    &dsp_ctx,
                    &eq_params,
                    &saturation_params,
                    &crossfeed_params,
                    &limiter_params,
                    &volume_params,
                    &noise_shaper_params,
                    &dynamic_loudness_params,
                    &dynamic_loudness_telemetry,
                    &loudness_state,
                    noise_shaper_bits,
                    &spectrum_tx,
                    phase_response,
                    target_lufs,
                ) {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn handle_audio_command(
    command: AudioCommand,
    cmd_rx: &Receiver<AudioCommand>,
    stream: &mut Option<Stream>,
    owned_dsp_chain: &mut Option<crate::processor::DspChain>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    eq_params: &Arc<AtomicEqParams>,
    saturation_params: &Arc<AtomicSaturationParams>,
    crossfeed_params: &Arc<AtomicCrossfeedParams>,
    limiter_params: &Arc<AtomicPeakLimiterParams>,
    volume_params: &Arc<AtomicVolumeParams>,
    noise_shaper_params: &Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: &Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    loudness_state: &Arc<AtomicLoudnessState>,
    noise_shaper_bits: u32,
    spectrum_tx: &Sender<f64>,
    phase_response: PhaseResponse,
    target_lufs: f64,
) -> bool {
    match command {
        AudioCommand::Play => {
            if handle_play_command(
                cmd_rx,
                stream,
                owned_dsp_chain,
                shared_state,
                dsp_ctx,
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
                target_lufs,
            ) {
                return true;
            }
        }
        AudioCommand::Pause => {
            handle_pause_command(stream, shared_state);
        }
        AudioCommand::Seek(time) => {
            handle_seek_command(shared_state, time);
        }
        AudioCommand::Stop => {
            handle_stop_command(stream, shared_state);
        }
        AudioCommand::StopForLoad => {
            handle_stop_for_load_command(stream, shared_state);
        }
        AudioCommand::SetExternalIrConvolver { ir_data, channels } => {
            handle_set_external_ir_convolver_command(dsp_ctx, ir_data, channels);
        }
        AudioCommand::ClearExternalIrConvolver => {
            dsp_ctx.clear_external_ir_convolver();
        }
        AudioCommand::SetFirConvolver { ir_data, channels } => {
            handle_set_fir_convolver_command(dsp_ctx, ir_data, channels);
        }
        AudioCommand::ClearFirConvolver => {
            dsp_ctx.clear_fir_convolver();
        }
        AudioCommand::SetNoiseShaperCurve { curve } => {
            *shared_state.noise_shaper_curve.write() = curve;
            log::info!("Noise shaper curve set to {:?} (lock-free path)", curve);
        }
        AudioCommand::LoadComplete { generation, result } => {
            handle_load_complete_command(
                shared_state,
                loudness_state,
                eq_params,
                saturation_params,
                crossfeed_params,
                limiter_params,
                volume_params,
                noise_shaper_params,
                dynamic_loudness_params,
                dynamic_loudness_telemetry,
                target_lufs,
                generation,
                result,
            );
        }
        AudioCommand::LoadError {
            generation,
            message,
        } => {
            handle_load_error_command(shared_state, generation, message);
        }
        AudioCommand::Shutdown => return true,
    }

    false
}

fn handle_pause_command(stream: &mut Option<Stream>, shared_state: &Arc<SharedState>) {
    if let Some(ref s) = stream {
        let _ = s.pause();
    }
    shared_state.state.store(PlayerState::Paused);
}

fn handle_seek_command(shared_state: &Arc<SharedState>, time: f64) {
    let new_pos = seek_frame_for_time(shared_state, time);
    shared_state
        .position_frames
        .store(new_pos, Ordering::Relaxed);
}

fn seek_frame_for_time(shared_state: &Arc<SharedState>, time: f64) -> u64 {
    let sr = shared_state.sample_rate.load(Ordering::Relaxed) as f64;
    let total = shared_state.total_frames.load(Ordering::Relaxed);
    ((time * sr) as u64).min(total)
}

fn handle_stop_command(stream: &mut Option<Stream>, shared_state: &Arc<SharedState>) {
    *stream = None;
    shared_state.position_frames.store(0, Ordering::Relaxed);
    shared_state.state.store(PlayerState::Stopped);
}

fn handle_stop_for_load_command(stream: &mut Option<Stream>, shared_state: &Arc<SharedState>) {
    *stream = None;
    shared_state.position_frames.store(0, Ordering::Relaxed);
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
    loudness_state: &Arc<AtomicLoudnessState>,
    eq_params: &Arc<AtomicEqParams>,
    saturation_params: &Arc<AtomicSaturationParams>,
    crossfeed_params: &Arc<AtomicCrossfeedParams>,
    limiter_params: &Arc<AtomicPeakLimiterParams>,
    volume_params: &Arc<AtomicVolumeParams>,
    noise_shaper_params: &Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: &Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    target_lufs: f64,
    generation: u64,
    result: crate::player::state::LoadResult,
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
        loudness_state,
        eq_params,
        saturation_params,
        crossfeed_params,
        limiter_params,
        volume_params,
        noise_shaper_params,
        dynamic_loudness_params,
        dynamic_loudness_telemetry,
        target_lufs,
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

#[allow(clippy::too_many_arguments)]
fn apply_loaded_track_result(
    shared_state: &Arc<SharedState>,
    loudness_state: &Arc<AtomicLoudnessState>,
    eq_params: &Arc<AtomicEqParams>,
    saturation_params: &Arc<AtomicSaturationParams>,
    crossfeed_params: &Arc<AtomicCrossfeedParams>,
    limiter_params: &Arc<AtomicPeakLimiterParams>,
    volume_params: &Arc<AtomicVolumeParams>,
    noise_shaper_params: &Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: &Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    target_lufs: f64,
    result: crate::player::state::LoadResult,
) {
    while shared_state.pending_dsp_chain.pop().is_some() {}
    let rebuilt_chain = LockfreeDspContext::build_dsp_chain(
        result.channels,
        result.sample_rate as f64,
        Arc::clone(eq_params),
        Arc::clone(saturation_params),
        Arc::clone(crossfeed_params),
        Arc::clone(limiter_params),
        Arc::clone(volume_params),
        Arc::clone(noise_shaper_params),
        Arc::clone(dynamic_loudness_params),
        Arc::clone(dynamic_loudness_telemetry),
    );
    let _ = shared_state.pending_dsp_chain.push(rebuilt_chain);

    shared_state
        .sample_rate
        .store(result.sample_rate as u64, Ordering::Relaxed);
    shared_state
        .channels
        .store(result.channels as u64, Ordering::Relaxed);
    shared_state
        .total_frames
        .store(result.total_frames, Ordering::Relaxed);
    shared_state.position_frames.store(0, Ordering::Relaxed);
    if shared_state.state.load() == PlayerState::Playing {
        // Keep Playing - autoplay will start the stream.
    } else if shared_state.state.load() == PlayerState::Paused {
        // User paused during loading - stay paused.
    } else {
        shared_state.state.store(PlayerState::Stopped);
    }

    let channels = result.channels;
    let sr_u32 = result.sample_rate;
    let metadata = result.metadata;
    let file_path = result.file_path;
    let samples_arc = Arc::new(result.samples);

    shared_state.audio_buffer.store(Arc::clone(&samples_arc));
    *shared_state.file_path.write() = Some(file_path.clone());
    *shared_state.track_metadata.write() = metadata.clone();
    *shared_state.current_track_path.write() = Some(file_path);
    shared_state
        .dsp_needs_rebuild
        .store(true, Ordering::Release);

    loudness_state.set_smoothing(200.0, sr_u32);

    let preamp = loudness_state.preamp_gain_db.load(Ordering::Relaxed);
    let calc_safe_gain = |rg_gain_db: f64, peak: Option<f64>, preamp_db: f64| -> f64 {
        let requested_gain = rg_gain_db + preamp_db;
        if requested_gain <= 0.0 {
            return requested_gain;
        }

        if let Some(peak_val) = peak {
            if peak_val > 0.0 {
                let max_linear = AUDIO_HEADROOM / peak_val;
                let max_gain_db = 20.0 * max_linear.log10();
                if requested_gain > max_gain_db {
                    log::info!(
                        "Peak protection: peak={:.4}, requested={:.2} dB, limited to {:.2} dB",
                        peak_val,
                        requested_gain,
                        max_gain_db
                    );
                    return max_gain_db;
                }
            }
        }

        requested_gain
    };

    match loudness_state.get_mode() {
        crate::config::NormalizationMode::ReplayGainTrack => {
            if let Some(rg_gain) = metadata.rg_track_gain {
                let peak = metadata.rg_track_peak;
                let effective_gain = calc_safe_gain(rg_gain, peak, preamp);
                loudness_state.set_target_gain(effective_gain);
                log::info!(
                    "ReplayGain Track: {:.2} dB + preamp {:.2} dB -> {:.2} dB (peak: {:?})",
                    rg_gain,
                    preamp,
                    effective_gain,
                    peak
                );
            } else {
                log::warn!("No ReplayGain track gain found, falling back to EBU R128 analysis");
                let mut meter = crate::processor::LoudnessMeter::new(channels, sr_u32);
                meter.process(&samples_arc);
                let loudness = meter.integrated_loudness();
                if loudness.is_finite() {
                    let gain = target_lufs - loudness + preamp;
                    loudness_state.set_target_gain(gain);
                    log::info!(
                        "EBU R128 fallback: {:.2} LUFS -> gain {:.2} dB (target: {:.2} LUFS)",
                        loudness,
                        gain,
                        target_lufs
                    );
                } else {
                    loudness_state.set_target_gain(preamp);
                    log::warn!(
                        "EBU R128 analysis failed, using preamp only: {:.2} dB",
                        preamp
                    );
                }
            }
        }
        crate::config::NormalizationMode::ReplayGainAlbum => {
            let rg_gain = metadata.rg_album_gain.or(metadata.rg_track_gain);
            let peak = metadata.rg_album_peak.or(metadata.rg_track_peak);
            if let Some(gain) = rg_gain {
                let effective_gain = calc_safe_gain(gain, peak, preamp);
                loudness_state.set_target_gain(effective_gain);
                log::info!(
                    "ReplayGain Album: {:.2} dB + preamp {:.2} dB -> {:.2} dB (peak: {:?})",
                    gain,
                    preamp,
                    effective_gain,
                    peak
                );
            } else {
                log::warn!("No ReplayGain gain found, falling back to EBU R128 analysis");
                let mut meter = crate::processor::LoudnessMeter::new(channels, sr_u32);
                meter.process(&samples_arc);
                let loudness = meter.integrated_loudness();
                if loudness.is_finite() {
                    let gain = target_lufs - loudness + preamp;
                    loudness_state.set_target_gain(gain);
                    log::info!(
                        "EBU R128 fallback: {:.2} LUFS -> gain {:.2} dB (target: {:.2} LUFS)",
                        loudness,
                        gain,
                        target_lufs
                    );
                } else {
                    loudness_state.set_target_gain(preamp);
                }
            }
        }
        _ => {}
    }

    shared_state
        .event_flags
        .fetch_or(EVENT_LOAD_COMPLETE | EVENT_TRACK_CHANGED, Ordering::Release);
    log::debug!("DSP context updated for {} Hz sample rate", sr_u32);
}

fn resume_paused_stream(stream: &Option<Stream>, shared_state: &SharedState) -> bool {
    if shared_state.state.load() != PlayerState::Paused {
        return false;
    }

    if let Some(s) = stream {
        let _ = s.play();
        shared_state.state.store(PlayerState::Playing);
        shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
        return true;
    }

    // If no stream exists (e.g. destroyed by StopForLoad while loading), the Play
    // command must continue into normal stream creation.
    false
}

#[allow(clippy::too_many_arguments)]
fn handle_play_command(
    cmd_rx: &Receiver<AudioCommand>,
    stream: &mut Option<Stream>,
    owned_dsp_chain: &mut Option<crate::processor::DspChain>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    eq_params: &Arc<AtomicEqParams>,
    saturation_params: &Arc<AtomicSaturationParams>,
    crossfeed_params: &Arc<AtomicCrossfeedParams>,
    limiter_params: &Arc<AtomicPeakLimiterParams>,
    volume_params: &Arc<AtomicVolumeParams>,
    noise_shaper_params: &Arc<AtomicNoiseShaperParams>,
    dynamic_loudness_params: &Arc<AtomicDynamicLoudnessParams>,
    dynamic_loudness_telemetry: &Arc<AtomicDynamicLoudnessTelemetry>,
    loudness_state: &Arc<AtomicLoudnessState>,
    noise_shaper_bits: u32,
    spectrum_tx: &Sender<f64>,
    phase_response: PhaseResponse,
    target_lufs: f64,
) -> bool {
    log::info!("Received Play command");
    if resume_paused_stream(stream, shared_state) {
        return false;
    }

    let use_exclusive = shared_state.exclusive_mode.load(Ordering::Relaxed);

    #[cfg(windows)]
    if use_exclusive {
        match handle_wasapi_exclusive(
            cmd_rx,
            shared_state,
            dsp_ctx,
            loudness_state,
            spectrum_tx,
            target_lufs,
            dynamic_loudness_telemetry,
        ) {
            WasapiPlaybackOutcome::Handled => return false,
            WasapiPlaybackOutcome::Fallback => {}
            WasapiPlaybackOutcome::ShutdownThread => return true,
        }
    }

    let Some(output_plan) = prepare_playback_output(shared_state, use_exclusive) else {
        return false;
    };

    let stream_context = OutputStreamContext {
        shared_state,
        dsp_ctx,
        loudness_state,
        spectrum_tx,
    };
    let dsp_params = DspParamRefs {
        eq_params,
        saturation_params,
        crossfeed_params,
        limiter_params,
        volume_params,
        noise_shaper_params,
        dynamic_loudness_params,
        dynamic_loudness_telemetry,
    };

    match build_requested_output_stream(
        &output_plan,
        owned_dsp_chain,
        &stream_context,
        &dsp_params,
        phase_response,
    ) {
        Ok(s) => {
            activate_started_stream(stream, s, shared_state);
            let detected_bits = detect_output_bits(&output_plan.device, noise_shaper_bits);

            shared_state
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
                phase_response,
            ) {
                Ok(s) => {
                    activate_started_stream(stream, s, shared_state);
                    let detected_bits = detect_output_bits(&output_plan.device, noise_shaper_bits);
                    shared_state
                        .output_bits
                        .store(detected_bits, Ordering::Relaxed);

                    log::info!(
                        "Stream started with device default config, {}-bit output",
                        detected_bits
                    );
                }
                Err(e2) => {
                    log::error!("Failed to start stream even with device default: {}", e2);
                    shared_state.state.store(PlayerState::Stopped);
                }
            }
        }
    }

    false
}

fn prepare_playback_output(
    shared_state: &Arc<SharedState>,
    use_exclusive: bool,
) -> Option<PlaybackOutputPlan> {
    let host = cpal::default_host();
    let device = match select_output_device(&host, requested_output_device_id(shared_state)) {
        Some(d) => {
            let name = d.name().unwrap_or_else(|_| "Unknown".to_string());
            log::info!("Using audio device: {}", name);
            d
        }
        None => {
            log::error!("Failed to play: No audio output device found");
            shared_state.state.store(PlayerState::Stopped);
            return None;
        }
    };

    let requested_sample_rate = shared_state.sample_rate.load(Ordering::Relaxed) as u32;
    let channels = shared_state.channels.load(Ordering::Relaxed) as u16;

    if channels == 0 {
        log::error!("Failed to play: Invalid channel count (0)");
        shared_state.state.store(PlayerState::Stopped);
        return None;
    }

    let (actual_sample_rate, buffer_size) =
        negotiate_output_config(&device, requested_sample_rate, channels, use_exclusive);

    log::info!(
        "Opening stream: {} Hz (requested {}), {} channels, exclusive={}",
        actual_sample_rate,
        requested_sample_rate,
        channels,
        use_exclusive
    );

    Some(PlaybackOutputPlan {
        device,
        requested_sample_rate,
        actual_sample_rate,
        channels,
        config: StreamConfig {
            channels,
            sample_rate: cpal::SampleRate(actual_sample_rate),
            buffer_size,
        },
    })
}

fn build_requested_output_stream(
    output_plan: &PlaybackOutputPlan,
    owned_dsp_chain: &mut Option<crate::processor::DspChain>,
    context: &OutputStreamContext<'_>,
    dsp_params: &DspParamRefs<'_>,
    phase_response: PhaseResponse,
) -> Result<Stream, String> {
    let dsp_chain = owned_dsp_chain.take().unwrap_or_else(|| {
        build_dsp_chain(
            output_plan.channels as usize,
            output_plan.requested_sample_rate as f64,
            dsp_params,
        )
    });

    log::info!("Building output stream...");
    build_output_stream_with_callback(
        &output_plan.device,
        &output_plan.config,
        output_plan.channels as usize,
        output_plan.requested_sample_rate,
        output_plan.actual_sample_rate,
        phase_response,
        dsp_chain,
        context,
    )
}

fn build_fallback_output_stream(
    output_plan: &PlaybackOutputPlan,
    context: &OutputStreamContext<'_>,
    dsp_params: &DspParamRefs<'_>,
    phase_response: PhaseResponse,
) -> Result<Stream, String> {
    let fallback_config: StreamConfig = output_plan
        .device
        .default_output_config()
        .map_err(|e| format!("Cannot get device default config: {}", e))?
        .into();
    let fallback_sample_rate = fallback_config.sample_rate.0;
    let fallback_channels = fallback_config.channels as usize;
    let fallback_chain =
        build_dsp_chain(fallback_channels, fallback_sample_rate as f64, dsp_params);

    build_output_stream_with_callback(
        &output_plan.device,
        &fallback_config,
        fallback_channels,
        output_plan.requested_sample_rate,
        fallback_sample_rate,
        phase_response,
        fallback_chain,
        context,
    )
}

fn build_dsp_chain(
    channels: usize,
    sample_rate: f64,
    params: &DspParamRefs<'_>,
) -> crate::processor::DspChain {
    LockfreeDspContext::build_dsp_chain(
        channels,
        sample_rate,
        Arc::clone(params.eq_params),
        Arc::clone(params.saturation_params),
        Arc::clone(params.crossfeed_params),
        Arc::clone(params.limiter_params),
        Arc::clone(params.volume_params),
        Arc::clone(params.noise_shaper_params),
        Arc::clone(params.dynamic_loudness_params),
        Arc::clone(params.dynamic_loudness_telemetry),
    )
}

#[allow(clippy::too_many_arguments)]
fn build_output_stream_with_callback(
    device: &Device,
    config: &StreamConfig,
    channels: usize,
    source_sample_rate: u32,
    output_sample_rate: u32,
    phase_response: PhaseResponse,
    mut dsp_chain: crate::processor::DspChain,
    context: &OutputStreamContext<'_>,
) -> Result<Stream, String> {
    let mut resampler = if output_sample_rate != source_sample_rate {
        Some(
            StreamingResampler::with_phase(
                channels,
                source_sample_rate,
                output_sample_rate,
                phase_response,
            )
            .map_err(|e| format!("Failed to create resampler: {}", e))?,
        )
    } else {
        None
    };

    let cb_shared = Arc::clone(context.shared_state);
    let cb_convolver = Arc::clone(&context.dsp_ctx.merged_convolver);
    let cb_loudness_state = Arc::clone(context.loudness_state);
    let cb_spectrum_tx = context.spectrum_tx.clone();
    let mut process_buffer = Vec::with_capacity(AUDIO_PROCESS_BUFFER_FRAMES * channels);
    process_buffer.resize(AUDIO_PROCESS_BUFFER_FRAMES * channels, 0.0);
    let mut resample_leftover = Vec::with_capacity(AUDIO_RESAMPLE_BUFFER_FRAMES * channels);
    let mut resample_leftover_pos = 0usize;
    let mut resample_output = Vec::with_capacity(AUDIO_RESAMPLE_BUFFER_FRAMES * channels);
    let mut owned_convolver: Option<crate::processor::FFTConvolver> = None;
    let mut convolver_output = Vec::with_capacity(AUDIO_PROCESS_BUFFER_FRAMES * channels);

    device
        .build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                #[cfg(debug_assertions)]
                assert_no_alloc(|| {
                    audio_callback_lockfree(
                        data,
                        &cb_shared,
                        &mut dsp_chain,
                        &mut owned_convolver,
                        &cb_convolver,
                        &cb_loudness_state,
                        &cb_spectrum_tx,
                        channels,
                        &mut process_buffer,
                        &mut resampler,
                        &mut resample_leftover,
                        &mut resample_leftover_pos,
                        &mut resample_output,
                        &mut convolver_output,
                    );
                });

                #[cfg(not(debug_assertions))]
                audio_callback_lockfree(
                    data,
                    &cb_shared,
                    &mut dsp_chain,
                    &mut owned_convolver,
                    &cb_convolver,
                    &cb_loudness_state,
                    &cb_spectrum_tx,
                    channels,
                    &mut process_buffer,
                    &mut resampler,
                    &mut resample_leftover,
                    &mut resample_leftover_pos,
                    &mut resample_output,
                    &mut convolver_output,
                );
            },
            |err| log::error!("Stream error: {}", err),
            None,
        )
        .map_err(|e| e.to_string())
}

fn requested_output_device_id(shared_state: &SharedState) -> Option<usize> {
    let device_id_value = shared_state.device_id.load(Ordering::Relaxed);
    (device_id_value >= 0).then_some(device_id_value as usize)
}

fn select_output_device(host: &Host, requested_device_id: Option<usize>) -> Option<Device> {
    if let Some(id) = requested_device_id {
        log::info!("Attempting to select device by ID: {}", id);
        return host
            .output_devices()
            .ok()
            .and_then(|mut devices| devices.nth(id))
            .or_else(|| {
                log::warn!("Device ID {} not found, falling back to default", id);
                host.default_output_device()
            });
    }

    host.default_output_device()
}

fn negotiate_output_config(
    device: &Device,
    requested_sample_rate: u32,
    channels: u16,
    use_exclusive: bool,
) -> (u32, cpal::BufferSize) {
    match device.supported_output_configs() {
        Ok(configs) => {
            let configs: Vec<_> = configs.collect();
            log::info!("Device supports {} output configurations", configs.len());

            let mut best_rate = None;
            let mut max_supported_rate = 0u32;

            for config in &configs {
                let min_rate = config.min_sample_rate().0;
                let max_rate = config.max_sample_rate().0;
                log::debug!(
                    "  Config: {} ch, {}-{} Hz",
                    config.channels(),
                    min_rate,
                    max_rate
                );

                if config.channels() != channels {
                    continue;
                }

                if max_rate > max_supported_rate {
                    max_supported_rate = max_rate;
                }

                if requested_sample_rate >= min_rate && requested_sample_rate <= max_rate {
                    best_rate = Some(requested_sample_rate);
                    break;
                }

                if best_rate.is_none() {
                    for multiplier in [2u32, 4u32] {
                        if let Some(candidate) = requested_sample_rate.checked_mul(multiplier) {
                            if candidate >= min_rate
                                && candidate <= max_rate
                                && candidate <= MAX_DAC_RATE
                            {
                                best_rate = Some(candidate);
                                log::debug!(
                                    "Found same-family rate: {} Hz ({}x requested)",
                                    candidate,
                                    multiplier
                                );
                                break;
                            }
                        }
                    }
                }
            }

            let final_rate = best_rate.unwrap_or_else(|| {
                if max_supported_rate > 0 {
                    log::warn!(
                        "Requested {} Hz not supported, using device max {} Hz",
                        requested_sample_rate,
                        max_supported_rate
                    );
                    max_supported_rate
                } else {
                    device
                        .default_output_config()
                        .map(|c| c.sample_rate().0)
                        .unwrap_or(48000)
                }
            });

            let buffer_size = if use_exclusive && best_rate.is_some() {
                cpal::BufferSize::Fixed(512)
            } else {
                cpal::BufferSize::Default
            };

            (final_rate, buffer_size)
        }
        Err(e) => {
            log::warn!("Failed to query device configs: {}. Using default.", e);
            let rate = device
                .default_output_config()
                .map(|c| c.sample_rate().0)
                .unwrap_or(48000);
            (rate, cpal::BufferSize::Default)
        }
    }
}

fn activate_started_stream(
    stream_slot: &mut Option<Stream>,
    started_stream: Stream,
    shared_state: &SharedState,
) {
    let _ = started_stream.play();
    *stream_slot = Some(started_stream);

    // Only transition to Playing if the user has not paused during stream
    // creation. If paused, pause the stream immediately and skip STARTED.
    if shared_state.state.load() == PlayerState::Paused {
        if let Some(stream) = stream_slot {
            let _ = stream.pause();
        }
        return;
    }

    shared_state.state.store(PlayerState::Playing);
    shared_state
        .event_flags
        .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
}

fn detect_output_bits(device: &Device, fallback_bits: u32) -> u32 {
    match device.default_output_config() {
        Ok(cfg) => match cfg.sample_format() {
            cpal::SampleFormat::I16 => 16,
            cpal::SampleFormat::I32 => 24,
            cpal::SampleFormat::F32 => 24,
            _ => fallback_bits.max(16),
        },
        Err(_) => fallback_bits.max(16),
    }
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn handle_wasapi_exclusive(
    cmd_rx: &Receiver<AudioCommand>,
    shared_state: &Arc<SharedState>,
    dsp_ctx: &Arc<LockfreeDspContext>,
    loudness_state: &Arc<AtomicLoudnessState>,
    spectrum_tx: &Sender<f64>,
    target_lufs: f64,
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

    let cb_shared = Arc::clone(shared_state);
    let cb_convolver = Arc::clone(&dsp_ctx.merged_convolver);
    let cb_loudness_state = Arc::clone(loudness_state);
    let cb_spectrum_tx = spectrum_tx.clone();

    let mut process_buffer = Vec::with_capacity(AUDIO_PROCESS_BUFFER_FRAMES * channels);
    process_buffer.resize(AUDIO_PROCESS_BUFFER_FRAMES * channels, 0.0);

    // Build a DspChain owned by the WASAPI callback
    let (_, wasapi_chain) = LockfreeDspContext::new(
        channels,
        sample_rate as f64,
        Arc::clone(&dsp_ctx.eq_params),
        Arc::clone(&dsp_ctx.saturation_params),
        Arc::clone(&dsp_ctx.crossfeed_params),
        Arc::clone(&dsp_ctx.limiter_params),
        Arc::clone(&dsp_ctx.volume_params),
        Arc::clone(&dsp_ctx.noise_shaper_params),
        Arc::clone(&dsp_ctx.dynamic_loudness_params),
        Arc::new(crate::processor::AtomicDynamicLoudnessTelemetry::new()),
    );
    let mut wasapi_dsp_chain = wasapi_chain;

    let mut unused_resampler = None;
    let mut unused_leftover = Vec::new();
    let mut unused_leftover_pos = 0usize;
    let mut unused_output = Vec::new();
    let mut wasapi_owned_convolver: Option<crate::processor::FFTConvolver> = None;
    let mut wasapi_convolver_output = Vec::with_capacity(AUDIO_PROCESS_BUFFER_FRAMES * channels);

    let dsp_callback = Box::new(move |data: &mut [f32], cb_channels: usize| -> bool {
        audio_callback_lockfree(
            data,
            &cb_shared,
            &mut wasapi_dsp_chain,
            &mut wasapi_owned_convolver,
            &cb_convolver,
            &cb_loudness_state,
            &cb_spectrum_tx,
            cb_channels,
            &mut process_buffer,
            &mut unused_resampler,
            &mut unused_leftover,
            &mut unused_leftover_pos,
            &mut unused_output,
            &mut wasapi_convolver_output,
        );

        cb_shared.state.load() == PlayerState::Stopped
    });

    let device_id_value = shared_state.device_id.load(Ordering::Relaxed);
    let wasapi_device_id = if device_id_value >= 0 {
        Some(device_id_value as usize)
    } else {
        None
    };

    match WasapiExclusivePlayer::new(wasapi_device_id, sample_rate, channels, dsp_callback) {
        Ok(wasapi_player) => {
            if let Err(e) = wasapi_player.play() {
                log::error!("Failed to start WASAPI playback: {}", e);
                shared_state.state.store(PlayerState::Stopped);
                return WasapiPlaybackOutcome::Handled;
            }

            if shared_state.state.load() == PlayerState::Paused {
                let _ = wasapi_player.pause();
            } else {
                shared_state.state.store(PlayerState::Playing);
                shared_state
                    .event_flags
                    .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
            }

            let mut wait_count = 0;
            while wasapi_player.get_state() == WasapiState::Stopped && wait_count < 300 {
                std::thread::sleep(std::time::Duration::from_millis(10));
                wait_count += 1;
            }

            if wasapi_player.get_state() == WasapiState::Stopped {
                log::error!("WASAPI: Failed to start playback after waiting");
                shared_state.state.store(PlayerState::Stopped);
                return WasapiPlaybackOutcome::Handled;
            }

            log::info!("WASAPI: Playback started, entering monitoring loop");
            let command_context = WasapiCommandContext {
                shared_state,
                dsp_ctx,
                loudness_state,
                dynamic_loudness_telemetry,
                target_lufs,
            };

            loop {
                if let Ok(cmd) = cmd_rx.try_recv() {
                    match handle_wasapi_command(cmd, &wasapi_player, &command_context) {
                        WasapiCommandOutcome::Continue => {}
                        WasapiCommandOutcome::StopPlayback => break,
                        WasapiCommandOutcome::ShutdownThread => {
                            return WasapiPlaybackOutcome::ShutdownThread;
                        }
                    }
                }

                if shared_state.state.load() == PlayerState::Stopped {
                    log::info!("WASAPI playback finished");
                    let _ = wasapi_player.stop();
                    break;
                }

                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            WasapiPlaybackOutcome::Handled
        }
        Err(e) => {
            log::error!(
                "Failed to create WASAPI player: {}. Falling back to cpal.",
                e
            );
            WasapiPlaybackOutcome::Fallback
        }
    }
}

#[cfg(windows)]
fn handle_wasapi_command(
    command: AudioCommand,
    wasapi_player: &WasapiExclusivePlayer,
    context: &WasapiCommandContext<'_>,
) -> WasapiCommandOutcome {
    match command {
        AudioCommand::Pause => {
            let _ = wasapi_player.pause();
            context.shared_state.state.store(PlayerState::Paused);
        }
        AudioCommand::Play => {
            if context.shared_state.state.load() == PlayerState::Paused {
                let _ = wasapi_player.play();
                context.shared_state.state.store(PlayerState::Playing);
                context
                    .shared_state
                    .event_flags
                    .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
            }
        }
        AudioCommand::Seek(time) => {
            let frame = seek_frame_for_time(context.shared_state, time);
            context
                .shared_state
                .position_frames
                .store(frame, Ordering::Relaxed);
            let _ = wasapi_player.seek(frame);
        }
        AudioCommand::Stop => {
            let _ = wasapi_player.stop();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            context.shared_state.state.store(PlayerState::Stopped);
            return WasapiCommandOutcome::StopPlayback;
        }
        AudioCommand::StopForLoad => {
            let _ = wasapi_player.stop();
            context
                .shared_state
                .position_frames
                .store(0, Ordering::Relaxed);
            return WasapiCommandOutcome::StopPlayback;
        }
        AudioCommand::SetExternalIrConvolver { ir_data, channels } => {
            handle_set_external_ir_convolver_command(context.dsp_ctx, ir_data, channels);
        }
        AudioCommand::ClearExternalIrConvolver => {
            context.dsp_ctx.clear_external_ir_convolver();
        }
        AudioCommand::SetFirConvolver { ir_data, channels } => {
            handle_set_fir_convolver_command(context.dsp_ctx, ir_data, channels);
        }
        AudioCommand::ClearFirConvolver => {
            context.dsp_ctx.clear_fir_convolver();
        }
        AudioCommand::SetNoiseShaperCurve { curve } => {
            *context.shared_state.noise_shaper_curve.write() = curve;
            log::info!("Noise shaper curve set to {:?} (WASAPI path)", curve);
        }
        AudioCommand::LoadComplete { generation, result } => {
            handle_load_complete_command(
                context.shared_state,
                context.loudness_state,
                &context.dsp_ctx.eq_params,
                &context.dsp_ctx.saturation_params,
                &context.dsp_ctx.crossfeed_params,
                &context.dsp_ctx.limiter_params,
                &context.dsp_ctx.volume_params,
                &context.dsp_ctx.noise_shaper_params,
                &context.dsp_ctx.dynamic_loudness_params,
                context.dynamic_loudness_telemetry,
                context.target_lufs,
                generation,
                result,
            );
        }
        AudioCommand::LoadError {
            generation,
            message,
        } => {
            handle_load_error_command(context.shared_state, generation, message);
        }
        AudioCommand::Shutdown => {
            let _ = wasapi_player.stop();
            context.shared_state.state.store(PlayerState::Stopped);
            return WasapiCommandOutcome::ShutdownThread;
        }
    }

    WasapiCommandOutcome::Continue
}
