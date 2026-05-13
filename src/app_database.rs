//! Application domain database.
//!
//! SQLite-backed persistence for higher-level domain state that should survive
//! process restarts: WebDAV sources, media metadata, playback sessions/history,
//! active device/DSP snapshots, queue snapshot, and analysis task records.

use rand::{seq::SliceRandom, Rng};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::decoder::TrackMetadata;
use crate::migration;
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

#[derive(Debug, Clone)]
pub enum LibrarySortField {
    Default,
    Title,
    Album,
    Duration,
    Size,
}

#[derive(Debug, Clone)]
pub enum LibrarySortOrder {
    Default,
    Asc,
    Desc,
}

#[derive(Debug, Clone)]
pub struct LibraryTrackQuery {
    pub search: Option<String>,
    pub folder_path: Option<String>,
    pub sort_field: LibrarySortField,
    pub sort_order: LibrarySortOrder,
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

pub struct AppDatabase {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

fn media_item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaItemRecord> {
    media_item_from_row_with_offset(row, 0)
}

fn media_item_from_row_with_offset(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<MediaItemRecord> {
    let source_path: String = row.get(offset + 1)?;
    let stored_size: Option<i64> = row.get(offset + 16)?;
    Ok(MediaItemRecord {
        media_id: row.get(offset)?,
        source_path: source_path.clone(),
        source_kind: row.get(offset + 2)?,
        title: row.get(offset + 3)?,
        artist: row.get(offset + 4)?,
        album: row.get(offset + 5)?,
        track_number: row.get::<_, Option<i64>>(offset + 6)?.map(|v| v as u32),
        disc_number: row.get::<_, Option<i64>>(offset + 7)?.map(|v| v as u32),
        genre: row.get(offset + 8)?,
        year: row.get::<_, Option<i64>>(offset + 9)?.map(|v| v as u32),
        duration_secs: row.get(offset + 10)?,
        sample_rate: row.get::<_, Option<i64>>(offset + 11)?.map(|v| v as u32),
        channels: row.get::<_, Option<i64>>(offset + 12)?.map(|v| v as u32),
        has_cover_art: row.get::<_, i64>(offset + 14)? != 0,
        external_artwork_url: row.get(offset + 15)?,
        size_bytes: stored_size
            .map(|v| v as u64)
            .or_else(|| file_size_for_source_path(&source_path)),
        updated_at_epoch_secs: row.get::<_, i64>(offset + 13)? as u64,
    })
}

fn queue_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueueEntryRecord> {
    Ok(QueueEntryRecord {
        queue_id: row.get(0)?,
        entry_id: row.get(1)?,
        position_index: row.get(2)?,
        shuffle_index: row.get(3)?,
        source_path: row.get(4)?,
        media_id: row.get(5)?,
        status: row.get(6)?,
        added_at_epoch_secs: row.get::<_, i64>(7)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(8)? as u64,
        title: row.get(9)?,
        artist: row.get(10)?,
        album: row.get(11)?,
        duration_secs: row.get(12)?,
        has_cover_art: row.get::<_, i64>(13)? != 0,
        external_artwork_url: row.get(14)?,
    })
}

const QUEUE_ENTRY_SELECT_WITH_METADATA: &str = r#"
    SELECT q.queue_id, q.entry_id, q.position_index, q.shuffle_index, q.source_path, q.media_id,
           q.status, q.added_at, q.updated_at,
           m.title, m.artist, m.album, m.duration_secs,
           EXISTS (
               SELECT 1
               FROM cover_art_cache
               WHERE cover_art_cache.media_id = q.media_id
               LIMIT 1
           ) AS has_cover_art,
           m.external_artwork_url
    FROM playback_queue_entries q
    LEFT JOIN media_items m ON m.media_id = q.media_id
"#;

fn library_track_summary_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<LibraryTrackSummaryRecord> {
    let source_path: String = row.get(1)?;
    let (folder_path, folder_label, file_name) = split_source_path_for_library(&source_path);
    let stored_size: Option<i64> = row.get(12)?;
    Ok(LibraryTrackSummaryRecord {
        track_key: row.get(0)?,
        media_id: row.get(7)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        track_number: row.get::<_, Option<i64>>(5)?.map(|value| value as u32),
        file_name,
        folder_key: stable_key_for_text(&folder_path),
        folder_path,
        folder_label,
        duration_secs: row.get(6)?,
        has_cover_art: row.get::<_, i64>(10)? != 0,
        external_artwork_url: row.get(11)?,
        size_bytes: stored_size
            .map(|value| value as u64)
            .or_else(|| file_size_for_source_path(&source_path)),
        added_at_epoch_secs: row.get::<_, i64>(8)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(9)? as u64,
    })
}

fn split_source_path_for_library(source_path: &str) -> (String, String, String) {
    let normalized = normalize_media_path_for_id(source_path)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let Some(index) = normalized.rfind('/') else {
        return (String::new(), String::new(), normalized.trim().to_string());
    };
    let folder_path = normalized[..index].to_string();
    let file_name = normalized[index + 1..].to_string();
    let folder_label = folder_path
        .rsplit('/')
        .find(|part| !part.is_empty())
        .unwrap_or(folder_path.as_str())
        .to_string();
    (folder_path, folder_label, file_name)
}

fn stable_key_for_text(value: &str) -> String {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let hash = value.as_bytes().iter().fold(FNV_OFFSET, |acc, byte| {
        (acc ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    format!("{:016x}", hash)
}

fn search_like_pattern(value: &str) -> Option<String> {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    Some(format!(
        "%{}%",
        trimmed
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    ))
}

fn normalized_folder_prefix(value: &str) -> Option<String> {
    let normalized = normalize_media_path_for_id(value)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if normalized.trim().is_empty() {
        return None;
    }
    Some(format!("{}/%", normalized))
}

fn library_order_clause(query: &LibraryTrackQuery) -> &'static str {
    match (&query.sort_field, &query.sort_order) {
        (LibrarySortField::Title, LibrarySortOrder::Asc) => {
            "lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Title, LibrarySortOrder::Desc) => {
            "lower(COALESCE(NULLIF(title, ''), source_path)) DESC, media_id DESC"
        }
        (LibrarySortField::Album, LibrarySortOrder::Asc) => {
            "lower(COALESCE(album, '')) ASC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Album, LibrarySortOrder::Desc) => {
            "lower(COALESCE(album, '')) DESC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Duration, LibrarySortOrder::Asc) => {
            "COALESCE(duration_secs, 0) ASC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Duration, LibrarySortOrder::Desc) => {
            "COALESCE(duration_secs, 0) DESC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Size, LibrarySortOrder::Asc) => {
            "COALESCE(size_bytes, 0) ASC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        (LibrarySortField::Size, LibrarySortOrder::Desc) => {
            "COALESCE(size_bytes, 0) DESC, lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC"
        }
        _ => "lower(COALESCE(NULLIF(title, ''), source_path)) ASC, media_id ASC",
    }
}

fn local_playlist_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalPlaylistRecord> {
    Ok(LocalPlaylistRecord {
        playlist_id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        cover_media_id: row.get(3)?,
        cover_has_cover_art: row.get::<_, i64>(4)? != 0,
        cover_external_artwork_url: row.get(5)?,
        track_count: row.get::<_, i64>(6)? as u64,
        created_at_epoch_secs: row.get::<_, i64>(7)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(8)? as u64,
    })
}

fn read_local_playlist_by_id(
    conn: &Connection,
    playlist_id: &str,
) -> Result<Option<LocalPlaylistRecord>, String> {
    conn.query_row(
        r#"
        SELECT p.playlist_id,
               p.name,
               p.description,
               cover.media_id AS cover_media_id,
               CASE
                   WHEN cover.media_id IS NULL THEN 0
                   ELSE EXISTS (
                       SELECT 1
                       FROM cover_art_cache
                       WHERE cover_art_cache.media_id = cover.media_id
                       LIMIT 1
                   )
               END AS cover_has_cover_art,
               cover.external_artwork_url,
               (
                   SELECT COUNT(*)
                   FROM local_playlist_items count_items
                   WHERE count_items.playlist_id = p.playlist_id
               ) AS track_count,
               p.created_at,
               p.updated_at
        FROM local_playlists p
        LEFT JOIN media_items cover ON cover.media_id = COALESCE(
            p.cover_media_id,
            (
                SELECT first_item.media_id
                FROM local_playlist_items first_item
                WHERE first_item.playlist_id = p.playlist_id
                ORDER BY first_item.position_index ASC, first_item.added_at DESC, first_item.media_id ASC
                LIMIT 1
            )
        )
        WHERE p.playlist_id = ?1
        "#,
        params![playlist_id],
        local_playlist_from_row,
    )
    .optional()
    .map_err(|e| format!("Failed to read local playlist '{}': {}", playlist_id, e))
}

fn reindex_local_playlist_items_tx(
    tx: &rusqlite::Transaction<'_>,
    playlist_id: &str,
) -> Result<(), String> {
    let media_ids = {
        let mut stmt = tx
            .prepare(
                r#"
                SELECT media_id
                FROM local_playlist_items
                WHERE playlist_id = ?1
                ORDER BY position_index ASC, added_at DESC, media_id ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare local playlist reindex query: {}", e))?;
        let media_ids = stmt
            .query_map(params![playlist_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query local playlist item order: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode local playlist item order: {}", e))?;
        media_ids
    };

    for (index, media_id) in media_ids.iter().enumerate() {
        tx.execute(
            r#"
            UPDATE local_playlist_items
            SET position_index = ?3
            WHERE playlist_id = ?1 AND media_id = ?2
            "#,
            params![playlist_id, media_id, index as i64],
        )
        .map_err(|e| {
            format!(
                "Failed to reindex local playlist item '{}': {}",
                media_id, e
            )
        })?;
    }
    Ok(())
}

fn ncm_account_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NcmAccountRecord> {
    let cookie: String = row.get(3)?;
    Ok(NcmAccountRecord {
        user_id: row.get(0)?,
        nickname: row.get(1)?,
        avatar_url: row.get(2)?,
        has_cookie: !cookie.trim().is_empty(),
        cookie,
        vip_type: row.get(4)?,
        level: row.get(5)?,
        signin_at_ms: row.get(6)?,
        added_at_ms: row.get(7)?,
        refreshed_at_ms: row.get(8)?,
    })
}

fn ncm_track_source_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<NcmTrackSourceRecord> {
    Ok(NcmTrackSourceRecord {
        media_id: row.get(0)?,
        source_path: row.get(1)?,
        song_id: row.get(2)?,
        source_page_url: row.get(3)?,
        resolved_at_epoch_secs: row.get::<_, i64>(4)? as u64,
        scrobbled_at_epoch_secs: row.get::<_, Option<i64>>(5)?.map(|value| value as u64),
        scrobble_secs: row.get::<_, Option<i64>>(6)?.map(|value| value as u64),
    })
}

impl AppDatabase {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let db_path = path.as_ref().to_path_buf();
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create app database directory: {}", e))?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open app database: {}", e))?;
        let mut conn = prepare_connection(conn, true)?;
        migration::run_migrations(&mut conn)?;

        let db = Self {
            conn: Mutex::new(conn),
            db_path,
        };
        db.gc_on_startup()?;
        Ok(db)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory()
            .map_err(|e| format!("Failed to create in-memory app database: {}", e))?;
        let mut conn = prepare_connection(conn, false)?;
        migration::run_migrations(&mut conn)?;
        let db = Self {
            conn: Mutex::new(conn),
            db_path: PathBuf::from(":memory:"),
        };
        Ok(db)
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    pub fn gc_on_startup(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        let history_cutoff = now - 30 * 24 * 3600;
        let task_cutoff = now - 30 * 24 * 3600;
        let stale_session_cutoff = now - 24 * 3600;

        let removed_history = conn
            .execute(
                "DELETE FROM playback_history WHERE event_at < ?1",
                params![history_cutoff],
            )
            .map_err(|e| format!("Failed to GC old playback history: {}", e))?;
        if removed_history > 0 {
            log::info!(
                "GC removed {} old playback history entries",
                removed_history
            );
        }

        let removed_tasks = conn
            .execute(
                r#"
                DELETE FROM analysis_tasks
                WHERE updated_at < ?1
                  AND status IN ('success', 'error', 'canceled')
                "#,
                params![task_cutoff],
            )
            .map_err(|e| format!("Failed to GC terminal analysis tasks: {}", e))?;
        if removed_tasks > 0 {
            log::info!("GC removed {} terminal analysis tasks", removed_tasks);
        }

        let abandoned_sessions = conn
            .execute(
                r#"
                UPDATE playback_sessions
                SET status = 'abandoned',
                    ended_at = COALESCE(ended_at, updated_at),
                    updated_at = ?2
                WHERE ended_at IS NULL
                  AND started_at < ?1
                "#,
                params![stale_session_cutoff, now],
            )
            .map_err(|e| format!("Failed to mark stale playback sessions abandoned: {}", e))?;
        if abandoned_sessions > 0 {
            log::info!(
                "GC marked {} stale playback sessions abandoned",
                abandoned_sessions
            );
        }

        let removed_cover_art = conn
            .execute(
                r#"
                DELETE FROM cover_art_cache
                WHERE NOT EXISTS (
                    SELECT 1 FROM media_items
                    WHERE media_items.media_id = cover_art_cache.media_id
                )
                "#,
                [],
            )
            .map_err(|e| format!("Failed to GC orphaned cover art: {}", e))?;
        if removed_cover_art > 0 {
            log::info!(
                "GC removed {} orphaned cover art entries",
                removed_cover_art
            );
        }

        Ok(())
    }

    pub fn list_ncm_accounts(&self) -> Result<(Vec<NcmAccountRecord>, Option<i64>), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT user_id, nickname, avatar_url, cookie, vip_type, level,
                       signin_at_ms, added_at_ms, refreshed_at_ms
                FROM ncm_accounts
                ORDER BY added_at_ms ASC, user_id ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare NCM account list query: {}", e))?;
        let accounts = stmt
            .query_map([], ncm_account_from_row)
            .map_err(|e| format!("Failed to query NCM accounts: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode NCM accounts: {}", e))?;
        let active_user_id = active_ncm_user_id_from_conn(&conn)?;
        Ok((accounts, active_user_id))
    }

    pub fn active_ncm_account(&self) -> Result<Option<NcmAccountRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let Some(user_id) = active_ncm_user_id_from_conn(&conn)? else {
            return Ok(None);
        };
        conn.query_row(
            r#"
            SELECT user_id, nickname, avatar_url, cookie, vip_type, level,
                   signin_at_ms, added_at_ms, refreshed_at_ms
            FROM ncm_accounts
            WHERE user_id = ?1
            "#,
            params![user_id],
            ncm_account_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read active NCM account: {}", e))
    }

    pub fn active_ncm_cookie(&self) -> Result<Option<String>, String> {
        Ok(self
            .active_ncm_account()?
            .and_then(|account| non_empty_string(account.cookie)))
    }

    pub fn upsert_ncm_account(&self, input: &NcmAccountUpsert) -> Result<NcmAccountRecord, String> {
        if input.user_id <= 0 {
            return Err("NCM user id must be positive".to_string());
        }
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_millis_i64();
        conn.execute(
            r#"
            INSERT INTO ncm_accounts (
                user_id, nickname, avatar_url, cookie, vip_type, level,
                signin_at_ms, added_at_ms, refreshed_at_ms
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
            ON CONFLICT(user_id) DO UPDATE SET
                nickname = COALESCE(excluded.nickname, nickname),
                avatar_url = COALESCE(excluded.avatar_url, avatar_url),
                cookie = excluded.cookie,
                vip_type = COALESCE(excluded.vip_type, vip_type),
                level = COALESCE(excluded.level, level),
                signin_at_ms = COALESCE(excluded.signin_at_ms, signin_at_ms),
                refreshed_at_ms = excluded.refreshed_at_ms
            "#,
            params![
                input.user_id,
                input.nickname,
                input.avatar_url,
                input.cookie,
                input.vip_type,
                input.level,
                input.signin_at_ms,
                now,
            ],
        )
        .map_err(|e| format!("Failed to upsert NCM account: {}", e))?;
        set_active_ncm_user_id_in_conn(&conn, Some(input.user_id))?;
        read_ncm_account_from_conn(&conn, input.user_id)
    }

    pub fn update_ncm_account_profile(
        &self,
        user_id: i64,
        nickname: Option<&str>,
        avatar_url: Option<&str>,
        vip_type: Option<i64>,
        level: Option<i64>,
    ) -> Result<Option<NcmAccountRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_millis_i64();
        let changed = conn
            .execute(
                r#"
                UPDATE ncm_accounts
                SET nickname = COALESCE(?2, nickname),
                    avatar_url = COALESCE(?3, avatar_url),
                    vip_type = COALESCE(?4, vip_type),
                    level = COALESCE(?5, level),
                    refreshed_at_ms = ?6
                WHERE user_id = ?1
                "#,
                params![user_id, nickname, avatar_url, vip_type, level, now],
            )
            .map_err(|e| format!("Failed to update NCM account profile: {}", e))?;
        if changed == 0 {
            return Ok(None);
        }
        read_ncm_account_from_conn(&conn, user_id).map(Some)
    }

    pub fn mark_ncm_account_signed_in(
        &self,
        user_id: i64,
    ) -> Result<Option<NcmAccountRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_millis_i64();
        let changed = conn
            .execute(
                r#"
                UPDATE ncm_accounts
                SET signin_at_ms = ?2,
                    refreshed_at_ms = ?2
                WHERE user_id = ?1
                "#,
                params![user_id, now],
            )
            .map_err(|e| format!("Failed to update NCM account signin time: {}", e))?;
        if changed == 0 {
            return Ok(None);
        }
        read_ncm_account_from_conn(&conn, user_id).map(Some)
    }

    pub fn set_active_ncm_account(&self, user_id: i64) -> Result<NcmAccountRecord, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let account = read_ncm_account_from_conn(&conn, user_id)?;
        set_active_ncm_user_id_in_conn(&conn, Some(user_id))?;
        Ok(account)
    }

    pub fn clear_active_ncm_account(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        set_active_ncm_user_id_in_conn(&conn, None)
    }

    pub fn delete_ncm_account(&self, user_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM ncm_accounts WHERE user_id = ?1",
            params![user_id],
        )
        .map_err(|e| format!("Failed to delete NCM account: {}", e))?;
        if active_ncm_user_id_from_conn(&conn)? == Some(user_id) {
            set_active_ncm_user_id_in_conn(&conn, None)?;
        }
        Ok(())
    }

    #[cfg(test)]
    fn has_column(&self, table: &str, column: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(&format!("PRAGMA table_info({})", table))
            .map_err(|e| format!("Failed to inspect {} schema: {}", table, e))?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| format!("Failed to read {} schema columns: {}", table, e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode {} schema columns: {}", table, e))?;
        Ok(columns.iter().any(|name| name == column))
    }

    pub fn load_primary_webdav_source(&self) -> Result<Option<WebDavConfig>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT base_url, username, password
            FROM webdav_sources
            WHERE is_default = 1
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
            [],
            |row| {
                Ok(WebDavConfig {
                    base_url: row.get(0)?,
                    username: row.get(1)?,
                    password: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source: {}", e))
    }

    pub fn save_primary_webdav_source(&self, config: &WebDavConfig) -> Result<(), String> {
        self.upsert_webdav_source("primary", "Primary WebDAV", config, true)
    }

    pub fn list_webdav_sources(&self) -> Result<Vec<WebDavSourceRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT source_key, display_name, base_url, username, is_default, created_at, updated_at
                FROM webdav_sources
                ORDER BY is_default DESC, updated_at DESC, source_key ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare WebDAV sources query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(WebDavSourceRecord {
                    source_key: row.get(0)?,
                    display_name: row.get(1)?,
                    base_url: row.get(2)?,
                    username: row.get(3)?,
                    is_default: row.get::<_, i64>(4)? != 0,
                    created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                })
            })
            .map_err(|e| format!("Failed to query WebDAV sources: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode WebDAV sources: {}", e))
    }

    pub fn get_webdav_source(
        &self,
        source_key: &str,
    ) -> Result<Option<WebDavSourceRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT source_key, display_name, base_url, username, is_default, created_at, updated_at
            FROM webdav_sources
            WHERE source_key = ?1
            "#,
            params![source_key],
            |row| {
                Ok(WebDavSourceRecord {
                    source_key: row.get(0)?,
                    display_name: row.get(1)?,
                    base_url: row.get(2)?,
                    username: row.get(3)?,
                    is_default: row.get::<_, i64>(4)? != 0,
                    created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source: {}", e))
    }

    pub fn load_webdav_source_config(
        &self,
        source_key: &str,
    ) -> Result<Option<StoredWebDavSource>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT source_key, display_name, base_url, username, password, is_default, created_at, updated_at
            FROM webdav_sources
            WHERE source_key = ?1
            "#,
            params![source_key],
            |row| {
                Ok(StoredWebDavSource {
                    source_key: row.get(0)?,
                    display_name: row.get(1)?,
                    config: WebDavConfig {
                        base_url: row.get(2)?,
                        username: row.get(3)?,
                        password: row.get(4)?,
                    },
                    is_default: row.get::<_, i64>(5)? != 0,
                    created_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(7)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source config: {}", e))
    }

    pub fn upsert_webdav_source(
        &self,
        source_key: &str,
        display_name: &str,
        config: &WebDavConfig,
        make_default: bool,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start WebDAV source transaction: {}", e))?;
        let now = now_epoch_secs_i64();

        if make_default {
            tx.execute(
                "UPDATE webdav_sources SET is_default = 0 WHERE is_default = 1",
                [],
            )
            .map_err(|e| format!("Failed to clear default WebDAV source: {}", e))?;
        }

        tx.execute(
            r#"
            INSERT INTO webdav_sources
                (source_key, display_name, base_url, username, password, is_default, created_at, updated_at)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            ON CONFLICT(source_key) DO UPDATE SET
                display_name = excluded.display_name,
                base_url = excluded.base_url,
                username = excluded.username,
                password = excluded.password,
                is_default = excluded.is_default,
                updated_at = excluded.updated_at
            "#,
            params![
                source_key,
                display_name,
                config.base_url,
                config.username,
                config.password,
                bool_to_sqlite(make_default),
                now
            ],
        )
        .map_err(|e| format!("Failed to upsert WebDAV source: {}", e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit WebDAV source transaction: {}", e))?;
        Ok(())
    }

    pub fn set_default_webdav_source(
        &self,
        source_key: &str,
    ) -> Result<Option<WebDavConfig>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start default WebDAV source transaction: {}", e))?;

        let selected = tx
            .query_row(
                r#"
                SELECT base_url, username, password
                FROM webdav_sources
                WHERE source_key = ?1
                "#,
                params![source_key],
                |row| {
                    Ok(WebDavConfig {
                        base_url: row.get(0)?,
                        username: row.get(1)?,
                        password: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("Failed to load requested WebDAV source: {}", e))?;

        let Some(config) = selected else {
            return Ok(None);
        };

        tx.execute(
            "UPDATE webdav_sources SET is_default = 0 WHERE is_default = 1",
            [],
        )
        .map_err(|e| format!("Failed to clear existing default WebDAV source: {}", e))?;
        tx.execute(
            "UPDATE webdav_sources SET is_default = 1, updated_at = ?2 WHERE source_key = ?1",
            params![source_key, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to set default WebDAV source: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit default WebDAV source transaction: {}", e))?;

        Ok(Some(config))
    }

    pub fn delete_webdav_source(&self, source_key: &str) -> Result<Option<WebDavConfig>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start delete WebDAV source transaction: {}", e))?;

        let was_default = tx
            .query_row(
                "SELECT is_default FROM webdav_sources WHERE source_key = ?1",
                params![source_key],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect WebDAV source before delete: {}", e))?;

        if was_default.is_none() {
            return Ok(None);
        }

        tx.execute(
            "DELETE FROM webdav_sources WHERE source_key = ?1",
            params![source_key],
        )
        .map_err(|e| format!("Failed to delete WebDAV source: {}", e))?;

        let fallback = if was_default == Some(1) {
            let fallback = tx
                .query_row(
                    r#"
                    SELECT source_key, base_url, username, password
                    FROM webdav_sources
                    ORDER BY updated_at DESC, created_at DESC, source_key ASC
                    LIMIT 1
                    "#,
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            WebDavConfig {
                                base_url: row.get(1)?,
                                username: row.get(2)?,
                                password: row.get(3)?,
                            },
                        ))
                    },
                )
                .optional()
                .map_err(|e| format!("Failed to select fallback WebDAV source: {}", e))?;

            if let Some((fallback_key, fallback_cfg)) = fallback {
                tx.execute(
                    "UPDATE webdav_sources SET is_default = 1, updated_at = ?2 WHERE source_key = ?1",
                    params![fallback_key, now_epoch_secs_i64()],
                )
                .map_err(|e| format!("Failed to promote fallback WebDAV source: {}", e))?;
                Some(fallback_cfg)
            } else {
                Some(WebDavConfig::default())
            }
        } else {
            None
        };

        tx.commit()
            .map_err(|e| format!("Failed to commit delete WebDAV source transaction: {}", e))?;
        Ok(fallback)
    }

    pub fn upsert_analysis_task(
        &self,
        task_id: u64,
        task_type: &str,
        source_path: &str,
        status: &str,
        store_result: bool,
        created_at_epoch_secs: u64,
        updated_at_epoch_secs: u64,
        result: Option<&JsonValue>,
        error: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let result_json = result.map(|value| value.to_string());
        conn.execute(
            r#"
            INSERT INTO analysis_tasks
                (task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(task_id) DO UPDATE SET
                task_type = excluded.task_type,
                source_path = excluded.source_path,
                status = excluded.status,
                store_result = excluded.store_result,
                updated_at = excluded.updated_at,
                result_json = excluded.result_json,
                error_text = excluded.error_text
            "#,
            params![
                task_id as i64,
                task_type,
                source_path,
                status,
                bool_to_sqlite(store_result),
                created_at_epoch_secs as i64,
                updated_at_epoch_secs as i64,
                result_json,
                error,
            ],
        )
        .map_err(|e| format!("Failed to persist analysis task: {}", e))?;
        Ok(())
    }

    pub fn get_analysis_task(&self, task_id: u64) -> Result<Option<StoredAnalysisTask>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text
            FROM analysis_tasks
            WHERE task_id = ?1
            "#,
            params![task_id as i64],
            |row| {
                let result_json: Option<String> = row.get(7)?;
                Ok(StoredAnalysisTask {
                    task_id: row.get::<_, i64>(0)? as u64,
                    task_type: row.get(1)?,
                    source_path: row.get(2)?,
                    status: row.get(3)?,
                    store_result: row.get::<_, i64>(4)? != 0,
                    created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                    result: result_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str(value).ok()),
                    error: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read analysis task: {}", e))
    }

    pub fn recent_analysis_tasks(&self, limit: usize) -> Result<Vec<StoredAnalysisTask>, String> {
        self.recent_analysis_tasks_by_type(None, limit)
    }

    pub fn recent_analysis_tasks_by_type(
        &self,
        task_type: Option<&str>,
        limit: usize,
    ) -> Result<Vec<StoredAnalysisTask>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let query_all = r#"
                SELECT task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text
                FROM analysis_tasks
                ORDER BY updated_at DESC, task_id DESC
                LIMIT ?1
                "#;
        let query_filtered = r#"
                SELECT task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text
                FROM analysis_tasks
                WHERE task_type = ?1
                ORDER BY updated_at DESC, task_id DESC
                LIMIT ?2
                "#;

        let mapper = |row: &rusqlite::Row<'_>| -> rusqlite::Result<StoredAnalysisTask> {
            let result_json: Option<String> = row.get(7)?;
            Ok(StoredAnalysisTask {
                task_id: row.get::<_, i64>(0)? as u64,
                task_type: row.get(1)?,
                source_path: row.get(2)?,
                status: row.get(3)?,
                store_result: row.get::<_, i64>(4)? != 0,
                created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                updated_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                result: result_json
                    .as_deref()
                    .and_then(|value| serde_json::from_str(value).ok()),
                error: row.get(8)?,
            })
        };

        let rows = if let Some(task_type) = task_type {
            let mut stmt = conn
                .prepare(query_filtered)
                .map_err(|e| format!("Failed to prepare filtered analysis tasks query: {}", e))?;
            let rows = stmt
                .query_map(params![task_type, limit as i64], mapper)
                .map_err(|e| format!("Failed to query filtered analysis tasks: {}", e))?
                .collect::<Result<Vec<_>, _>>();
            rows
        } else {
            let mut stmt = conn
                .prepare(query_all)
                .map_err(|e| format!("Failed to prepare recent analysis tasks query: {}", e))?;
            let rows = stmt
                .query_map(params![limit as i64], mapper)
                .map_err(|e| format!("Failed to query recent analysis tasks: {}", e))?
                .collect::<Result<Vec<_>, _>>();
            rows
        };

        rows.map_err(|e| format!("Failed to decode recent analysis tasks: {}", e))
    }

    pub fn record_media_stub(&self, source_path: &str) -> Result<String, String> {
        let media_id = media_id_for_path(source_path);
        let source_kind =
            if source_path.starts_with("http://") || source_path.starts_with("https://") {
                "remote"
            } else {
                "local"
            };
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT(media_id) DO UPDATE SET
                source_path = excluded.source_path,
                source_kind = excluded.source_kind,
                updated_at = excluded.updated_at
            "#,
            params![media_id, source_path, source_kind, now],
        )
        .map_err(|e| format!("Failed to record media item: {}", e))?;
        Ok(media_id_for_path(source_path))
    }

    pub fn record_media_metadata(
        &self,
        source_path: &str,
        metadata: &TrackMetadata,
        duration_secs: Option<f64>,
        sample_rate: Option<u32>,
        channels: Option<usize>,
    ) -> Result<String, String> {
        self.record_media_metadata_with_scan_info(
            source_path,
            metadata,
            duration_secs,
            sample_rate,
            channels,
            None,
            None,
        )
    }

    pub fn record_media_metadata_with_scan_info(
        &self,
        source_path: &str,
        metadata: &TrackMetadata,
        duration_secs: Option<f64>,
        sample_rate: Option<u32>,
        channels: Option<usize>,
        mtime: Option<f64>,
        size_bytes: Option<u64>,
    ) -> Result<String, String> {
        let media_id = self.record_media_stub(source_path)?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            UPDATE media_items
            SET title = COALESCE(NULLIF(?2, ''), title),
                artist = COALESCE(NULLIF(?3, ''), artist),
                album = COALESCE(NULLIF(?4, ''), album),
                track_number = ?5,
                disc_number = ?6,
                genre = ?7,
                year = ?8,
                duration_secs = COALESCE(?9, duration_secs),
                sample_rate = COALESCE(?10, sample_rate),
                channels = COALESCE(?11, channels),
                mtime = COALESCE(?13, mtime),
                size_bytes = COALESCE(?14, size_bytes),
                updated_at = ?12
            WHERE media_id = ?1
            "#,
            params![
                media_id,
                metadata.title,
                metadata.artist,
                metadata.album,
                metadata.track_number.map(|v| v as i64),
                metadata.disc_number.map(|v| v as i64),
                metadata.genre,
                metadata.year.map(|v| v as i64),
                duration_secs,
                sample_rate.map(|v| v as i64),
                channels.map(|v| v as i64),
                now,
                mtime,
                size_bytes.map(|v| v as i64),
            ],
        )
        .map_err(|e| format!("Failed to update media metadata: {}", e))?;

        if let Some(ref art) = metadata.cover_art {
            let cover_art_id = format!("{}:cover", media_id);
            conn.execute(
                r#"
                INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT(cover_art_id) DO UPDATE SET
                    mime_type = excluded.mime_type,
                    image_bytes = excluded.image_bytes,
                    byte_len = excluded.byte_len,
                    created_at = excluded.created_at
                "#,
                params![
                    cover_art_id,
                    media_id,
                    metadata.cover_art_mime,
                    art,
                    art.len() as i64,
                    now,
                ],
            )
            .map_err(|e| format!("Failed to update cover art cache: {}", e))?;
        }

        Ok(media_id_for_path(source_path))
    }

    pub fn record_external_media_metadata(
        &self,
        source_path: &str,
        title: Option<&str>,
        artist: Option<&str>,
        album: Option<&str>,
        duration_secs: Option<f64>,
        external_artwork_url: Option<&str>,
    ) -> Result<String, String> {
        let media_id = self.record_media_stub(source_path)?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            UPDATE media_items
            SET title = COALESCE(?2, title),
                artist = COALESCE(?3, artist),
                album = COALESCE(?4, album),
                duration_secs = COALESCE(?5, duration_secs),
                external_artwork_url = COALESCE(?6, external_artwork_url),
                updated_at = ?7
            WHERE media_id = ?1
            "#,
            params![
                media_id,
                title,
                artist,
                album,
                duration_secs,
                external_artwork_url,
                now,
            ],
        )
        .map_err(|e| format!("Failed to update external media metadata: {}", e))?;
        Ok(media_id_for_path(source_path))
    }

    pub fn record_ncm_track_source(
        &self,
        source_path: &str,
        song_id: i64,
        source_page_url: Option<&str>,
    ) -> Result<NcmTrackSourceRecord, String> {
        if song_id <= 0 {
            return Err("NCM song id must be positive".to_string());
        }
        let media_id = self.record_media_stub(source_path)?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO ncm_track_sources (
                media_id, source_path, song_id, source_page_url, resolved_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(media_id) DO UPDATE SET
                source_path = excluded.source_path,
                song_id = excluded.song_id,
                source_page_url = excluded.source_page_url,
                resolved_at = excluded.resolved_at
            "#,
            params![media_id, source_path, song_id, source_page_url, now],
        )
        .map_err(|e| format!("Failed to record NCM track source: {}", e))?;
        read_ncm_track_source_from_conn(&conn, &media_id)
    }

    pub fn ncm_track_source_for_path(
        &self,
        source_path: &str,
    ) -> Result<Option<NcmTrackSourceRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let media_id = media_id_for_path(source_path);
        conn.query_row(
            r#"
            SELECT media_id, source_path, song_id, source_page_url,
                   resolved_at, scrobbled_at, scrobble_secs
            FROM ncm_track_sources
            WHERE media_id = ?1
            "#,
            params![media_id],
            ncm_track_source_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read NCM track source: {}", e))
    }

    pub fn mark_ncm_track_scrobbled(
        &self,
        source_path: &str,
        scrobble_secs: u64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let media_id = media_id_for_path(source_path);
        conn.execute(
            r#"
            UPDATE ncm_track_sources
            SET scrobbled_at = ?2,
                scrobble_secs = ?3
            WHERE media_id = ?1
            "#,
            params![media_id, now_epoch_secs_i64(), scrobble_secs as i64],
        )
        .map_err(|e| format!("Failed to mark NCM track scrobbled: {}", e))?;
        Ok(())
    }

    pub fn media_metadata_for_path(
        &self,
        source_path: &str,
    ) -> Result<Option<MediaItemRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
                   genre, year, duration_secs, sample_rate, channels, updated_at,
                   EXISTS (
                       SELECT 1
                       FROM cover_art_cache
                       WHERE cover_art_cache.media_id = media_items.media_id
                       LIMIT 1
                   ) AS has_cover_art,
                   external_artwork_url,
                   size_bytes
            FROM media_items
            WHERE media_id = ?1 OR source_path = ?2
            LIMIT 1
            "#,
            params![media_id_for_path(source_path), source_path],
            |row| media_item_from_row(row),
        )
        .optional()
        .map_err(|e| format!("Failed to read media metadata for '{}': {}", source_path, e))
    }

    pub fn get_cover_art_for_media(
        &self,
        media_id: &str,
    ) -> Result<Option<(CoverArtRecord, Vec<u8>)>, String> {
        let normalized_media_id = media_id_for_path(media_id);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at
            FROM cover_art_cache
            WHERE media_id = ?1 OR media_id = ?2
            ORDER BY created_at DESC, cover_art_id DESC
            LIMIT 1
            "#,
            params![media_id, normalized_media_id],
            |row| {
                Ok((
                    CoverArtRecord {
                        cover_art_id: row.get(0)?,
                        media_id: row.get(1)?,
                        mime_type: row.get(2)?,
                        byte_len: row.get::<_, i64>(4)? as u64,
                        created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    },
                    row.get(3)?,
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read cover art cache: {}", e))
    }

    pub fn source_path_for_media_id(&self, media_id: &str) -> Result<Option<String>, String> {
        let normalized_media_id = media_id_for_path(media_id);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT source_path
            FROM media_items
            WHERE media_id = ?1 OR media_id = ?2 OR source_path = ?3
            LIMIT 1
            "#,
            params![media_id, normalized_media_id, media_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read source path for media '{}': {}", media_id, e))
    }

    pub fn start_playback_session(
        &self,
        source_path: &str,
        status: &str,
        snapshot: &PlaybackRuntimeSnapshot,
    ) -> Result<i64, String> {
        let media_id = self.record_media_stub(source_path)?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO playback_sessions
                (media_id, source_path, status, started_at, updated_at, position_secs, duration_secs, volume, device_id, exclusive_mode)
            VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                media_id,
                source_path,
                status,
                now,
                snapshot.position_secs,
                snapshot.duration_secs,
                snapshot.volume.map(|v| v as f64),
                snapshot.device_id.map(|v| v as i64),
                bool_to_sqlite(snapshot.exclusive_mode),
            ],
        )
        .map_err(|e| format!("Failed to start playback session: {}", e))?;
        Ok(conn.last_insert_rowid())
    }

    pub fn update_playback_session(
        &self,
        session_id: i64,
        status: &str,
        snapshot: &PlaybackRuntimeSnapshot,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            UPDATE playback_sessions
            SET status = ?2,
                updated_at = ?3,
                position_secs = ?4,
                duration_secs = ?5,
                volume = ?6,
                device_id = ?7,
                exclusive_mode = ?8
            WHERE session_id = ?1
            "#,
            params![
                session_id,
                status,
                now,
                snapshot.position_secs,
                snapshot.duration_secs,
                snapshot.volume.map(|v| v as f64),
                snapshot.device_id.map(|v| v as i64),
                bool_to_sqlite(snapshot.exclusive_mode),
            ],
        )
        .map_err(|e| format!("Failed to update playback session: {}", e))?;
        Ok(())
    }

    pub fn finish_playback_session(
        &self,
        session_id: i64,
        status: &str,
        snapshot: &PlaybackRuntimeSnapshot,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            UPDATE playback_sessions
            SET status = ?2,
                updated_at = ?3,
                ended_at = ?3,
                position_secs = ?4,
                duration_secs = ?5,
                volume = ?6,
                device_id = ?7,
                exclusive_mode = ?8
            WHERE session_id = ?1
            "#,
            params![
                session_id,
                status,
                now,
                snapshot.position_secs,
                snapshot.duration_secs,
                snapshot.volume.map(|v| v as f64),
                snapshot.device_id.map(|v| v as i64),
                bool_to_sqlite(snapshot.exclusive_mode),
            ],
        )
        .map_err(|e| format!("Failed to finish playback session: {}", e))?;
        Ok(())
    }

    pub fn append_playback_history(
        &self,
        session_id: Option<i64>,
        source_path: &str,
        event_type: &str,
        position_secs: Option<f64>,
        payload: Option<&JsonValue>,
    ) -> Result<(), String> {
        let media_id = media_id_for_path(source_path);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        let payload_json = payload.map(|value| value.to_string());
        conn.execute(
            r#"
            INSERT INTO playback_history
                (session_id, media_id, source_path, event_type, event_at, position_secs, payload_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                session_id,
                media_id,
                source_path,
                event_type,
                now,
                position_secs,
                payload_json,
            ],
        )
        .map_err(|e| format!("Failed to append playback history: {}", e))?;
        Ok(())
    }

    pub fn recent_playback_history(
        &self,
        limit: usize,
    ) -> Result<Vec<PlaybackHistoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT h.id, h.session_id, h.media_id, n.song_id, n.source_page_url,
                       h.source_path, h.event_type, h.event_at,
                       h.position_secs, h.payload_json, m.title, m.artist, m.album, m.duration_secs,
                       EXISTS (
                           SELECT 1
                           FROM cover_art_cache
                           WHERE cover_art_cache.media_id = h.media_id
                           LIMIT 1
                       ) AS has_cover_art,
                       m.external_artwork_url
                FROM playback_history h
                LEFT JOIN media_items m ON m.media_id = h.media_id
                LEFT JOIN ncm_track_sources n ON n.media_id = h.media_id
                ORDER BY h.event_at DESC, h.id DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare playback history query: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                let payload_json: Option<String> = row.get(9)?;
                Ok(PlaybackHistoryEntry {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    media_id: row.get(2)?,
                    ncm_song_id: row.get(3)?,
                    ncm_source_page_url: row.get(4)?,
                    source_path: row.get(5)?,
                    event_type: row.get(6)?,
                    event_at_epoch_secs: row.get::<_, i64>(7)? as u64,
                    position_secs: row.get(8)?,
                    payload: payload_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str(value).ok()),
                    title: row.get(10)?,
                    artist: row.get(11)?,
                    album: row.get(12)?,
                    duration_secs: row.get(13)?,
                    has_cover_art: row.get::<_, i64>(14)? != 0,
                    external_artwork_url: row.get(15)?,
                })
            })
            .map_err(|e| format!("Failed to query playback history: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playback history: {}", e))
    }

    pub fn recent_media_items(&self, limit: usize) -> Result<Vec<MediaItemRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
                       genre, year, duration_secs, sample_rate, channels, updated_at,
                       EXISTS (
                           SELECT 1
                           FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id
                           LIMIT 1
                       ) AS has_cover_art,
                       external_artwork_url,
                       size_bytes
                FROM media_items
                ORDER BY updated_at DESC, media_id DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare media items query: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], media_item_from_row)
            .map_err(|e| format!("Failed to query media items: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode media items: {}", e))
    }

    pub fn list_media_items(&self) -> Result<Vec<MediaItemRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
                       genre, year, duration_secs, sample_rate, channels, updated_at,
                       EXISTS (
                           SELECT 1
                           FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id
                           LIMIT 1
                       ) AS has_cover_art,
                       external_artwork_url,
                       size_bytes
                FROM media_items
                ORDER BY lower(COALESCE(title, source_path)), media_id
                "#,
            )
            .map_err(|e| format!("Failed to prepare media items list query: {}", e))?;

        let rows = stmt
            .query_map([], media_item_from_row)
            .map_err(|e| format!("Failed to query media items list: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode media items list: {}", e))
    }

    pub fn library_summary_stats(&self) -> Result<LibrarySummaryStatsRecord, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT COUNT(*),
                   COALESCE(SUM(COALESCE(size_bytes, 0)), 0),
                   COALESCE(MAX(updated_at), 0)
            FROM media_items
            "#,
            [],
            |row| {
                let total_count = row.get::<_, i64>(0)? as u64;
                let total_size_bytes = row.get::<_, i64>(1)? as u64;
                let max_updated = row.get::<_, i64>(2)?;
                Ok(LibrarySummaryStatsRecord {
                    total_count,
                    total_size_bytes,
                    revision: format!("{}:{}", total_count, max_updated),
                })
            },
        )
        .map_err(|e| format!("Failed to read library summary stats: {}", e))
    }

    pub fn list_library_track_summaries(&self) -> Result<Vec<LibraryTrackSummaryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT rowid, source_path, title, artist, album, track_number, duration_secs,
                       media_id, added_at, updated_at,
                       EXISTS (
                           SELECT 1
                           FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id
                           LIMIT 1
                       ) AS has_cover_art,
                       external_artwork_url,
                       size_bytes
                FROM media_items
                ORDER BY lower(COALESCE(NULLIF(title, ''), source_path)), media_id
                "#,
            )
            .map_err(|e| format!("Failed to prepare library summaries query: {}", e))?;

        let rows = stmt
            .query_map([], library_track_summary_from_row)
            .map_err(|e| format!("Failed to query library summaries: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode library summaries: {}", e))
    }

    pub fn library_folder_summaries_for_tracks(
        &self,
        tracks: &[LibraryTrackSummaryRecord],
    ) -> Vec<LibraryFolderSummaryRecord> {
        let mut folders = HashMap::<String, LibraryFolderSummaryRecord>::new();
        for track in tracks {
            let entry = folders.entry(track.folder_key.clone()).or_insert_with(|| {
                LibraryFolderSummaryRecord {
                    key: track.folder_key.clone(),
                    label: if track.folder_label.is_empty() {
                        track.folder_path.clone()
                    } else {
                        track.folder_label.clone()
                    },
                    path: track.folder_path.clone(),
                    count: 0,
                }
            });
            entry.count += 1;
        }
        let mut folders = folders.into_values().collect::<Vec<_>>();
        folders.sort_by(|left, right| {
            left.label
                .to_lowercase()
                .cmp(&right.label.to_lowercase())
                .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
        });
        folders
    }

    pub fn library_track_detail(
        &self,
        track_key: i64,
    ) -> Result<Option<LibraryTrackDetailRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT rowid, media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
                   genre, year, duration_secs, sample_rate, channels, updated_at,
                   EXISTS (
                       SELECT 1
                       FROM cover_art_cache
                       WHERE cover_art_cache.media_id = media_items.media_id
                       LIMIT 1
                   ) AS has_cover_art,
                   external_artwork_url,
                   size_bytes
            FROM media_items
            WHERE rowid = ?1
            LIMIT 1
            "#,
            params![track_key],
            |row| {
                Ok(LibraryTrackDetailRecord {
                    track_key: row.get(0)?,
                    item: media_item_from_row_with_offset(row, 1)?,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read library track detail '{}': {}", track_key, e))
    }

    pub fn media_id_for_track_key(&self, track_key: i64) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT media_id FROM media_items WHERE rowid = ?1 LIMIT 1",
            params![track_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read media id for track '{}': {}", track_key, e))
    }

    pub fn source_path_for_track_key(&self, track_key: i64) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT source_path FROM media_items WHERE rowid = ?1 LIMIT 1",
            params![track_key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| {
            format!(
                "Failed to read source path for track '{}': {}",
                track_key, e
            )
        })
    }

    pub fn source_paths_for_track_keys(
        &self,
        track_keys: &[i64],
    ) -> Result<Vec<(i64, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut path_by_key = HashMap::with_capacity(track_keys.len());
        for chunk in track_keys.chunks(500) {
            if chunk.is_empty() {
                continue;
            }
            let placeholders = std::iter::repeat("?")
                .take(chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT rowid, source_path FROM media_items WHERE rowid IN ({})",
                placeholders
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed to prepare library track key lookup: {}", e))?;
            let rows = stmt
                .query_map(params_from_iter(chunk.iter()), |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed to query library track key lookup: {}", e))?;
            for row in rows {
                let (track_key, source_path) =
                    row.map_err(|e| format!("Failed to decode library track key lookup: {}", e))?;
                path_by_key.insert(track_key, source_path);
            }
        }
        Ok(track_keys
            .iter()
            .filter_map(|track_key| {
                path_by_key
                    .get(track_key)
                    .map(|source_path| (*track_key, source_path.clone()))
            })
            .collect())
    }

    pub fn source_paths_for_library_query(
        &self,
        query: &LibraryTrackQuery,
    ) -> Result<Vec<(i64, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let search = search_like_pattern(query.search.as_deref().unwrap_or(""));
        let folder_prefix = query
            .folder_path
            .as_deref()
            .and_then(normalized_folder_prefix);
        let order_clause = library_order_clause(query);
        let sql = format!(
            r#"
            SELECT rowid, source_path
            FROM media_items
            WHERE (?1 IS NULL OR (
                    lower(COALESCE(title, '')) LIKE ?1 ESCAPE '\'
                 OR lower(COALESCE(artist, '')) LIKE ?1 ESCAPE '\'
                 OR lower(COALESCE(album, '')) LIKE ?1 ESCAPE '\'
                 OR lower(REPLACE(source_path, '\', '/')) LIKE ?1 ESCAPE '\'
            ))
              AND (?2 IS NULL OR REPLACE(source_path, '\', '/') LIKE ?2)
            ORDER BY {}
            "#,
            order_clause
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare library queue query: {}", e))?;
        let rows = stmt
            .query_map(params![search, folder_prefix], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query library queue paths: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode library queue paths: {}", e))
    }

    pub fn queue_entry_at_position(
        &self,
        queue_id: &str,
        position_index: i64,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            r#"
            {}
            WHERE q.queue_id = ?1 AND q.position_index = ?2
            LIMIT 1
            "#,
            QUEUE_ENTRY_SELECT_WITH_METADATA
        );
        conn.query_row(
            &sql,
            params![queue_id, position_index],
            queue_entry_from_row,
        )
        .optional()
        .map_err(|e| {
            format!(
                "Failed to read queue entry at position {}: {}",
                position_index, e
            )
        })
    }

    pub fn delete_media_items(&self, media_ids: &[String]) -> Result<u64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start media delete transaction: {}", e))?;
        let mut removed = 0_u64;
        let mut seen = std::collections::HashSet::new();

        for media_id in media_ids {
            let trimmed = media_id.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                continue;
            }
            let changed = tx
                .execute(
                    "DELETE FROM media_items WHERE media_id = ?1",
                    params![trimmed],
                )
                .map_err(|e| format!("Failed to delete media item '{}': {}", trimmed, e))?;
            removed += changed as u64;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit media delete transaction: {}", e))?;
        Ok(removed)
    }

    pub fn list_local_playlists(&self) -> Result<Vec<LocalPlaylistRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT p.playlist_id,
                       p.name,
                       p.description,
                       cover.media_id AS cover_media_id,
                       CASE
                           WHEN cover.media_id IS NULL THEN 0
                           ELSE EXISTS (
                               SELECT 1
                               FROM cover_art_cache
                               WHERE cover_art_cache.media_id = cover.media_id
                               LIMIT 1
                           )
                       END AS cover_has_cover_art,
                       cover.external_artwork_url,
                       (
                           SELECT COUNT(*)
                           FROM local_playlist_items count_items
                           WHERE count_items.playlist_id = p.playlist_id
                       ) AS track_count,
                       p.created_at,
                       p.updated_at
                FROM local_playlists p
                LEFT JOIN media_items cover ON cover.media_id = COALESCE(
                    p.cover_media_id,
                    (
                        SELECT first_item.media_id
                        FROM local_playlist_items first_item
                        WHERE first_item.playlist_id = p.playlist_id
                        ORDER BY first_item.position_index ASC, first_item.added_at DESC, first_item.media_id ASC
                        LIMIT 1
                    )
                )
                ORDER BY p.updated_at DESC, lower(p.name), p.playlist_id
                "#,
            )
            .map_err(|e| format!("Failed to prepare local playlists query: {}", e))?;

        let rows = stmt
            .query_map([], local_playlist_from_row)
            .map_err(|e| format!("Failed to query local playlists: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode local playlists: {}", e))
    }

    pub fn create_local_playlist(
        &self,
        name: &str,
        description: Option<&str>,
    ) -> Result<LocalPlaylistRecord, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Playlist name cannot be empty".to_string());
        }

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        let random_suffix: u32 = rand::thread_rng().gen_range(1000..=9999);
        let playlist_id = format!("local-{}-{}", now, random_suffix);
        let trimmed_description = description.map(str::trim).filter(|value| !value.is_empty());

        conn.execute(
            r#"
            INSERT INTO local_playlists (playlist_id, name, description, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?4)
            "#,
            params![playlist_id, trimmed_name, trimmed_description, now],
        )
        .map_err(|e| format!("Failed to create local playlist '{}': {}", trimmed_name, e))?;

        read_local_playlist_by_id(&conn, &playlist_id)?
            .ok_or_else(|| format!("Failed to read created local playlist '{}'", playlist_id))
    }

    pub fn update_local_playlist(
        &self,
        playlist_id: &str,
        name: Option<&str>,
        description: Option<&str>,
    ) -> Result<Option<LocalPlaylistRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let Some(current) = read_local_playlist_by_id(&conn, playlist_id)? else {
            return Ok(None);
        };
        let next_name = name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(current.name.as_str());
        let next_description = description
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or(current.description);
        let now = now_epoch_secs_i64();

        conn.execute(
            r#"
            UPDATE local_playlists
            SET name = ?2,
                description = ?3,
                updated_at = ?4
            WHERE playlist_id = ?1
            "#,
            params![playlist_id, next_name, next_description, now],
        )
        .map_err(|e| format!("Failed to update local playlist '{}': {}", playlist_id, e))?;

        read_local_playlist_by_id(&conn, playlist_id)
    }

    pub fn delete_local_playlist(&self, playlist_id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let changed = conn
            .execute(
                "DELETE FROM local_playlists WHERE playlist_id = ?1",
                params![playlist_id],
            )
            .map_err(|e| format!("Failed to delete local playlist '{}': {}", playlist_id, e))?;
        Ok(changed > 0)
    }

    pub fn get_local_playlist(
        &self,
        playlist_id: &str,
    ) -> Result<Option<LocalPlaylistDetailRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let Some(playlist) = read_local_playlist_by_id(&conn, playlist_id)? else {
            return Ok(None);
        };

        let mut stmt = conn
            .prepare(
                r#"
                SELECT media_items.media_id, media_items.source_path, media_items.source_kind,
                       media_items.title, media_items.artist, media_items.album,
                       media_items.track_number, media_items.disc_number,
                       media_items.genre, media_items.year, media_items.duration_secs,
                       media_items.sample_rate, media_items.channels, media_items.updated_at,
                       EXISTS (
                           SELECT 1
                           FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id
                           LIMIT 1
                       ) AS has_cover_art,
                       media_items.external_artwork_url,
                       media_items.size_bytes
                FROM local_playlist_items
                JOIN media_items ON media_items.media_id = local_playlist_items.media_id
                WHERE local_playlist_items.playlist_id = ?1
                ORDER BY local_playlist_items.position_index ASC,
                         local_playlist_items.added_at DESC,
                         local_playlist_items.media_id ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare local playlist items query: {}", e))?;

        let rows = stmt
            .query_map(params![playlist_id], media_item_from_row)
            .map_err(|e| format!("Failed to query local playlist items: {}", e))?;
        let items = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode local playlist items: {}", e))?;

        Ok(Some(LocalPlaylistDetailRecord { playlist, items }))
    }

    pub fn add_media_to_local_playlist(
        &self,
        playlist_id: &str,
        media_ids: &[String],
    ) -> Result<u64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start local playlist append transaction: {}", e))?;
        let exists = tx
            .query_row(
                "SELECT 1 FROM local_playlists WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect local playlist '{}': {}", playlist_id, e))?;
        if exists.is_none() {
            return Err(format!("Local playlist '{}' not found", playlist_id));
        }

        let existing = {
            let mut stmt = tx
                .prepare("SELECT media_id FROM local_playlist_items WHERE playlist_id = ?1")
                .map_err(|e| format!("Failed to prepare local playlist membership query: {}", e))?;
            let media_ids = stmt
                .query_map(params![playlist_id], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to query local playlist membership: {}", e))?
                .collect::<Result<std::collections::HashSet<_>, _>>()
                .map_err(|e| format!("Failed to decode local playlist membership: {}", e))?;
            media_ids
        };

        let mut seen = std::collections::HashSet::new();
        let mut additions = Vec::new();
        for media_id in media_ids {
            let trimmed = media_id.trim();
            if trimmed.is_empty() || existing.contains(trimmed) || !seen.insert(trimmed.to_string())
            {
                continue;
            }
            let media_exists = tx
                .query_row(
                    "SELECT 1 FROM media_items WHERE media_id = ?1",
                    params![trimmed],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|e| format!("Failed to inspect media item '{}': {}", trimmed, e))?;
            if media_exists.is_some() {
                additions.push(trimmed.to_string());
            }
        }

        if additions.is_empty() {
            tx.commit().map_err(|e| {
                format!(
                    "Failed to commit empty local playlist append transaction: {}",
                    e
                )
            })?;
            return Ok(0);
        }

        tx.execute(
            r#"
            UPDATE local_playlist_items
            SET position_index = position_index + ?2
            WHERE playlist_id = ?1
            "#,
            params![playlist_id, additions.len() as i64],
        )
        .map_err(|e| format!("Failed to shift local playlist positions: {}", e))?;

        let now = now_epoch_secs_i64();
        for (index, media_id) in additions.iter().enumerate() {
            tx.execute(
                r#"
                INSERT INTO local_playlist_items (playlist_id, media_id, position_index, added_at)
                VALUES (?1, ?2, ?3, ?4)
                "#,
                params![playlist_id, media_id, index as i64, now],
            )
            .map_err(|e| {
                format!(
                    "Failed to add media item '{}' to local playlist '{}': {}",
                    media_id, playlist_id, e
                )
            })?;
        }

        tx.execute(
            "UPDATE local_playlists SET updated_at = ?2 WHERE playlist_id = ?1",
            params![playlist_id, now],
        )
        .map_err(|e| format!("Failed to update local playlist timestamp: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit local playlist append transaction: {}", e))?;
        Ok(additions.len() as u64)
    }

    pub fn remove_media_from_local_playlist(
        &self,
        playlist_id: &str,
        media_ids: &[String],
    ) -> Result<u64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start local playlist removal transaction: {}", e))?;
        let exists = tx
            .query_row(
                "SELECT 1 FROM local_playlists WHERE playlist_id = ?1",
                params![playlist_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect local playlist '{}': {}", playlist_id, e))?;
        if exists.is_none() {
            return Err(format!("Local playlist '{}' not found", playlist_id));
        }

        let mut removed = 0_u64;
        let mut seen = std::collections::HashSet::new();

        for media_id in media_ids {
            let trimmed = media_id.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                continue;
            }
            let changed = tx
                .execute(
                    r#"
                    DELETE FROM local_playlist_items
                    WHERE playlist_id = ?1 AND media_id = ?2
                    "#,
                    params![playlist_id, trimmed],
                )
                .map_err(|e| {
                    format!(
                        "Failed to remove media item '{}' from local playlist '{}': {}",
                        trimmed, playlist_id, e
                    )
                })?;
            removed += changed as u64;
        }

        if removed > 0 {
            reindex_local_playlist_items_tx(&tx, playlist_id)?;
            tx.execute(
                "UPDATE local_playlists SET updated_at = ?2 WHERE playlist_id = ?1",
                params![playlist_id, now_epoch_secs_i64()],
            )
            .map_err(|e| format!("Failed to update local playlist timestamp: {}", e))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit local playlist removal transaction: {}", e))?;
        Ok(removed)
    }

    /// Load a snapshot of existing local media items for incremental scanning.
    /// Returns a map of source_path -> (mtime, size_bytes, has_cover_art).
    pub fn load_scan_snapshot(
        &self,
    ) -> Result<std::collections::HashMap<String, (Option<f64>, Option<u64>, bool)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT source_path, mtime, size_bytes,
                       EXISTS (
                           SELECT 1 FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id LIMIT 1
                       ) AS has_cover
                FROM media_items
                WHERE source_kind = 'local'
                "#,
            )
            .map_err(|e| format!("Failed to prepare scan snapshot query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let path: String = row.get(0)?;
                let mtime: Option<f64> = row.get(1)?;
                let size: Option<i64> = row.get(2)?;
                let has_cover: i64 = row.get(3)?;
                Ok((path, (mtime, size.map(|v| v as u64), has_cover != 0)))
            })
            .map_err(|e| format!("Failed to query scan snapshot: {}", e))?;

        let mut map = std::collections::HashMap::new();
        for row in rows.flatten() {
            map.insert(row.0, row.1);
        }
        Ok(map)
    }

    pub fn delete_local_media_not_in_root(
        &self,
        root_path: &str,
        keep_paths: &[String],
    ) -> Result<u64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start media cleanup transaction: {}", e))?;
        let mut stmt = tx
            .prepare(
                r#"
                SELECT source_path
                FROM media_items
                WHERE source_kind = 'local'
                "#,
            )
            .map_err(|e| format!("Failed to prepare media cleanup query: {}", e))?;
        let candidates = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query media cleanup candidates: {}", e))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode media cleanup candidates: {}", e))?;
        drop(stmt);

        let root_media_id = media_id_for_path(root_path)
            .trim_end_matches('/')
            .to_string();
        let root_id_prefix = format!("{}/", root_media_id);
        let keep = keep_paths
            .iter()
            .map(|path| media_id_for_path(path))
            .collect::<std::collections::HashSet<_>>();
        let mut removed = 0_u64;
        for source_path in candidates {
            let media_id = media_id_for_path(&source_path);
            if media_id != root_media_id && !media_id.starts_with(&root_id_prefix) {
                continue;
            }
            if keep.contains(&media_id) {
                continue;
            }
            let changed = tx
                .execute(
                    "DELETE FROM media_items WHERE media_id = ?1",
                    params![media_id],
                )
                .map_err(|e| {
                    format!("Failed to delete stale media item '{}': {}", source_path, e)
                })?;
            removed += changed as u64;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit media cleanup transaction: {}", e))?;
        Ok(removed)
    }

    pub fn recent_playback_sessions(
        &self,
        limit: usize,
    ) -> Result<Vec<PlaybackSessionRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT session_id, media_id, source_path, status, started_at, updated_at, ended_at,
                       position_secs, duration_secs, volume, device_id, exclusive_mode
                FROM playback_sessions
                ORDER BY updated_at DESC, session_id DESC
                LIMIT ?1
                "#,
            )
            .map_err(|e| format!("Failed to prepare playback sessions query: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(PlaybackSessionRecord {
                    session_id: row.get(0)?,
                    media_id: row.get(1)?,
                    source_path: row.get(2)?,
                    status: row.get(3)?,
                    started_at_epoch_secs: row.get::<_, i64>(4)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    ended_at_epoch_secs: row.get::<_, Option<i64>>(6)?.map(|v| v as u64),
                    position_secs: row.get(7)?,
                    duration_secs: row.get(8)?,
                    volume: row.get(9)?,
                    device_id: row.get::<_, Option<i64>>(10)?.map(|v| v as usize),
                    exclusive_mode: row.get::<_, i64>(11)? != 0,
                })
            })
            .map_err(|e| format!("Failed to query playback sessions: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playback sessions: {}", e))
    }

    pub fn latest_open_playback_session(&self) -> Result<Option<PlaybackSessionRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT session_id, media_id, source_path, status, started_at, updated_at, ended_at,
                   position_secs, duration_secs, volume, device_id, exclusive_mode
            FROM playback_sessions
            WHERE ended_at IS NULL
            ORDER BY updated_at DESC, session_id DESC
            LIMIT 1
            "#,
            [],
            |row| {
                Ok(PlaybackSessionRecord {
                    session_id: row.get(0)?,
                    media_id: row.get(1)?,
                    source_path: row.get(2)?,
                    status: row.get(3)?,
                    started_at_epoch_secs: row.get::<_, i64>(4)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(5)? as u64,
                    ended_at_epoch_secs: row.get::<_, Option<i64>>(6)?.map(|v| v as u64),
                    position_secs: row.get(7)?,
                    duration_secs: row.get(8)?,
                    volume: row.get(9)?,
                    device_id: row.get::<_, Option<i64>>(10)?.map(|v| v as usize),
                    exclusive_mode: row.get::<_, i64>(11)? != 0,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load latest open playback session: {}", e))
    }

    pub fn upsert_device_config(
        &self,
        profile_key: &str,
        device_id: Option<usize>,
        exclusive_mode: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO device_configs (profile_key, device_id, exclusive_mode, updated_at, last_seen_at)
            VALUES (?1, ?2, ?3, ?4, ?4)
            ON CONFLICT(profile_key) DO UPDATE SET
                device_id = excluded.device_id,
                exclusive_mode = excluded.exclusive_mode,
                updated_at = excluded.updated_at,
                last_seen_at = excluded.last_seen_at
            "#,
            params![
                profile_key,
                device_id.map(|v| v as i64),
                bool_to_sqlite(exclusive_mode),
                now,
            ],
        )
        .map_err(|e| format!("Failed to persist device config: {}", e))?;
        Ok(())
    }

    pub fn get_device_config(
        &self,
        profile_key: &str,
    ) -> Result<Option<DeviceConfigRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT profile_key, device_id, exclusive_mode, updated_at, last_seen_at
            FROM device_configs
            WHERE profile_key = ?1
            "#,
            params![profile_key],
            |row| {
                Ok(DeviceConfigRecord {
                    profile_key: row.get(0)?,
                    device_id: row.get::<_, Option<i64>>(1)?.map(|v| v as usize),
                    exclusive_mode: row.get::<_, i64>(2)? != 0,
                    updated_at_epoch_secs: row.get::<_, i64>(3)? as u64,
                    last_seen_at_epoch_secs: row.get::<_, i64>(4)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read device config: {}", e))
    }

    pub fn upsert_dsp_config(&self, config_key: &str, payload: &JsonValue) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO dsp_configs (config_key, payload_json, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(config_key) DO UPDATE SET
                payload_json = excluded.payload_json,
                updated_at = excluded.updated_at
            "#,
            params![config_key, payload.to_string(), now],
        )
        .map_err(|e| format!("Failed to persist DSP config: {}", e))?;
        Ok(())
    }

    pub fn list_dsp_configs(&self) -> Result<Vec<DspConfigRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT config_key, payload_json, updated_at
                FROM dsp_configs
                ORDER BY config_key ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare DSP configs query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let payload_json: String = row.get(1)?;
                Ok(DspConfigRecord {
                    config_key: row.get(0)?,
                    payload: serde_json::from_str(&payload_json).unwrap_or(JsonValue::Null),
                    updated_at_epoch_secs: row.get::<_, i64>(2)? as u64,
                })
            })
            .map_err(|e| format!("Failed to query DSP configs: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode DSP configs: {}", e))
    }

    pub fn upsert_queue_snapshot(
        &self,
        current_track_path: Option<&str>,
        pending_track_path: Option<&str>,
        needs_preload: bool,
        pending_ready: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO playback_queue_state
                (queue_key, current_track_path, pending_track_path, needs_preload, pending_ready, updated_at)
            VALUES ('active', ?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(queue_key) DO UPDATE SET
                current_track_path = excluded.current_track_path,
                pending_track_path = excluded.pending_track_path,
                needs_preload = excluded.needs_preload,
                pending_ready = excluded.pending_ready,
                updated_at = excluded.updated_at
            "#,
            params![
                current_track_path,
                pending_track_path,
                bool_to_sqlite(needs_preload),
                bool_to_sqlite(pending_ready),
                now,
            ],
        )
        .map_err(|e| format!("Failed to persist queue snapshot: {}", e))?;
        Ok(())
    }

    pub fn get_queue_snapshot(&self) -> Result<Option<QueueSnapshotRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT current_track_path, pending_track_path, needs_preload, pending_ready, updated_at
            FROM playback_queue_state
            WHERE queue_key = 'active'
            "#,
            [],
            |row| {
                Ok(QueueSnapshotRecord {
                    current_track_path: row.get(0)?,
                    pending_track_path: row.get(1)?,
                    needs_preload: row.get::<_, i64>(2)? != 0,
                    pending_ready: row.get::<_, i64>(3)? != 0,
                    updated_at_epoch_secs: row.get::<_, i64>(4)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to read queue snapshot: {}", e))
    }

    pub fn upsert_library_root(
        &self,
        source_key: Option<&str>,
        source_path: &str,
        source_kind: &str,
        display_name: &str,
        scan_status: &str,
    ) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            INSERT INTO library_roots
                (source_key, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            ON CONFLICT(source_path) DO UPDATE SET
                source_key = excluded.source_key,
                source_kind = excluded.source_kind,
                display_name = excluded.display_name,
                scan_status = excluded.scan_status,
                updated_at = excluded.updated_at
            "#,
            params![
                source_key,
                source_path,
                source_kind,
                display_name,
                scan_status,
                now
            ],
        )
        .map_err(|e| format!("Failed to upsert library root: {}", e))?;

        conn.query_row(
            "SELECT root_id FROM library_roots WHERE source_path = ?1",
            params![source_path],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to fetch library root id: {}", e))
    }

    pub fn update_library_root_scan_status(
        &self,
        root_id: i64,
        scan_status: &str,
        track_count: Option<u64>,
        started_at: Option<u64>,
        finished_at: Option<u64>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        conn.execute(
            r#"
            UPDATE library_roots
            SET scan_status = ?2,
                track_count = COALESCE(?3, track_count),
                last_scan_started_at = COALESCE(?4, last_scan_started_at),
                last_scan_finished_at = COALESCE(?5, last_scan_finished_at),
                updated_at = ?6
            WHERE root_id = ?1
            "#,
            params![
                root_id,
                scan_status,
                track_count.map(|v| v as i64),
                started_at.map(|v| v as i64),
                finished_at.map(|v| v as i64),
                now,
            ],
        )
        .map_err(|e| format!("Failed to update library root scan status: {}", e))?;
        Ok(())
    }

    pub fn list_library_roots(&self) -> Result<Vec<LibraryRootRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT root_id, source_key, source_path, source_kind, display_name, scan_status, track_count,
                       last_scan_started_at, last_scan_finished_at, updated_at
                FROM library_roots
                ORDER BY updated_at DESC, root_id DESC
                "#,
            )
            .map_err(|e| format!("Failed to prepare library roots query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(LibraryRootRecord {
                    root_id: row.get(0)?,
                    source_key: row.get(1)?,
                    source_path: row.get(2)?,
                    source_kind: row.get(3)?,
                    display_name: row.get(4)?,
                    scan_status: row.get(5)?,
                    track_count: row.get::<_, i64>(6)? as u64,
                    last_scan_started_at_epoch_secs: row
                        .get::<_, Option<i64>>(7)?
                        .map(|v| v as u64),
                    last_scan_finished_at_epoch_secs: row
                        .get::<_, Option<i64>>(8)?
                        .map(|v| v as u64),
                    updated_at_epoch_secs: row.get::<_, i64>(9)? as u64,
                })
            })
            .map_err(|e| format!("Failed to query library roots: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode library roots: {}", e))
    }

    pub fn delete_library_root(&self, root_id: i64) -> Result<Option<(String, u64)>, String> {
        let root_path = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            match conn.query_row(
                "SELECT source_path FROM library_roots WHERE root_id = ?1",
                params![root_id],
                |row| row.get::<_, String>(0),
            ) {
                Ok(path) => path,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(format!("Failed to fetch library root: {}", e)),
            }
        };

        let removed_media = self.delete_local_media_not_in_root(&root_path, &[])?;
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM library_roots WHERE root_id = ?1",
            params![root_id],
        )
        .map_err(|e| format!("Failed to delete library root: {}", e))?;
        Ok(Some((root_path, removed_media)))
    }

    pub fn replace_queue_entries(&self, queue_id: &str, entries: &[String]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start queue transaction: {}", e))?;
        tx.execute(
            "DELETE FROM playback_queue_entries WHERE queue_id = ?1",
            params![queue_id],
        )
        .map_err(|e| format!("Failed to clear queue entries: {}", e))?;

        let now = now_epoch_secs_i64();
        for (index, source_path) in entries.iter().enumerate() {
            tx.execute(
                r#"
                INSERT INTO playback_queue_entries
                    (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5)
                "#,
                params![
                    queue_id,
                    index as i64,
                    source_path,
                    media_id_for_path(source_path),
                    now,
                ],
            )
            .map_err(|e| format!("Failed to insert queue entry: {}", e))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit queue transaction: {}", e))?;
        Ok(())
    }

    pub fn append_queue_entry(&self, queue_id: &str, source_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        let next_position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position_index) + 1, 0) FROM playback_queue_entries WHERE queue_id = ?1",
                params![queue_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to compute next queue position: {}", e))?;
        conn.execute(
            r#"
            INSERT INTO playback_queue_entries
                (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5)
            "#,
            params![
                queue_id,
                next_position,
                source_path,
                media_id_for_path(source_path),
                now
            ],
        )
        .map_err(|e| format!("Failed to append queue entry: {}", e))?;
        Ok(())
    }

    pub fn append_queue_entries(&self, queue_id: &str, entries: &[String]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start queue append transaction: {}", e))?;
        let now = now_epoch_secs_i64();
        let next_position: i64 = tx
            .query_row(
                "SELECT COALESCE(MAX(position_index) + 1, 0) FROM playback_queue_entries WHERE queue_id = ?1",
                params![queue_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to compute next queue position: {}", e))?;

        for (offset, source_path) in entries.iter().enumerate() {
            tx.execute(
                r#"
                INSERT INTO playback_queue_entries
                    (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5)
                "#,
                params![
                    queue_id,
                    next_position + offset as i64,
                    source_path,
                    media_id_for_path(source_path),
                    now,
                ],
            )
            .map_err(|e| format!("Failed to append queue entry: {}", e))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit queue append transaction: {}", e))?;
        Ok(())
    }

    pub fn remove_queue_entry(&self, queue_id: &str, entry_id: i64) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start queue removal transaction: {}", e))?;
        tx.execute(
            "DELETE FROM playback_queue_entries WHERE queue_id = ?1 AND entry_id = ?2",
            params![queue_id, entry_id],
        )
        .map_err(|e| format!("Failed to remove queue entry: {}", e))?;
        tx.execute(
            r#"
            UPDATE playback_queue_entries
            SET position_index = (
                SELECT COUNT(*) FROM playback_queue_entries q2
                WHERE q2.queue_id = ?1
                  AND q2.position_index < playback_queue_entries.position_index
            ),
                updated_at = ?2
            WHERE queue_id = ?1
            "#,
            params![queue_id, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to reindex queue entries: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit queue removal transaction: {}", e))?;
        Ok(())
    }

    pub fn clear_queue(&self, queue_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM playback_queue_entries WHERE queue_id = ?1",
            params![queue_id],
        )
        .map_err(|e| format!("Failed to clear queue: {}", e))?;
        Ok(())
    }

    pub fn list_queue_entries(&self, queue_id: &str) -> Result<Vec<QueueEntryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let sql = format!(
            r#"
            {}
            WHERE q.queue_id = ?1
            ORDER BY COALESCE(q.shuffle_index, q.position_index) ASC, q.entry_id ASC
            "#,
            QUEUE_ENTRY_SELECT_WITH_METADATA
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare queue entries query: {}", e))?;

        let rows = stmt
            .query_map(params![queue_id], queue_entry_from_row)
            .map_err(|e| format!("Failed to query queue entries: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode queue entries: {}", e))
    }

    pub fn peek_next_queue_entry(
        &self,
        queue_id: &str,
        after_source_path: Option<&str>,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let after_media_id = after_source_path.map(media_id_for_path);

        let query_with_cursor = format!(
            r#"
            {}
            WHERE q.queue_id = ?1
              AND q.status IN ('queued', 'preloading')
              AND COALESCE(q.shuffle_index, q.position_index) > COALESCE(
                  (
                      SELECT COALESCE(q2.shuffle_index, q2.position_index)
                      FROM playback_queue_entries q2
                      WHERE q2.queue_id = ?1 AND q2.media_id = ?2
                      ORDER BY COALESCE(q2.shuffle_index, q2.position_index) ASC, q2.entry_id ASC
                      LIMIT 1
                  ),
                  -1
              )
            ORDER BY COALESCE(q.shuffle_index, q.position_index) ASC, q.entry_id ASC
            LIMIT 1
            "#,
            QUEUE_ENTRY_SELECT_WITH_METADATA
        );

        let query_without_cursor = format!(
            r#"
            {}
            WHERE q.queue_id = ?1
              AND q.status IN ('queued', 'preloading')
            ORDER BY COALESCE(q.shuffle_index, q.position_index) ASC, q.entry_id ASC
            LIMIT 1
            "#,
            QUEUE_ENTRY_SELECT_WITH_METADATA
        );

        let result = if let Some(media_id) = after_media_id.as_deref() {
            conn.query_row(
                &query_with_cursor,
                params![queue_id, media_id],
                queue_entry_from_row,
            )
        } else {
            conn.query_row(
                &query_without_cursor,
                params![queue_id],
                queue_entry_from_row,
            )
        };

        result
            .optional()
            .map_err(|e| format!("Failed to peek next queue entry: {}", e))
    }

    pub fn peek_previous_queue_entry(
        &self,
        queue_id: &str,
        before_source_path: Option<&str>,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let Some(media_id) = before_source_path.map(media_id_for_path) else {
            return Ok(None);
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT q.queue_id, q.entry_id, q.position_index, q.shuffle_index, q.source_path, q.media_id,
                   q.status, q.added_at, q.updated_at,
                   m.title, m.artist, m.album, m.duration_secs,
                   EXISTS (
                       SELECT 1
                       FROM cover_art_cache
                       WHERE cover_art_cache.media_id = q.media_id
                       LIMIT 1
                   ) AS has_cover_art,
                   m.external_artwork_url
            FROM playback_queue_entries q
            LEFT JOIN media_items m ON m.media_id = q.media_id
            WHERE q.queue_id = ?1
              AND COALESCE(q.shuffle_index, q.position_index) < (
                  SELECT COALESCE(q2.shuffle_index, q2.position_index)
                  FROM playback_queue_entries q2
                  WHERE q2.queue_id = ?1 AND q2.media_id = ?2
                  ORDER BY COALESCE(q2.shuffle_index, q2.position_index) ASC, q2.entry_id ASC
                  LIMIT 1
              )
            ORDER BY COALESCE(q.shuffle_index, q.position_index) DESC, q.entry_id DESC
            LIMIT 1
            "#,
            params![queue_id, media_id],
            queue_entry_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to peek previous queue entry: {}", e))
    }

    pub fn shuffle_entries(&self, queue_id: &str) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start shuffle transaction: {}", e))?;

        let mut entries = {
            let mut stmt = tx
                .prepare(
                    r#"
                    SELECT entry_id
                    FROM playback_queue_entries
                    WHERE queue_id = ?1
                    ORDER BY position_index ASC, entry_id ASC
                    "#,
                )
                .map_err(|e| format!("Failed to prepare shuffle query: {}", e))?;
            let rows = stmt
                .query_map(params![queue_id], |row| row.get::<_, i64>(0))
                .map_err(|e| format!("Failed to query shuffle entries: {}", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to decode shuffle entries: {}", e))?;
            rows
        };

        let original = entries.clone();
        entries.shuffle(&mut rand::thread_rng());
        if entries.len() > 1 && entries == original {
            entries.swap(0, 1);
        }

        let now = now_epoch_secs_i64();
        for (index, entry_id) in entries.iter().enumerate() {
            tx.execute(
                r#"
                UPDATE playback_queue_entries
                SET shuffle_index = ?3,
                    updated_at = ?4
                WHERE queue_id = ?1 AND entry_id = ?2
                "#,
                params![queue_id, entry_id, index as i64, now],
            )
            .map_err(|e| format!("Failed to update shuffle index: {}", e))?;
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit shuffle transaction: {}", e))?;
        Ok(())
    }

    pub fn unshuffle_entries(&self, queue_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            UPDATE playback_queue_entries
            SET shuffle_index = NULL,
                updated_at = ?2
            WHERE queue_id = ?1
            "#,
            params![queue_id, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to clear shuffle indexes: {}", e))?;
        Ok(())
    }

    pub fn reset_queue_cycle_for_repeat_all(
        &self,
        queue_id: &str,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            UPDATE playback_queue_entries
            SET status = 'queued',
                updated_at = ?2
            WHERE queue_id = ?1
              AND status IN ('played', 'playing', 'preloading')
            "#,
            params![queue_id, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to reset queue cycle: {}", e))?;
        drop(conn);

        self.peek_next_queue_entry(queue_id, None)
    }

    pub fn mark_queue_entry_status(
        &self,
        queue_id: &str,
        entry_id: i64,
        status: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            r#"
            UPDATE playback_queue_entries
            SET status = ?3,
                updated_at = ?4
            WHERE queue_id = ?1 AND entry_id = ?2
            "#,
            params![queue_id, entry_id, status, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to update queue entry status: {}", e))?;
        Ok(())
    }

    pub fn mark_queue_entry_playing(&self, queue_id: &str, entry_id: i64) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start queue status transaction: {}", e))?;
        let now = now_epoch_secs_i64();

        tx.execute(
            r#"
            UPDATE playback_queue_entries
            SET status = 'queued',
                updated_at = ?3
            WHERE queue_id = ?1
              AND entry_id <> ?2
              AND status IN ('playing', 'preloading')
            "#,
            params![queue_id, entry_id, now],
        )
        .map_err(|e| format!("Failed to clear active queue entries: {}", e))?;

        tx.execute(
            r#"
            UPDATE playback_queue_entries
            SET status = 'playing',
                updated_at = ?3
            WHERE queue_id = ?1 AND entry_id = ?2
            "#,
            params![queue_id, entry_id, now],
        )
        .map_err(|e| format!("Failed to mark queue entry as playing: {}", e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit queue status transaction: {}", e))?;
        Ok(())
    }

    pub fn mark_queue_entry_played_by_path(
        &self,
        queue_id: &str,
        source_path: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let media_id = media_id_for_path(source_path);
        conn.execute(
            r#"
            UPDATE playback_queue_entries
            SET status = 'played',
                updated_at = ?3
            WHERE entry_id = (
                SELECT entry_id
                FROM playback_queue_entries
                WHERE queue_id = ?1 AND media_id = ?2
                ORDER BY position_index ASC, entry_id ASC
                LIMIT 1
            )
            "#,
            params![queue_id, media_id, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to mark queue entry as played: {}", e))?;
        Ok(())
    }

    pub fn mark_queue_entry_status_by_path(
        &self,
        queue_id: &str,
        source_path: &str,
        current_statuses: &[&str],
        next_status: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated_at = now_epoch_secs_i64();
        let media_id = media_id_for_path(source_path);

        let changed = if current_statuses.is_empty() {
            conn.execute(
                r#"
                UPDATE playback_queue_entries
                SET status = ?3,
                    updated_at = ?4
                WHERE entry_id = (
                    SELECT entry_id
                    FROM playback_queue_entries
                    WHERE queue_id = ?1 AND media_id = ?2
                    ORDER BY position_index ASC, entry_id ASC
                    LIMIT 1
                )
                "#,
                params![queue_id, media_id, next_status, updated_at],
            )
        } else {
            let placeholders = std::iter::repeat("?")
                .take(current_statuses.len())
                .collect::<Vec<_>>()
                .join(", ");
            let sql = format!(
                r#"
                UPDATE playback_queue_entries
                SET status = ?,
                    updated_at = ?
                WHERE entry_id = (
                    SELECT entry_id
                    FROM playback_queue_entries
                    WHERE queue_id = ?
                      AND media_id = ?
                      AND status IN ({})
                    ORDER BY position_index ASC, entry_id ASC
                    LIMIT 1
                )
                "#,
                placeholders
            );
            let mut query_params: Vec<&dyn ToSql> =
                vec![&next_status, &updated_at, &queue_id, &media_id];
            for status in current_statuses {
                query_params.push(status);
            }
            conn.execute(&sql, rusqlite::params_from_iter(query_params))
        }
        .map_err(|e| format!("Failed to update queue entry status by path: {}", e))?;

        if changed == 0 {
            return Ok(());
        }

        Ok(())
    }
}

pub(crate) fn media_id_for_path(path: &str) -> String {
    normalize_media_path_for_id(path)
        .replace('\\', "/")
        .to_lowercase()
}

fn normalize_media_path_for_id(path: &str) -> &str {
    path.strip_prefix(r"\\?\UNC\")
        .map(|rest| rest.strip_prefix('\\').unwrap_or(rest))
        .or_else(|| path.strip_prefix(r"\\?\"))
        .unwrap_or(path)
}

fn file_size_for_source_path(source_path: &str) -> Option<u64> {
    if source_path.starts_with("http://") || source_path.starts_with("https://") {
        return None;
    }

    std::fs::metadata(source_path)
        .ok()
        .filter(|metadata| metadata.is_file())
        .map(|metadata| metadata.len())
}

fn prepare_connection(conn: Connection, enable_wal: bool) -> Result<Connection, String> {
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable app database foreign keys: {}", e))?;
    if enable_wal {
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("Failed to enable app database WAL mode: {}", e))?;
    }
    Ok(conn)
}

fn now_epoch_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

fn now_epoch_millis_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or(0)
}

fn non_empty_string(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn read_ncm_account_from_conn(conn: &Connection, user_id: i64) -> Result<NcmAccountRecord, String> {
    conn.query_row(
        r#"
        SELECT user_id, nickname, avatar_url, cookie, vip_type, level,
               signin_at_ms, added_at_ms, refreshed_at_ms
        FROM ncm_accounts
        WHERE user_id = ?1
        "#,
        params![user_id],
        ncm_account_from_row,
    )
    .map_err(|e| format!("Failed to read NCM account {}: {}", user_id, e))
}

fn read_ncm_track_source_from_conn(
    conn: &Connection,
    media_id: &str,
) -> Result<NcmTrackSourceRecord, String> {
    conn.query_row(
        r#"
        SELECT media_id, source_path, song_id, source_page_url,
               resolved_at, scrobbled_at, scrobble_secs
        FROM ncm_track_sources
        WHERE media_id = ?1
        "#,
        params![media_id],
        ncm_track_source_from_row,
    )
    .map_err(|e| format!("Failed to read NCM track source '{}': {}", media_id, e))
}

fn active_ncm_user_id_from_conn(conn: &Connection) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT active_user_id FROM ncm_account_state WHERE state_key = 'active'",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )
    .optional()
    .map(|value| value.flatten())
    .map_err(|e| format!("Failed to read active NCM account id: {}", e))
}

fn set_active_ncm_user_id_in_conn(conn: &Connection, user_id: Option<i64>) -> Result<(), String> {
    conn.execute(
        r#"
        INSERT INTO ncm_account_state (state_key, active_user_id, updated_at_ms)
        VALUES ('active', ?1, ?2)
        ON CONFLICT(state_key) DO UPDATE SET
            active_user_id = excluded.active_user_id,
            updated_at_ms = excluded.updated_at_ms
        "#,
        params![user_id, now_epoch_millis_i64()],
    )
    .map_err(|e| format!("Failed to set active NCM account id: {}", e))?;
    Ok(())
}

fn bool_to_sqlite(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn persists_webdav_and_history() {
        let db = AppDatabase::in_memory().unwrap();

        let cfg = WebDavConfig {
            base_url: "https://example.test/music".to_string(),
            username: Some("alice".to_string()),
            password: Some("secret".to_string()),
        };
        db.save_primary_webdav_source(&cfg).unwrap();
        let loaded = db.load_primary_webdav_source().unwrap().unwrap();
        assert_eq!(loaded.base_url, cfg.base_url);
        assert_eq!(loaded.username, cfg.username);
        assert_eq!(loaded.password, cfg.password);
        let sources = db.list_webdav_sources().unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].source_key, "primary");
        assert!(sources[0].is_default);
        assert_eq!(sources[0].base_url, cfg.base_url);

        let snapshot = PlaybackRuntimeSnapshot {
            position_secs: Some(1.5),
            duration_secs: Some(180.0),
            volume: Some(0.7),
            device_id: Some(1),
            exclusive_mode: true,
        };
        let session_id = db
            .start_playback_session("D:/music/test.flac", "loading", &snapshot)
            .unwrap();
        db.append_playback_history(
            Some(session_id),
            "D:/music/test.flac",
            "load_requested",
            Some(1.5),
            Some(&serde_json::json!({ "source": "test" })),
        )
        .unwrap();

        let history = db.recent_playback_history(10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].event_type, "load_requested");
    }

    #[test]
    fn persists_ncm_accounts_without_serializing_cookie() {
        let db = AppDatabase::in_memory().unwrap();
        let record = db
            .upsert_ncm_account(&NcmAccountUpsert {
                user_id: 42,
                nickname: Some("Ada".to_string()),
                avatar_url: Some("https://example.test/a.jpg".to_string()),
                cookie: "MUSIC_U=secret".to_string(),
                vip_type: Some(11),
                level: Some(8),
                signin_at_ms: None,
            })
            .unwrap();

        assert!(record.has_cookie);
        assert_eq!(record.cookie, "MUSIC_U=secret");
        assert_eq!(
            db.active_ncm_cookie().unwrap().as_deref(),
            Some("MUSIC_U=secret")
        );

        let json = serde_json::to_value(&record).unwrap();
        assert_eq!(json.get("has_cookie").and_then(|v| v.as_bool()), Some(true));
        assert!(json.get("cookie").is_none());
    }

    #[test]
    fn deleting_active_ncm_account_clears_active_state() {
        let db = AppDatabase::in_memory().unwrap();
        db.upsert_ncm_account(&NcmAccountUpsert {
            user_id: 7,
            nickname: None,
            avatar_url: None,
            cookie: "MUSIC_U=gone".to_string(),
            vip_type: None,
            level: None,
            signin_at_ms: None,
        })
        .unwrap();

        db.delete_ncm_account(7).unwrap();

        assert!(db.active_ncm_cookie().unwrap().is_none());
        let (accounts, active_user_id) = db.list_ncm_accounts().unwrap();
        assert!(accounts.is_empty());
        assert_eq!(active_user_id, None);
    }

    #[test]
    fn persists_ncm_track_source_and_scrobble_marker() {
        let db = AppDatabase::in_memory().unwrap();
        let source_path = "https://stream.example.test/song.mp3";

        let record = db
            .record_ncm_track_source(source_path, 42, Some("https://music.163.com/#/song?id=42"))
            .unwrap();

        assert_eq!(record.song_id, 42);
        assert_eq!(record.source_path, source_path);
        assert_eq!(
            db.ncm_track_source_for_path(source_path).unwrap().unwrap(),
            record
        );

        db.mark_ncm_track_scrobbled(source_path, 37).unwrap();
        let updated = db.ncm_track_source_for_path(source_path).unwrap().unwrap();
        assert_eq!(updated.scrobble_secs, Some(37));
        assert!(updated.scrobbled_at_epoch_secs.is_some());
    }

    #[test]
    fn playback_history_includes_media_metadata() {
        let db = AppDatabase::in_memory().unwrap();
        let path = "https://music.example.test/song.mp3";
        db.record_external_media_metadata(
            path,
            Some("Online Song"),
            Some("Online Artist"),
            Some("Online Album"),
            Some(213.5),
            Some("https://img.example.test/song.jpg"),
        )
        .unwrap();
        db.append_playback_history(None, path, "play", Some(0.0), None)
            .unwrap();

        let history = db.recent_playback_history(10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].title.as_deref(), Some("Online Song"));
        assert_eq!(history[0].artist.as_deref(), Some("Online Artist"));
        assert_eq!(history[0].album.as_deref(), Some("Online Album"));
        assert_eq!(history[0].duration_secs, Some(213.5));
        assert_eq!(
            history[0].external_artwork_url.as_deref(),
            Some("https://img.example.test/song.jpg")
        );
    }

    #[test]
    fn playback_history_includes_ncm_track_identity() {
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
        db.append_playback_history(None, path, "play", Some(0.0), None)
            .unwrap();

        let history = db.recent_playback_history(10).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].ncm_song_id, Some(12345));
        assert_eq!(
            history[0].ncm_source_page_url.as_deref(),
            Some("https://music.163.com/#/song?id=12345")
        );
        assert_eq!(
            history[0].external_artwork_url.as_deref(),
            Some("https://p1.music.126.net/cover.jpg")
        );
    }

    #[test]
    fn empty_stream_metadata_does_not_clear_external_metadata() {
        let db = AppDatabase::in_memory().unwrap();
        let path = "https://music.example.test/transient-stream.mp3";
        db.record_external_media_metadata(
            path,
            Some("Online Song"),
            Some("Online Artist"),
            Some("Online Album"),
            Some(213.5),
            Some("https://img.example.test/song.jpg"),
        )
        .unwrap();

        db.record_media_metadata(
            path,
            &TrackMetadata::default(),
            Some(214.0),
            Some(44100),
            Some(2),
        )
        .unwrap();

        let item = db.media_metadata_for_path(path).unwrap().unwrap();
        assert_eq!(item.title.as_deref(), Some("Online Song"));
        assert_eq!(item.artist.as_deref(), Some("Online Artist"));
        assert_eq!(item.album.as_deref(), Some("Online Album"));
        assert_eq!(item.duration_secs, Some(214.0));
        assert_eq!(
            item.external_artwork_url.as_deref(),
            Some("https://img.example.test/song.jpg")
        );
    }

    #[test]
    fn list_queue_entries_includes_media_display_metadata() {
        let db = AppDatabase::in_memory().unwrap();
        let path = "https://music.example.test/queued-stream.mp3";
        db.record_external_media_metadata(
            path,
            Some("Queued Song"),
            Some("Queued Artist"),
            Some("Queued Album"),
            Some(199.5),
            Some("https://img.example.test/queued.jpg"),
        )
        .unwrap();
        db.append_queue_entry("active", path).unwrap();

        let queue = db.list_queue_entries("active").unwrap();

        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].title.as_deref(), Some("Queued Song"));
        assert_eq!(queue[0].artist.as_deref(), Some("Queued Artist"));
        assert_eq!(queue[0].album.as_deref(), Some("Queued Album"));
        assert_eq!(queue[0].duration_secs, Some(199.5));
        assert_eq!(
            queue[0].external_artwork_url.as_deref(),
            Some("https://img.example.test/queued.jpg")
        );
    }

    #[test]
    fn manages_multiple_webdav_sources_and_default_switching() {
        let db = AppDatabase::in_memory().unwrap();

        let primary = WebDavConfig {
            base_url: "https://example.test/primary".to_string(),
            username: Some("alice".to_string()),
            password: Some("secret-a".to_string()),
        };
        let archive = WebDavConfig {
            base_url: "https://example.test/archive".to_string(),
            username: Some("bob".to_string()),
            password: Some("secret-b".to_string()),
        };

        db.upsert_webdav_source("primary", "Primary", &primary, true)
            .unwrap();
        db.upsert_webdav_source("archive", "Archive", &archive, false)
            .unwrap();

        let loaded = db.load_primary_webdav_source().unwrap().unwrap();
        assert_eq!(loaded.base_url, primary.base_url);

        let sources = db.list_webdav_sources().unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].source_key, "primary");
        assert!(sources[0].is_default);
        assert_eq!(sources[1].source_key, "archive");
        assert!(!sources[1].is_default);

        let archive_loaded = db
            .load_webdav_source_config("archive")
            .unwrap()
            .expect("archive source");
        assert_eq!(archive_loaded.display_name, "Archive");
        assert_eq!(archive_loaded.config.base_url, archive.base_url);

        let new_default = db
            .set_default_webdav_source("archive")
            .unwrap()
            .expect("archive default config");
        assert_eq!(new_default.base_url, archive.base_url);
        let loaded = db.load_primary_webdav_source().unwrap().unwrap();
        assert_eq!(loaded.base_url, archive.base_url);

        let fallback = db
            .delete_webdav_source("archive")
            .unwrap()
            .expect("fallback config");
        assert_eq!(fallback.base_url, primary.base_url);
        let loaded = db.load_primary_webdav_source().unwrap().unwrap();
        assert_eq!(loaded.base_url, primary.base_url);

        let deleted_non_default = db.delete_webdav_source("primary").unwrap();
        assert!(deleted_non_default.is_some());
        assert!(db.load_primary_webdav_source().unwrap().is_none());
    }

    #[test]
    fn persists_analysis_tasks() {
        let db = AppDatabase::in_memory().unwrap();
        let result = serde_json::json!({ "integrated_lufs": -14.2 });

        db.upsert_analysis_task(
            42,
            "scan_loudness",
            "D:/music/test.flac",
            "success",
            true,
            100,
            101,
            Some(&result),
            None,
        )
        .unwrap();

        let stored = db.get_analysis_task(42).unwrap().unwrap();
        assert_eq!(stored.task_id, 42);
        assert_eq!(stored.status, "success");
        assert_eq!(stored.result.unwrap()["integrated_lufs"], -14.2);

        db.upsert_analysis_task(
            43,
            "library_scan",
            "/library",
            "success",
            true,
            102,
            103,
            Some(&serde_json::json!({ "indexed_files": 3 })),
            None,
        )
        .unwrap();
        let only_library_scans = db
            .recent_analysis_tasks_by_type(Some("library_scan"), 10)
            .unwrap();
        assert_eq!(only_library_scans.len(), 1);
        assert_eq!(only_library_scans[0].task_id, 43);
    }

    #[test]
    fn persists_library_roots_and_queue_entries() {
        let db = AppDatabase::in_memory().unwrap();

        let root_id = db
            .upsert_library_root(None, "D:/music", "local", "Music", "idle")
            .unwrap();
        db.update_library_root_scan_status(root_id, "completed", Some(12), Some(10), Some(20))
            .unwrap();

        let remote_root_id = db
            .upsert_library_root(Some("archive"), "/library", "webdav", "Archive", "idle")
            .unwrap();
        db.update_library_root_scan_status(remote_root_id, "scanning", None, Some(30), None)
            .unwrap();

        let roots = db.list_library_roots().unwrap();
        assert_eq!(roots.len(), 2);
        let local_root = roots
            .iter()
            .find(|root| root.source_kind == "local")
            .unwrap();
        assert_eq!(local_root.track_count, 12);
        assert_eq!(local_root.scan_status, "completed");
        assert!(local_root.source_key.is_none());
        let remote_root = roots
            .iter()
            .find(|root| root.source_kind == "webdav")
            .unwrap();
        assert_eq!(remote_root.source_key.as_deref(), Some("archive"));
        assert_eq!(remote_root.source_path, "/library");
        assert_eq!(remote_root.scan_status, "scanning");

        let metadata = TrackMetadata {
            title: Some("Track A".to_string()),
            cover_art: Some(vec![1, 2, 3, 4]),
            cover_art_mime: Some("image/png".to_string()),
            ..TrackMetadata::default()
        };
        let media_id = db
            .record_media_metadata(
                "D:/music/a.flac",
                &metadata,
                Some(180.0),
                Some(44100),
                Some(2),
            )
            .unwrap();
        let cover = db
            .get_cover_art_for_media(&media_id)
            .unwrap()
            .expect("cover art record");
        assert_eq!(cover.0.media_id, media_id);
        assert_eq!(cover.0.mime_type.as_deref(), Some("image/png"));
        assert_eq!(cover.1, vec![1, 2, 3, 4]);
        assert_eq!(
            db.source_path_for_media_id(&media_id).unwrap().as_deref(),
            Some("D:/music/a.flac")
        );

        db.append_queue_entry("active", "D:/music/a.flac").unwrap();
        db.append_queue_entry("active", "D:/music/b.flac").unwrap();
        db.append_queue_entries(
            "active",
            &["D:/music/c.flac".to_string(), "D:/music/d.flac".to_string()],
        )
        .unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue.len(), 4);
        assert_eq!(queue[0].position_index, 0);
        assert_eq!(queue[1].position_index, 1);
        assert_eq!(queue[2].position_index, 2);
        assert_eq!(queue[3].position_index, 3);

        db.remove_queue_entry("active", queue[0].entry_id).unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue.len(), 3);
        assert_eq!(queue[0].position_index, 0);
        assert_eq!(queue[1].position_index, 1);
        assert_eq!(queue[2].position_index, 2);

        db.clear_queue("active").unwrap();
        assert!(db.list_queue_entries("active").unwrap().is_empty());
    }

    #[test]
    fn migrations_create_schema_version_and_expected_columns() {
        let db = AppDatabase::in_memory().unwrap();

        assert!(db.has_column("library_roots", "source_key").unwrap());
        assert!(db
            .has_column("playback_queue_entries", "shuffle_index")
            .unwrap());
        assert!(db.has_column("ncm_track_sources", "song_id").unwrap());
        assert!(db.has_column("ncm_track_sources", "scrobble_secs").unwrap());
        assert!(db.has_column("local_playlists", "playlist_id").unwrap());
        assert!(db
            .has_column("local_playlist_items", "position_index")
            .unwrap());

        let conn = db.conn.lock().unwrap();
        let versions = conn
            .prepare("SELECT version FROM schema_version ORDER BY version ASC")
            .unwrap()
            .query_map([], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);

        let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_playback_queue_entries_status_position'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index_count, 1);
    }

    #[test]
    fn local_playlists_prepend_remove_and_cascade_deleted_media() {
        let db = AppDatabase::in_memory().unwrap();
        let media_a = db.record_media_stub("D:/music/a.flac").unwrap();
        let media_b = db.record_media_stub("D:/music/b.flac").unwrap();
        let media_c = db.record_media_stub("D:/music/c.flac").unwrap();
        let playlist = db.create_local_playlist("Road", Some("drive")).unwrap();

        assert_eq!(
            db.add_media_to_local_playlist(
                &playlist.playlist_id,
                &[media_a.clone(), media_b.clone()]
            )
            .unwrap(),
            2
        );
        assert_eq!(
            db.add_media_to_local_playlist(&playlist.playlist_id, &[media_c.clone()])
                .unwrap(),
            1
        );
        let detail = db
            .get_local_playlist(&playlist.playlist_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            detail
                .items
                .iter()
                .map(|item| item.media_id.as_str())
                .collect::<Vec<_>>(),
            vec![media_c.as_str(), media_a.as_str(), media_b.as_str()]
        );
        assert_eq!(detail.playlist.track_count, 3);

        assert_eq!(
            db.remove_media_from_local_playlist(&playlist.playlist_id, &[media_a.clone()])
                .unwrap(),
            1
        );
        let detail = db
            .get_local_playlist(&playlist.playlist_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            detail
                .items
                .iter()
                .map(|item| item.media_id.as_str())
                .collect::<Vec<_>>(),
            vec![media_c.as_str(), media_b.as_str()]
        );

        assert_eq!(db.delete_media_items(&[media_c.clone()]).unwrap(), 1);
        let detail = db
            .get_local_playlist(&playlist.playlist_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            detail
                .items
                .iter()
                .map(|item| item.media_id.as_str())
                .collect::<Vec<_>>(),
            vec![media_b.as_str()]
        );
        assert_eq!(detail.playlist.track_count, 1);
    }

    #[test]
    fn shuffle_order_changes_and_unshuffle_restores_natural_order() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &[
                "D:/music/a.flac".to_string(),
                "D:/music/b.flac".to_string(),
                "D:/music/c.flac".to_string(),
            ],
        )
        .unwrap();

        let natural = db.list_queue_entries("active").unwrap();
        assert!(natural.iter().all(|entry| entry.shuffle_index.is_none()));

        db.shuffle_entries("active").unwrap();
        let shuffled = db.list_queue_entries("active").unwrap();
        assert!(shuffled.iter().all(|entry| entry.shuffle_index.is_some()));
        assert_ne!(
            shuffled
                .iter()
                .map(|entry| entry.source_path.as_str())
                .collect::<Vec<_>>(),
            natural
                .iter()
                .map(|entry| entry.source_path.as_str())
                .collect::<Vec<_>>(),
        );

        db.unshuffle_entries("active").unwrap();
        let restored = db.list_queue_entries("active").unwrap();
        assert!(restored.iter().all(|entry| entry.shuffle_index.is_none()));
        assert_eq!(
            restored
                .iter()
                .map(|entry| entry.source_path.as_str())
                .collect::<Vec<_>>(),
            natural
                .iter()
                .map(|entry| entry.source_path.as_str())
                .collect::<Vec<_>>(),
        );
    }

    #[test]
    fn peek_next_queue_entry_uses_effective_shuffle_order() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &[
                "D:/music/a.flac".to_string(),
                "D:/music/b.flac".to_string(),
                "D:/music/c.flac".to_string(),
            ],
        )
        .unwrap();

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 2 WHERE source_path = 'D:/music/a.flac'",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 0 WHERE source_path = 'D:/music/b.flac'",
                [],
            )
            .unwrap();
            conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 1 WHERE source_path = 'D:/music/c.flac'",
                [],
            )
            .unwrap();
        }

        let first = db.peek_next_queue_entry("active", None).unwrap().unwrap();
        assert_eq!(first.source_path, "D:/music/b.flac");

        let next = db
            .peek_next_queue_entry("active", Some("D:/music/b.flac"))
            .unwrap()
            .unwrap();
        assert_eq!(next.source_path, "D:/music/c.flac");

        let previous = db
            .peek_previous_queue_entry("active", Some("D:/music/c.flac"))
            .unwrap()
            .unwrap();
        assert_eq!(previous.source_path, "D:/music/b.flac");
    }

    #[test]
    fn repeat_all_reset_requeues_played_entries() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &["D:/music/a.flac".to_string(), "D:/music/b.flac".to_string()],
        )
        .unwrap();
        db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &["queued"], "played")
            .unwrap();
        db.mark_queue_entry_status_by_path("active", "D:/music/b.flac", &["queued"], "playing")
            .unwrap();

        let first = db
            .reset_queue_cycle_for_repeat_all("active")
            .unwrap()
            .unwrap();
        assert_eq!(first.source_path, "D:/music/a.flac");
        let queue = db.list_queue_entries("active").unwrap();
        assert!(queue.iter().all(|entry| entry.status == "queued"));
    }

    #[test]
    fn media_id_normalizes_paths_for_state_exposure() {
        assert_eq!(
            media_id_for_path("D:\\Music\\Artist\\Track.FLAC"),
            "d:/music/artist/track.flac"
        );
        assert_eq!(
            media_id_for_path(r"\\?\D:\Music\Artist\Track.FLAC"),
            "d:/music/artist/track.flac"
        );
    }

    #[test]
    fn media_art_lookup_accepts_raw_and_normalized_identity() {
        let db = AppDatabase::in_memory().unwrap();
        let metadata = TrackMetadata {
            cover_art: Some(vec![9, 8, 7]),
            cover_art_mime: Some("image/jpeg".to_string()),
            ..TrackMetadata::default()
        };

        let media_id = db
            .record_media_metadata(
                r"D:\Music\Artist\Track.flac",
                &metadata,
                Some(120.0),
                Some(44100),
                Some(2),
            )
            .unwrap();

        assert_eq!(media_id, "d:/music/artist/track.flac");
        assert_eq!(
            db.source_path_for_media_id(r"\\?\D:\Music\Artist\Track.FLAC")
                .unwrap()
                .as_deref(),
            Some(r"D:\Music\Artist\Track.flac")
        );
        assert_eq!(
            db.get_cover_art_for_media(r"\\?\D:\Music\Artist\Track.FLAC")
                .unwrap()
                .expect("cover art")
                .1,
            vec![9, 8, 7]
        );
    }

    #[test]
    fn queue_cursor_matches_extended_length_windows_paths() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &[
                "D:\\Music\\a.flac".to_string(),
                "D:\\Music\\b.flac".to_string(),
                "D:\\Music\\c.flac".to_string(),
            ],
        )
        .unwrap();

        let next = db
            .peek_next_queue_entry("active", Some(r"\\?\D:\Music\a.flac"))
            .unwrap()
            .unwrap();

        assert_eq!(next.source_path, "D:\\Music\\b.flac");

        let previous = db
            .peek_previous_queue_entry("active", Some(r"\\?\D:\Music\c.flac"))
            .unwrap()
            .unwrap();

        assert_eq!(previous.source_path, "D:\\Music\\b.flac");
    }

    #[test]
    fn peek_next_queue_entry_can_advance_to_preloading_entry() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &[
                "D:/music/a.flac".to_string(),
                "D:/music/b.flac".to_string(),
                "D:/music/c.flac".to_string(),
            ],
        )
        .unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        db.mark_queue_entry_status("active", queue[1].entry_id, "preloading")
            .unwrap();

        let next = db
            .peek_next_queue_entry("active", Some("D:/music/a.flac"))
            .unwrap()
            .unwrap();

        assert_eq!(next.source_path, "D:/music/b.flac");
        assert_eq!(next.status, "preloading");
    }

    #[test]
    fn mark_queue_entry_playing_keeps_single_active_entry() {
        let db = AppDatabase::in_memory().unwrap();
        db.append_queue_entries(
            "active",
            &[
                "D:/music/a.flac".to_string(),
                "D:/music/b.flac".to_string(),
                "D:/music/c.flac".to_string(),
            ],
        )
        .unwrap();
        let queue = db.list_queue_entries("active").unwrap();

        db.mark_queue_entry_status("active", queue[0].entry_id, "playing")
            .unwrap();
        db.mark_queue_entry_status("active", queue[1].entry_id, "preloading")
            .unwrap();
        db.mark_queue_entry_playing("active", queue[2].entry_id)
            .unwrap();

        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue[0].status, "queued");
        assert_eq!(queue[1].status, "queued");
        assert_eq!(queue[2].status, "playing");
    }

    #[test]
    fn startup_gc_removes_old_rows_and_marks_stale_sessions() {
        let db = AppDatabase::in_memory().unwrap();
        let now = now_epoch_secs_i64();
        let old = now - 31 * 24 * 3600;
        let recent = now - 60;
        let stale_started = now - 25 * 3600;

        let snapshot = PlaybackRuntimeSnapshot {
            position_secs: Some(0.0),
            duration_secs: Some(180.0),
            volume: Some(0.5),
            device_id: None,
            exclusive_mode: false,
        };
        let stale_session_id = db
            .start_playback_session("D:/music/stale.flac", "playing", &snapshot)
            .unwrap();
        db.append_playback_history(
            Some(stale_session_id),
            "D:/music/stale.flac",
            "play",
            Some(1.0),
            None,
        )
        .unwrap();

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE playback_sessions SET started_at = ?1, updated_at = ?1 WHERE session_id = ?2",
                params![stale_started, stale_session_id],
            )
            .unwrap();
            conn.execute(
                "UPDATE playback_history SET event_at = ?1 WHERE session_id = ?2",
                params![recent, stale_session_id],
            )
            .unwrap();
            conn.execute(
                r#"
                INSERT INTO playback_history (session_id, media_id, source_path, event_type, event_at, position_secs, payload_json)
                VALUES (NULL, NULL, 'D:/music/old.flac', 'old', ?1, NULL, NULL)
                "#,
                params![old],
            )
            .unwrap();
            conn.execute(
                r#"
                INSERT INTO analysis_tasks
                    (task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text)
                VALUES
                    (1, 'scan_loudness', 'old-success.flac', 'success', 1, ?1, ?1, NULL, NULL),
                    (2, 'scan_loudness', 'old-running.flac', 'running', 1, ?1, ?1, NULL, NULL),
                    (3, 'scan_loudness', 'recent-error.flac', 'error', 1, ?2, ?2, NULL, NULL)
                "#,
                params![old, recent],
            )
            .unwrap();
            conn.execute(
                r#"
                INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                VALUES ('orphan', 'missing-media', 'image/png', x'0102', 2, ?1)
                "#,
                params![old],
            )
            .unwrap_or_else(|_| {
                conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
                conn.execute(
                    r#"
                    INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                    VALUES ('orphan', 'missing-media', 'image/png', x'0102', 2, ?1)
                    "#,
                    params![old],
                )
                .unwrap();
                conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
                1
            });
        }

        db.gc_on_startup().unwrap();

        let conn = db.conn.lock().unwrap();
        let old_history_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playback_history WHERE source_path = 'D:/music/old.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_history_count, 0);

        let referenced_history_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playback_history WHERE session_id = ?1",
                params![stale_session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(referenced_history_count, 1);

        let (status, ended_at): (String, Option<i64>) = conn
            .query_row(
                "SELECT status, ended_at FROM playback_sessions WHERE session_id = ?1",
                params![stale_session_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "abandoned");
        assert!(ended_at.is_some());

        let old_terminal_tasks: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM analysis_tasks WHERE task_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(old_terminal_tasks, 0);
        let kept_tasks: i64 = conn
            .query_row("SELECT COUNT(*) FROM analysis_tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(kept_tasks, 2);

        let orphan_cover_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM cover_art_cache WHERE cover_art_id = 'orphan'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(orphan_cover_count, 0);
    }

    #[test]
    fn file_backed_database_enables_wal() {
        let db_path = std::env::temp_dir().join(format!(
            "audio_engine_app_db_wal_{}_{}.db",
            std::process::id(),
            now_epoch_secs_i64()
        ));
        let db = AppDatabase::open(&db_path).unwrap();
        let conn = db.conn.lock().unwrap();
        let mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        drop(conn);
        drop(db);
        let _ = fs::remove_file(&db_path);
        let _ = fs::remove_file(db_path.with_extension("db-wal"));
        let _ = fs::remove_file(db_path.with_extension("db-shm"));
    }

    #[test]
    fn mark_queue_entry_status_by_path_supports_dynamic_status_filters() {
        let db = AppDatabase::in_memory().unwrap();

        db.append_queue_entry("active", "D:/music/a.flac").unwrap();
        db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &[], "playing")
            .unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue[0].status, "playing");

        db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &["queued"], "skipped")
            .unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue[0].status, "playing");

        db.mark_queue_entry_status_by_path(
            "active",
            "D:/music/a.flac",
            &["queued", "playing", "preloading"],
            "played",
        )
        .unwrap();
        let queue = db.list_queue_entries("active").unwrap();
        assert_eq!(queue[0].status, "played");
    }

    #[test]
    fn library_track_key_lookup_preserves_order_and_keeps_summaries_light() {
        let db = AppDatabase::in_memory().unwrap();
        let media_a = db.record_media_stub("D:/music/a.flac").unwrap();
        let media_b = db.record_media_stub("D:/music/b.flac").unwrap();
        db.record_media_stub("D:/music/nested/c.flac").unwrap();

        let summaries = db.list_library_track_summaries().unwrap();
        let key_for_media = |media_id: &str| {
            summaries
                .iter()
                .find(|track| track.media_id == media_id)
                .map(|track| track.track_key)
                .unwrap()
        };
        let key_a = key_for_media(&media_a);
        let key_b = key_for_media(&media_b);
        let missing_key = summaries
            .iter()
            .map(|track| track.track_key)
            .max()
            .unwrap_or(0)
            + 10_000;

        let rows = db
            .source_paths_for_track_keys(&[key_b, missing_key, key_a, key_b])
            .unwrap();
        assert_eq!(
            rows,
            vec![
                (key_b, "D:/music/b.flac".to_string()),
                (key_a, "D:/music/a.flac".to_string()),
                (key_b, "D:/music/b.flac".to_string())
            ]
        );

        let folders = db.library_folder_summaries_for_tracks(&summaries);
        assert!(folders
            .iter()
            .any(|folder| folder.path == "D:/music" && folder.count == 2));
        let serialized = serde_json::to_value(&summaries[0]).unwrap();
        assert!(serialized.get("folder_path").is_none());
        assert!(serialized.get("media_id").is_some());
    }
}
