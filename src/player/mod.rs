//! Audio Player Module
//!
//! Native audio playback using cpal with lock-free DSP processing.
//! Uses f64 full-stack path for maximum transparency.

mod audio_thread;
#[doc(hidden)]
pub mod bench_support;
mod buffer_budget;
mod cache;
mod callback;
mod command_handlers;
mod effects_api;
mod fir_eq_api;
mod gapless;
mod loading;
mod output_stream;
mod playback_config;
mod spectrum;
mod state;
mod track_loudness;
#[cfg(windows)]
mod wasapi_loop;

// Re-exports
pub use callback::{
    audio_callback_lockfree, normalize_channels, CallbackScratch, LockfreeDspContext,
};
pub use gapless::GaplessManager;
pub(crate) use playback_config::{pending_promotion_readiness, PendingPromotionReadiness};
pub use spectrum::SpectrumBatch;
pub use state::{
    AtomicPlayerState, AudioCommand, AudioDeviceInfo, CachedLoudness, PlayerState, RepeatMode,
    SharedState, ShuffleMode, EVENT_LOAD_COMPLETE, EVENT_LOAD_ERROR, EVENT_NEEDS_PRELOAD,
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

use crate::config::EngineSettings;
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
    LoudnessDatabase,
    LoudnessNormalizer,
    SpectrumAnalyzer,
    STANDARD_BANDS,
};

// Import internal modules
use audio_thread::{audio_thread_main, AudioThreadStartup};
use loading::{decode_file_internal, decode_file_streaming_first_buffer};
use spectrum::spectrum_thread_main;

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
    loudness_db: Option<Arc<LoudnessDatabase>>,
}

struct MemoryStreamingSeekRequest {
    path: String,
    generation: u64,
    load_cancel: Arc<AtomicBool>,
    target_time_secs: f64,
}

impl AudioPlayer {
    pub fn new(config: EngineSettings) -> Self {
        Self::with_loudness_database(config, None)
    }

    pub fn with_loudness_database(
        config: EngineSettings,
        loudness_db: Option<Arc<LoudnessDatabase>>,
    ) -> Self {
        log::info!("Initializing AudioPlayer (lock-free mode)...");
        let shared_state = Arc::new(SharedState::new());
        let (cmd_tx, cmd_rx) = unbounded::<AudioCommand>();

        let thread_state = Arc::clone(&shared_state);

        let loudness_normalizer = Arc::new(Mutex::new(LoudnessNormalizer::new(
            2,
            44100,
            config.loudness.clone(),
        )));
        let loudness_state = loudness_normalizer.lock().atomic_state();

        let (spectrum_tx, spectrum_rx) = crossbeam::channel::bounded::<SpectrumBatch>(256);

        let spec_state = Arc::clone(&shared_state);
        let spec_analyzer = SpectrumAnalyzer::new(2048, 64);
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
        let replaygain_reference_lufs = config.loudness.replaygain_reference_lufs;

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
                resample_quality: config.resample_quality,
                target_lufs,
                replaygain_reference_lufs,
            });
        });

        shared_state.volume.store(
            (config.volume.clamp(0.0, 1.0) * 1_000_000.0) as u64,
            Ordering::Relaxed,
        );
        shared_state
            .exclusive_mode
            .store(config.exclusive_mode, Ordering::Relaxed);
        shared_state
            .prefer_default_output_config
            .store(!config.preemptive_resample, Ordering::Relaxed);
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
            loudness_db,
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
        let loudness_db = self.loudness_db.clone();

        let use_streaming_first_buffer =
            self.should_use_streaming_first_buffer(path, credentials, autoplay);

        // Spawn background thread for decoding
        thread::spawn(move || {
            let result = if use_streaming_first_buffer {
                decode_file_streaming_first_buffer(
                    &path_owned,
                    credentials_owned.as_ref(),
                    &config,
                    device_id,
                    &shared_state,
                    &load_cancel,
                    loudness_db.clone(),
                    generation,
                    &cmd_tx,
                    autoplay,
                    0.0,
                )
                .map(|_| None)
            } else {
                decode_file_internal(
                    &path_owned,
                    credentials_owned.as_ref(),
                    &config,
                    device_id,
                    &shared_state,
                    loudness_enabled,
                    &load_cancel,
                    loudness_db.clone(),
                )
                .map(Some)
            };

            let is_current = shared_state.load_generation.load(Ordering::Acquire) == generation;

            match result {
                Ok(Some(load_result)) => {
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
                Ok(None) => {}
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

        self.shared_state.mark_load_request_returned();
        Ok(())
    }

    fn should_use_streaming_first_buffer(
        &self,
        path: &str,
        credentials: Option<&crate::decoder::HttpCredentials>,
        autoplay: bool,
    ) -> bool {
        self.config.streaming_first_buffer
            && autoplay
            && credentials.is_none()
            && !self.config.use_cache
            && !path.starts_with("http://")
            && !path.starts_with("https://")
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
        self.shared_state.reset_streaming_state();
        if was_loading {
            self.shared_state
                .load_generation
                .fetch_add(1, Ordering::AcqRel);
            self.shared_state.load_progress.store(0, Ordering::Relaxed);
        }
    }

    fn begin_loading_track(&self, path: &str, autoplay: bool) {
        self.shared_state.reset_load_phase_timestamps();
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
        *self.shared_state.current_cached_loudness.write() = None;
    }

    fn prepare_memory_streaming_seek(
        &mut self,
        time_secs: f64,
    ) -> Result<MemoryStreamingSeekRequest, String> {
        let path = self
            .shared_state
            .current_track_path
            .read()
            .clone()
            .or_else(|| self.shared_state.file_path.read().clone())
            .ok_or_else(|| {
                "Cannot seek memory-bounded stream without a current track".to_string()
            })?;
        if path.starts_with("http://") || path.starts_with("https://") {
            return Err("Streaming seek is only available for local files".to_string());
        }

        let sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1);
        let total_frames = self.shared_state.total_frames.load(Ordering::Relaxed);
        let requested_frame = (time_secs.max(0.0) * sample_rate as f64) as u64;
        let target_frame = if total_frames > 0 {
            requested_frame.min(total_frames)
        } else {
            requested_frame
        };
        let target_time_secs = target_frame as f64 / sample_rate as f64;

        self.cancel_current_load();
        GaplessManager::cancel_preload(&self.shared_state);
        let load_cancel = self.create_load_cancel_token();
        let generation = self
            .shared_state
            .load_generation
            .fetch_add(1, Ordering::AcqRel)
            + 1;

        self.shared_state.reset_load_phase_timestamps();
        self.shared_state
            .streaming_generation
            .store(generation, Ordering::Release);
        self.shared_state
            .streaming_decode_finished
            .store(false, Ordering::Release);
        self.shared_state
            .streaming_memory_mode
            .store(true, Ordering::Release);
        self.shared_state
            .streaming_full_buffer_published
            .store(false, Ordering::Release);
        self.shared_state
            .streaming_active
            .store(true, Ordering::Release);
        self.shared_state.audio_buffer.store(Arc::new(Vec::new()));
        self.shared_state
            .dsp_reset_pending
            .store(true, Ordering::Release);
        self.shared_state
            .position_frames
            .store(target_frame, Ordering::Relaxed);
        self.shared_state.state.store(PlayerState::Playing);
        self.shared_state.is_loading.store(true, Ordering::Release);
        self.shared_state.load_progress.store(0, Ordering::Relaxed);
        *self.shared_state.load_error.write() = None;
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_SEEKED, Ordering::Release);

        Ok(MemoryStreamingSeekRequest {
            path,
            generation,
            load_cancel,
            target_time_secs,
        })
    }

    fn restart_memory_streaming_at(&mut self, time_secs: f64) -> Result<(), String> {
        let request = self.prepare_memory_streaming_seek(time_secs)?;
        let path_owned = request.path;
        let shared_state = Arc::clone(&self.shared_state);
        let cmd_tx = self.cmd_tx.clone();
        let config = self.config.clone();
        let device_id = self.device_id;
        let loudness_db = self.loudness_db.clone();
        let load_cancel = Arc::clone(&request.load_cancel);
        let generation = request.generation;
        let target_time_secs = request.target_time_secs;

        thread::spawn(move || {
            let result = decode_file_streaming_first_buffer(
                &path_owned,
                None,
                &config,
                device_id,
                &shared_state,
                &load_cancel,
                loudness_db.clone(),
                generation,
                &cmd_tx,
                true,
                target_time_secs,
            );

            let is_current = shared_state.load_generation.load(Ordering::Acquire) == generation;
            if let Err(e) = result {
                if load_cancel.load(Ordering::Acquire) || !is_current {
                    log::info!(
                        "Streaming seek cancelled for '{}' (generation {}): {}",
                        path_owned,
                        generation,
                        e
                    );
                    return;
                }
                log::error!("Streaming seek failed: {}", e);
                let _ = cmd_tx.send(AudioCommand::LoadError {
                    generation,
                    message: e,
                });
            }
        });

        self.shared_state.mark_load_request_returned();
        Ok(())
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
            if !self.shared_state.exclusive_mode.load(Ordering::Relaxed) {
                self.shared_state.mark_stream_play_returned();
            }
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
        self.shared_state.reset_streaming_state();
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
        self.shared_state.reset_streaming_state();
        self.shared_state
            .position_frames
            .store(0, Ordering::Relaxed);
        self.shared_state.state.store(PlayerState::Stopped);
        let _ = self.cmd_tx.send(AudioCommand::StopForLoad);
    }

    pub fn seek(&mut self, time_secs: f64) -> Result<(), String> {
        if self
            .shared_state
            .streaming_memory_mode
            .load(Ordering::Acquire)
            && self.shared_state.streaming_active.load(Ordering::Acquire)
        {
            return self.restart_memory_streaming_at(time_secs);
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seek_active_memory_streaming_prepares_new_streaming_generation() {
        let mut player = AudioPlayer::new(EngineSettings::default());
        let shared = player.shared_state();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.total_frames.store(44_100 * 60, Ordering::Relaxed);
        shared.position_frames.store(123, Ordering::Relaxed);
        shared.load_generation.store(41, Ordering::Release);
        shared.streaming_generation.store(41, Ordering::Release);
        shared.streaming_memory_mode.store(true, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);
        shared.mark_active_output_stream(44_100, 44_100, 2);
        *shared.current_track_path.write() = Some(r"D:\Music\large.flac".to_string());
        shared
            .streaming_chunks
            .push(state::StreamingAudioChunk {
                generation: 41,
                samples: Arc::new(vec![0.5, 0.5]),
            })
            .expect("streaming queue should have capacity");

        let request = player
            .prepare_memory_streaming_seek(10.0)
            .expect("active memory streaming seek should prepare rebuffer");

        assert_eq!(request.path, r"D:\Music\large.flac");
        assert_eq!(request.generation, 42);
        assert!((request.target_time_secs - 10.0).abs() < f64::EPSILON);
        assert!(!request.load_cancel.load(Ordering::Acquire));
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 42);
        assert_eq!(shared.streaming_generation.load(Ordering::Acquire), 42);
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), 441_000);
        assert!(shared.streaming_active.load(Ordering::Acquire));
        assert!(shared.streaming_memory_mode.load(Ordering::Acquire));
        assert!(!shared.streaming_decode_finished.load(Ordering::Acquire));
        assert!(shared.is_loading.load(Ordering::Acquire));
        assert!(shared.audio_buffer.load().is_empty());
        assert!(shared.streaming_chunks.is_empty());
        assert_eq!(
            shared
                .active_stream_source_sample_rate
                .load(Ordering::Acquire),
            44_100
        );
        assert!(shared.active_output_stream_matches_current());
        assert_ne!(
            shared.event_flags.load(Ordering::Relaxed) & EVENT_PLAYBACK_SEEKED,
            0
        );
    }
}
