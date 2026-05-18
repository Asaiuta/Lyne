use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

use crate::webdav::WebDavConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackRuntimeSnapshot {
    pub position_secs: Option<f64>,
    pub duration_secs: Option<f64>,
    pub volume: Option<f32>,
    pub device_id: Option<usize>,
    pub exclusive_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAnalysisTask {
    pub task_id: u64,
    pub task_type: String,
    pub source_path: String,
    pub status: String,
    pub store_result: bool,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
    pub result: Option<JsonValue>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverArtRecord {
    pub cover_art_id: String,
    pub media_id: String,
    pub mime_type: Option<String>,
    pub byte_len: u64,
    pub created_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackHistoryEntry {
    pub id: i64,
    pub session_id: Option<i64>,
    pub media_id: Option<String>,
    pub ncm_song_id: Option<i64>,
    pub ncm_source_page_url: Option<String>,
    pub source_path: String,
    pub event_type: String,
    pub event_at_epoch_secs: u64,
    pub position_secs: Option<f64>,
    pub payload: Option<JsonValue>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: Option<f64>,
    pub has_cover_art: bool,
    pub external_artwork_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItemRecord {
    pub media_id: String,
    pub source_path: String,
    pub source_kind: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub duration_secs: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u32>,
    pub bitrate_bps: Option<f64>,
    pub bits_per_sample: Option<u32>,
    pub has_cover_art: bool,
    pub external_artwork_url: Option<String>,
    pub size_bytes: Option<u64>,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryTrackSummaryRecord {
    pub track_key: i64,
    pub media_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub track_number: Option<u32>,
    pub file_name: String,
    pub folder_key: String,
    #[serde(skip_serializing)]
    pub folder_path: String,
    pub folder_label: String,
    pub duration_secs: Option<f64>,
    pub sample_rate: Option<u32>,
    pub bitrate_bps: Option<f64>,
    pub bits_per_sample: Option<u32>,
    pub has_cover_art: bool,
    pub external_artwork_url: Option<String>,
    pub size_bytes: Option<u64>,
    pub added_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryFolderSummaryRecord {
    pub key: String,
    pub label: String,
    pub path: String,
    pub count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryTrackDetailRecord {
    pub track_key: i64,
    pub item: MediaItemRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibrarySummaryStatsRecord {
    pub total_count: u64,
    pub total_size_bytes: u64,
    pub revision: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlaylistRecord {
    pub playlist_id: String,
    pub name: String,
    pub description: Option<String>,
    pub cover_media_id: Option<String>,
    pub cover_has_cover_art: bool,
    pub cover_external_artwork_url: Option<String>,
    pub track_count: u64,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalPlaylistDetailRecord {
    pub playlist: LocalPlaylistRecord,
    pub items: Vec<MediaItemRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaybackSessionRecord {
    pub session_id: i64,
    pub media_id: Option<String>,
    pub source_path: String,
    pub status: String,
    pub started_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
    pub ended_at_epoch_secs: Option<u64>,
    pub position_secs: Option<f64>,
    pub duration_secs: Option<f64>,
    pub volume: Option<f64>,
    pub device_id: Option<usize>,
    pub exclusive_mode: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfigRecord {
    pub profile_key: String,
    pub device_id: Option<usize>,
    pub exclusive_mode: bool,
    pub updated_at_epoch_secs: u64,
    pub last_seen_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DspConfigRecord {
    pub config_key: String,
    pub payload: JsonValue,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueSnapshotRecord {
    pub current_track_path: Option<String>,
    pub pending_track_path: Option<String>,
    pub needs_preload: bool,
    pub pending_ready: bool,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryRootRecord {
    pub root_id: i64,
    pub source_key: Option<String>,
    pub source_path: String,
    pub source_kind: String,
    pub display_name: String,
    pub scan_status: String,
    pub track_count: u64,
    pub last_scan_started_at_epoch_secs: Option<u64>,
    pub last_scan_finished_at_epoch_secs: Option<u64>,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueEntryRecord {
    pub queue_id: String,
    pub entry_id: i64,
    pub position_index: i64,
    pub shuffle_index: Option<i64>,
    pub source_path: String,
    pub media_id: Option<String>,
    pub status: String,
    pub added_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: Option<f64>,
    pub has_cover_art: bool,
    pub external_artwork_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebDavSourceRecord {
    pub source_key: String,
    pub display_name: String,
    pub base_url: String,
    pub username: Option<String>,
    pub is_default: bool,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone)]
pub struct StoredWebDavSource {
    pub source_key: String,
    pub display_name: String,
    pub config: WebDavConfig,
    pub is_default: bool,
    pub created_at_epoch_secs: u64,
    pub updated_at_epoch_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NcmAccountRecord {
    pub user_id: i64,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(skip_serializing)]
    pub cookie: String,
    pub has_cookie: bool,
    pub vip_type: Option<i64>,
    pub level: Option<i64>,
    pub signin_at_ms: Option<i64>,
    pub added_at_ms: i64,
    pub refreshed_at_ms: i64,
}

#[derive(Debug, Clone)]
pub struct NcmAccountUpsert {
    pub user_id: i64,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub cookie: String,
    pub vip_type: Option<i64>,
    pub level: Option<i64>,
    pub signin_at_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NcmTrackSourceRecord {
    pub media_id: String,
    pub source_path: String,
    pub song_id: i64,
    pub source_page_url: Option<String>,
    pub resolved_at_epoch_secs: u64,
    pub scrobbled_at_epoch_secs: Option<u64>,
    pub scrobble_secs: Option<u64>,
}
