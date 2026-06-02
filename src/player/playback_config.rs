//! Configuration setters/getters for resampling, cache, IR convolution,
//! gapless queue, and output bit depth / loudness mode introspection.
//!
//! These methods only touch fields and channels already owned by the player;
//! grouping them here keeps `mod.rs` focused on the core lifecycle (new,
//! load, transport, Drop) while keeping the public API surface unchanged.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::{AudioCommand, AudioPlayer, GaplessManager};
use crate::player::state::{
    PlayerState, SharedState, EVENT_NEEDS_PRELOAD_RESET, EVENT_PLAYBACK_STARTED,
    EVENT_TRACK_CHANGED,
};
use crate::processor::AtomicLoudnessState;

impl AudioPlayer {
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
        self.shared_state
            .prefer_default_output_config
            .store(!enabled, Ordering::Relaxed);
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
            self.loudness_db.clone(),
        )
    }

    pub fn cancel_preload(&self) {
        GaplessManager::cancel_preload(&self.shared_state);
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

    let pending_total_frames = shared.pending_total_frames.load(Ordering::Relaxed);
    let pending_metadata = shared.pending_metadata.write().take().unwrap_or_default();
    let pending_cached_loudness = shared.pending_cached_loudness.write().take();
    let pending_gain_db = f64::from_bits(shared.pending_target_gain_db.load(Ordering::Relaxed));

    shared.state.store(PlayerState::Paused);
    shared.preload_generation.fetch_add(1, Ordering::AcqRel);
    shared.cancel_preload_signal.store(true, Ordering::Release);
    shared.needs_preload.store(false, Ordering::Release);
    shared.gapless_swap_pending.store(false, Ordering::Release);

    shared.position_frames.store(0, Ordering::Relaxed);
    shared
        .total_frames
        .store(pending_total_frames, Ordering::Relaxed);
    shared
        .sample_rate
        .store(pending_sample_rate, Ordering::Relaxed);
    shared.channels.store(pending_channels, Ordering::Relaxed);
    shared.audio_buffer.store(samples);
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
        assert_eq!(shared.position_frames.load(Ordering::Relaxed), 0);
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
