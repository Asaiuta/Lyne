//! Helpers that translate `AudioPlayer` + `AppDatabase` state into the response
//! DTOs served by the HTTP layer, plus the small "apply persisted settings to
//! player" and "restore in-memory state from db at startup" bridges.
//!
//! Handlers should capture raw player state with [`get_player_state`] while the
//! player mutex is held, then call [`enrich_player_state`] after that lock drops.

use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use crate::app_database::{AppDatabase, PlaybackRuntimeSnapshot};
use crate::config::{normalization_mode_to_string, NormalizationMode};
use crate::player::{AudioPlayer, PlayerState};

use super::{AppState, ScanTaskRecord, StateResponse};

pub(crate) fn get_player_state(player: &AudioPlayer) -> StateResponse {
    let shared = player.shared_state();
    let state = player.get_state();

    // Get real values from SharedState
    let volume = shared.volume.load(std::sync::atomic::Ordering::Relaxed) as f32 / 1_000_000.0;
    let device_id = shared.device_id.load(std::sync::atomic::Ordering::Relaxed);
    let file_path = shared
        .current_track_path
        .read()
        .clone()
        .or_else(|| shared.file_path.read().clone());
    let media_id = file_path
        .as_deref()
        .map(crate::app_database::media_id_for_path);
    let eq_type = shared.eq_type.read().clone();

    // Get track metadata
    let metadata = shared.track_metadata.read();

    // Get loudness normalization info
    let loudness_info = player.get_loudness_info();
    let normalization_mode = player.get_normalization_mode();
    let loudness_mode = normalization_mode_to_string(normalization_mode);
    let replaygain_enabled = matches!(
        normalization_mode,
        NormalizationMode::ReplayGainTrack | NormalizationMode::ReplayGainAlbum
    );

    // Get saturation info
    let saturation_info = player.get_saturation_info();

    // Get crossfeed info
    let crossfeed_info = player.get_crossfeed_info();

    // Get noise shaper info
    let noise_shaper_curve = player.get_noise_shaper_curve();

    StateResponse {
        is_playing: state == PlayerState::Playing,
        is_paused: state == PlayerState::Paused,
        is_loading: shared.is_loading.load(std::sync::atomic::Ordering::Relaxed),
        duration: shared.duration_secs(),
        current_time: shared.current_time_secs(),
        file_path,
        media_id,
        ncm_song_id: None,
        ncm_source_page_url: None,
        volume,
        device_id: if device_id >= 0 {
            Some(device_id as usize)
        } else {
            None
        },
        exclusive_mode: player.exclusive_mode,
        eq_type,
        dither_enabled: player.dither_enabled,
        replaygain_enabled,
        loudness_enabled: player.loudness_enabled,
        // Loudness normalization extended fields
        loudness_mode,
        target_lufs: player.get_target_lufs(),
        preamp_db: loudness_info.preamp_db,
        // ReplayGain fields
        rg_track_gain: metadata.rg_track_gain,
        rg_album_gain: metadata.rg_album_gain,
        rg_track_peak: metadata.rg_track_peak,
        rg_album_peak: metadata.rg_album_peak,
        // Saturation fields
        saturation_enabled: saturation_info.enabled,
        saturation_drive: saturation_info.drive,
        saturation_mix: saturation_info.mix,
        // Crossfeed fields
        crossfeed_enabled: crossfeed_info.enabled,
        crossfeed_mix: crossfeed_info.mix,
        // Dynamic Loudness fields
        dynamic_loudness_enabled: player.is_dynamic_loudness_enabled(),
        dynamic_loudness_strength: player.get_dynamic_loudness_strength(),
        dynamic_loudness_factor: player.get_dynamic_loudness_factor(),
        // Noise shaper fields
        output_bits: player.get_output_bits(),
        noise_shaper_curve,
        // Resampling fields
        target_samplerate: player.get_target_sample_rate(),
        resample_quality: player.get_resample_quality(),
        use_cache: player.get_use_cache(),
        preemptive_resample: player.get_preemptive_resample(),
        // Track metadata
        title: metadata.title.clone(),
        artist: metadata.artist.clone(),
        album: metadata.album.clone(),
        track_number: metadata.track_number,
        disc_number: metadata.disc_number,
        genre: metadata.genre.clone(),
        year: metadata.year,
        has_cover_art: metadata.cover_art.is_some(),
        external_artwork_url: None,
        repeat_mode: shared.repeat_mode().as_str().to_string(),
        shuffle_mode: shared.shuffle_mode().as_str().to_string(),
    }
}

pub(crate) fn enrich_player_state(app_db: &AppDatabase, mut state: StateResponse) -> StateResponse {
    enrich_state_from_media_database(app_db, &mut state);
    state
}

fn enrich_state_from_media_database(app_db: &AppDatabase, state: &mut StateResponse) {
    let Some(path) = state.file_path.as_deref() else {
        return;
    };

    let Ok(Some(item)) = app_db.media_metadata_for_path(path) else {
        return;
    };

    if state.media_id.is_none() {
        state.media_id = Some(item.media_id);
    }
    if state
        .title
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.title = item.title;
    }
    if state
        .artist
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.artist = item.artist;
    }
    if state
        .album
        .as_deref()
        .map_or(true, |value| value.trim().is_empty())
    {
        state.album = item.album;
    }
    if state.duration <= 0.0 {
        if let Some(duration) = item.duration_secs {
            state.duration = duration;
        }
    }
    state.has_cover_art = state.has_cover_art || item.has_cover_art;
    if state.external_artwork_url.is_none() {
        state.external_artwork_url = item.external_artwork_url;
    }

    if let Ok(Some(source)) = app_db.ncm_track_source_for_path(path) {
        state.ncm_song_id = Some(source.song_id);
        state.ncm_source_page_url = source.source_page_url;
    }
}

pub(crate) fn build_runtime_snapshot(player: &AudioPlayer) -> PlaybackRuntimeSnapshot {
    let shared = player.shared_state();
    let volume = shared.volume.load(std::sync::atomic::Ordering::Relaxed) as f32 / 1_000_000.0;
    let device_id = shared.device_id.load(std::sync::atomic::Ordering::Relaxed);

    PlaybackRuntimeSnapshot {
        position_secs: Some(shared.current_time_secs()),
        duration_secs: Some(shared.duration_secs()),
        volume: Some(volume),
        device_id: if device_id >= 0 {
            Some(device_id as usize)
        } else {
            None
        },
        exclusive_mode: player.exclusive_mode,
    }
}

pub(crate) fn restore_domain_state(state: &Arc<AppState>) {
    match state.app_db.latest_open_playback_session() {
        Ok(Some(session)) => {
            *state.playback.active_session_id.lock() = Some(session.session_id);
            log::info!(
                "Recovered active playback session {} for '{}'",
                session.session_id,
                session.source_path
            );
        }
        Ok(None) => {}
        Err(e) => log::warn!("Failed to restore active playback session: {}", e),
    }

    match state
        .app_db
        .recent_analysis_tasks(state.analysis.scan_task_max_entries)
    {
        Ok(tasks) => {
            let mut memory_tasks = state.analysis.scan_tasks.lock();
            for task in tasks {
                memory_tasks.insert(
                    task.task_id,
                    ScanTaskRecord {
                        status: task.status,
                        created_at_epoch_secs: task.created_at_epoch_secs,
                        updated_at_epoch_secs: task.updated_at_epoch_secs,
                        result: task.result,
                        error: task.error,
                    },
                );
            }
            if !memory_tasks.is_empty() {
                log::info!(
                    "Recovered {} persisted analysis task records",
                    memory_tasks.len()
                );
            }
        }
        Err(e) => log::warn!("Failed to restore persisted analysis tasks: {}", e),
    }
}

pub(crate) fn record_webdav_probe(data: &AppState, latency: Duration, success: bool) {
    let latency_ms = latency.as_millis().min(u128::from(u64::MAX)) as u64;
    data.analysis
        .webdav_last_latency_ms
        .store(latency_ms, Ordering::Relaxed);
    data.analysis
        .webdav_max_latency_ms
        .fetch_max(latency_ms, Ordering::Relaxed);
    data.analysis
        .webdav_request_count
        .fetch_add(1, Ordering::Relaxed);
    if !success {
        data.analysis
            .webdav_error_count
            .fetch_add(1, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_state_for_path(path: &str) -> StateResponse {
        StateResponse {
            is_playing: false,
            is_paused: false,
            is_loading: false,
            duration: 0.0,
            current_time: 0.0,
            file_path: Some(path.to_string()),
            media_id: None,
            ncm_song_id: None,
            ncm_source_page_url: None,
            volume: 1.0,
            device_id: None,
            exclusive_mode: false,
            eq_type: "IIR".to_string(),
            dither_enabled: false,
            replaygain_enabled: false,
            loudness_enabled: false,
            loudness_mode: "track".to_string(),
            target_lufs: -14.0,
            preamp_db: 0.0,
            rg_track_gain: None,
            rg_album_gain: None,
            rg_track_peak: None,
            rg_album_peak: None,
            saturation_enabled: false,
            saturation_drive: 0.0,
            saturation_mix: 0.0,
            crossfeed_enabled: false,
            crossfeed_mix: 0.0,
            dynamic_loudness_enabled: false,
            dynamic_loudness_strength: 0.0,
            dynamic_loudness_factor: 1.0,
            output_bits: 24,
            noise_shaper_curve: "Lipshitz5".to_string(),
            target_samplerate: None,
            resample_quality: "standard".to_string(),
            use_cache: false,
            preemptive_resample: false,
            title: None,
            artist: None,
            album: None,
            track_number: None,
            disc_number: None,
            genre: None,
            year: None,
            has_cover_art: false,
            external_artwork_url: None,
            repeat_mode: "off".to_string(),
            shuffle_mode: "off".to_string(),
        }
    }

    #[test]
    fn enrich_player_state_adds_database_metadata_without_player_reference() {
        let db = AppDatabase::in_memory().unwrap();
        let path = "https://m701.music.126.net/song.mp3";
        db.record_external_media_metadata(
            path,
            Some("NCM Song"),
            Some("NCM Artist"),
            Some("NCM Album"),
            Some(187.0),
            Some("https://p1.music.126.net/cover.jpg"),
        )
        .unwrap();
        db.record_ncm_track_source(path, 12345, Some("https://music.163.com/#/song?id=12345"))
            .unwrap();

        let state = enrich_player_state(&db, raw_state_for_path(path));

        assert_eq!(state.title.as_deref(), Some("NCM Song"));
        assert_eq!(state.artist.as_deref(), Some("NCM Artist"));
        assert_eq!(state.album.as_deref(), Some("NCM Album"));
        assert_eq!(state.duration, 187.0);
        assert!(state.has_cover_art || state.external_artwork_url.is_some());
        assert_eq!(state.ncm_song_id, Some(12345));
        assert_eq!(
            state.ncm_source_page_url.as_deref(),
            Some("https://music.163.com/#/song?id=12345")
        );
    }

    #[test]
    fn replaygain_state_is_derived_from_normalization_mode() {
        let mut player =
            AudioPlayer::new(crate::config::EngineSettings::default()).expect("player");

        for mode in [
            NormalizationMode::Track,
            NormalizationMode::Album,
            NormalizationMode::Streaming,
        ] {
            player.set_normalization_mode(mode);
            assert!(!get_player_state(&player).replaygain_enabled);
        }

        for mode in [
            NormalizationMode::ReplayGainTrack,
            NormalizationMode::ReplayGainAlbum,
        ] {
            player.set_normalization_mode(mode);
            assert!(get_player_state(&player).replaygain_enabled);
        }
    }
}
