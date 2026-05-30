//! CPAL output stream lifecycle.
//!
//! Keeps device selection, output config negotiation, stream construction, and
//! stream activation out of the audio command loop.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, Host, Stream, StreamConfig};
use crossbeam::channel::Sender;

#[cfg(debug_assertions)]
use assert_no_alloc::assert_no_alloc;

use super::callback::{audio_callback_lockfree, CallbackScratch, LockfreeDspContext};
use super::spectrum::SpectrumBatch;
use super::state::{PlayerState, SharedState, EVENT_PLAYBACK_STARTED};
use crate::config::{PhaseResponse, ResampleQuality};
use crate::processor::{
    AtomicCrossfeedParams, AtomicDynamicLoudnessParams, AtomicDynamicLoudnessTelemetry,
    AtomicEqParams, AtomicLoudnessState, AtomicNoiseShaperParams, AtomicPeakLimiterParams,
    AtomicSaturationParams, AtomicVolumeParams, NoiseShaperProcessor, StreamingResampler,
};

const MAX_DAC_RATE: u32 = 384000;
pub(super) struct PlaybackOutputPlan {
    pub device: Device,
    pub requested_sample_rate: u32,
    pub actual_sample_rate: u32,
    pub channels: u16,
    pub config: StreamConfig,
}

pub(super) struct OutputStreamContext<'a> {
    pub shared_state: &'a Arc<SharedState>,
    pub dsp_ctx: &'a Arc<LockfreeDspContext>,
    pub loudness_state: &'a Arc<AtomicLoudnessState>,
    pub spectrum_tx: &'a Sender<SpectrumBatch>,
}

#[derive(Clone, Copy)]
pub(super) struct DspParamRefs<'a> {
    pub eq_params: &'a Arc<AtomicEqParams>,
    pub saturation_params: &'a Arc<AtomicSaturationParams>,
    pub crossfeed_params: &'a Arc<AtomicCrossfeedParams>,
    pub limiter_params: &'a Arc<AtomicPeakLimiterParams>,
    pub volume_params: &'a Arc<AtomicVolumeParams>,
    pub noise_shaper_params: &'a Arc<AtomicNoiseShaperParams>,
    pub dynamic_loudness_params: &'a Arc<AtomicDynamicLoudnessParams>,
    pub dynamic_loudness_telemetry: &'a Arc<AtomicDynamicLoudnessTelemetry>,
}

#[derive(Clone, Copy)]
pub(super) struct ResamplerConfig {
    pub phase_response: PhaseResponse,
    pub quality: ResampleQuality,
}

pub(super) fn prepare_playback_output(
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

pub(super) fn build_requested_output_stream(
    output_plan: &PlaybackOutputPlan,
    owned_dsp_chain: &mut Option<crate::processor::DspChain>,
    context: &OutputStreamContext<'_>,
    dsp_params: &DspParamRefs<'_>,
    resampler_config: ResamplerConfig,
) -> Result<Stream, String> {
    let dsp_chain = owned_dsp_chain.take().unwrap_or_else(|| {
        build_dsp_chain(
            output_plan.channels as usize,
            output_plan.requested_sample_rate as f64,
            context,
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
        resampler_config,
        dsp_chain,
        context,
    )
}

pub(super) fn build_fallback_output_stream(
    output_plan: &PlaybackOutputPlan,
    context: &OutputStreamContext<'_>,
    dsp_params: &DspParamRefs<'_>,
    resampler_config: ResamplerConfig,
) -> Result<Stream, String> {
    let fallback_config: StreamConfig = output_plan
        .device
        .default_output_config()
        .map_err(|e| format!("Cannot get device default config: {}", e))?
        .into();
    let fallback_sample_rate = fallback_config.sample_rate.0;
    let fallback_channels = fallback_config.channels as usize;
    let fallback_chain = build_dsp_chain(
        fallback_channels,
        fallback_sample_rate as f64,
        context,
        dsp_params,
    );

    build_output_stream_with_callback(
        &output_plan.device,
        &fallback_config,
        fallback_channels,
        output_plan.requested_sample_rate,
        fallback_sample_rate,
        resampler_config,
        fallback_chain,
        context,
    )
}

fn build_dsp_chain(
    channels: usize,
    sample_rate: f64,
    context: &OutputStreamContext<'_>,
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
        Arc::clone(&context.dsp_ctx.merged_convolver),
        Arc::clone(&context.dsp_ctx.merged_convolver_enabled),
    )
}

#[allow(clippy::too_many_arguments)]
fn build_output_stream_with_callback(
    device: &Device,
    config: &StreamConfig,
    channels: usize,
    source_sample_rate: u32,
    output_sample_rate: u32,
    resampler_config: ResamplerConfig,
    mut dsp_chain: crate::processor::DspChain,
    context: &OutputStreamContext<'_>,
) -> Result<Stream, String> {
    let mut resampler = if output_sample_rate != source_sample_rate {
        Some(
            StreamingResampler::with_quality(
                channels,
                source_sample_rate,
                output_sample_rate,
                resampler_config.phase_response,
                resampler_config.quality,
            )
            .map_err(|e| format!("Failed to create resampler: {}", e))?,
        )
    } else {
        None
    };

    let cb_shared = Arc::clone(context.shared_state);
    let cb_loudness_state = Arc::clone(context.loudness_state);
    let cb_spectrum_tx = context.spectrum_tx.clone();
    let mut scratch = CallbackScratch::new(channels);
    let mut final_noise_shaper = NoiseShaperProcessor::new(
        channels,
        output_sample_rate,
        Arc::clone(context.dsp_ctx.noise_shaper_params()),
    );

    device
        .build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                crate::runtime::audio_thread_init();
                #[cfg(debug_assertions)]
                debug_assert!(crate::runtime::audio_thread_float_mode_is_enabled());

                #[cfg(debug_assertions)]
                assert_no_alloc(|| {
                    audio_callback_lockfree(
                        data,
                        &cb_shared,
                        &mut dsp_chain,
                        Some(&mut final_noise_shaper),
                        &cb_loudness_state,
                        &cb_spectrum_tx,
                        channels,
                        &mut resampler,
                        &mut scratch,
                    );
                });

                #[cfg(not(debug_assertions))]
                audio_callback_lockfree(
                    data,
                    &cb_shared,
                    &mut dsp_chain,
                    Some(&mut final_noise_shaper),
                    &cb_loudness_state,
                    &cb_spectrum_tx,
                    channels,
                    &mut resampler,
                    &mut scratch,
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

pub(super) fn activate_started_stream(
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

pub(super) fn detect_output_bits(device: &Device, fallback_bits: u32) -> u32 {
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
