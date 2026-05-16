//! Audio Player Module
//!
//! Native audio playback using cpal with lock-free DSP processing.
//! Uses f64 full-stack path for maximum transparency.

mod audio_thread;
mod callback;
mod effects_api;
mod gapless;
mod output_stream;
mod spectrum;
mod state;

// Re-exports
pub use callback::{audio_callback_lockfree, normalize_channels, LockfreeDspContext};
pub use gapless::GaplessManager;
pub use state::{
    AtomicPlayerState, AudioCommand, AudioDeviceInfo, PlayerState, RepeatMode, SharedState,
    ShuffleMode, EVENT_LOAD_COMPLETE, EVENT_LOAD_ERROR, EVENT_NEEDS_PRELOAD,
    EVENT_NEEDS_PRELOAD_RESET, EVENT_PLAYBACK_ENDED, EVENT_PLAYBACK_HISTORY_UPDATED,
    EVENT_PLAYBACK_PAUSED, EVENT_PLAYBACK_SEEKED, EVENT_PLAYBACK_STARTED, EVENT_PLAYBACK_STOPPED,
    EVENT_QUEUE_UPDATED, EVENT_TRACK_CHANGED, EVENT_TRACK_EOF,
};

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

use cpal::traits::{DeviceTrait, HostTrait};
use crossbeam::channel::{unbounded, Sender};
use parking_lot::Mutex;

use crate::config::{EngineSettings, ResampleQuality};
use crate::processor::{
    AtomicCrossfeedParams,
    AtomicDynamicLoudnessParams,
    AtomicDynamicLoudnessTelemetry,
    // Lock-free parameters
    AtomicEqParams,
    AtomicNoiseShaperParams,
    AtomicPeakLimiterParams,
    AtomicSaturationParams,
    AtomicVolumeParams,
    FirPhaseMode,
    LoudnessNormalizer,
    SpectrumAnalyzer,
    STANDARD_BANDS,
};

// Import internal modules
use audio_thread::{audio_thread_main, AudioThreadStartup};
use spectrum::spectrum_thread_main;
use state::{load_cache_with_header, save_cache_with_header};

/// The main audio player - thread-safe wrapper
pub struct AudioPlayer {
    shared_state: Arc<SharedState>,
    cmd_tx: Sender<AudioCommand>,
    audio_thread: Option<JoinHandle<()>>,

    // Loudness normalizer for main thread operations
    loudness_normalizer: Arc<Mutex<LoudnessNormalizer>>,

    // ═══════════════════════════════════════════════════════════════
    // Lock-free Parameter Structures
    // These allow main thread to set parameters without blocking audio thread
    // ═══════════════════════════════════════════════════════════════
    /// Lock-free EQ parameters - use this for real-time EQ updates
    pub lockfree_eq_params: Arc<AtomicEqParams>,
    /// Lock-free saturation parameters
    pub lockfree_saturation_params: Arc<AtomicSaturationParams>,
    /// Lock-free crossfeed parameters
    pub lockfree_crossfeed_params: Arc<AtomicCrossfeedParams>,
    /// Lock-free peak limiter parameters
    pub lockfree_limiter_params: Arc<AtomicPeakLimiterParams>,
    /// Lock-free volume parameters (includes mute)
    pub lockfree_volume_params: Arc<AtomicVolumeParams>,
    /// Lock-free noise shaper parameters
    pub lockfree_noise_shaper_params: Arc<AtomicNoiseShaperParams>,
    /// Lock-free dynamic loudness parameters
    pub lockfree_dynamic_loudness_params: Arc<AtomicDynamicLoudnessParams>,
    /// Real-time dynamic loudness telemetry from audio thread
    dynamic_loudness_telemetry: Arc<AtomicDynamicLoudnessTelemetry>,

    // Config
    pub exclusive_mode: bool,
    pub target_sample_rate: Option<u32>,
    pub dither_enabled: bool,
    pub replaygain_enabled: bool,
    pub loudness_enabled: bool,

    // FIR EQ emulation state (maps FIR API onto lock-free EQ runtime)
    fir_eq_enabled: bool,
    fir_taps: usize,
    fir_bands: [(f64, f64); 10],
    fir_phase_mode: FirPhaseMode,
    ir_loaded: bool,
    ir_path: Option<String>,

    config: EngineSettings,
    device_id: Option<usize>,
    current_load_cancel: Option<Arc<AtomicBool>>,
}

impl AudioPlayer {
    pub fn new(config: EngineSettings) -> Self {
        log::info!("Initializing AudioPlayer (lock-free mode)...");
        let shared_state = Arc::new(SharedState::new());
        let (cmd_tx, cmd_rx) = unbounded::<AudioCommand>();

        let thread_state = Arc::clone(&shared_state);

        let spectrum_analyzer = Arc::new(SpectrumAnalyzer::new(2048, 64));

        let loudness_normalizer = Arc::new(Mutex::new(LoudnessNormalizer::new(
            2,
            44100,
            config.loudness.clone(),
        )));
        let loudness_state = loudness_normalizer.lock().atomic_state();

        let (spectrum_tx, spectrum_rx) = crossbeam::channel::bounded::<f64>(4096);

        let spec_state = Arc::clone(&shared_state);
        let spec_analyzer = Arc::clone(&spectrum_analyzer);
        thread::spawn(move || {
            spectrum_thread_main(spectrum_rx, spec_state, spec_analyzer);
        });

        let loudness_enabled = config.loudness.enabled;

        // ═══════════════════════════════════════════════════════════════
        // Initialize lock-free parameter structures
        // ═══════════════════════════════════════════════════════════════
        let lockfree_eq_params = Arc::new(AtomicEqParams::new());
        let lockfree_saturation_params = Arc::new(AtomicSaturationParams::new());
        let lockfree_crossfeed_params = Arc::new(AtomicCrossfeedParams::new());
        let lockfree_limiter_params = Arc::new(AtomicPeakLimiterParams::new());
        let lockfree_volume_params = Arc::new(AtomicVolumeParams::new());
        let lockfree_noise_shaper_params = Arc::new(AtomicNoiseShaperParams::new());
        let lockfree_dynamic_loudness_params = Arc::new(AtomicDynamicLoudnessParams::new());
        let dynamic_loudness_telemetry = Arc::new(AtomicDynamicLoudnessTelemetry::new());

        // Sync initial saturation config to lockfree params
        {
            lockfree_saturation_params.set_drive(config.saturation.drive);
            lockfree_saturation_params.set_threshold(config.saturation.threshold);
            lockfree_saturation_params.set_mix(config.saturation.mix);
            lockfree_saturation_params.set_enabled(config.saturation.enabled);
        }

        {
            lockfree_crossfeed_params.set_enabled(config.crossfeed.enabled);
            lockfree_crossfeed_params.set_mix(config.crossfeed.mix);
        }

        // Sync initial dynamic loudness config to lockfree params
        {
            lockfree_dynamic_loudness_params.set_enabled(config.dynamic_loudness.enabled);
            lockfree_dynamic_loudness_params.set_strength(config.dynamic_loudness.strength);
            lockfree_dynamic_loudness_params
                .set_ref_volume_db(config.dynamic_loudness.ref_volume_db);
        }

        {
            lockfree_noise_shaper_params.set_enabled(config.dither.enabled);
            lockfree_noise_shaper_params.set_bits(config.output_bits);
            lockfree_noise_shaper_params.set_curve(config.dither.noise_shaper_curve);
        }

        // ═══════════════════════════════════════════════════════════════
        // Spawn audio thread (lock-free only)
        // ═══════════════════════════════════════════════════════════════
        let lf_eq = Arc::clone(&lockfree_eq_params);
        let lf_sat = Arc::clone(&lockfree_saturation_params);
        let lf_cross = Arc::clone(&lockfree_crossfeed_params);
        let lf_limiter = Arc::clone(&lockfree_limiter_params);
        let lf_vol = Arc::clone(&lockfree_volume_params);
        let lf_ns = Arc::clone(&lockfree_noise_shaper_params);
        let lf_dl = Arc::clone(&lockfree_dynamic_loudness_params);
        let lf_dl_telemetry = Arc::clone(&dynamic_loudness_telemetry);
        let lf_loudness_state = Arc::clone(&loudness_state);
        let phase_response = config.phase_response;
        let target_lufs = config.loudness.target_lufs;

        let audio_thread = thread::spawn(move || {
            audio_thread_main(AudioThreadStartup {
                cmd_rx,
                shared_state: thread_state,
                eq_params: lf_eq,
                saturation_params: lf_sat,
                crossfeed_params: lf_cross,
                limiter_params: lf_limiter,
                volume_params: lf_vol,
                noise_shaper_params: lf_ns,
                dynamic_loudness_params: lf_dl,
                dynamic_loudness_telemetry: lf_dl_telemetry,
                loudness_state: lf_loudness_state,
                noise_shaper_bits: config.output_bits, // M-1 fix: read from config instead of hardcoded 24
                spectrum_tx,
                phase_response,
                target_lufs,
            });
        });

        shared_state.volume.store(
            (config.volume.clamp(0.0, 1.0) * 1_000_000.0) as u64,
            Ordering::Relaxed,
        );
        shared_state
            .exclusive_mode
            .store(config.exclusive_mode, Ordering::Relaxed);
        shared_state.device_id.store(
            config.device_id.map(|i| i as i64).unwrap_or(-1),
            Ordering::Relaxed,
        );
        let eq_type = config.eq_type.clone();
        let exclusive_mode = config.exclusive_mode;
        let target_sample_rate = config.target_samplerate;
        let dither_enabled = config.dither.enabled;
        let fir_taps = config.fir_taps.unwrap_or(1023);
        let device_id = config.device_id;
        shared_state
            .output_bits
            .store(config.output_bits, Ordering::Relaxed);
        *shared_state.noise_shaper_curve.write() = config.dither.noise_shaper_curve;
        *shared_state.eq_type.write() = eq_type;

        Self {
            shared_state,
            cmd_tx,
            audio_thread: Some(audio_thread),
            loudness_normalizer,
            // Lock-free parameters
            lockfree_eq_params,
            lockfree_saturation_params,
            lockfree_crossfeed_params,
            lockfree_limiter_params,
            lockfree_volume_params,
            lockfree_noise_shaper_params,
            lockfree_dynamic_loudness_params,
            dynamic_loudness_telemetry,
            exclusive_mode,
            target_sample_rate,
            dither_enabled,
            replaygain_enabled: true,
            loudness_enabled,
            fir_eq_enabled: false,
            fir_taps,
            fir_bands: STANDARD_BANDS,
            fir_phase_mode: FirPhaseMode::Linear,
            ir_loaded: false,
            ir_path: None,
            config,
            device_id,
            current_load_cancel: None,
        }
    }

    pub fn list_devices(&self) -> Vec<AudioDeviceInfo> {
        log::info!("Listing audio devices...");
        let host = cpal::default_host();
        let mut all_devices = Vec::new();
        let default_device = host.default_output_device();
        let default_name = default_device.as_ref().and_then(|d| d.name().ok());

        if let Ok(devices) = host.output_devices() {
            for (idx, device) in devices.enumerate() {
                if let Ok(name) = device.name() {
                    let config = device.default_output_config().ok();
                    let is_default = Some(&name) == default_name.as_ref();
                    all_devices.push(AudioDeviceInfo {
                        id: idx,
                        name,
                        is_default,
                        sample_rate: config.map(|c| c.sample_rate().0),
                    });
                }
            }
        }

        if all_devices.is_empty() {
            log::warn!("No audio output devices found!");
        } else {
            log::info!("Found {} audio devices", all_devices.len());
        }

        all_devices
    }

    pub fn select_device(&mut self, device_id: Option<usize>) -> Result<(), String> {
        self.device_id = device_id;
        let id_value = device_id.map(|i| i as i64).unwrap_or(-1);
        self.shared_state
            .device_id
            .store(id_value, Ordering::Relaxed);
        log::info!("Device selected: {:?}", device_id);
        Ok(())
    }

    pub fn load(&mut self, path: &str) -> Result<(), String> {
        self.load_with_credentials(path, None)
    }

    /// Load audio file asynchronously in a background thread.
    /// Returns immediately with Ok(()) - check `is_loading()` for completion status.
    /// On completion, a `LoadComplete` command is sent to the audio thread.
    pub fn load_with_credentials(
        &mut self,
        path: &str,
        credentials: Option<&crate::decoder::HttpCredentials>,
    ) -> Result<(), String> {
        self.load_with_credentials_inner(path, credentials, false)
    }

    pub fn load_with_credentials_and_autoplay(
        &mut self,
        path: &str,
        credentials: Option<&crate::decoder::HttpCredentials>,
    ) -> Result<(), String> {
        self.load_with_credentials_inner(path, credentials, true)
    }

    fn load_with_credentials_inner(
        &mut self,
        path: &str,
        credentials: Option<&crate::decoder::HttpCredentials>,
        autoplay: bool,
    ) -> Result<(), String> {
        log::info!(
            "Loading track async (credentials={}): {}",
            credentials.is_some(),
            path
        );
        self.stop_for_track_load();
        GaplessManager::cancel_preload(&self.shared_state);
        self.cancel_current_load();
        let load_cancel = self.create_load_cancel_token();
        let generation = self
            .shared_state
            .load_generation
            .fetch_add(1, Ordering::AcqRel)
            + 1;

        self.begin_loading_track(path, autoplay);

        let path_owned = path.to_string();
        let credentials_owned = credentials.cloned();
        let shared_state = Arc::clone(&self.shared_state);
        let cmd_tx = self.cmd_tx.clone();
        let config = self.config.clone();
        let device_id = self.device_id;
        let loudness_enabled = self.loudness_enabled;

        // Spawn background thread for decoding
        thread::spawn(move || {
            let result = Self::decode_file_internal(
                &path_owned,
                credentials_owned.as_ref(),
                &config,
                device_id,
                &shared_state,
                loudness_enabled,
                &load_cancel,
            );

            let is_current = shared_state.load_generation.load(Ordering::Acquire) == generation;
            if is_current {
                shared_state.is_loading.store(false, Ordering::Release);
            }

            match result {
                Ok(load_result) => {
                    if load_cancel.load(Ordering::Acquire) || !is_current {
                        log::info!(
                            "Discarding cancelled async load result for '{}' (generation {})",
                            path_owned,
                            generation
                        );
                        return;
                    }
                    let _ = cmd_tx.send(AudioCommand::LoadComplete {
                        generation,
                        result: load_result,
                    });
                    if autoplay
                        && shared_state.load_generation.load(Ordering::Acquire) == generation
                        && shared_state.state.load() != PlayerState::Paused
                    {
                        let _ = cmd_tx.send(AudioCommand::Play);
                    }
                }
                Err(e) => {
                    if load_cancel.load(Ordering::Acquire) || !is_current {
                        log::info!(
                            "Async load cancelled for '{}' (generation {}): {}",
                            path_owned,
                            generation,
                            e
                        );
                        return;
                    }
                    log::error!("Async load failed: {}", e);
                    if is_current {
                        shared_state
                            .load_error_count
                            .fetch_add(1, Ordering::Relaxed);
                        *shared_state.load_error.write() = Some(e.clone());
                    }
                    let _ = cmd_tx.send(AudioCommand::LoadError {
                        generation,
                        message: e,
                    });
                }
            }
        });

        Ok(())
    }

    fn create_load_cancel_token(&mut self) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.current_load_cancel = Some(Arc::clone(&cancel));
        cancel
    }

    fn cancel_current_load(&mut self) {
        let was_loading = self.shared_state.is_loading.swap(false, Ordering::AcqRel);
        if let Some(cancel) = self.current_load_cancel.take() {
            cancel.store(true, Ordering::Release);
        }
        if was_loading {
            self.shared_state
                .load_generation
                .fetch_add(1, Ordering::AcqRel);
            self.shared_state.load_progress.store(0, Ordering::Relaxed);
        }
    }

    fn begin_loading_track(&self, path: &str, autoplay: bool) {
        self.shared_state
            .position_frames
            .store(0, Ordering::Relaxed);
        self.shared_state.total_frames.store(0, Ordering::Relaxed);
        self.shared_state.state.store(if autoplay {
            PlayerState::Playing
        } else {
            PlayerState::Stopped
        });
        self.shared_state.is_loading.store(true, Ordering::Release);
        self.shared_state.load_progress.store(0, Ordering::Relaxed);
        *self.shared_state.load_error.write() = None;
        *self.shared_state.file_path.write() = Some(path.to_string());
        *self.shared_state.current_track_path.write() = Some(path.to_string());
        *self.shared_state.track_metadata.write() = crate::decoder::TrackMetadata::default();
    }

    /// Internal decode function for async loading
    fn decode_file_internal(
        path: &str,
        credentials: Option<&crate::decoder::HttpCredentials>,
        config: &EngineSettings,
        device_id: Option<usize>,
        shared_state: &Arc<SharedState>,
        _loudness_enabled: bool,
        load_cancel: &Arc<AtomicBool>,
    ) -> Result<state::LoadResult, String> {
        use crate::decoder::{DecodeCancelToken, StreamingDecoder};
        use crate::processor::StreamingResampler;

        let decode_started_at = std::time::Instant::now();
        let cancel_token = DecodeCancelToken::new(Arc::clone(load_cancel));
        let mut decoder = StreamingDecoder::open_with_credentials_and_cancel(
            path,
            credentials,
            Some(cancel_token.clone()),
        )
        .map_err(|e| {
            log::error!("Failed to open decoder for {}: {}", path, e);
            e.to_string()
        })?;

        let info = decoder.info.clone();
        let original_sr = info.sample_rate;
        let channels = info.channels;

        let target_sr = config.target_samplerate.unwrap_or_else(|| {
            let host = cpal::default_host();
            let device = match device_id {
                Some(id) => host.output_devices().ok().and_then(|mut d| d.nth(id)),
                None => host.default_output_device(),
            };
            device
                .and_then(|d| d.default_output_config().ok())
                .map(|c| c.sample_rate().0)
                .unwrap_or(original_sr)
        });

        let need_resample = target_sr != original_sr;
        let estimated_input_frames = info.total_frames.unwrap_or(0) as usize;

        // If preemptive_resample is false, skip pre-resampling and keep original sample rate
        let (final_target_sr, final_need_resample) = if need_resample && !config.preemptive_resample
        {
            log::info!(
                "preemptive_resample=false: keeping original {} Hz (will resample at playback)",
                original_sr
            );
            (original_sr, false)
        } else {
            (target_sr, need_resample)
        };

        // Calculate cache path
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
            hasher.update(&[q_byte]);
            hasher.update(estimated_input_frames.to_le_bytes());
            hasher.update(&[config.phase_response as u8]);

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

        // Try cache first
        if let Some(ref cp) = cache_path {
            if cp.exists() {
                if let Some(cached_samples) =
                    load_cache_with_header(cp, final_target_sr, channels as u32)
                {
                    let total_frames = cached_samples.len() / channels;
                    log::info!("Loaded from cache: {} frames", total_frames);
                    return Ok(state::LoadResult {
                        samples: cached_samples, // Move instead of clone — avoids copying hundreds of MB
                        sample_rate: final_target_sr,
                        channels,
                        total_frames: total_frames as u64,
                        file_path: path.to_string(),
                        loudness_info: None,
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

        let estimated_output_frames = if final_need_resample {
            (estimated_input_frames as f64 * final_target_sr as f64 / original_sr as f64).ceil()
                as usize
        } else {
            estimated_input_frames
        };
        let mut samples = Vec::with_capacity(estimated_output_frames * channels);

        let mut resampler = if final_need_resample {
            match StreamingResampler::with_phase(
                channels,
                original_sr,
                final_target_sr,
                config.phase_response,
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

        while let Some(decoded_chunk) = decoder.decode_next().map_err(|e| e.to_string())? {
            if load_cancel.load(Ordering::Acquire) {
                return Err("Load cancelled".to_string());
            }
            decoded_frames += (decoded_chunk.len() / channels) as u64;
            if let Some(ref mut rs) = resampler {
                let resampled = rs.process_chunk(&decoded_chunk);
                samples.extend(resampled);
            } else {
                samples.extend(decoded_chunk);
            }
            chunk_count += 1;

            // Update progress
            let progress =
                ((decoded_frames as f64 / total_estimated as f64) * 100.0).min(99.0) as u64;
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
            samples.extend(rs.flush());
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

        log::info!(
            "Streaming decode complete: {} chunks, {} output samples ({}→{} Hz)",
            chunk_count,
            samples.len(),
            original_sr,
            final_target_sr
        );

        // Save to cache
        if final_need_resample {
            if let Some(ref cp) = cache_path {
                if let Err(e) =
                    save_cache_with_header(cp, &samples, final_target_sr, channels as u32)
                {
                    log::warn!("Failed to save cache: {}", e);
                } else if let Some(cache_dir) = cp.parent() {
                    let cache_max_bytes = state::configured_cache_max_bytes();
                    if let Err(e) = state::prune_cache_dir_to_limit(cache_dir, cache_max_bytes) {
                        log::warn!("Failed to prune resample cache: {}", e);
                    }
                }
            }
        }

        let total_frames = samples.len() / channels;

        Ok(state::LoadResult {
            samples,
            sample_rate: final_target_sr,
            channels,
            total_frames: total_frames as u64,
            file_path: path.to_string(),
            loudness_info: None,
            metadata: info.metadata,
        })
    }

    /// Check if a file is currently being loaded
    pub fn is_loading(&self) -> bool {
        self.shared_state.is_loading.load(Ordering::Relaxed)
    }

    /// Get loading progress (0-100)
    pub fn load_progress(&self) -> u64 {
        self.shared_state.load_progress.load(Ordering::Relaxed)
    }

    /// Get load error if any
    pub fn load_error(&self) -> Option<String> {
        self.shared_state.load_error.read().clone()
    }

    pub fn play(&mut self) -> Result<(), String> {
        let previous = self.shared_state.state.load();
        if previous == PlayerState::Paused {
            self.shared_state.state.store(PlayerState::Playing);
            self.shared_state
                .event_flags
                .fetch_or(EVENT_PLAYBACK_STARTED, Ordering::Release);
        }
        let _ = self.cmd_tx.send(AudioCommand::Play);
        Ok(())
    }

    pub fn pause(&mut self) -> Result<(), String> {
        self.shared_state.state.store(PlayerState::Paused);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_PAUSED, Ordering::Release);
        let _ = self.cmd_tx.send(AudioCommand::Pause);
        Ok(())
    }

    pub fn stop(&mut self) {
        self.cancel_current_load();
        self.shared_state
            .position_frames
            .store(0, Ordering::Relaxed);
        self.shared_state.state.store(PlayerState::Stopped);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_STOPPED, Ordering::Release);
        let _ = self.cmd_tx.send(AudioCommand::Stop);
    }

    fn stop_for_track_load(&self) {
        self.shared_state
            .position_frames
            .store(0, Ordering::Relaxed);
        self.shared_state.state.store(PlayerState::Stopped);
        let _ = self.cmd_tx.send(AudioCommand::StopForLoad);
    }

    pub fn seek(&mut self, time_secs: f64) -> Result<(), String> {
        let sr = self.shared_state.sample_rate.load(Ordering::Relaxed) as f64;
        let total = self.shared_state.total_frames.load(Ordering::Relaxed);
        let new_pos = ((time_secs.max(0.0) * sr) as u64).min(total);
        self.shared_state
            .position_frames
            .store(new_pos, Ordering::Relaxed);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_SEEKED, Ordering::Release);
        self.cmd_tx
            .send(AudioCommand::Seek(time_secs))
            .map_err(|e| format!("Failed to send seek command: {}", e))
    }

    pub fn set_volume(&mut self, vol: f64) {
        let clamped_vol = vol.clamp(0.0, 1.0);
        self.shared_state
            .volume
            .store((clamped_vol * 1_000_000.0) as u64, Ordering::Relaxed);

        // Update lock-free volume params
        self.lockfree_volume_params.set_volume(clamped_vol);
        self.lockfree_dynamic_loudness_params
            .set_volume(clamped_vol);
    }

    pub fn get_volume(&self) -> f64 {
        self.shared_state.volume.load(Ordering::Relaxed) as f64 / 1_000_000.0
    }

    pub fn get_state(&self) -> PlayerState {
        self.shared_state.state.load()
    }

    pub fn set_repeat_mode(&self, mode: RepeatMode) {
        self.shared_state.set_repeat_mode(mode);
    }

    pub fn set_shuffle_mode(&self, mode: ShuffleMode) {
        self.shared_state.set_shuffle_mode(mode);
    }

    pub fn shared_state(&self) -> Arc<SharedState> {
        Arc::clone(&self.shared_state)
    }

    // ============ Resampling Config Methods ============

    /// Get resample quality as string
    pub fn get_resample_quality(&self) -> String {
        crate::config::resample_quality_to_string(self.config.resample_quality)
    }

    /// Get use_cache setting
    pub fn get_use_cache(&self) -> bool {
        self.config.use_cache
    }

    /// Get preemptive_resample setting
    pub fn get_preemptive_resample(&self) -> bool {
        self.config.preemptive_resample
    }

    /// Set resample quality
    pub fn set_resample_quality(&mut self, quality: crate::config::ResampleQuality) {
        self.config.resample_quality = quality;
        log::info!("Resample quality set to: {:?}", quality);
    }

    /// Set use_cache setting
    pub fn set_use_cache(&mut self, enabled: bool) {
        self.config.use_cache = enabled;
        log::info!(
            "Resample cache {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    /// Set preemptive_resample setting
    pub fn set_preemptive_resample(&mut self, enabled: bool) {
        self.config.preemptive_resample = enabled;
        log::info!(
            "Preemptive resample {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    pub fn load_ir(&mut self, path: &str) -> Result<(), String> {
        use crate::decoder::StreamingDecoder;

        const MAX_IR_BYTES: usize = 64 * 1024 * 1024;

        let mut decoder = StreamingDecoder::open(path)
            .map_err(|e| format!("Failed to open IR file '{}': {}", path, e))?;
        let info = decoder.info.clone();
        let ir_data = decoder
            .decode_all()
            .map_err(|e| format!("Failed to decode IR file '{}': {}", path, e))?;

        if ir_data.is_empty() {
            return Err("IR file decoded to empty buffer".to_string());
        }

        let ir_bytes = ir_data.len().saturating_mul(std::mem::size_of::<f64>());
        if ir_bytes > MAX_IR_BYTES {
            return Err(format!(
                "IR data too large: {:.1} MB (max: {:.1} MB)",
                ir_bytes as f64 / (1024.0 * 1024.0),
                MAX_IR_BYTES as f64 / (1024.0 * 1024.0)
            ));
        }

        self.cmd_tx
            .send(AudioCommand::SetExternalIrConvolver {
                ir_data,
                channels: info.channels.max(1),
            })
            .map_err(|e| format!("Failed to send IR command to audio thread: {}", e))?;

        self.ir_loaded = true;
        self.ir_path = Some(path.to_string());
        log::info!("IR loaded and activated: '{}'", path);
        Ok(())
    }

    pub fn unload_ir(&mut self) {
        if let Err(e) = self.cmd_tx.send(AudioCommand::ClearExternalIrConvolver) {
            log::warn!("Failed to send ClearExternalIrConvolver command: {}", e);
        }
        self.ir_loaded = false;
        self.ir_path = None;
        log::info!("IR unloaded");
    }

    pub fn is_ir_loaded(&self) -> bool {
        self.ir_loaded
    }

    pub fn queue_next(&self, path: &str) -> Result<(), String> {
        self.queue_next_with_credentials(path, None)
    }

    pub fn queue_next_with_credentials(
        &self,
        path: &str,
        credentials: Option<crate::decoder::HttpCredentials>,
    ) -> Result<(), String> {
        let mode = self.config.loudness.mode;
        GaplessManager::queue_next(
            &self.shared_state,
            &self.loudness_normalizer,
            &self.config,
            path,
            credentials,
            self.loudness_enabled,
            mode,
        )
    }

    pub fn cancel_preload(&self) {
        GaplessManager::cancel_preload(&self.shared_state);
    }

    /// Set output bit depth for NoiseShaper
    pub fn set_output_bits(&self, bits: u32) {
        self.lockfree_noise_shaper_params.set_bits(bits);
        self.shared_state.output_bits.store(bits, Ordering::Relaxed);
        log::info!("Output bit depth set to {} bits", bits);
    }

    /// Get output bit depth
    pub fn get_output_bits(&self) -> u32 {
        self.shared_state.output_bits.load(Ordering::Relaxed)
    }

    /// Get normalization mode
    pub fn get_normalization_mode(&self) -> crate::config::NormalizationMode {
        self.config.loudness.mode
    }

    /// Get target LUFS
    pub fn get_target_lufs(&self) -> f64 {
        self.config.loudness.target_lufs
    }

    // ============ FIR EQ Methods ============

    /// Enable FIR EQ (real convolution backend)
    pub fn enable_fir_eq(&mut self, num_taps: usize) -> Result<(), String> {
        let normalized_taps = if num_taps == 0 {
            1023
        } else if num_taps % 2 == 0 {
            num_taps + 1
        } else {
            num_taps
        };

        self.fir_eq_enabled = true;
        self.fir_taps = normalized_taps;
        self.lockfree_eq_params.set_enabled(false);
        *self.shared_state.eq_type.write() = "FIR".to_string();
        self.apply_fir_convolver()?;

        log::info!("FIR EQ enabled (real convolution, taps={})", self.fir_taps);
        Ok(())
    }

    /// Disable FIR EQ
    pub fn disable_fir_eq(&mut self) {
        self.fir_eq_enabled = false;
        if let Err(e) = self.cmd_tx.send(AudioCommand::ClearFirConvolver) {
            log::warn!("Failed to clear FIR convolver: {}", e);
        }
        *self.shared_state.eq_type.write() = "IIR".to_string();
        log::info!("FIR EQ disabled");
    }

    /// Check if FIR EQ is enabled
    pub fn is_fir_eq_enabled(&self) -> bool {
        self.fir_eq_enabled
    }

    /// Set FIR EQ band gain
    pub fn set_fir_band_gain(&mut self, band_idx: usize, gain_db: f64) -> Result<(), String> {
        if band_idx >= self.fir_bands.len() {
            return Err(format!("FIR band index out of range: {}", band_idx));
        }

        let clamped = gain_db.clamp(-15.0, 15.0);
        self.fir_bands[band_idx].1 = clamped;
        if self.fir_eq_enabled {
            self.apply_fir_convolver()?;
        }
        Ok(())
    }

    /// Set all FIR EQ band gains at once
    pub fn set_fir_bands(&mut self, gains_db: &[f64; 10]) -> Result<(), String> {
        for (idx, gain) in gains_db.iter().enumerate() {
            let clamped = gain.clamp(-15.0, 15.0);
            self.fir_bands[idx].1 = clamped;
        }
        if self.fir_eq_enabled {
            self.apply_fir_convolver()?;
        }
        Ok(())
    }

    /// Get current FIR EQ band gains
    pub fn get_fir_bands(&self) -> Option<[(f64, f64); 10]> {
        Some(self.fir_bands)
    }

    /// Set FIR EQ phase mode
    pub fn set_fir_phase_mode(
        &mut self,
        mode: crate::processor::FirPhaseMode,
    ) -> Result<(), String> {
        self.fir_phase_mode = mode;
        if self.fir_eq_enabled {
            self.apply_fir_convolver()?;
        }
        log::info!("FIR phase mode set to {:?}", self.fir_phase_mode);
        Ok(())
    }

    /// Reset FIR convolver state
    pub fn reset_fir_convolver(&self) {
        if self.fir_eq_enabled {
            if let Err(e) = self.apply_fir_convolver() {
                log::warn!("Failed to reset FIR convolver: {}", e);
            }
        }
    }

    fn current_output_channels(&self) -> usize {
        self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize
    }

    fn build_fir_ir(&self, channels: usize) -> Vec<f64> {
        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1) as f64;
        let mut fir = crate::processor::FirEq::new(sample_rate, self.fir_taps);
        fir.set_phase_mode(self.fir_phase_mode);
        let gains = std::array::from_fn(|i| self.fir_bands[i].1);
        fir.set_bands(&gains);
        fir.get_ir(channels)
    }

    fn apply_fir_convolver(&self) -> Result<(), String> {
        let channels = self.current_output_channels();
        let ir_data = self.build_fir_ir(channels);
        self.cmd_tx
            .send(AudioCommand::SetFirConvolver { ir_data, channels })
            .map_err(|e| format!("Failed to send FIR convolver update: {}", e))
    }
}

impl Drop for AudioPlayer {
    fn drop(&mut self) {
        self.cancel_current_load();
        let _ = self.cmd_tx.send(AudioCommand::Shutdown);
        if let Some(handle) = self.audio_thread.take() {
            let _ = handle.join();
        }
    }
}
