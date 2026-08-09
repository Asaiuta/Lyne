//! Configuration setters/getters for resampling, cache, IR convolution,
//! gapless queue, and output bit depth / loudness mode introspection.
//!
//! These methods only touch fields and channels already owned by the player;
//! grouping them here keeps `mod.rs` focused on the core lifecycle (new,
//! load, transport, Drop) while keeping the public API surface unchanged.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::{AudioCommand, AudioPlayer, GaplessManager};
use crate::config::{EngineSettings, EngineSettingsUpdate};
use crate::player::state::{
    PlayerState, SharedState, EVENT_NEEDS_PRELOAD_RESET, EVENT_PLAYBACK_STARTED,
    EVENT_TRACK_CHANGED,
};
use crate::processor::AtomicLoudnessState;

impl AudioPlayer {
    pub fn get_target_sample_rate(&self) -> Option<u32> {
        self.config.target_samplerate
    }

    pub fn set_target_sample_rate(&mut self, sample_rate: Option<u32>) {
        self.config.target_samplerate = sample_rate;
    }

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
        self.shared_state.set_resample_quality(quality);
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
        self.shared_state
            .prefer_default_output_config
            .store(!enabled, Ordering::Relaxed);
        log::info!(
            "Preemptive resample {}",
            if enabled { "enabled" } else { "disabled" }
        );
    }

    pub fn set_streaming_first_buffer(&mut self, enabled: bool) {
        self.config.streaming_first_buffer = enabled;
    }

    pub fn set_streaming_pcm_window_limit_mib(&mut self, limit_mib: u64) {
        self.config.streaming_pcm_window_limit_mib = limit_mib;
    }

    pub fn set_use_next_prefetch(&mut self, enabled: bool) {
        self.config.use_next_prefetch = enabled;
    }

    pub fn set_exclusive_mode(&mut self, enabled: bool) {
        self.exclusive_mode = enabled;
        self.config.exclusive_mode = enabled;
        self.shared_state
            .exclusive_mode
            .store(enabled, Ordering::Relaxed);
    }

    pub fn set_dither_enabled(&mut self, enabled: bool) {
        self.dither_enabled = enabled;
        self.config.dither.enabled = enabled;
        self.lockfree_noise_shaper_params.set_enabled(enabled);
    }

    pub fn synchronize_engine_settings(&mut self, settings: &EngineSettings) -> Result<(), String> {
        self.set_volume(settings.volume as f64);
        self.select_device(settings.device_id)?;
        self.set_exclusive_mode(settings.exclusive_mode);
        self.apply_eq_configuration(settings)?;
        self.set_dither_enabled(settings.dither.enabled);
        self.set_output_bits(settings.output_bits);
        self.set_noise_shaper_curve(settings.dither.noise_shaper_curve)?;
        self.set_loudness_enabled(settings.loudness.enabled);
        self.set_target_lufs(settings.loudness.target_lufs);
        self.set_preamp_gain(settings.dynamic_loudness.pre_gain_db);
        self.set_normalization_mode(settings.loudness.mode);

        self.lockfree_saturation_params
            .set_sat_type(settings.saturation.sat_type.into());
        self.lockfree_saturation_params
            .set_quality(settings.saturation.quality.into());
        self.lockfree_saturation_params
            .set_drive(settings.saturation.drive);
        self.lockfree_saturation_params
            .set_threshold(settings.saturation.threshold);
        self.lockfree_saturation_params
            .set_mix(settings.saturation.mix);
        self.lockfree_saturation_params
            .set_input_gain(settings.saturation.input_gain_db);
        self.lockfree_saturation_params
            .set_output_gain(settings.saturation.output_gain_db);
        self.lockfree_saturation_params
            .set_enabled(settings.saturation.enabled);

        self.set_crossfeed_enabled(settings.crossfeed.enabled);
        self.set_crossfeed_mix(settings.crossfeed.mix);
        self.set_dynamic_loudness_enabled(settings.dynamic_loudness.enabled);
        self.set_dynamic_loudness_strength(settings.dynamic_loudness.strength);

        self.set_target_sample_rate(settings.target_samplerate);
        self.set_resample_quality(settings.resample_quality);
        self.set_use_cache(settings.use_cache);
        self.set_preemptive_resample(settings.preemptive_resample);
        self.set_streaming_first_buffer(settings.streaming_first_buffer);
        self.set_streaming_pcm_window_limit_mib(settings.streaming_pcm_window_limit_mib);
        self.set_use_next_prefetch(settings.use_next_prefetch);
        self.config = settings.clone();
        Ok(())
    }

    pub fn apply_engine_settings_update(
        &mut self,
        update: &EngineSettingsUpdate,
        desired: &EngineSettings,
    ) -> Result<(), String> {
        if update.device_id.is_some() {
            self.select_device(desired.device_id)?;
        }
        if update.exclusive_mode.is_some() {
            self.set_exclusive_mode(desired.exclusive_mode);
        }
        if update.volume.is_some() {
            self.set_volume(desired.volume as f64);
        }
        if update.eq_type.is_some() || update.eq_bands.is_some() || update.fir_taps.is_some() {
            self.apply_eq_configuration(desired)?;
        }
        if update.dither_enabled.is_some() {
            self.set_dither_enabled(desired.dither.enabled);
        }
        if update.output_bits.is_some() {
            self.set_output_bits(desired.output_bits);
        }
        if update.noise_shaper_curve.is_some() {
            self.set_noise_shaper_curve(desired.dither.noise_shaper_curve)?;
        }
        if update.loudness_enabled.is_some() {
            self.set_loudness_enabled(desired.loudness.enabled);
        }
        if update.target_lufs.is_some() {
            self.set_target_lufs(desired.loudness.target_lufs);
        }
        if update.preamp_db.is_some() {
            self.set_preamp_gain(desired.dynamic_loudness.pre_gain_db);
        }
        if update.loudness_mode.is_some() {
            self.set_normalization_mode(desired.loudness.mode);
        }
        if update.saturation_enabled.is_some() {
            self.set_saturation_enabled(desired.saturation.enabled);
        }
        if update.saturation_drive.is_some() {
            self.set_saturation_drive(desired.saturation.drive);
        }
        if update.saturation_mix.is_some() {
            self.set_saturation_mix(desired.saturation.mix);
        }
        if update.crossfeed_enabled.is_some() {
            self.set_crossfeed_enabled(desired.crossfeed.enabled);
        }
        if update.crossfeed_mix.is_some() {
            self.set_crossfeed_mix(desired.crossfeed.mix);
        }
        if update.dynamic_loudness_enabled.is_some() {
            self.set_dynamic_loudness_enabled(desired.dynamic_loudness.enabled);
        }
        if update.dynamic_loudness_strength.is_some() {
            self.set_dynamic_loudness_strength(desired.dynamic_loudness.strength);
        }
        if update.target_samplerate.is_some() {
            self.set_target_sample_rate(desired.target_samplerate);
        }
        if update.resample_quality.is_some() {
            self.set_resample_quality(desired.resample_quality);
        }
        if update.use_cache.is_some() {
            self.set_use_cache(desired.use_cache);
        }
        if update.preemptive_resample.is_some() {
            self.set_preemptive_resample(desired.preemptive_resample);
        }
        if update.streaming_first_buffer.is_some() {
            self.set_streaming_first_buffer(desired.streaming_first_buffer);
        }
        if update.streaming_pcm_window_limit_mib.is_some() {
            self.set_streaming_pcm_window_limit_mib(desired.streaming_pcm_window_limit_mib);
        }
        if update.use_next_prefetch.is_some() {
            self.set_use_next_prefetch(desired.use_next_prefetch);
        }
        self.config = desired.clone();
        Ok(())
    }

    pub fn apply_eq_settings(&mut self, settings: &EngineSettings) -> Result<(), String> {
        self.apply_eq_configuration(settings)?;
        self.config.eq_type = settings.eq_type.clone();
        self.config.eq_bands = settings.eq_bands.clone();
        self.config.fir_taps = settings.fir_taps;
        Ok(())
    }

    fn apply_eq_configuration(&mut self, settings: &EngineSettings) -> Result<(), String> {
        const BANDS: [&str; 10] = [
            "31", "62", "125", "250", "500", "1000", "2000", "4000", "8000", "16000",
        ];
        let gains = std::array::from_fn(|index| {
            settings
                .eq_bands
                .as_ref()
                .and_then(|bands| bands.get(BANDS[index]))
                .copied()
                .unwrap_or(0.0)
        });

        if settings.eq_type.eq_ignore_ascii_case("FIR") {
            if self.is_fir_eq_enabled() {
                self.disable_fir_eq();
            }
            self.set_fir_bands(&gains)?;
            self.enable_fir_eq(settings.fir_taps.unwrap_or(1023))?;
        } else {
            if self.is_fir_eq_enabled() {
                self.disable_fir_eq();
            }
            for (index, gain) in gains.iter().enumerate() {
                self.lockfree_eq_params.set_band_gain(index, *gain);
            }
            self.lockfree_eq_params.set_enabled(true);
            *self.shared_state.eq_type.write() = "IIR".to_string();
        }
        Ok(())
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
        // Streaming-v2 playback: preload through a second windowed session
        // (gapless pending swap) instead of the legacy full-buffer decode.
        if self.config.streaming_first_buffer
            && self.shared_state.streaming_v2_enabled.load(Ordering::Acquire)
        {
            return self.queue_next_streaming_v2(path, credentials);
        }
        let mode = self.config.loudness.mode;
        GaplessManager::queue_next(
            &self.shared_state,
            &self.loudness_normalizer,
            &self.config,
            path,
            credentials,
            self.loudness_enabled,
            mode,
            self.loudness_db.clone(),
        )
    }

    /// Gapless preload for the streaming-v2 engine: opens the next track as a
    /// windowed session at the current output format and hands it to the audio
    /// thread as the pending swap target (consumed at the current track's EOF).
    fn queue_next_streaming_v2(
        &self,
        path: &str,
        credentials: Option<crate::decoder::HttpCredentials>,
    ) -> Result<(), String> {
        if self
            .shared_state
            .streaming_pending_ready
            .load(Ordering::Acquire)
        {
            log::debug!("Gapless(v2): pending already ready, ignoring queue_next");
            return Ok(());
        }
        let path = path.to_string();
        let generation = self.shared_state.load_generation.load(Ordering::Acquire);
        let config = self.config.clone();
        let cmd_tx = self.cmd_tx.clone();
        let shared_state = Arc::clone(&self.shared_state);
        // Hand the upcoming track path + metadata to the gapless chain early —
        // the same slots legacy preload uses; the WS coordinator publishes them
        // when the callback fires EVENT_TRACK_CHANGED at the swap. The lofty
        // parse is blocking file I/O, so it runs inside the preload thread.
        *shared_state.pending_file_path.write() = Some(path.clone());
        // Force the preload session to the active output format (the callback
        // does not channel-resample on swap; it only switches `channels`).
        let active_sample_rate = self.shared_state.sample_rate.load(Ordering::Acquire) as u32;
        let active_channels = self.shared_state.channels.load(Ordering::Acquire).max(1) as usize;
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));

        std::thread::spawn(move || {
            use crate::player::streaming::source::{StreamSourceFactory, StreamFetchPolicy};
            log::info!("Gapless preload(v2) started: {}", path);
            let open_request = crate::player::streaming::source::OpenRequest {
                generation,
                intent: crate::player::streaming::source::StreamOpenIntent::GaplessPreload,
                path: std::path::Path::new(&path),
                cancel: crate::decoder::DecodeCancelToken::new(Arc::clone(&cancel)),
                credentials: credentials.as_ref(),
                expected_identity: None,
                fetch_policy: if super::is_remote_http_path(&path) {
                    StreamFetchPolicy::AllowRemote
                } else {
                    StreamFetchPolicy::LocalOnly
                },
            };
            let result = if super::is_remote_http_path(&path) {
                crate::player::streaming::source::RemoteHttpSourceFactory.open(open_request)
            } else {
                crate::player::streaming::source::LocalFileSourceFactory.open(open_request)
            }
            .map_err(|error| error.to_string());
            let opened = match result {
                Ok(opened) => opened,
                Err(error) => {
                    log::warn!("Gapless preload(v2) open failed: {}", error);
                    return;
                }
            };
            let capacity_bytes = usize::try_from(config.streaming_pcm_window_limit_mib)
                .ok()
                .and_then(|mib| mib.checked_mul(1024 * 1024))
                .unwrap_or(64 * 1024 * 1024);
            // Publish basic metadata for the upcoming track so the WS gapless
            // chain can hand over title/artist instead of leaving stale data.
            let mut preload_metadata = crate::decoder::TrackMetadata::default();
            if let Some(lofty) = crate::metadata::extract_lofty_metadata(&path) {
                crate::metadata::merge_lofty_into(&mut preload_metadata, &lofty);
            }
            if !preload_metadata.title.is_none() {
                *shared_state.pending_metadata.write() = Some(preload_metadata);
            }
            let session = match crate::player::streaming::session::PersistentStreamingSession::
                start_local_with_capacity(
                    opened,
                    capacity_bytes,
                    crate::player::streaming::session::LocalSessionConfig {
                        target_output_sample_rate: Some(active_sample_rate),
                        epoch: 1,
                        origin_frame: 0,
                        phase_response: config.phase_response,
                        resample_quality: config.resample_quality,
                        window_owner: crate::player::streaming::memory::DecodedMemoryOwner::PendingPlayback,
                    },
                )
            {
                Ok(session) => session,
                Err(error) => {
                    log::warn!("Gapless preload(v2) session failed: {}", error);
                    return;
                }
            };
            if session.channels != active_channels {
                log::warn!(
                    "Gapless preload(v2) channel mismatch (pending {} vs active {}), dropping preload",
                    session.channels,
                    active_channels
                );
                return;
            }
            log::info!(
                "Gapless preload(v2) installed: {} (gen {})",
                path, generation
            );
            let _ = cmd_tx.send(AudioCommand::InstallPendingStreamingV2Session {
                generation,
                session: Box::new(session),
            });
        });
        Ok(())
    }

    pub fn cancel_preload(&self) {
        GaplessManager::cancel_preload(&self.shared_state);
        // Streaming-v2 playback keeps its preload as a second windowed session;
        // drop it alongside the legacy path.
        let _ = self
            .cmd_tx
            .send(AudioCommand::CancelPendingStreamingV2Session);
    }

    /// Promote a preloaded gapless buffer for a manual next-track action.
    ///
    /// Natural gapless transitions happen inside the audio callback at EOF.
    /// Manual queue next needs the same prepared buffer immediately, but only
    /// when playback is active and the pending buffer exactly matches the
    /// requested queue entry. Other cases return `Ok(false)` so callers can
    /// fall back to the normal load path.
    pub fn promote_pending_if_matching(&mut self, expected_path: &str) -> Result<bool, String> {
        let loudness_state = self.loudness_normalizer.lock().atomic_state();
        promote_pending_buffer_if_matching(&self.shared_state, &loudness_state, expected_path)
    }

    /// Set output bit depth for NoiseShaper
    pub fn set_output_bits(&mut self, bits: u32) {
        let clamped = bits.clamp(8, 32);
        self.config.output_bits = clamped;
        self.lockfree_noise_shaper_params.set_bits(clamped);
        self.shared_state
            .output_bits
            .store(clamped, Ordering::Relaxed);
        log::info!("Output bit depth set to {} bits", clamped);
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
}

fn comparable_media_path(value: &str) -> String {
    strip_extended_windows_path_prefix(value)
        .replace('\\', "/")
        .to_lowercase()
}

fn strip_extended_windows_path_prefix(value: &str) -> &str {
    value
        .strip_prefix(r"\\?\UNC\")
        .map(strip_leading_path_separator)
        .or_else(|| {
            value
                .strip_prefix("//?/UNC/")
                .map(strip_leading_path_separator)
        })
        .or_else(|| value.strip_prefix(r"\\?\"))
        .or_else(|| value.strip_prefix("//?/"))
        .unwrap_or(value)
}

fn strip_leading_path_separator(value: &str) -> &str {
    value
        .strip_prefix('\\')
        .or_else(|| value.strip_prefix('/'))
        .unwrap_or(value)
}

fn pending_path_matches(pending: &str, expected: &str) -> bool {
    comparable_media_path(pending) == comparable_media_path(expected)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PendingPromotionReadiness {
    Ready,
    Waiting,
    Mismatch,
    Unavailable,
}

pub(crate) fn pending_promotion_readiness(
    shared: &SharedState,
    expected_path: &str,
) -> PendingPromotionReadiness {
    if shared.state.load() != PlayerState::Playing || shared.is_loading.load(Ordering::Acquire) {
        return PendingPromotionReadiness::Unavailable;
    }

    let Some(pending_path) = shared.pending_file_path.read().clone() else {
        return PendingPromotionReadiness::Unavailable;
    };
    if !pending_path_matches(&pending_path, expected_path) {
        return PendingPromotionReadiness::Mismatch;
    }

    if shared.pending_ready.load(Ordering::Acquire) {
        PendingPromotionReadiness::Ready
    } else if shared.cancel_preload_signal.load(Ordering::Acquire) {
        PendingPromotionReadiness::Unavailable
    } else {
        PendingPromotionReadiness::Waiting
    }
}

fn promote_pending_buffer_if_matching(
    shared: &Arc<SharedState>,
    loudness_state: &AtomicLoudnessState,
    expected_path: &str,
) -> Result<bool, String> {
    if pending_promotion_readiness(shared, expected_path) != PendingPromotionReadiness::Ready {
        return Ok(false);
    }

    let pending_path = shared
        .pending_file_path
        .read()
        .clone()
        .ok_or_else(|| "Pending preload path disappeared before promotion".to_string())?;

    let pending_sample_rate = shared.pending_sample_rate.load(Ordering::Relaxed);
    let pending_channels = shared.pending_channels.load(Ordering::Relaxed);
    let current_sample_rate = shared.sample_rate.load(Ordering::Relaxed);
    let current_channels = shared.channels.load(Ordering::Relaxed);
    if pending_sample_rate != current_sample_rate || pending_channels != current_channels {
        log::info!(
            "Pending preload format mismatch for manual next: pending={}Hz/{}ch current={}Hz/{}ch",
            pending_sample_rate,
            pending_channels,
            current_sample_rate,
            current_channels
        );
        return Ok(false);
    }

    if shared
        .pending_ready
        .compare_exchange(true, false, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Ok(false);
    }

    let Some(samples) = shared.pending_buffer.swap(None) else {
        log::warn!(
            "Pending preload marked ready for '{}' but buffer was missing",
            pending_path
        );
        clear_pending_after_manual_promote(shared);
        return Ok(false);
    };
    let reservation = shared.pending_buffer_reservation.swap(None);

    let pending_total_frames = shared.pending_total_frames.load(Ordering::Relaxed);
    let pending_metadata = shared.pending_metadata.write().take().unwrap_or_default();
    let pending_cached_loudness = shared.pending_cached_loudness.write().take();
    let pending_gain_db = f64::from_bits(shared.pending_target_gain_db.load(Ordering::Relaxed));

    shared.state.store(PlayerState::Paused);
    shared.preload_generation.fetch_add(1, Ordering::AcqRel);
    shared.cancel_preload_signal.store(true, Ordering::Release);
    shared.needs_preload.store(false, Ordering::Release);
    shared.gapless_swap_pending.store(false, Ordering::Release);

    // Slot-published reset: supersedes any unconsumed seek request from the
    // outgoing track (M1 protocol; see `SharedState::request_seek_to_frame`).
    shared.request_seek_to_frame(0);
    shared
        .total_frames
        .store(pending_total_frames, Ordering::Relaxed);
    shared
        .sample_rate
        .store(pending_sample_rate, Ordering::Relaxed);
    shared.channels.store(pending_channels, Ordering::Relaxed);
    shared.publish_audio_buffer_with_reservation(samples, reservation);
    shared.is_loading.store(false, Ordering::Release);
    shared.load_progress.store(100, Ordering::Relaxed);
    *shared.load_error.write() = None;
    *shared.file_path.write() = Some(pending_path.clone());
    *shared.current_track_path.write() = Some(pending_path.clone());
    *shared.track_metadata.write() = pending_metadata;
    *shared.current_cached_loudness.write() = pending_cached_loudness;
    loudness_state.set_target_gain(pending_gain_db);

    clear_pending_after_manual_promote(shared);
    shared.dsp_reset_pending.store(true, Ordering::Release);
    shared.state.store(PlayerState::Playing);
    shared.event_flags.fetch_or(
        EVENT_TRACK_CHANGED | EVENT_PLAYBACK_STARTED | EVENT_NEEDS_PRELOAD_RESET,
        Ordering::Release,
    );
    log::info!(
        "Promoted pending preload for manual next: '{}' ({} frames)",
        pending_path,
        pending_total_frames
    );
    Ok(true)
}

fn clear_pending_after_manual_promote(shared: &SharedState) {
    shared.pending_buffer.store(None);
    shared.pending_buffer_reservation.store(None);
    shared.pending_total_frames.store(0, Ordering::Relaxed);
    shared.pending_sample_rate.store(44100, Ordering::Relaxed);
    shared.pending_channels.store(2, Ordering::Relaxed);
    *shared.pending_file_path.write() = None;
    *shared.pending_metadata.write() = None;
    *shared.pending_cached_loudness.write() = None;
    shared.pending_ready.store(false, Ordering::Release);
    shared
        .pending_target_gain_db
        .store(0.0_f64.to_bits(), Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::processor::AtomicLoudnessState;
    use std::collections::HashMap;

    #[test]
    fn player_construction_hydrates_engine_visible_audio_settings() {
        let settings = EngineSettings {
            volume: 0.23,
            eq_type: "IIR".to_string(),
            eq_bands: Some(HashMap::from([
                ("31".to_string(), -1.5),
                ("1000".to_string(), 2.5),
            ])),
            dither: crate::config::DitherConfig {
                enabled: false,
                noise_shaper_curve: crate::processor::NoiseShaperCurve::TpdfOnly,
            },
            output_bits: 32,
            target_samplerate: Some(96_000),
            resample_quality: crate::config::ResampleQuality::UltraHigh,
            ..EngineSettings::default()
        };

        let player = AudioPlayer::new(settings);
        let volume = player.lockfree_volume_params.read();
        let eq = player.lockfree_eq_params.read();
        let noise_shaper = player.lockfree_noise_shaper_params.read();

        assert!((volume.volume - 0.23).abs() < 1e-6);
        assert!((player.get_volume() - 0.23).abs() < 1e-6);
        assert!(eq.enabled);
        assert!((eq.gains[0] - -1.5).abs() < f64::EPSILON);
        assert!((eq.gains[5] - 2.5).abs() < f64::EPSILON);
        assert!(!noise_shaper.enabled);
        assert_eq!(noise_shaper.bits, 32);
        assert_eq!(
            noise_shaper.curve,
            crate::processor::NoiseShaperCurve::TpdfOnly
        );
        assert_eq!(player.get_output_bits(), 32);
        assert_eq!(player.get_target_sample_rate(), Some(96_000));
        assert_eq!(player.get_resample_quality(), "uhq");
        assert_eq!(
            player.shared_state().resample_quality(),
            crate::config::ResampleQuality::UltraHigh
        );
    }

    #[test]
    fn switching_from_fir_to_iir_disables_fir_and_applies_iir_bands() {
        let fir_settings = EngineSettings {
            eq_type: "FIR".to_string(),
            eq_bands: Some(HashMap::from([("1000".to_string(), 4.0)])),
            fir_taps: Some(511),
            ..EngineSettings::default()
        };
        let mut player = AudioPlayer::new(fir_settings.clone());
        assert!(player.is_fir_eq_enabled());

        let mut iir_settings = fir_settings;
        iir_settings.eq_type = "IIR".to_string();
        iir_settings.eq_bands = Some(HashMap::from([("1000".to_string(), -2.0)]));
        player
            .apply_engine_settings_update(
                &EngineSettingsUpdate {
                    eq_type: Some("IIR".to_string()),
                    eq_bands: iir_settings.eq_bands.clone(),
                    ..EngineSettingsUpdate::default()
                },
                &iir_settings,
            )
            .expect("FIR to IIR transition should apply");

        assert!(!player.is_fir_eq_enabled());
        let eq = player.lockfree_eq_params.read();
        assert!(eq.enabled);
        assert!((eq.gains[5] - -2.0).abs() < f64::EPSILON);
    }

    #[test]
    fn manual_promote_moves_matching_pending_buffer_to_current_track() {
        let shared = Arc::new(SharedState::new());
        let loudness_state = AtomicLoudnessState::default();
        let pending = Arc::new(vec![0.25, 0.5, 0.75, 1.0]);
        let pending_ptr = Arc::as_ptr(&pending);

        shared.state.store(PlayerState::Playing);
        shared.sample_rate.store(48_000, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.pending_buffer.store(Some(pending));
        shared.pending_total_frames.store(2, Ordering::Relaxed);
        shared.pending_sample_rate.store(48_000, Ordering::Relaxed);
        shared.pending_channels.store(2, Ordering::Relaxed);
        *shared.pending_file_path.write() = Some(r"D:\Music\next.flac".to_string());
        shared.pending_ready.store(true, Ordering::Release);
        shared
            .pending_target_gain_db
            .store(3.5_f64.to_bits(), Ordering::Relaxed);

        let promoted =
            promote_pending_buffer_if_matching(&shared, &loudness_state, r"\\?\D:\Music\next.flac")
                .expect("promotion should not error");

        assert!(promoted);
        let current = shared.audio_buffer.load_full();
        assert_eq!(Arc::as_ptr(&current), pending_ptr);
        assert_eq!(
            shared
                .playback_clock
                .callback
                .position_frames
                .load(Ordering::Relaxed),
            0
        );
        assert_eq!(shared.total_frames.load(Ordering::Relaxed), 2);
        assert_eq!(
            shared.current_track_path.read().as_deref(),
            Some(r"D:\Music\next.flac")
        );
        assert!(shared.pending_buffer.load_full().is_none());
        assert!(!shared.pending_ready.load(Ordering::Acquire));
        assert_eq!(loudness_state.target_gain_db.load(Ordering::Relaxed), 3.5);
    }

    #[test]
    fn pending_path_matches_extended_windows_path_variants() {
        assert!(pending_path_matches(
            r"D:\Music\Artist\Track.FLAC",
            "//?/D:/Music/Artist/Track.flac"
        ));
        assert!(pending_path_matches(
            r"\\?\UNC\Server\Share\Artist\Track.FLAC",
            "//?/UNC/Server/Share/Artist/Track.flac"
        ));
    }

    #[test]
    fn manual_promote_falls_back_when_pending_path_differs() {
        let shared = Arc::new(SharedState::new());
        let loudness_state = AtomicLoudnessState::default();
        shared.state.store(PlayerState::Playing);
        shared.sample_rate.store(48_000, Ordering::Relaxed);
        shared.channels.store(2, Ordering::Relaxed);
        shared.pending_buffer.store(Some(Arc::new(vec![0.0, 1.0])));
        shared.pending_total_frames.store(1, Ordering::Relaxed);
        shared.pending_sample_rate.store(48_000, Ordering::Relaxed);
        shared.pending_channels.store(2, Ordering::Relaxed);
        *shared.pending_file_path.write() = Some(r"D:\Music\other.flac".to_string());
        shared.pending_ready.store(true, Ordering::Release);

        let promoted =
            promote_pending_buffer_if_matching(&shared, &loudness_state, r"D:\Music\next.flac")
                .expect("promotion should not error");

        assert!(!promoted);
        assert!(shared.pending_ready.load(Ordering::Acquire));
        assert!(shared.pending_buffer.load_full().is_some());
    }
}
