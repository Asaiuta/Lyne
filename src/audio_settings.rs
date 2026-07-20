//! Versioned, single-writer control plane for persistent audio settings.
//!
//! The coordinator owns committed intent (`desired`), verified/applied runtime
//! state (`effective`), per-field revisions, and temporary preview overlays.
//! HTTP handlers must submit commands here instead of independently mutating
//! the settings file and `AudioPlayer`.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;

use crate::config::{normalize_eq_bands, EngineSettings, EngineSettingsUpdate};
use crate::player::AudioPlayer;
use crate::settings::{PersistentSettings, SharedSettingsManager};

const DEFAULT_PREVIEW_TTL: Duration = Duration::from_secs(10);
const CLOSED_PREVIEW_TTL: Duration = Duration::from_secs(60);
const MAX_PREVIEW_SESSION_ID_LEN: usize = 128;

const ALL_SETTING_FIELDS: [&str; 27] = [
    "volume",
    "device_id",
    "exclusive_mode",
    "eq_type",
    "eq_bands",
    "fir_taps",
    "dither_enabled",
    "output_bits",
    "noise_shaper_curve",
    "loudness_enabled",
    "loudness_mode",
    "target_lufs",
    "preamp_db",
    "saturation_enabled",
    "saturation_drive",
    "saturation_mix",
    "crossfeed_enabled",
    "crossfeed_mix",
    "dynamic_loudness_enabled",
    "dynamic_loudness_strength",
    "target_samplerate",
    "resample_quality",
    "use_cache",
    "preemptive_resample",
    "streaming_first_buffer",
    "streaming_pcm_window_limit_mib",
    "use_next_prefetch",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioSettingsApplyState {
    Applied,
    NextTrack,
    RestartOutput,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AudioSettingApplyStatus {
    pub state: AudioSettingsApplyState,
    pub revision: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActiveAudioSettingsPreview {
    pub session_id: String,
    pub seq: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub volume: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eq_bands: Option<HashMap<String, f64>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioSettingsSnapshot {
    pub revision: u64,
    /// Monotonic version for every observable control-plane mutation,
    /// including preview/cancel/expiry changes that do not commit settings.
    pub state_revision: u64,
    pub desired: PersistentSettings,
    pub effective: PersistentSettings,
    pub apply_status: BTreeMap<String, AudioSettingApplyStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_preview: Option<ActiveAudioSettingsPreview>,
}

#[derive(Debug)]
pub enum AudioSettingsCommitError {
    Invalid(String),
    Conflict {
        fields: Vec<String>,
        snapshot: Box<AudioSettingsSnapshot>,
    },
    Persistence(String),
}

impl std::fmt::Display for AudioSettingsCommitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Invalid(message) | Self::Persistence(message) => formatter.write_str(message),
            Self::Conflict { fields, .. } => {
                write!(formatter, "Audio settings conflict: {}", fields.join(", "))
            }
        }
    }
}

#[derive(Debug, Clone)]
struct VolumePreview {
    seq: u64,
    volume: f32,
    order: u64,
    updated_at: Instant,
}

#[derive(Debug, Clone)]
struct EqPreview {
    seq: u64,
    bands: HashMap<String, f64>,
    order: u64,
    updated_at: Instant,
}

struct CoordinatorState {
    revision: u64,
    state_revision: u64,
    desired: EngineSettings,
    effective: EngineSettings,
    field_revisions: HashMap<&'static str, u64>,
    apply_status: BTreeMap<String, AudioSettingApplyStatus>,
    volume_previews: HashMap<String, VolumePreview>,
    eq_previews: HashMap<String, EqPreview>,
    closed_previews: HashMap<String, Instant>,
    preview_order: u64,
}

impl CoordinatorState {
    fn new(settings: EngineSettings) -> Self {
        let field_revisions = ALL_SETTING_FIELDS
            .into_iter()
            .map(|field| (field, 0))
            .collect();
        let apply_status = ALL_SETTING_FIELDS
            .into_iter()
            .map(|field| {
                (
                    field.to_string(),
                    AudioSettingApplyStatus {
                        state: AudioSettingsApplyState::Applied,
                        revision: 0,
                        message: None,
                    },
                )
            })
            .collect();
        Self {
            revision: 0,
            state_revision: 0,
            desired: settings.clone(),
            effective: settings,
            field_revisions,
            apply_status,
            volume_previews: HashMap::new(),
            eq_previews: HashMap::new(),
            closed_previews: HashMap::new(),
            preview_order: 0,
        }
    }

    fn active_preview(&self) -> Option<ActiveAudioSettingsPreview> {
        let volume = self
            .volume_previews
            .iter()
            .max_by_key(|(_, preview)| preview.order)
            .map(|(session_id, preview)| {
                (
                    preview.order,
                    ActiveAudioSettingsPreview {
                        session_id: session_id.clone(),
                        seq: preview.seq,
                        volume: Some(preview.volume),
                        eq_bands: None,
                    },
                )
            });
        let eq = self
            .eq_previews
            .iter()
            .max_by_key(|(_, preview)| preview.order)
            .map(|(session_id, preview)| {
                (
                    preview.order,
                    ActiveAudioSettingsPreview {
                        session_id: session_id.clone(),
                        seq: preview.seq,
                        volume: None,
                        eq_bands: Some(preview.bands.clone()),
                    },
                )
            });
        [volume, eq]
            .into_iter()
            .flatten()
            .max_by_key(|(order, _)| *order)
            .map(|(_, preview)| preview)
    }

    fn snapshot(&self) -> AudioSettingsSnapshot {
        AudioSettingsSnapshot {
            revision: self.revision,
            state_revision: self.state_revision,
            desired: self.desired.clone().into(),
            effective: self.effective.clone().into(),
            apply_status: self.apply_status.clone(),
            active_preview: self.active_preview(),
        }
    }
}

pub struct AudioSettingsCoordinator {
    repository: SharedSettingsManager,
    state: Mutex<CoordinatorState>,
    preview_ttl: Duration,
}

impl AudioSettingsCoordinator {
    pub fn new(repository: SharedSettingsManager) -> Self {
        Self::with_preview_ttl(repository, DEFAULT_PREVIEW_TTL)
    }

    fn with_preview_ttl(repository: SharedSettingsManager, preview_ttl: Duration) -> Self {
        let desired = repository.lock().get_settings();
        Self {
            repository,
            state: Mutex::new(CoordinatorState::new(desired)),
            preview_ttl,
        }
    }

    pub fn snapshot(&self) -> AudioSettingsSnapshot {
        self.state.lock().snapshot()
    }

    pub fn commit(
        &self,
        player: &mut AudioPlayer,
        mut update: EngineSettingsUpdate,
        base_revision: Option<u64>,
        preview_session_id: Option<&str>,
    ) -> Result<AudioSettingsSnapshot, AudioSettingsCommitError> {
        if let Some(eq_type) = update.eq_type.as_mut() {
            *eq_type = eq_type.to_ascii_uppercase();
        }
        validate_update(&update)?;
        let changed_fields = update.changed_fields();
        let eq_configuration_changed = changed_fields
            .iter()
            .any(|field| matches!(*field, "eq_type" | "eq_bands" | "fir_taps"));
        if changed_fields.is_empty() {
            return Err(AudioSettingsCommitError::Invalid(
                "Audio settings patch must contain at least one field".to_string(),
            ));
        }

        let mut state = self.state.lock();
        expire_previews_locked(&mut state, player, self.preview_ttl);
        if let Some(base_revision) = base_revision {
            if base_revision > state.revision {
                return Err(AudioSettingsCommitError::Invalid(format!(
                    "Base revision {} is newer than current revision {}",
                    base_revision, state.revision
                )));
            }
            let conflicts: Vec<String> = changed_fields
                .iter()
                .filter(|field| {
                    state.field_revisions.get(**field).copied().unwrap_or(0) > base_revision
                })
                .map(|field| (*field).to_string())
                .collect();
            if !conflicts.is_empty() {
                return Err(AudioSettingsCommitError::Conflict {
                    fields: conflicts,
                    snapshot: Box::new(state.snapshot()),
                });
            }
        }

        let desired = self
            .repository
            .lock()
            .update(update.clone())
            .map_err(AudioSettingsCommitError::Persistence)?;

        state.revision = state.revision.saturating_add(1);
        let revision = state.revision;
        state.desired = desired.clone();
        for field in &changed_fields {
            state.field_revisions.insert(field, revision);
        }
        let removed_eq_preview = preview_session_id
            .and_then(|session_id| state.eq_previews.remove(session_id))
            .is_some();
        if let Some(session_id) = preview_session_id {
            state.volume_previews.remove(session_id);
            state
                .closed_previews
                .insert(session_id.to_string(), Instant::now());
        }

        match player.apply_engine_settings_update(&update, &desired) {
            Ok(()) => {
                for field in changed_fields {
                    let apply_state = apply_state_for_field(field);
                    if apply_state == AudioSettingsApplyState::Applied {
                        apply_effective_field(&mut state.effective, &desired, field);
                    }
                    state.apply_status.insert(
                        field.to_string(),
                        AudioSettingApplyStatus {
                            state: apply_state,
                            revision,
                            message: None,
                        },
                    );
                }
            }
            Err(error) => {
                log::error!(
                    "Audio settings runtime apply failed: revision={}, fields={}, error={}",
                    revision,
                    changed_fields.join(","),
                    error
                );
                for field in changed_fields {
                    state.apply_status.insert(
                        field.to_string(),
                        AudioSettingApplyStatus {
                            state: AudioSettingsApplyState::Failed,
                            revision,
                            message: Some(error.clone()),
                        },
                    );
                }
            }
        }

        reapply_active_volume_preview(&mut state, player);
        if removed_eq_preview || eq_configuration_changed || !state.eq_previews.is_empty() {
            if let Err(error) = reapply_active_eq_preview(&mut state, player) {
                log::error!(
                    "Failed to reapply EQ preview after settings commit: revision={}, error={}",
                    revision,
                    error
                );
            }
        }
        state.state_revision = state.state_revision.saturating_add(1);
        log::info!(
            "Audio settings committed: revision={}, fields={}",
            revision,
            state
                .field_revisions
                .iter()
                .filter_map(|(field, changed_at)| (*changed_at == revision).then_some(*field))
                .collect::<Vec<_>>()
                .join(",")
        );
        Ok(state.snapshot())
    }

    pub fn preview_volume(
        &self,
        player: &mut AudioPlayer,
        session_id: &str,
        seq: u64,
        volume: f32,
    ) -> Result<(bool, AudioSettingsSnapshot), String> {
        validate_preview_session_id(session_id)?;
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err("Volume preview must be between 0.0 and 1.0".to_string());
        }

        let mut state = self.state.lock();
        expire_previews_locked(&mut state, player, self.preview_ttl);
        if state.closed_previews.contains_key(session_id) {
            return Ok((false, state.snapshot()));
        }
        if state
            .volume_previews
            .get(session_id)
            .is_some_and(|preview| seq <= preview.seq)
        {
            return Ok((false, state.snapshot()));
        }

        state.preview_order = state.preview_order.saturating_add(1);
        let order = state.preview_order;
        state.volume_previews.insert(
            session_id.to_string(),
            VolumePreview {
                seq,
                volume,
                order,
                updated_at: Instant::now(),
            },
        );
        state.effective.volume = volume;
        player.set_volume(volume as f64);
        state.state_revision = state.state_revision.saturating_add(1);
        Ok((true, state.snapshot()))
    }

    pub fn preview_eq_bands(
        &self,
        player: &mut AudioPlayer,
        session_id: &str,
        seq: u64,
        bands: HashMap<String, f64>,
    ) -> Result<(bool, AudioSettingsSnapshot), String> {
        validate_preview_session_id(session_id)?;
        let mut unknown_bands = Vec::new();
        let normalized = normalize_eq_bands(bands, |name| unknown_bands.push(name.to_string()));
        if !unknown_bands.is_empty() {
            return Err(format!(
                "Unknown EQ preview bands: {}",
                unknown_bands.join(", ")
            ));
        }
        if normalized.is_empty() {
            return Err("EQ preview must contain at least one band".to_string());
        }
        if normalized
            .values()
            .any(|gain| !gain.is_finite() || !(-12.0..=12.0).contains(gain))
        {
            return Err("EQ preview gains must be between -12.0 and 12.0 dB".to_string());
        }

        let mut state = self.state.lock();
        expire_previews_locked(&mut state, player, self.preview_ttl);
        if state.closed_previews.contains_key(session_id) {
            return Ok((false, state.snapshot()));
        }
        if state
            .eq_previews
            .get(session_id)
            .is_some_and(|preview| seq <= preview.seq)
        {
            return Ok((false, state.snapshot()));
        }

        state.preview_order = state.preview_order.saturating_add(1);
        let order = state.preview_order;
        let previous = state.eq_previews.insert(
            session_id.to_string(),
            EqPreview {
                seq,
                bands: normalized,
                order,
                updated_at: Instant::now(),
            },
        );
        if let Err(error) = reapply_active_eq_preview(&mut state, player) {
            if let Some(previous) = previous {
                state.eq_previews.insert(session_id.to_string(), previous);
            } else {
                state.eq_previews.remove(session_id);
            }
            let _ = reapply_active_eq_preview(&mut state, player);
            return Err(error);
        }
        state.state_revision = state.state_revision.saturating_add(1);
        Ok((true, state.snapshot()))
    }

    pub fn cancel_preview(
        &self,
        player: &mut AudioPlayer,
        session_id: &str,
    ) -> Result<AudioSettingsSnapshot, String> {
        validate_preview_session_id(session_id)?;
        let mut state = self.state.lock();
        expire_previews_locked(&mut state, player, self.preview_ttl);
        let removed_volume = state.volume_previews.remove(session_id).is_some();
        let removed_eq = state.eq_previews.remove(session_id).is_some();
        let closed_changed = state
            .closed_previews
            .insert(session_id.to_string(), Instant::now())
            .is_none();
        if removed_volume {
            reapply_active_volume_preview(&mut state, player);
        }
        if removed_eq {
            reapply_active_eq_preview(&mut state, player)?;
        }
        if removed_volume || removed_eq || closed_changed {
            state.state_revision = state.state_revision.saturating_add(1);
        }
        Ok(state.snapshot())
    }

    pub fn expire_previews(&self, player: &mut AudioPlayer) -> bool {
        let mut state = self.state.lock();
        expire_previews_locked(&mut state, player, self.preview_ttl)
    }
}

fn validate_update(update: &EngineSettingsUpdate) -> Result<(), AudioSettingsCommitError> {
    if let Some(volume) = update.volume {
        if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
            return Err(AudioSettingsCommitError::Invalid(
                "Volume must be between 0.0 and 1.0".to_string(),
            ));
        }
    }
    if let Some(eq_type) = update.eq_type.as_deref() {
        if !eq_type.eq_ignore_ascii_case("IIR") && !eq_type.eq_ignore_ascii_case("FIR") {
            return Err(AudioSettingsCommitError::Invalid(
                "EQ type must be IIR or FIR".to_string(),
            ));
        }
    }
    if let Some(eq_bands) = update.eq_bands.as_ref() {
        let mut unknown_bands = Vec::new();
        normalize_eq_bands(eq_bands.clone(), |name| {
            unknown_bands.push(name.to_string())
        });
        if !unknown_bands.is_empty() {
            return Err(AudioSettingsCommitError::Invalid(format!(
                "Unknown EQ bands: {}",
                unknown_bands.join(", ")
            )));
        }
        validate_numeric_values("EQ band gain", eq_bands.values().copied(), -12.0, 12.0)?;
    }
    if let Some(Some(sample_rate)) = update.target_samplerate {
        if !(8_000..=384_000).contains(&sample_rate) {
            return Err(AudioSettingsCommitError::Invalid(
                "Target sample rate must be between 8000 and 384000 Hz".to_string(),
            ));
        }
    }
    if let Some(bits) = update.output_bits {
        if !matches!(bits, 16 | 24 | 32) {
            return Err(AudioSettingsCommitError::Invalid(
                "Output bit depth must be 16, 24, or 32".to_string(),
            ));
        }
    }
    if update.fir_taps == Some(0) {
        return Err(AudioSettingsCommitError::Invalid(
            "FIR tap count must be positive".to_string(),
        ));
    }
    if let Some(quality) = update.resample_quality.as_deref() {
        if !matches!(
            quality.to_ascii_lowercase().as_str(),
            "low" | "std" | "standard" | "hq" | "high" | "uhq" | "ultrahigh" | "ultra_high"
        ) {
            return Err(AudioSettingsCommitError::Invalid(format!(
                "Unknown resample quality: {}",
                quality
            )));
        }
    }
    if let Some(mode) = update.loudness_mode.as_deref() {
        if !matches!(
            mode.to_ascii_lowercase().as_str(),
            "track"
                | "album"
                | "streaming"
                | "replaygain_track"
                | "rg_track"
                | "replaygain_album"
                | "rg_album"
        ) {
            return Err(AudioSettingsCommitError::Invalid(format!(
                "Unknown loudness mode: {}",
                mode
            )));
        }
    }
    if let Some(curve) = update.noise_shaper_curve.as_deref() {
        let normalized = curve.to_ascii_lowercase();
        if !matches!(
            normalized.as_str(),
            "lipshitz5"
                | "fweighted9"
                | "f_weighted9"
                | "f-weighted9"
                | "modifiede9"
                | "modified_e9"
                | "modified-e9"
                | "improvede9"
                | "improved_e9"
                | "improved-e9"
                | "tpdfonly"
                | "tpdf_only"
                | "tpdf-only"
        ) {
            return Err(AudioSettingsCommitError::Invalid(format!(
                "Unknown noise shaper curve: {}",
                curve
            )));
        }
    }
    validate_optional_number("Target LUFS", update.target_lufs, -30.0, -6.0)?;
    validate_optional_number("Preamp", update.preamp_db, -6.0, 0.0)?;
    validate_optional_number("Saturation drive", update.saturation_drive, 0.0, 2.0)?;
    validate_optional_number("Saturation mix", update.saturation_mix, 0.0, 1.0)?;
    validate_optional_number("Crossfeed mix", update.crossfeed_mix, 0.0, 1.0)?;
    validate_optional_number(
        "Dynamic loudness strength",
        update.dynamic_loudness_strength,
        0.0,
        1.0,
    )?;
    if update
        .streaming_pcm_window_limit_mib
        .is_some_and(|value| value > crate::config::MAX_STREAMING_PCM_WINDOW_LIMIT_MIB)
    {
        return Err(AudioSettingsCommitError::Invalid(format!(
            "Streaming PCM window limit must be at most {} MiB",
            crate::config::MAX_STREAMING_PCM_WINDOW_LIMIT_MIB
        )));
    }
    Ok(())
}

fn validate_optional_number(
    label: &str,
    value: Option<f64>,
    minimum: f64,
    maximum: f64,
) -> Result<(), AudioSettingsCommitError> {
    if let Some(value) = value {
        validate_numeric_values(label, std::iter::once(value), minimum, maximum)?;
    }
    Ok(())
}

fn validate_numeric_values(
    label: &str,
    values: impl IntoIterator<Item = f64>,
    minimum: f64,
    maximum: f64,
) -> Result<(), AudioSettingsCommitError> {
    if values
        .into_iter()
        .any(|value| !value.is_finite() || !(minimum..=maximum).contains(&value))
    {
        return Err(AudioSettingsCommitError::Invalid(format!(
            "{} must be between {} and {}",
            label, minimum, maximum
        )));
    }
    Ok(())
}

fn validate_preview_session_id(session_id: &str) -> Result<(), String> {
    if session_id.trim().is_empty() || session_id.len() > MAX_PREVIEW_SESSION_ID_LEN {
        return Err("Preview session id must contain 1 to 128 characters".to_string());
    }
    Ok(())
}

fn apply_state_for_field(field: &str) -> AudioSettingsApplyState {
    match field {
        "device_id" | "exclusive_mode" => AudioSettingsApplyState::RestartOutput,
        "target_samplerate"
        | "resample_quality"
        | "use_cache"
        | "preemptive_resample"
        | "streaming_first_buffer"
        | "streaming_pcm_window_limit_mib"
        | "use_next_prefetch" => AudioSettingsApplyState::NextTrack,
        _ => AudioSettingsApplyState::Applied,
    }
}

fn apply_effective_field(effective: &mut EngineSettings, desired: &EngineSettings, field: &str) {
    match field {
        "volume" => effective.volume = desired.volume,
        "eq_type" | "eq_bands" | "fir_taps" => {
            effective.eq_type = desired.eq_type.clone();
            effective.eq_bands = desired.eq_bands.clone();
            effective.fir_taps = desired.fir_taps;
        }
        "dither_enabled" => effective.dither.enabled = desired.dither.enabled,
        "output_bits" => effective.output_bits = desired.output_bits,
        "noise_shaper_curve" => {
            effective.dither.noise_shaper_curve = desired.dither.noise_shaper_curve;
        }
        "loudness_enabled" => effective.loudness.enabled = desired.loudness.enabled,
        "loudness_mode" => effective.loudness.mode = desired.loudness.mode,
        "target_lufs" => effective.loudness.target_lufs = desired.loudness.target_lufs,
        "preamp_db" => {
            effective.dynamic_loudness.pre_gain_db = desired.dynamic_loudness.pre_gain_db;
        }
        "saturation_enabled" => effective.saturation.enabled = desired.saturation.enabled,
        "saturation_drive" => effective.saturation.drive = desired.saturation.drive,
        "saturation_mix" => effective.saturation.mix = desired.saturation.mix,
        "crossfeed_enabled" => effective.crossfeed.enabled = desired.crossfeed.enabled,
        "crossfeed_mix" => effective.crossfeed.mix = desired.crossfeed.mix,
        "dynamic_loudness_enabled" => {
            effective.dynamic_loudness.enabled = desired.dynamic_loudness.enabled;
        }
        "dynamic_loudness_strength" => {
            effective.dynamic_loudness.strength = desired.dynamic_loudness.strength;
        }
        _ => {}
    }
}

fn expire_previews_locked(
    state: &mut CoordinatorState,
    player: &mut AudioPlayer,
    preview_ttl: Duration,
) -> bool {
    let now = Instant::now();
    let expired_volume_sessions: Vec<String> = state
        .volume_previews
        .iter()
        .filter(|(_, preview)| now.duration_since(preview.updated_at) >= preview_ttl)
        .map(|(session_id, _)| session_id.clone())
        .collect();
    let expired_eq_sessions: Vec<String> = state
        .eq_previews
        .iter()
        .filter(|(_, preview)| now.duration_since(preview.updated_at) >= preview_ttl)
        .map(|(session_id, _)| session_id.clone())
        .collect();
    for session_id in &expired_volume_sessions {
        state.volume_previews.remove(session_id);
        state.closed_previews.insert(session_id.clone(), now);
    }
    for session_id in &expired_eq_sessions {
        state.eq_previews.remove(session_id);
        state.closed_previews.insert(session_id.clone(), now);
    }
    state
        .closed_previews
        .retain(|_, closed_at| now.duration_since(*closed_at) < CLOSED_PREVIEW_TTL);
    let volume_changed = !expired_volume_sessions.is_empty();
    let eq_changed = !expired_eq_sessions.is_empty();
    if volume_changed {
        reapply_active_volume_preview(state, player);
    }
    if eq_changed {
        if let Err(error) = reapply_active_eq_preview(state, player) {
            log::error!("Failed to restore EQ after preview expiry: {}", error);
        }
    }
    if volume_changed || eq_changed {
        state.state_revision = state.state_revision.saturating_add(1);
    }
    volume_changed || eq_changed
}

fn reapply_active_volume_preview(state: &mut CoordinatorState, player: &mut AudioPlayer) {
    let volume = state
        .volume_previews
        .values()
        .max_by_key(|preview| preview.order)
        .map(|preview| preview.volume)
        .unwrap_or(state.desired.volume);
    state.effective.volume = volume;
    player.set_volume(volume as f64);
}

fn reapply_active_eq_preview(
    state: &mut CoordinatorState,
    player: &mut AudioPlayer,
) -> Result<(), String> {
    let bands = state
        .eq_previews
        .values()
        .max_by_key(|preview| preview.order)
        .map(|preview| Some(preview.bands.clone()))
        .unwrap_or_else(|| state.desired.eq_bands.clone());
    let mut settings = state.desired.clone();
    settings.eq_bands = bands.clone();
    player.apply_eq_settings(&settings)?;
    state.effective.eq_type = settings.eq_type;
    state.effective.eq_bands = bands;
    state.effective.fir_taps = settings.fir_taps;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::create_settings_manager;
    use std::path::PathBuf;

    fn unique_settings_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "audio-settings-coordinator-{}-{}-{}.json",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock should be after epoch")
                .as_nanos()
        ))
    }

    fn fixture(label: &str) -> (PathBuf, AudioSettingsCoordinator, AudioPlayer) {
        let path = unique_settings_path(label);
        let repository = create_settings_manager(&path);
        let settings = repository.lock().get_settings();
        let coordinator = AudioSettingsCoordinator::new(repository);
        let player = AudioPlayer::new(settings);
        (path, coordinator, player)
    }

    #[test]
    fn unrelated_commit_cannot_restore_stale_volume() {
        let (path, coordinator, mut player) = fixture("volume-regression");
        let volume_snapshot = coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    volume: Some(0.35),
                    ..EngineSettingsUpdate::default()
                },
                Some(0),
                None,
            )
            .expect("volume commit should succeed");
        let next = coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    use_cache: Some(true),
                    ..EngineSettingsUpdate::default()
                },
                Some(volume_snapshot.revision),
                None,
            )
            .expect("unrelated commit should succeed");

        assert!((next.desired.volume - 0.35).abs() < f32::EPSILON);
        assert!((next.effective.volume - 0.35).abs() < f32::EPSILON);
        assert!((player.get_volume() - 0.35).abs() < 1e-6);
        let persisted = EngineSettings::load_from_file(&path).expect("settings should reload");
        assert!((persisted.volume - 0.35).abs() < f32::EPSILON);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn next_track_fields_remain_desired_effective_divergent_until_acknowledged() {
        let (path, coordinator, mut player) = fixture("next-track-status");
        let before = coordinator.snapshot();
        let target = !before.desired.use_cache;
        let committed = coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    use_cache: Some(target),
                    ..EngineSettingsUpdate::default()
                },
                Some(before.revision),
                None,
            )
            .expect("next-track setting commit should succeed");

        assert_eq!(committed.desired.use_cache, target);
        assert_eq!(committed.effective.use_cache, before.effective.use_cache);
        assert_eq!(
            committed
                .apply_status
                .get("use_cache")
                .map(|status| status.state),
            Some(AudioSettingsApplyState::NextTrack)
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn invalid_enum_and_numeric_patches_do_not_advance_revision() {
        let (path, coordinator, mut player) = fixture("validation");
        let before = coordinator.snapshot();

        let invalid_quality = coordinator.commit(
            &mut player,
            EngineSettingsUpdate {
                resample_quality: Some("fastest-ish".to_string()),
                ..EngineSettingsUpdate::default()
            },
            Some(before.revision),
            None,
        );
        assert!(matches!(
            invalid_quality,
            Err(AudioSettingsCommitError::Invalid(_))
        ));
        let invalid_drive = coordinator.commit(
            &mut player,
            EngineSettingsUpdate {
                saturation_drive: Some(3.0),
                ..EngineSettingsUpdate::default()
            },
            Some(before.revision),
            None,
        );
        assert!(matches!(
            invalid_drive,
            Err(AudioSettingsCommitError::Invalid(_))
        ));
        assert_eq!(coordinator.snapshot().revision, before.revision);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn stale_non_overlapping_patch_rebases_but_same_field_conflicts() {
        let (path, coordinator, mut player) = fixture("field-conflict");
        coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    volume: Some(0.4),
                    ..EngineSettingsUpdate::default()
                },
                Some(0),
                None,
            )
            .expect("first commit should succeed");
        coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    use_cache: Some(true),
                    ..EngineSettingsUpdate::default()
                },
                Some(0),
                None,
            )
            .expect("unrelated stale patch should rebase");

        let conflict = coordinator
            .commit(
                &mut player,
                EngineSettingsUpdate {
                    volume: Some(0.8),
                    ..EngineSettingsUpdate::default()
                },
                Some(0),
                None,
            )
            .expect_err("same-field stale patch should conflict");
        match conflict {
            AudioSettingsCommitError::Conflict { fields, .. } => {
                assert_eq!(fields, vec!["volume".to_string()]);
            }
            other => panic!("unexpected error: {other}"),
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn preview_sequence_and_cancel_restore_committed_volume() {
        let (path, coordinator, mut player) = fixture("preview");
        let (accepted, previewed) = coordinator
            .preview_volume(&mut player, "playerbar", 2, 0.2)
            .expect("preview should succeed");
        assert!(accepted);
        assert_eq!(previewed.state_revision, 1);
        let (accepted, stale) = coordinator
            .preview_volume(&mut player, "playerbar", 1, 0.9)
            .expect("stale preview should be ignored");
        assert!(!accepted);
        assert!((stale.effective.volume - 0.2).abs() < f32::EPSILON);

        let restored = coordinator
            .cancel_preview(&mut player, "playerbar")
            .expect("cancel should succeed");
        assert_eq!(restored.state_revision, 2);
        assert!((restored.effective.volume - restored.desired.volume).abs() < f32::EPSILON);
        assert!((player.get_volume() - f64::from(restored.desired.volume)).abs() < 1e-6);
        let (accepted, after_cancel) = coordinator
            .preview_volume(&mut player, "playerbar", 3, 0.1)
            .expect("late preview after cancel should be ignored");
        assert!(!accepted);
        assert!((after_cancel.effective.volume - after_cancel.desired.volume).abs() < f32::EPSILON);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn eq_preview_uses_sequence_order_and_cancel_restores_desired_bands() {
        let (path, coordinator, mut player) = fixture("eq-preview");
        let preview_bands = HashMap::from([("1000".to_string(), 3.0)]);
        let (accepted, previewed) = coordinator
            .preview_eq_bands(&mut player, "settings-eq", 2, preview_bands)
            .expect("EQ preview should succeed");
        assert!(accepted);
        assert_eq!(
            previewed
                .effective
                .eq_bands
                .as_ref()
                .and_then(|bands| bands.get("1000")),
            Some(&3.0)
        );

        let (accepted, stale) = coordinator
            .preview_eq_bands(
                &mut player,
                "settings-eq",
                1,
                HashMap::from([("1000".to_string(), -4.0)]),
            )
            .expect("stale EQ preview should be ignored");
        assert!(!accepted);
        assert_eq!(
            stale
                .effective
                .eq_bands
                .as_ref()
                .and_then(|bands| bands.get("1000")),
            Some(&3.0)
        );

        let restored = coordinator
            .cancel_preview(&mut player, "settings-eq")
            .expect("EQ preview cancel should succeed");
        assert_eq!(restored.effective.eq_bands, restored.desired.eq_bands);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn expired_preview_restores_latest_desired_volume() {
        let path = unique_settings_path("preview-expiry");
        let repository = create_settings_manager(&path);
        let settings = repository.lock().get_settings();
        let coordinator = AudioSettingsCoordinator::with_preview_ttl(repository, Duration::ZERO);
        let mut player = AudioPlayer::new(settings);
        coordinator
            .preview_volume(&mut player, "playerbar", 1, 0.1)
            .expect("preview should succeed");

        assert!(coordinator.expire_previews(&mut player));
        let snapshot = coordinator.snapshot();
        assert!(snapshot.active_preview.is_none());
        assert!((snapshot.effective.volume - snapshot.desired.volume).abs() < f32::EPSILON);
        let (accepted, late) = coordinator
            .preview_volume(&mut player, "playerbar", 2, 0.9)
            .expect("late preview should be handled");
        assert!(!accepted);
        assert!((late.effective.volume - late.desired.volume).abs() < f32::EPSILON);
        let _ = std::fs::remove_file(path);
    }
}
