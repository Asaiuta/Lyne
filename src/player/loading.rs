//! Async track loading and decode helpers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

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
    self, playback_phase_time_ms, AudioCommand, LoadResult, SharedState, StreamingAudioChunk,
    StreamingTrackStart, PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS,
    PLAYBACK_PROGRESS_REPLAY_COMMAND_GRACE_MS, PLAYBACK_PROGRESS_REPLAY_GRACE_MS,
};
use crate::config::{EngineSettings, ResampleQuality};
use crate::decoder::{DecodeCancelToken, StreamingDecoder};
use crate::processor::{LoudnessDatabase, StreamingResampler};

const STREAMING_CHUNK_FRAMES: usize = 4096;
const STREAMING_START_BUFFER_FRAMES: u64 = 8192;
const STREAMING_QUEUE_BACKPRESSURE_SLEEP: Duration = Duration::from_millis(2);
const STREAMING_READY_APPLIED_POLL: Duration = Duration::from_millis(1);
const STREAMING_PROGRESS_WATCHDOG_DELAY: Duration = Duration::from_millis(300);
const STREAMING_PROGRESS_WATCHDOG_RECHECK: Duration = Duration::from_millis(50);
const STREAMING_PROGRESS_WATCHDOG_MAX_OBSERVE: Duration = Duration::from_secs(2);
const F64_SAMPLE_BYTES: u128 = std::mem::size_of::<f64>() as u128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamingFullBufferMode {
    PublishFullBuffer,
    MemoryOnly,
}

impl StreamingFullBufferMode {
    fn publishes_full_buffer(self) -> bool {
        matches!(self, Self::PublishFullBuffer)
    }
}

fn streaming_full_buffer_limit_bytes(config: &EngineSettings) -> u128 {
    u128::from(config.streaming_full_buffer_limit_mib) * 1024 * 1024
}

fn estimated_decoded_pcm_bytes(output_frames: u64, channels: usize) -> Option<u128> {
    u128::from(output_frames)
        .checked_mul(channels as u128)?
        .checked_mul(F64_SAMPLE_BYTES)
}

fn streaming_full_buffer_mode(
    estimated_output_frames: Option<u64>,
    channels: usize,
    config: &EngineSettings,
) -> StreamingFullBufferMode {
    let limit_bytes = streaming_full_buffer_limit_bytes(config);
    if limit_bytes == 0 {
        return StreamingFullBufferMode::MemoryOnly;
    }

    let Some(estimated_output_frames) = estimated_output_frames else {
        return StreamingFullBufferMode::MemoryOnly;
    };
    let Some(estimated_bytes) = estimated_decoded_pcm_bytes(estimated_output_frames, channels)
    else {
        return StreamingFullBufferMode::MemoryOnly;
    };
    if estimated_bytes > limit_bytes {
        StreamingFullBufferMode::MemoryOnly
    } else {
        StreamingFullBufferMode::PublishFullBuffer
    }
}

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
    start_time_secs: f64,
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
    let start_time_secs = start_time_secs.max(0.0);
    let cached_loudness = cached_loudness_from_db(loudness_db.as_deref(), path);
    let estimated_input_frames = info.total_frames;
    let estimated_output_frames = estimated_input_frames.map(|frames| {
        if final_need_resample {
            ((frames as f64 * final_target_sr as f64) / original_sr.max(1) as f64).ceil() as u64
        } else {
            frames
        }
    });
    let estimated_start_frame = (start_time_secs * f64::from(final_target_sr)) as u64;
    let start_frame = estimated_output_frames
        .map(|total| estimated_start_frame.min(total))
        .unwrap_or(estimated_start_frame);
    let estimated_input_frames_for_progress = estimated_input_frames.unwrap_or(0);
    let full_buffer_mode = streaming_full_buffer_mode(estimated_output_frames, channels, config);
    let estimated_pcm_mib = estimated_output_frames
        .and_then(|frames| estimated_decoded_pcm_bytes(frames, channels))
        .map(|bytes| bytes / 1024 / 1024);

    let existing_decoded_samples = published_decoded_samples(shared_state);
    let mut full_samples = if full_buffer_mode.publishes_full_buffer() {
        let output_sample_capacity = record_budget_rejection(
            shared_state,
            reserve_decoded_buffer_capacity(
                DecodedBufferKind::CurrentTrack,
                path,
                estimated_input_frames_for_progress,
                original_sr,
                final_target_sr,
                channels,
                final_need_resample,
                existing_decoded_samples,
            ),
        )?;
        Some(Vec::with_capacity(output_sample_capacity))
    } else {
        None
    };
    log::info!(
        "Streaming first-buffer mode for '{}': {:?}, estimated_pcm_mib={:?}, full_buffer_limit_mib={}",
        path,
        full_buffer_mode,
        estimated_pcm_mib,
        config.streaming_full_buffer_limit_mib
    );
    let mut pending_samples = Vec::with_capacity(STREAMING_CHUNK_FRAMES * channels);
    let mut decoded_chunk = Vec::new();
    let mut ready_sent = false;
    let mut queued_frames = 0_u64;
    let mut decoded_frames = 0_u64;
    let mut output_samples = 0_u64;
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

    if start_time_secs > 0.0 {
        decoder.seek(start_time_secs).map_err(|e| {
            format!(
                "Failed to seek streaming decoder to {:.3}s: {}",
                start_time_secs, e
            )
        })?;
    }

    let track = StreamingTrackStart {
        sample_rate: final_target_sr,
        channels,
        total_frames: estimated_output_frames.unwrap_or(0),
        start_frame,
        file_path: path.to_string(),
        cached_loudness,
        metadata: info.metadata,
        memory_mode: !full_buffer_mode.publishes_full_buffer(),
    };

    while decoder
        .decode_next_into(&mut decoded_chunk)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        ensure_streaming_load_current(shared_state, load_cancel, generation)?;

        decoded_frames += (decoded_chunk.len() / channels) as u64;
        let produced_samples = if let Some(full_samples) = full_samples.as_mut() {
            let produced_start = full_samples.len();
            if let Some(ref mut rs) = resampler {
                rs.process_chunk_append(&decoded_chunk, full_samples);
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
            full_samples.len().saturating_sub(produced_start)
        } else {
            let produced_start = pending_samples.len();
            if let Some(ref mut rs) = resampler {
                rs.process_chunk_append(&decoded_chunk, &mut pending_samples);
            } else {
                pending_samples.extend_from_slice(&decoded_chunk);
            }
            pending_samples.len().saturating_sub(produced_start)
        };
        output_samples = output_samples.saturating_add(produced_samples as u64);

        let pre_ready_frame_limit =
            (!ready_sent).then(|| STREAMING_START_BUFFER_FRAMES.saturating_sub(queued_frames));
        queued_frames += push_ready_streaming_chunks(
            shared_state,
            load_cancel,
            generation,
            channels,
            &mut pending_samples,
            false,
            full_buffer_mode,
            pre_ready_frame_limit,
        )?;
        if !ready_sent && queued_frames >= STREAMING_START_BUFFER_FRAMES {
            publish_streaming_ready(shared_state, cmd_tx, generation, &track, autoplay);
            ready_sent = true;
            if !full_buffer_mode.publishes_full_buffer() {
                wait_for_streaming_ready_applied(shared_state, load_cancel, generation)?;
            }
            queued_frames += push_ready_streaming_chunks(
                shared_state,
                load_cancel,
                generation,
                channels,
                &mut pending_samples,
                false,
                full_buffer_mode,
                None,
            )?;
        }

        decoded_chunk.clear();
        chunk_count += 1;
        let total_estimated = estimated_input_frames_for_progress.max(1);
        let progress = ((decoded_frames as f64 / total_estimated as f64) * 100.0).min(99.0) as u64;
        shared_state
            .load_progress
            .store(progress, Ordering::Relaxed);
    }

    if let Some(ref mut rs) = resampler {
        let produced_samples = if let Some(full_samples) = full_samples.as_mut() {
            let produced_start = full_samples.len();
            rs.flush_into(full_samples);
            pending_samples.extend_from_slice(&full_samples[produced_start..]);
            full_samples.len().saturating_sub(produced_start)
        } else {
            let produced_start = pending_samples.len();
            rs.flush_into(&mut pending_samples);
            pending_samples.len().saturating_sub(produced_start)
        };
        output_samples = output_samples.saturating_add(produced_samples as u64);
    }

    if !ready_sent {
        publish_streaming_ready(shared_state, cmd_tx, generation, &track, autoplay);
        if !full_buffer_mode.publishes_full_buffer() {
            wait_for_streaming_ready_applied(shared_state, load_cancel, generation)?;
        }
    }

    queued_frames += push_ready_streaming_chunks(
        shared_state,
        load_cancel,
        generation,
        channels,
        &mut pending_samples,
        true,
        full_buffer_mode,
        None,
    )?;

    let decoded_remaining_frames = output_samples / channels as u64;
    // Memory mode publishes no full buffer, so the callback can only stop at EOF by
    // position. Report the *actual* produced frame count (not the ceil estimate) so
    // `position_frames` reaches `total_frames` exactly when the queue drains;
    // an estimate larger than the real output would otherwise strand playback just
    // past the last decoded sample. Full-buffer mode keeps the estimate (the
    // callback already clamps reads to the published buffer length).
    let total_frames = if full_buffer_mode.publishes_full_buffer() {
        estimated_output_frames
            .unwrap_or_else(|| start_frame.saturating_add(decoded_remaining_frames))
    } else {
        start_frame.saturating_add(decoded_remaining_frames)
    };
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
        .store(output_samples, Ordering::Relaxed);
    shared_state
        .last_decode_chunk_count
        .store(chunk_count, Ordering::Relaxed);
    shared_state
        .last_decode_throughput_frames_per_sec
        .store(throughput, Ordering::Relaxed);
    shared_state.mark_decode_finished();

    log::info!(
        "Streaming first-buffer decode complete: {} chunks, {} queued frames, {} output samples ({}→{} Hz, mode={:?})",
        chunk_count,
        queued_frames,
        output_samples,
        original_sr,
        final_target_sr,
        full_buffer_mode
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
    shared_state: &Arc<SharedState>,
    cmd_tx: &Sender<AudioCommand>,
    generation: u64,
    track: &StreamingTrackStart,
    autoplay: bool,
) {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        return;
    }
    let ready_sent = cmd_tx.send(AudioCommand::StreamingLoadReady {
        generation,
        track: track.clone(),
        autoplay,
    });
    if ready_sent.is_ok() {
        shared_state.mark_streaming_ready_sent();
        if autoplay {
            let cmd_tx = cmd_tx.clone();
            let shared_state = Arc::clone(shared_state);
            std::thread::spawn(move || {
                std::thread::sleep(STREAMING_PROGRESS_WATCHDOG_DELAY);
                let observe_started = Instant::now();
                let mut replay_attempted = false;
                let mut replay_requested_ms = 0_u64;
                loop {
                    match streaming_progress_watchdog_should_send(
                        &shared_state,
                        generation,
                        observe_started.elapsed(),
                        replay_attempted,
                        replay_requested_ms,
                    ) {
                        StreamingProgressWatchdogAction::SendEnsureProgress {
                            replay_attempted: action_replay_attempted,
                        } => {
                            if !action_replay_attempted {
                                replay_requested_ms = playback_phase_time_ms();
                                replay_attempted = true;
                                let _ = cmd_tx.send(AudioCommand::EnsurePlaybackProgress {
                                    generation,
                                    replay_attempted: false,
                                });
                            } else {
                                let _ = cmd_tx.send(AudioCommand::EnsurePlaybackProgress {
                                    generation,
                                    replay_attempted: true,
                                });
                                return;
                            }
                        }
                        StreamingProgressWatchdogAction::Wait => {
                            std::thread::sleep(STREAMING_PROGRESS_WATCHDOG_RECHECK);
                        }
                        StreamingProgressWatchdogAction::Stop => return,
                    }
                }
            });
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StreamingProgressWatchdogAction {
    SendEnsureProgress { replay_attempted: bool },
    Wait,
    Stop,
}

fn streaming_progress_watchdog_should_send(
    shared_state: &SharedState,
    generation: u64,
    observe_elapsed: Duration,
    replay_attempted: bool,
    replay_requested_ms: u64,
) -> StreamingProgressWatchdogAction {
    if shared_state.load_generation.load(Ordering::Acquire) != generation {
        return StreamingProgressWatchdogAction::Stop;
    }

    let playback_state = shared_state.state.load();
    if playback_state == state::PlayerState::Paused {
        return StreamingProgressWatchdogAction::Stop;
    }

    let has_progress = shared_state
        .playback_progress_generation
        .load(Ordering::Acquire)
        == generation
        || shared_state
            .first_callback_after_play_ms
            .load(Ordering::Acquire)
            != 0
        || shared_state
            .first_position_advanced_ms
            .load(Ordering::Acquire)
            != 0;
    if has_progress {
        return StreamingProgressWatchdogAction::Stop;
    }

    if shared_state.output_callback_observed_after_current_play() {
        return StreamingProgressWatchdogAction::Stop;
    }

    let stream_play_generation = shared_state.stream_play_generation.load(Ordering::Acquire);
    let stream_play_returned_ms = shared_state.stream_play_returned_ms.load(Ordering::Acquire);
    if playback_state == state::PlayerState::Stopped
        && stream_play_returned_ms != 0
        && stream_play_generation == generation
        && !shared_state.streaming_active.load(Ordering::Acquire)
        && !shared_state.is_loading.load(Ordering::Acquire)
    {
        return StreamingProgressWatchdogAction::Stop;
    }

    if stream_play_returned_ms == 0 || stream_play_generation != generation {
        return if observe_elapsed >= STREAMING_PROGRESS_WATCHDOG_MAX_OBSERVE {
            StreamingProgressWatchdogAction::Stop
        } else {
            StreamingProgressWatchdogAction::Wait
        };
    }

    if replay_attempted
        && replay_requested_ms != 0
        && stream_play_returned_ms < replay_requested_ms
        && playback_phase_time_ms().saturating_sub(replay_requested_ms)
            < PLAYBACK_PROGRESS_REPLAY_COMMAND_GRACE_MS
    {
        return StreamingProgressWatchdogAction::Wait;
    }

    let play_elapsed_ms = playback_phase_time_ms().saturating_sub(stream_play_returned_ms);
    let required_grace_ms = if replay_attempted {
        PLAYBACK_PROGRESS_REPLAY_GRACE_MS
    } else {
        PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS
    };
    if play_elapsed_ms < required_grace_ms {
        StreamingProgressWatchdogAction::Wait
    } else {
        StreamingProgressWatchdogAction::SendEnsureProgress { replay_attempted }
    }
}

fn wait_for_streaming_ready_applied(
    shared_state: &SharedState,
    load_cancel: &AtomicBool,
    generation: u64,
) -> Result<(), String> {
    while shared_state.streaming_ready_ms.load(Ordering::Acquire) == 0 {
        ensure_streaming_load_current(shared_state, load_cancel, generation)?;
        std::thread::sleep(STREAMING_READY_APPLIED_POLL);
    }
    Ok(())
}

fn push_ready_streaming_chunks(
    shared_state: &SharedState,
    load_cancel: &AtomicBool,
    generation: u64,
    channels: usize,
    pending_samples: &mut Vec<f64>,
    force_all: bool,
    full_buffer_mode: StreamingFullBufferMode,
    max_pushed_frames: Option<u64>,
) -> Result<u64, String> {
    let mut pushed_frames = 0_u64;
    let chunk_samples = STREAMING_CHUNK_FRAMES * channels;

    while pending_samples.len() >= chunk_samples || (force_all && !pending_samples.is_empty()) {
        if max_pushed_frames.is_some_and(|limit| pushed_frames >= limit) {
            break;
        }
        let take = if pending_samples.len() >= chunk_samples {
            chunk_samples
        } else {
            pending_samples.len()
        };
        let samples = pending_samples.drain(..take).collect::<Vec<_>>();
        let frames = (samples.len() / channels) as u64;
        if push_streaming_chunk(
            shared_state,
            load_cancel,
            generation,
            samples,
            full_buffer_mode,
        )? {
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
    full_buffer_mode: StreamingFullBufferMode,
) -> Result<bool, String> {
    if samples.is_empty() {
        return Ok(false);
    }

    let mut chunk = StreamingAudioChunk {
        generation,
        samples: Arc::new(samples),
    };

    loop {
        ensure_streaming_load_current(shared_state, load_cancel, generation)?;
        match shared_state.streaming_chunks.push(chunk) {
            Ok(()) => {
                shared_state.mark_streaming_first_chunk();
                return Ok(true);
            }
            Err(returned) if full_buffer_mode.publishes_full_buffer() => {
                let _ = returned;
                return Ok(false);
            }
            Err(returned) => {
                chunk = returned;
                std::thread::sleep(STREAMING_QUEUE_BACKPRESSURE_SLEEP);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streaming_full_buffer_mode_keeps_small_outputs_publishable() {
        let mut config = EngineSettings {
            streaming_full_buffer_limit_mib: 256,
            ..EngineSettings::default()
        };
        config = config.normalized();

        let frames = 44_100 * 60;
        assert_eq!(
            streaming_full_buffer_mode(Some(frames), 2, &config),
            StreamingFullBufferMode::PublishFullBuffer
        );
    }

    #[test]
    fn streaming_full_buffer_mode_switches_large_outputs_to_memory_only() {
        let mut config = EngineSettings {
            streaming_full_buffer_limit_mib: 256,
            ..EngineSettings::default()
        };
        config = config.normalized();

        let frames = 44_100 * 60 * 10;
        assert_eq!(
            streaming_full_buffer_mode(Some(frames), 2, &config),
            StreamingFullBufferMode::MemoryOnly
        );
    }

    #[test]
    fn streaming_full_buffer_mode_zero_limit_forces_memory_only() {
        let mut config = EngineSettings {
            streaming_full_buffer_limit_mib: 0,
            ..EngineSettings::default()
        };
        config = config.normalized();

        assert_eq!(
            streaming_full_buffer_mode(Some(44_100), 2, &config),
            StreamingFullBufferMode::MemoryOnly
        );
    }

    #[test]
    fn streaming_full_buffer_mode_unknown_size_is_memory_only() {
        let config = EngineSettings::default().normalized();

        assert_eq!(
            streaming_full_buffer_mode(None, 2, &config),
            StreamingFullBufferMode::MemoryOnly
        );
    }

    #[test]
    fn pre_ready_streaming_push_stops_at_start_threshold() {
        let shared = SharedState::new();
        let cancel = AtomicBool::new(false);
        shared.load_generation.store(7, Ordering::Release);

        let channels = 2;
        let chunk_samples = STREAMING_CHUNK_FRAMES * channels;
        let mut pending_samples = vec![0.25; chunk_samples * 4];

        let pushed = push_ready_streaming_chunks(
            &shared,
            &cancel,
            7,
            channels,
            &mut pending_samples,
            false,
            StreamingFullBufferMode::MemoryOnly,
            Some(STREAMING_START_BUFFER_FRAMES),
        )
        .expect("pre-ready push should not block or fail");

        assert_eq!(pushed, STREAMING_START_BUFFER_FRAMES);
        assert_eq!(
            shared.streaming_chunks.len() as u64,
            STREAMING_START_BUFFER_FRAMES / STREAMING_CHUNK_FRAMES as u64
        );
        assert_eq!(pending_samples.len(), chunk_samples * 2);
    }

    #[test]
    fn waiting_for_streaming_ready_applied_stops_when_generation_changes() {
        let shared = SharedState::new();
        let cancel = AtomicBool::new(false);
        shared.load_generation.store(8, Ordering::Release);

        let result = wait_for_streaming_ready_applied(&shared, &cancel, 7);

        assert_eq!(result, Err("Load cancelled".to_string()));
    }

    #[test]
    fn streaming_progress_watchdog_waits_while_stream_play_has_not_returned() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Stopped);

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(250),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Wait
        );
    }

    #[test]
    fn streaming_progress_watchdog_stops_for_stale_paused_or_progressed_loads() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                8,
                Duration::from_millis(250),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );

        shared.state.store(state::PlayerState::Paused);
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(250),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );

        shared.state.store(state::PlayerState::Playing);
        shared.mark_stream_play_returned();
        shared.mark_first_callback_after_play();
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(250),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );
    }

    #[test]
    fn streaming_progress_watchdog_waits_for_callback_grace_after_play() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        shared.mark_stream_play_returned();

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Wait
        );
    }

    #[test]
    fn streaming_progress_watchdog_sends_after_play_grace_without_progress() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS + 1),
            Ordering::Release,
        );
        shared.stream_play_generation.store(9, Ordering::Release);

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                false,
                0
            ),
            StreamingProgressWatchdogAction::SendEnsureProgress {
                replay_attempted: false
            }
        );
    }

    #[test]
    fn streaming_progress_watchdog_waits_for_current_generation_play_marker() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS + 1),
            Ordering::Release,
        );
        shared.stream_play_generation.store(8, Ordering::Release);

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Wait
        );
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                STREAMING_PROGRESS_WATCHDOG_MAX_OBSERVE,
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );
    }

    #[test]
    fn streaming_progress_watchdog_waits_for_replay_command_and_short_replay_grace() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        let replay_requested_ms = playback_phase_time_ms();
        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS + 1),
            Ordering::Release,
        );
        shared.stream_play_generation.store(9, Ordering::Release);

        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                true,
                replay_requested_ms
            ),
            StreamingProgressWatchdogAction::Wait
        );

        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_REPLAY_GRACE_MS + 1),
            Ordering::Release,
        );
        shared.stream_play_generation.store(9, Ordering::Release);
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(1100),
                true,
                0
            ),
            StreamingProgressWatchdogAction::SendEnsureProgress {
                replay_attempted: true
            }
        );
    }

    #[test]
    fn streaming_progress_watchdog_stops_after_generation_progress_survives_play_reset() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        shared.mark_stream_play_returned();
        shared.mark_first_position_advanced_after_play();
        shared.mark_stream_play_returned();
        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS + 1),
            Ordering::Release,
        );

        assert_eq!(shared.first_position_advanced_ms.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.playback_progress_generation.load(Ordering::Acquire),
            9
        );
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );
    }

    #[test]
    fn streaming_progress_watchdog_stops_when_output_callback_is_alive_without_position_progress() {
        let shared = SharedState::new();
        shared.load_generation.store(9, Ordering::Release);
        shared.state.store(state::PlayerState::Playing);
        shared.mark_stream_play_returned();
        shared.mark_output_callback_activity();
        shared.stream_play_returned_ms.store(
            playback_phase_time_ms().saturating_sub(PLAYBACK_PROGRESS_AFTER_PLAY_GRACE_MS + 1),
            Ordering::Release,
        );

        assert_eq!(
            shared.first_callback_after_play_ms.load(Ordering::Relaxed),
            0
        );
        assert_eq!(shared.first_position_advanced_ms.load(Ordering::Relaxed), 0);
        assert_eq!(
            shared.playback_progress_generation.load(Ordering::Acquire),
            0
        );
        assert_eq!(
            streaming_progress_watchdog_should_send(
                &shared,
                9,
                Duration::from_millis(600),
                false,
                0
            ),
            StreamingProgressWatchdogAction::Stop
        );
    }
}
