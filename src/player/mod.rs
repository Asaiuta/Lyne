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
use loading::{
    decode_file_internal, decode_file_streaming_first_buffer, replay_streaming_in_window,
    InWindowReplayRequest, IN_WINDOW_MIN_PREFIX_FRAMES,
};
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
        self.cancel_current_load_inner(false);
    }

    fn cancel_current_load_for_pending_load(&mut self) {
        self.cancel_current_load_inner(true);
    }

    fn cancel_current_load_inner(&mut self, loading_after_cancel: bool) {
        let was_loading = self
            .shared_state
            .is_loading
            .swap(loading_after_cancel, Ordering::AcqRel);
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

        let (generation, load_cancel) = self.begin_streaming_seek_generation(target_frame);

        Ok(MemoryStreamingSeekRequest {
            path,
            generation,
            load_cancel,
            target_time_secs,
        })
    }

    /// Clean-stop the current streaming load, bump to a fresh load generation,
    /// and re-apply the generation-scoped seek flags + synchronous
    /// `position_frames`. Shared by the normal rebuffer path
    /// ([`Self::prepare_memory_streaming_seek`]) and the in-window replay path
    /// ([`Self::try_restart_memory_streaming_in_window`]).
    ///
    /// `cancel_current_load_for_pending_load` calls `reset_streaming_state`,
    /// which sets `streaming_active=false`, drains the forward queue, clears the
    /// queue window, and clears the retention ring. The clean stop is what makes
    /// the realtime callback stop consuming on the old generation so the
    /// synchronous `position_frames = target_frame` set inside
    /// `apply_streaming_seek_generation_state` actually sticks (fast convergence)
    /// instead of being overwritten by the old-generation callback.
    ///
    /// The in-window path MUST extract its replay prefix from the retention ring
    /// **before** calling this, because the reset clears the ring.
    fn begin_streaming_seek_generation(&mut self, target_frame: u64) -> (u64, Arc<AtomicBool>) {
        self.cancel_current_load_for_pending_load();
        GaplessManager::cancel_preload(&self.shared_state);
        self.shared_state.load_progress.store(0, Ordering::Relaxed);
        let load_cancel = self.create_load_cancel_token();
        let generation = self
            .shared_state
            .load_generation
            .fetch_add(1, Ordering::AcqRel)
            + 1;
        self.apply_streaming_seek_generation_state(generation, target_frame);
        (generation, load_cancel)
    }

    /// Set the generation-scoped streaming flags and playback markers a memory
    /// seek needs once the seek target is known. Called by
    /// [`Self::begin_streaming_seek_generation`] after the clean stop, so both
    /// the normal rebuffer path and the in-window replay path re-apply identical
    /// flags. It intentionally does **not** clear streaming state or the
    /// retention ring; the preceding `cancel_current_load_for_pending_load`
    /// (via `reset_streaming_state`) owns that.
    fn apply_streaming_seek_generation_state(&mut self, generation: u64, target_frame: u64) {
        self.shared_state.reset_load_phase_timestamps();
        self.shared_state
            .streaming_generation
            .store(generation, Ordering::Release);
        self.shared_state
            .reset_streaming_queue_window_for_generation(generation);
        self.shared_state
            .streaming_decode_finished
            .store(false, Ordering::Release);
        self.shared_state
            .streaming_memory_mode
            .store(true, Ordering::Release);
        self.shared_state
            .streaming_full_buffer_published
            .store(false, Ordering::Release);
        self.shared_state.audio_buffer.store(Arc::new(Vec::new()));
        self.shared_state
            .dsp_reset_pending
            .store(true, Ordering::Release);
        self.shared_state
            .position_frames
            .store(target_frame, Ordering::Relaxed);
        self.shared_state.state.store(PlayerState::Playing);
        self.shared_state
            .streaming_active
            .store(true, Ordering::Release);
        *self.shared_state.load_error.write() = None;
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_SEEKED, Ordering::Release);
    }

    /// Attempt to serve a memory-streaming seek from the retention ring with zero
    /// decode. Returns `Ok(true)` when the seek was served in-window, `Ok(false)`
    /// when it misses (forward in-window, target before the oldest retained
    /// frame, prefix below the gate, or empty ring) and the caller must fall back
    /// to the normal rebuffer path.
    ///
    /// The hit test + prefix extraction run **before** any destructive reset, so
    /// the ring is still populated. On a hit we extract the prefix, then clear the
    /// ring (it repopulates as the new generation plays).
    fn try_restart_memory_streaming_in_window(&mut self, time_secs: f64) -> Result<bool, String> {
        let path = match self
            .shared_state
            .current_track_path
            .read()
            .clone()
            .or_else(|| self.shared_state.file_path.read().clone())
        {
            Some(path) => path,
            None => return Ok(false),
        };
        if path.starts_with("http://") || path.starts_with("https://") {
            return Ok(false);
        }

        let output_sample_rate = self.shared_state.sample_rate.load(Ordering::Relaxed).max(1);
        let total_frames = self.shared_state.total_frames.load(Ordering::Relaxed);
        let channels = self.shared_state.channels.load(Ordering::Relaxed).max(1) as usize;
        let requested_frame = (time_secs.max(0.0) * output_sample_rate as f64) as u64;
        let target_frame = if total_frames > 0 {
            requested_frame.min(total_frames)
        } else {
            requested_frame
        };
        let playhead = self.shared_state.position_frames.load(Ordering::Relaxed);

        // MVP: only backward/at seeks (target <= playhead) can hit the ring;
        // forward in-window data lives only in the live forward queue (deferred).
        if target_frame > playhead {
            return Ok(false);
        }
        let ring = &self.shared_state.streaming_retention_ring;
        match ring.oldest_start_frame() {
            Some(oldest) if target_frame >= oldest => {}
            _ => return Ok(false),
        }
        let prefix = match ring.take_replay_prefix(target_frame) {
            Some(prefix) if prefix.prefix_frames >= IN_WINDOW_MIN_PREFIX_FRAMES => prefix,
            _ => return Ok(false),
        };

        // Hit: capture the format/metadata and extract the replay prefix BEFORE
        // any reset. The clean stop below (`reset_streaming_state` via
        // `begin_streaming_seek_generation`) clears the retention ring, so the
        // prefix must already be in hand.
        let metadata = self.shared_state.track_metadata.read().clone();
        let cached_loudness = self.shared_state.current_cached_loudness.read().clone();

        // Mirror the normal rebuffer path's clean-stop + re-apply sequence so the
        // realtime callback stops consuming on the old generation and the
        // synchronous `position_frames = audible_start_frame` sticks (fast
        // convergence). `begin_streaming_seek_generation` cancels the in-flight
        // load, calls `reset_streaming_state` (streaming_active=false, drains the
        // forward queue, clears the queue window AND the retention ring), bumps
        // the load generation, then re-applies the seek flags
        // (streaming_active=true, position_frames=target, ...). The prefix was
        // already extracted above, so clearing the ring here is fine; the new
        // generation repopulates it as the prefix is consumed.
        let (generation, load_cancel) =
            self.begin_streaming_seek_generation(prefix.audible_start_frame);

        let request = InWindowReplayRequest {
            path,
            generation,
            channels,
            output_sample_rate: output_sample_rate as u32,
            total_frames,
            metadata,
            cached_loudness,
            prefix,
        };

        let shared_state = Arc::clone(&self.shared_state);
        let cmd_tx = self.cmd_tx.clone();
        let config = self.config.clone();
        let device_id = self.device_id;
        let loudness_db = self.loudness_db.clone();
        let load_cancel_thread = Arc::clone(&load_cancel);
        let path_for_log = request.path.clone();

        thread::spawn(move || {
            let result = replay_streaming_in_window(
                &config,
                device_id,
                &shared_state,
                &load_cancel_thread,
                loudness_db,
                &cmd_tx,
                request,
            );

            let is_current = shared_state.load_generation.load(Ordering::Acquire) == generation;
            if let Err(e) = result {
                if load_cancel_thread.load(Ordering::Acquire) || !is_current {
                    log::info!(
                        "In-window streaming seek cancelled for '{}' (generation {}): {}",
                        path_for_log,
                        generation,
                        e
                    );
                    return;
                }
                log::error!("In-window streaming seek failed: {}", e);
                let _ = cmd_tx.send(AudioCommand::LoadError {
                    generation,
                    message: e,
                });
            }
        });

        self.shared_state.mark_load_request_returned();
        Ok(true)
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
            // Try serving the seek from the retained PCM ring with zero decode
            // (backward/at, in-window). On a miss, fall back to the rebuffer path.
            if self.try_restart_memory_streaming_in_window(time_secs)? {
                return Ok(());
            }
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

    fn build_in_window_player() -> (AudioPlayer, Arc<SharedState>) {
        let player = AudioPlayer::new(EngineSettings::default());
        let shared = player.shared_state();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.total_frames.store(44_100 * 240, Ordering::Relaxed);
        shared.load_generation.store(50, Ordering::Release);
        shared.streaming_generation.store(50, Ordering::Release);
        shared.streaming_memory_mode.store(true, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);
        *shared.current_track_path.write() = Some(r"D:\Music\large.flac".to_string());
        (player, shared)
    }

    fn push_retained_window(shared: &SharedState, start_frame: u64, chunk_frames: u64, count: u64) {
        for i in 0..count {
            let frames = chunk_frames;
            shared.streaming_retention_ring.push(state::RetainedChunk {
                samples: Arc::new(vec![0.0; (frames * 2) as usize]),
                generation: 50,
                start_frame: start_frame + i * frames,
                frames: frames as u32,
            });
        }
    }

    #[test]
    fn in_window_seek_misses_on_empty_ring() {
        let (mut player, shared) = build_in_window_player();
        shared.position_frames.store(44_100 * 8, Ordering::Relaxed);

        // No retained chunks -> miss, no state mutation, generation unchanged.
        let served = player
            .try_restart_memory_streaming_in_window(2.0)
            .expect("classification should not fail");
        assert!(!served);
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 50);
    }

    #[test]
    fn in_window_seek_misses_forward_target() {
        let (mut player, shared) = build_in_window_player();
        let playhead = 44_100 * 8;
        shared.position_frames.store(playhead, Ordering::Relaxed);
        // A wide retained window behind the playhead exists...
        push_retained_window(&shared, 0, 4096, 200);

        // ...but a FORWARD seek (target > playhead) is a miss for the MVP.
        let served = player
            .try_restart_memory_streaming_in_window(20.0)
            .expect("classification should not fail");
        assert!(!served);
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 50);
    }

    #[test]
    fn in_window_seek_misses_before_oldest_retained_frame() {
        let (mut player, shared) = build_in_window_player();
        let playhead = 44_100 * 8;
        shared.position_frames.store(playhead, Ordering::Relaxed);
        // Retained window starts at 5 s; a seek to 1 s is before the oldest.
        push_retained_window(&shared, 44_100 * 5, 4096, 50);

        let served = player
            .try_restart_memory_streaming_in_window(1.0)
            .expect("classification should not fail");
        assert!(!served);
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 50);
    }

    #[test]
    fn in_window_seek_misses_when_prefix_below_gate() {
        let (mut player, shared) = build_in_window_player();
        let playhead = 44_100 * 8;
        shared.position_frames.store(playhead, Ordering::Relaxed);
        // Only one chunk retained ending right at the playhead: a backward seek
        // into it yields a prefix far below IN_WINDOW_MIN_PREFIX_FRAMES.
        let chunk_frames = 4096;
        push_retained_window(&shared, playhead - chunk_frames, chunk_frames, 1);

        let target_secs = (playhead - chunk_frames) as f64 / 44_100.0;
        let served = player
            .try_restart_memory_streaming_in_window(target_secs)
            .expect("classification should not fail");
        assert!(!served);
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 50);
    }

    #[test]
    fn in_window_seek_hit_clean_stops_and_reapplies_state() {
        let (mut player, shared) = build_in_window_player();
        let chunk_frames: u64 = 4096;
        let playhead = chunk_frames * 200; // 819_200
        shared.position_frames.store(playhead, Ordering::Relaxed);

        // A wide retained window behind the playhead, with a prefix far above the
        // gate so the backward seek is a hit.
        push_retained_window(&shared, 0, chunk_frames, 200);

        // The forward queue is still FULL of old-generation chunks at seek time
        // (capacity 128). The clean stop (reset_streaming_state) must drain it so
        // the new-generation prefix pushes do not stall in the backpressure loop.
        for _ in 0..128 {
            let _ = shared.streaming_chunks.push(state::StreamingAudioChunk {
                generation: 50,
                samples: Arc::new(vec![0.0; (chunk_frames * 2) as usize]),
            });
        }
        assert!(shared.streaming_chunks.is_full());

        // Seek backward to the start of chunk index 1 (an exact chunk boundary).
        let target_frame = chunk_frames; // 4096
        let target_secs = target_frame as f64 / 44_100.0;
        let served = player
            .try_restart_memory_streaming_in_window(target_secs)
            .expect("classification should not fail");

        assert!(served, "a wide backward in-window seek must be served");
        // Generation bumped past the stale 50.
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 51);
        assert_eq!(shared.streaming_generation.load(Ordering::Acquire), 51);
        // The clean stop drained the stale forward queue.
        assert!(
            shared.streaming_chunks.is_empty(),
            "the clean stop must drain the stale forward queue on an in-window hit"
        );
        // Position snapped synchronously to the audible start of the target chunk
        // (this is what makes convergence fast: the callback was cleanly stopped
        // so the synchronous set sticks).
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), target_frame);
        // The ring was cleared by reset_streaming_state after the prefix was
        // extracted; the new generation repopulates it as it plays.
        assert_eq!(shared.streaming_retention_ring.oldest_start_frame(), None);
        // Streaming flags were re-applied after the reset: the new generation is
        // active in memory mode, ready for the replay producer's prefix.
        assert!(
            shared.streaming_active.load(Ordering::Acquire),
            "streaming_active must be re-applied after the clean stop"
        );
        assert!(shared.streaming_memory_mode.load(Ordering::Acquire));
        assert!(!shared.streaming_decode_finished.load(Ordering::Acquire));
        assert!(shared.is_loading.load(Ordering::Acquire));
        assert!(shared.audio_buffer.load().is_empty());
        assert_ne!(
            shared.event_flags.load(Ordering::Relaxed) & EVENT_PLAYBACK_SEEKED,
            0
        );
    }
}
