//! Async track loading and decode helpers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait};
use crossbeam::channel::Sender;

use super::buffer_budget::{
    decoded_buffer_estimate, ensure_cache_file_fits_budget, ensure_decoded_samples_fit_budget,
    published_decoded_samples, record_budget_rejection, reserve_decoded_buffer_capacity,
    DecodedBufferKind,
};
use super::cache::{
    configured_cache_max_bytes, load_cache_with_header, prune_cache_dir_to_limit,
    save_cache_with_header,
};
use super::state::{
    self, AudioCommand, LoadResult, SharedState, StreamingAudioChunk, StreamingTrackStart,
};
use crate::config::{EngineSettings, ResampleQuality};
use crate::decoder::{DecodeCancelToken, StreamingDecoder};
use crate::processor::{LoudnessDatabase, StreamingResampler};

const STREAMING_CHUNK_FRAMES: usize = 4096;
const STREAMING_START_BUFFER_FRAMES: u64 = 8192;

pub(super) fn cached_loudness_from_db(
    db: Option<&LoudnessDatabase>,
    path: &str,
) -> Option<state::CachedLoudness> {
    let db = db?;
    match db.get_fresh(path) {
        Ok(Some(track)) => {
            let cached = state::CachedLoudness::from_track(&track);
            if cached.is_some() {
                log::info!("Using cached loudness for playback: {}", path);
            }
            cached
        }
        Ok(None) => None,
        Err(e) => {
            log::warn!("Loudness cache lookup failed for '{}': {}", path, e);
            None
        }
    }
}

fn target_sample_rate_for_device(
    original_sr: u32,
    config: &EngineSettings,
    device_id: Option<usize>,
) -> u32 {
    config.target_samplerate.unwrap_or_else(|| {
        let host = cpal::default_host();
        let device = match device_id {
            Some(id) => host.output_devices().ok().and_then(|mut d| d.nth(id)),
            None => host.default_output_device(),
        };
        device
            .and_then(|d| d.default_output_config().ok())
            .map(|c| c.sample_rate().0)
            .unwrap_or(original_sr)
    })
}

fn effective_resample_plan(
    original_sr: u32,
    target_sr: u32,
    config: &EngineSettings,
) -> (u32, bool) {
    let need_resample = target_sr != original_sr;
    if need_resample && !config.preemptive_resample {
        log::info!(
            "preemptive_resample=false: keeping original {} Hz (will resample at playback)",
            original_sr
        );
        (original_sr, false)
    } else {
        (target_sr, need_resample)
    }
}

/// Internal decode function for async loading.
pub(super) fn decode_file_internal(
    path: &str,
    credentials: Option<&crate::decoder::HttpCredentials>,
    config: &EngineSettings,
    device_id: Option<usize>,
    shared_state: &Arc<SharedState>,
    _loudness_enabled: bool,
    load_cancel: &Arc<AtomicBool>,
    loudness_db: Option<Arc<LoudnessDatabase>>,
) -> Result<LoadResult, String> {
    let decode_started_at = std::time::Instant::now();
    shared_state.mark_decode_started();
    let cancel_token = DecodeCancelToken::new(Arc::clone(load_cancel));
    let mut decoder =
        StreamingDecoder::open_with_credentials_and_cancel(path, credentials, Some(cancel_token))
            .map_err(|e| {
            log::error!("Failed to open decoder for {}: {}", path, e);
            e.to_string()
        })?;

    let info = decoder.info.clone();
    let original_sr = info.sample_rate;
    let channels = info.channels;
    let cached_loudness = cached_loudness_from_db(loudness_db.as_deref(), path);

    let target_sr = target_sample_rate_for_device(original_sr, config, device_id);
    let estimated_input_frames = info.total_frames.unwrap_or(0) as usize;
    let (final_target_sr, final_need_resample) =
        effective_resample_plan(original_sr, target_sr, config);

    let cache_path = if config.use_cache && final_need_resample {
        let cache_dir = crate::runtime::RuntimePaths::resolve().cache_dir;
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(path.as_bytes());
        hasher.update(final_target_sr.to_le_bytes());
        let q_byte = match config.resample_quality {
            ResampleQuality::Low => 0,
            ResampleQuality::Standard => 1,
            ResampleQuality::High => 2,
            ResampleQuality::UltraHigh => 3,
        };
        hasher.update([q_byte]);
        hasher.update(estimated_input_frames.to_le_bytes());
        hasher.update([config.phase_response as u8]);

        if !path.starts_with("http://") && !path.starts_with("https://") {
            if let Ok(metadata) = std::fs::metadata(path) {
                hasher.update(metadata.len().to_le_bytes());
                if let Ok(modified) = metadata.modified() {
                    if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                        hasher.update(duration.as_secs().to_le_bytes());
                        hasher.update(duration.subsec_nanos().to_le_bytes());
                    }
                }
            }
        }
        let hash = hex::encode(hasher.finalize());
        Some(cache_dir.join(format!("{}.bin", hash)))
    } else {
        None
    };

    let existing_decoded_samples = published_decoded_samples(shared_state);

    if let Some(ref cp) = cache_path {
        if cp.exists() {
            if let Ok(metadata) = std::fs::metadata(cp) {
                record_budget_rejection(
                    shared_state,
                    ensure_cache_file_fits_budget(
                        DecodedBufferKind::ResampleCache,
                        path,
                        metadata.len(),
                        existing_decoded_samples,
                    ),
                )?;
            }
            if let Some(cached_samples) =
                load_cache_with_header(cp, final_target_sr, channels as u32)
            {
                record_budget_rejection(
                    shared_state,
                    ensure_decoded_samples_fit_budget(
                        DecodedBufferKind::ResampleCache,
                        path,
                        cached_samples.len(),
                        existing_decoded_samples,
                    ),
                )?;
                let total_frames = cached_samples.len() / channels;
                log::info!("Loaded from cache: {} frames", total_frames);
                return Ok(LoadResult {
                    samples: cached_samples,
                    sample_rate: final_target_sr,
                    channels,
                    total_frames: total_frames as u64,
                    file_path: path.to_string(),
                    cached_loudness,
                    metadata: info.metadata,
                });
            } else {
                log::warn!("Cache validation failed, will re-decode");
            }
        }
    }

    if final_need_resample {
        log::info!(
            "Streaming SoX VHQ Resampling {} -> {} Hz",
            original_sr,
            final_target_sr
        );
    }

    let output_sample_capacity = record_budget_rejection(
        shared_state,
        reserve_decoded_buffer_capacity(
            DecodedBufferKind::CurrentTrack,
            path,
            info.total_frames.unwrap_or(0),
            original_sr,
            final_target_sr,
            channels,
            final_need_resample,
            existing_decoded_samples,
        ),
    )?;
    let mut samples = Vec::with_capacity(output_sample_capacity);

    let mut resampler = if final_need_resample {
        match StreamingResampler::with_quality(
            channels,
            original_sr,
            final_target_sr,
            config.phase_response,
            config.resample_quality,
        ) {
            Ok(rs) => Some(rs),
            Err(e) => {
                return Err(format!(
                    "Failed to create resampler: {} -> {}: {}",
                    original_sr, final_target_sr, e
                ));
            }
        }
    } else {
        None
    };

    let total_estimated = estimated_input_frames.max(1);
    let mut chunk_count = 0;
    let mut decoded_frames = 0_u64;
    let mut decoded_chunk = Vec::new();

    while decoder
        .decode_next_into(&mut decoded_chunk)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        if load_cancel.load(Ordering::Acquire) {
            return Err("Load cancelled".to_string());
        }
        decoded_frames += (decoded_chunk.len() / channels) as u64;
        if let Some(ref mut rs) = resampler {
            let chunk_input_frames = (decoded_chunk.len() / channels) as u64;
            let chunk_estimate = record_budget_rejection(
                shared_state,
                decoded_buffer_estimate(
                    chunk_input_frames,
                    original_sr,
                    final_target_sr,
                    channels,
                    true,
                ),
            )?;
            record_budget_rejection(
                shared_state,
                ensure_decoded_samples_fit_budget(
                    DecodedBufferKind::CurrentTrack,
                    path,
                    samples.len().saturating_add(chunk_estimate.samples),
                    existing_decoded_samples,
                ),
            )?;
            rs.process_chunk_append(&decoded_chunk, &mut samples);
        } else {
            record_budget_rejection(
                shared_state,
                ensure_decoded_samples_fit_budget(
                    DecodedBufferKind::CurrentTrack,
                    path,
                    samples.len().saturating_add(decoded_chunk.len()),
                    existing_decoded_samples,
                ),
            )?;
            samples.extend_from_slice(&decoded_chunk);
        }
        record_budget_rejection(
            shared_state,
            ensure_decoded_samples_fit_budget(
                DecodedBufferKind::CurrentTrack,
                path,
                samples.len(),
                existing_decoded_samples,
            ),
        )?;
        decoded_chunk.clear();
        chunk_count += 1;

        let progress = ((decoded_frames as f64 / total_estimated as f64) * 100.0).min(99.0) as u64;
        shared_state
            .load_progress
            .store(progress, Ordering::Relaxed);

        if chunk_count % 100 == 0 {
            log::debug!(
                "Streaming progress: {} chunks, {} decoded frames, {}%",
                chunk_count,
                decoded_frames,
                progress
            );
        }
    }

    if let Some(ref mut rs) = resampler {
        rs.flush_into(&mut samples);
        record_budget_rejection(
            shared_state,
            ensure_decoded_samples_fit_budget(
                DecodedBufferKind::CurrentTrack,
                path,
                samples.len(),
                existing_decoded_samples,
            ),
        )?;
    }

    shared_state.load_progress.store(100, Ordering::Relaxed);
    let decode_duration_ms = decode_started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let throughput = if decode_duration_ms > 0 {
        decoded_frames.saturating_mul(1000) / decode_duration_ms
    } else {
        decoded_frames
    };
    shared_state
        .last_decode_duration_ms
        .store(decode_duration_ms, Ordering::Relaxed);
    shared_state
        .last_decode_input_frames
        .store(decoded_frames, Ordering::Relaxed);
    shared_state
        .last_decode_output_samples
        .store(samples.len() as u64, Ordering::Relaxed);
    shared_state
        .last_decode_chunk_count
        .store(chunk_count, Ordering::Relaxed);
    shared_state
        .last_decode_throughput_frames_per_sec
        .store(throughput, Ordering::Relaxed);
    shared_state.mark_decode_finished();

    log::info!(
        "Streaming decode complete: {} chunks, {} output samples ({}→{} Hz)",
        chunk_count,
        samples.len(),
        original_sr,
        final_target_sr
    );

    if final_need_resample {
        if let Some(ref cp) = cache_path {
            if let Err(e) = save_cache_with_header(cp, &samples, final_target_sr, channels as u32) {
                log::warn!("Failed to save cache: {}", e);
            } else if let Some(cache_dir) = cp.parent() {
                let cache_max_bytes = configured_cache_max_bytes();
                if let Err(e) = prune_cache_dir_to_limit(cache_dir, cache_max_bytes) {
                    log::warn!("Failed to prune resample cache: {}", e);
                }
            }
        }
    }

    let total_frames = samples.len() / channels;

    Ok(LoadResult {
        samples,
        sample_rate: final_target_sr,
        channels,
        total_frames: total_frames as u64,
        file_path: path.to_string(),
        cached_loudness,
        metadata: info.metadata,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn decode_file_streaming_first_buffer(
    path: &str,
    credentials: Option<&crate::decoder::HttpCredentials>,
    config: &EngineSettings,
    device_id: Option<usize>,
    shared_state: &Arc<SharedState>,
    load_cancel: &Arc<AtomicBool>,
    loudness_db: Option<Arc<LoudnessDatabase>>,
    generation: u64,
    cmd_tx: &Sender<AudioCommand>,
    autoplay: bool,
) -> Result<(), String> {
    let decode_started_at = std::time::Instant::now();
    shared_state.mark_decode_started();
    let cancel_token = DecodeCancelToken::new(Arc::clone(load_cancel));
    let mut decoder =
        StreamingDecoder::open_with_credentials_and_cancel(path, credentials, Some(cancel_token))
            .map_err(|e| {
            log::error!("Failed to open decoder for {}: {}", path, e);
            e.to_string()
        })?;

    let info = decoder.info.clone();
    let original_sr = info.sample_rate;
    let channels = info.channels;
    let target_sr = target_sample_rate_for_device(original_sr, config, device_id);
    let (final_target_sr, final_need_resample) =
        effective_resample_plan(original_sr, target_sr, config);
    let cached_loudness = cached_loudness_from_db(loudness_db.as_deref(), path);
    let estimated_input_frames = info.total_frames.unwrap_or(0);
    let estimated_output_frames = if final_need_resample {
        ((estimated_input_frames as f64 * final_target_sr as f64) / original_sr.max(1) as f64)
            .ceil() as u64
    } else {
        estimated_input_frames
    };

    let existing_decoded_samples = published_decoded_samples(shared_state);
    let output_sample_capacity = record_budget_rejection(
        shared_state,
        reserve_decoded_buffer_capacity(
            DecodedBufferKind::CurrentTrack,
            path,
            estimated_input_frames,
            original_sr,
            final_target_sr,
            channels,
            final_need_resample,
            existing_decoded_samples,
        ),
    )?;
    let mut full_samples = Vec::with_capacity(output_sample_capacity);
    let mut pending_samples = Vec::with_capacity(STREAMING_CHUNK_FRAMES * channels);
    let mut decoded_chunk = Vec::new();
    let mut ready_sent = false;
    let mut queued_frames = 0_u64;
    let mut decoded_frames = 0_u64;
    let mut chunk_count = 0_u64;

    let mut resampler = if final_need_resample {
        Some(
            StreamingResampler::with_quality(
                channels,
                original_sr,
                final_target_sr,
                config.phase_response,
                config.resample_quality,
            )
            .map_err(|e| {
                format!(
                    "Failed to create streaming resampler: {} -> {}: {}",
                    original_sr, final_target_sr, e
                )
            })?,
        )
    } else {
        None
    };

    let track = StreamingTrackStart {
        sample_rate: final_target_sr,
        channels,
        total_frames: estimated_output_frames,
        file_path: path.to_string(),
        cached_loudness,
        metadata: info.metadata,
    };

    while decoder
        .decode_next_into(&mut decoded_chunk)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        ensure_streaming_load_current(shared_state, load_cancel, generation)?;

        decoded_frames += (decoded_chunk.len() / channels) as u64;
        let produced_start = full_samples.len();
        if let Some(ref mut rs) = resampler {
            rs.process_chunk_append(&decoded_chunk, &mut full_samples);
        } else {
            full_samples.extend_from_slice(&decoded_chunk);
        }
        pending_samples.extend_from_slice(&full_samples[produced_start..]);

        record_budget_rejection(
            shared_state,
            ensure_decoded_samples_fit_budget(
                DecodedBufferKind::CurrentTrack,
                path,
                full_samples.len(),
                existing_decoded_samples,
            ),
        )?;

        queued_frames += push_ready_streaming_chunks(
            shared_state,
            load_cancel,
            generation,
            channels,
            &mut pending_samples,
            false,
        )?;
        if !ready_sent && queued_frames >= STREAMING_START_BUFFER_FRAMES {
            publish_streaming_ready(shared_state, cmd_tx, generation, &track, autoplay);
            ready_sent = true;
        }

        decoded_chunk.clear();
        chunk_count += 1;
        let total_estimated = estimated_input_frames.max(1);
        let progress = ((decoded_frames as f64 / total_estimated as f64) * 100.0).min(99.0) as u64;
        shared_state
            .load_progress
            .store(progress, Ordering::Relaxed);
    }

    if let Some(ref mut rs) = resampler {
        let produced_start = full_samples.len();
        rs.flush_into(&mut full_samples);
        pending_samples.extend_from_slice(&full_samples[produced_start..]);
    }

    queued_frames += push_ready_streaming_chunks(
        shared_state,
        load_cancel,
        generation,
        channels,
        &mut pending_samples,
        true,
    )?;

    if !ready_sent {
        publish_streaming_ready(shared_state, cmd_tx, generation, &track, autoplay);
    }

    let total_frames = (full_samples.len() / channels) as u64;
    shared_state.load_progress.store(100, Ordering::Relaxed);
    let decode_duration_ms = decode_started_at
        .elapsed()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64;
    let throughput = if decode_duration_ms > 0 {
        decoded_frames.saturating_mul(1000) / decode_duration_ms
    } else {
        decoded_frames
    };
    shared_state
        .last_decode_duration_ms
        .store(decode_duration_ms, Ordering::Relaxed);
    shared_state
        .last_decode_input_frames
        .store(decoded_frames, Ordering::Relaxed);
    shared_state
        .last_decode_output_samples
        .store(full_samples.len() as u64, Ordering::Relaxed);
    shared_state
        .last_decode_chunk_count
        .store(chunk_count, Ordering::Relaxed);
    shared_state
        .last_decode_throughput_frames_per_sec
        .store(throughput, Ordering::Relaxed);
    shared_state.mark_decode_finished();

    log::info!(
        "Streaming first-buffer decode complete: {} chunks, {} queued frames, {} output samples ({}→{} Hz)",
        chunk_count,
        queued_frames,
        full_samples.len(),
        original_sr,
        final_target_sr
    );

    ensure_streaming_load_current(shared_state, load_cancel, generation)?;
    let _ = cmd_tx.send(AudioCommand::StreamingLoadFinished {
        generation,
        samples: full_samples,
        total_frames,
    });

    Ok(())
}

fn ensure_streaming_load_current(
    shared_state: &SharedState,
    load_cancel: &AtomicBool,
    generation: u64,
) -> Result<(), String> {
    if load_cancel.load(Ordering::Acquire)
        || shared_state.load_generation.load(Ordering::Acquire) != generation
    {
        return Err("Load cancelled".to_string());
    }
    Ok(())
}

fn publish_streaming_ready(
    shared_state: &SharedState,
    cmd_tx: &Sender<AudioCommand>,
    generation: u64,
    track: &StreamingTrackStart,
    autoplay: bool,
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        return;
    }
    shared_state.is_loading.store(false, Ordering::Release);
    shared_state.load_progress.store(100, Ordering::Relaxed);
    let _ = cmd_tx.send(AudioCommand::StreamingLoadReady {
        generation,
        track: track.clone(),
    });
    if autoplay && shared_state.state.load() != state::PlayerState::Paused {
        let _ = cmd_tx.send(AudioCommand::Play);
    }
}

fn push_ready_streaming_chunks(
    shared_state: &SharedState,
    load_cancel: &AtomicBool,
    generation: u64,
    channels: usize,
    pending_samples: &mut Vec<f64>,
    force_all: bool,
) -> Result<u64, String> {
    let mut pushed_frames = 0_u64;
    let chunk_samples = STREAMING_CHUNK_FRAMES * channels;

    while pending_samples.len() >= chunk_samples || (force_all && !pending_samples.is_empty()) {
        let take = if pending_samples.len() >= chunk_samples {
            chunk_samples
        } else {
            pending_samples.len()
        };
        let samples = pending_samples.drain(..take).collect::<Vec<_>>();
        let frames = (samples.len() / channels) as u64;
        if push_streaming_chunk(shared_state, load_cancel, generation, samples)? {
            pushed_frames += frames;
        }
    }

    Ok(pushed_frames)
}

fn push_streaming_chunk(
    shared_state: &SharedState,
    load_cancel: &AtomicBool,
    generation: u64,
    samples: Vec<f64>,
) -> Result<bool, String> {
    if samples.is_empty() {
        return Ok(false);
    }

    let chunk = StreamingAudioChunk {
        generation,
        samples: Arc::new(samples),
    };
    ensure_streaming_load_current(shared_state, load_cancel, generation)?;
    match shared_state.streaming_chunks.push(chunk) {
        Ok(()) => {
            shared_state.mark_streaming_first_chunk();
            Ok(true)
        }
        Err(_returned) => Ok(false),
    }
}
