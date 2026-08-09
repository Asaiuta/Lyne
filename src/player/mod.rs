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
pub(crate) mod streaming;
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
use loading::decode_file_internal;
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

fn is_remote_http_path(path: &str) -> bool {
    path.starts_with("http://") || path.starts_with("https://")
}

fn is_streaming_first_buffer_source_candidate(path: &str) -> bool {
    !path.is_empty() && (is_remote_http_path(path) || !path.contains("://"))
}

impl AudioPlayer {
    pub fn new(config: EngineSettings) -> Self {
        Self::with_loudness_database(config, None)
    }

    pub fn with_loudness_database(
        config: EngineSettings,
        loudness_db: Option<Arc<LoudnessDatabase>>,
    ) -> Self {
        let initial_config = config.clone();
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

        lockfree_volume_params.set_volume(config.volume as f64);
        lockfree_dynamic_loudness_params.set_volume(config.volume as f64);

        {
            lockfree_noise_shaper_params.set_enabled(config.dither.enabled);
            lockfree_noise_shaper_params.set_bits(config.output_bits);
            lockfree_noise_shaper_params.set_curve(config.dither.noise_shaper_curve);
        }

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
        shared_state
            .output_bits
            .store(config.output_bits, Ordering::Relaxed);
        shared_state.set_resample_quality(config.resample_quality);
        *shared_state.noise_shaper_curve.write() = config.dither.noise_shaper_curve;
        *shared_state.eq_type.write() = config.eq_type.clone();

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
                spectrum_tx,
                phase_response,
                target_lufs,
                replaygain_reference_lufs,
            });
        });

        let exclusive_mode = config.exclusive_mode;
        let dither_enabled = config.dither.enabled;
        let fir_taps = config.fir_taps.unwrap_or(1023);
        let device_id = config.device_id;

        let mut player = Self {
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
        };
        if let Err(error) = player.synchronize_engine_settings(&initial_config) {
            log::error!("Failed to hydrate initial audio settings: {}", error);
        }
        player
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
        self.config.device_id = device_id;
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
        let use_streaming_v2 = use_streaming_first_buffer;

        // Spawn background thread for decoding
        thread::spawn(move || {
            let result = if use_streaming_v2 {
                (|| {
                    use crate::player::streaming::source::StreamSourceFactory;

                    let open_request = crate::player::streaming::source::OpenRequest {
                        generation,
                        intent: crate::player::streaming::source::StreamOpenIntent::InitialPlayback,
                        path: std::path::Path::new(&path_owned),
                        cancel: crate::decoder::DecodeCancelToken::new(Arc::clone(&load_cancel)),
                        credentials: credentials_owned.as_ref(),
                        expected_identity: None,
                        fetch_policy: if is_remote_http_path(&path_owned) {
                            crate::player::streaming::source::StreamFetchPolicy::AllowRemote
                        } else {
                            crate::player::streaming::source::StreamFetchPolicy::LocalOnly
                        },
                    };
                    let opened = if is_remote_http_path(&path_owned) {
                        crate::player::streaming::source::RemoteHttpSourceFactory.open(open_request)
                    } else {
                        crate::player::streaming::source::LocalFileSourceFactory.open(open_request)
                    }
                    .map_err(|error| error.to_string())?;
                    let capacity_bytes = usize::try_from(config.streaming_pcm_window_limit_mib)
                        .ok()
                        .and_then(|mib| mib.checked_mul(1024 * 1024))
                        .ok_or_else(|| "streaming PCM window capacity overflow".to_string())?;
                    let session = crate::player::streaming::session::PersistentStreamingSession::start_local_with_capacity(
                    opened,
                    capacity_bytes,
                    crate::player::streaming::session::LocalSessionConfig {
                        target_output_sample_rate: config.target_samplerate,
                        epoch: 1,
                        origin_frame: 0,
                        phase_response: config.phase_response,
                        resample_quality: config.resample_quality,
                        window_owner: crate::player::streaming::memory::DecodedMemoryOwner::ActiveWindow,
                    },
                )
                .map_err(|error| error.to_string())?;
                    cmd_tx
                        .send(AudioCommand::InstallStreamingV2Session {
                            generation,
                            autoplay,
                            session: Box::new(session),
                        })
                        .map_err(|error| error.to_string())?;
                    Ok(None)
                })()
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
        if !self.config.streaming_first_buffer || !autoplay || self.config.use_cache {
            return false;
        }

        if credentials.is_some() {
            return false;
        }

        is_streaming_first_buffer_source_candidate(path)
    }

    fn create_load_cancel_token(&mut self) -> Arc<AtomicBool> {
        let cancel = Arc::new(AtomicBool::new(false));
        self.current_load_cancel = Some(Arc::clone(&cancel));
        cancel
    }

    fn cancel_current_load(&mut self) {
        self.cancel_current_load_inner(false);
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
        // Slot-published reset (not a bare store): supersedes any unconsumed
        // seek request from the previous track so it cannot be applied to the
        // newly loading one.
        self.shared_state.request_seek_to_frame(0);
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

    fn can_resume_inline_on_warm_shared_stream(&self) -> bool {
        !self.shared_state.exclusive_mode.load(Ordering::Relaxed)
            && self
                .shared_state
                .active_stream_running
                .load(Ordering::Acquire)
            && self.shared_state.active_output_stream_matches_current()
    }

    pub fn play(&mut self) -> Result<(), String> {
        let previous = self.shared_state.state.load();
        if previous == PlayerState::Paused {
            if !self.shared_state.exclusive_mode.load(Ordering::Relaxed) {
                self.shared_state.mark_stream_play_returned();
                command_handlers::mark_playback_started(&self.shared_state);
                if self.can_resume_inline_on_warm_shared_stream() {
                    return Ok(());
                }
            }
        }
        let _ = self.cmd_tx.send(AudioCommand::Play);
        Ok(())
    }

    pub fn pause(&mut self) -> Result<(), String> {
        self.shared_state.state.store(PlayerState::Paused);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_PAUSED, Ordering::Release);
        if self.shared_state.exclusive_mode.load(Ordering::Relaxed) {
            let _ = self.cmd_tx.send(AudioCommand::Pause);
        }
        Ok(())
    }

    pub fn stop(&mut self) {
        self.cancel_current_load();
        self.shared_state.reset_streaming_state();
        // Slot-published reset: also invalidates any unconsumed seek request.
        self.shared_state.request_seek_to_frame(0);
        self.shared_state.state.store(PlayerState::Stopped);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_STOPPED, Ordering::Release);
        let _ = self.cmd_tx.send(AudioCommand::Stop);
    }

    fn stop_for_track_load(&self) {
        self.shared_state.reset_streaming_state();
        // Slot-published reset: also invalidates any unconsumed seek request.
        self.shared_state.request_seek_to_frame(0);
        self.shared_state.state.store(PlayerState::Stopped);
        let _ = self.cmd_tx.send(AudioCommand::StopForLoad);
    }

    pub fn seek(&mut self, time_secs: f64) -> Result<(), String> {
        log::info!(
            "v2 src-seek: player.seek entry t={time_secs} v2={}",
            self.shared_state.streaming_v2_enabled.load(Ordering::Acquire)
        );
        self.shared_state.reset_seek_phase_timestamps();
        // V2 seeks are handled by the audio thread against the resident window
        // session. Keep routing through that path while the engine is v2 even
        // after a stop (the session is retained), so a stopped seek updates
        // the position exactly like the legacy path does.
        if self.shared_state.streaming_v2_enabled.load(Ordering::Acquire) {
            self.cmd_tx
                .send(AudioCommand::Seek(time_secs))
                .map_err(|error| format!("Failed to send v2 seek command: {error}"))?;
            self.shared_state
                .event_flags
                .fetch_or(EVENT_PLAYBACK_SEEKED, Ordering::Release);
            self.shared_state.mark_seek_request_returned();
            return Ok(());
        }
        let sr = self.shared_state.sample_rate.load(Ordering::Relaxed) as f64;
        let total = self.shared_state.total_frames.load(Ordering::Relaxed);
        let new_pos = ((time_secs.max(0.0) * sr) as u64).min(total);
        // M1 fix: publish through the seek slot instead of a bare
        // `position_frames` store the callback could clobber.
        self.shared_state.request_seek_to_frame(new_pos);
        self.shared_state
            .event_flags
            .fetch_or(EVENT_PLAYBACK_SEEKED, Ordering::Release);
        self.cmd_tx
            .send(AudioCommand::Seek(time_secs))
            .map_err(|e| format!("Failed to send seek command: {}", e))?;
        self.shared_state.mark_seek_request_returned();
        Ok(())
    }

    pub fn set_volume(&mut self, vol: f64) {
        let clamped_vol = vol.clamp(0.0, 1.0);
        self.config.volume = clamped_vol as f32;
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

    fn build_streaming_policy_player(use_cache: bool) -> AudioPlayer {
        AudioPlayer::new(EngineSettings {
            streaming_first_buffer: true,
            use_cache,
            ..EngineSettings::default()
        })
    }

    #[test]
    fn streaming_first_buffer_allows_local_and_http_autoplay_without_cache_or_credentials() {
        let player = build_streaming_policy_player(false);

        assert!(player.should_use_streaming_first_buffer(r"D:\Music\song.flac", None, true));
        assert!(player.should_use_streaming_first_buffer(
            "http://media.example.test/song.flac",
            None,
            true
        ));
        assert!(player.should_use_streaming_first_buffer(
            "https://m701.music.126.net/song.flac",
            None,
            true
        ));
    }

    #[test]
    fn streaming_first_buffer_rejects_cache_credentials_non_autoplay_and_unknown_schemes() {
        let player = build_streaming_policy_player(false);
        let cached_player = build_streaming_policy_player(true);
        let credentials = crate::decoder::HttpCredentials {
            username: "user".to_string(),
            password: "pass".to_string(),
        };

        assert!(!player.should_use_streaming_first_buffer(
            "https://dav.example.test/song.flac",
            Some(&credentials),
            true
        ));
        assert!(!cached_player.should_use_streaming_first_buffer(
            "https://m701.music.126.net/song.flac",
            None,
            true
        ));
        assert!(!player.should_use_streaming_first_buffer(
            "https://m701.music.126.net/song.flac",
            None,
            false
        ));
        assert!(!player.should_use_streaming_first_buffer(
            "ftp://media.example.test/song.flac",
            None,
            true
        ));
    }

    #[test]
    fn cancelling_current_load_clears_streaming_state_and_signals_decode_thread() {
        let mut player = build_streaming_policy_player(false);
        let shared = player.shared_state();
        let cancel = player.create_load_cancel_token();

        shared.is_loading.store(true, Ordering::Release);
        shared.load_generation.store(7, Ordering::Release);
        shared.streaming_active.store(true, Ordering::Release);

        player.cancel_current_load();

        assert!(cancel.load(Ordering::Acquire));
        assert!(!shared.streaming_active.load(Ordering::Acquire));
        assert_eq!(shared.load_generation.load(Ordering::Acquire), 8);
        assert_eq!(shared.load_progress.load(Ordering::Relaxed), 0);
    }

    fn build_resume_player() -> (AudioPlayer, Arc<SharedState>) {
        let player = AudioPlayer::new(EngineSettings::default());
        let shared = player.shared_state();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.device_id.store(-1, Ordering::Relaxed);
        shared.exclusive_mode.store(false, Ordering::Relaxed);
        shared
            .prefer_default_output_config
            .store(false, Ordering::Relaxed);
        shared.load_generation.store(7, Ordering::Release);
        shared.mark_active_output_stream(44_100, 44_100, 2, 2);
        (player, shared)
    }

    #[test]
    fn warm_shared_resume_can_inline_only_when_running_and_key_matches() {
        let (player, shared) = build_resume_player();

        assert!(player.can_resume_inline_on_warm_shared_stream());

        shared.mark_active_output_stream_paused();
        assert!(!player.can_resume_inline_on_warm_shared_stream());

        shared.mark_active_output_stream_running();
        shared.channels.store(1, Ordering::Relaxed);
        assert!(!player.can_resume_inline_on_warm_shared_stream());

        shared.channels.store(2, Ordering::Relaxed);
        shared.exclusive_mode.store(true, Ordering::Relaxed);
        assert!(!player.can_resume_inline_on_warm_shared_stream());
    }

    #[test]
    fn play_from_paused_warm_shared_stream_resumes_inline() {
        let (mut player, shared) = build_resume_player();
        shared.state.store(PlayerState::Paused);
        shared.event_flags.store(0, Ordering::Release);

        player.play().expect("warm shared resume should succeed");

        assert_eq!(shared.state.load(), PlayerState::Playing);
        assert_ne!(
            shared.event_flags.load(Ordering::Acquire) & EVENT_PLAYBACK_STARTED,
            0
        );
        assert!(shared.stream_play_returned_ms.load(Ordering::Acquire) > 0);
        assert_eq!(
            shared.stream_play_generation.load(Ordering::Acquire),
            shared.load_generation.load(Ordering::Acquire)
        );
    }

    #[test]
    fn shared_pause_keeps_warm_output_stream_running() {
        let (mut player, shared) = build_resume_player();
        shared.state.store(PlayerState::Playing);
        shared.event_flags.store(0, Ordering::Release);
        assert!(shared.active_stream_running.load(Ordering::Acquire));

        player.pause().expect("pause should succeed");

        assert_eq!(shared.state.load(), PlayerState::Paused);
        assert_ne!(
            shared.event_flags.load(Ordering::Acquire) & EVENT_PLAYBACK_PAUSED,
            0
        );
        assert!(
            shared.active_stream_running.load(Ordering::Acquire),
            "shared-mode pause keeps the CPAL stream warm and lets the callback output silence"
        );
    }

    #[test]
    fn plain_full_buffer_seek_publishes_through_seek_slot() {
        let mut player = AudioPlayer::new(EngineSettings::default());
        let shared = player.shared_state();
        shared.sample_rate.store(44_100, Ordering::Relaxed);
        shared.total_frames.store(44_100 * 60, Ordering::Relaxed);

        let serial_before = shared
            .playback_clock
            .requested
            .seek_slot_serial
            .load(Ordering::Acquire);
        player.seek(2.0).expect("plain seek should succeed");

        assert!(
            shared
                .playback_clock
                .requested
                .seek_slot_serial
                .load(Ordering::Acquire)
                > serial_before,
            "the plain seek path must publish through the seek slot"
        );
        assert_eq!(
            shared
                .playback_clock
                .requested
                .seek_slot_target_frames
                .load(Ordering::Acquire),
            88_200
        );
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            88_200
        );
        assert_ne!(
            shared.event_flags.load(Ordering::Relaxed) & EVENT_PLAYBACK_SEEKED,
            0
        );
    }
}
