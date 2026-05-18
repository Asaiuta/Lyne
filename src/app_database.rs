//! Application domain database.
//!
//! SQLite-backed persistence for higher-level domain state that should survive
//! process restarts: WebDAV sources, media metadata, playback sessions/history,
//! active device/DSP snapshots, queue snapshot, and analysis task records.

use rusqlite::{params, types::ValueRef, Connection};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::migration;

mod analysis_tasks;
mod library_media;
mod local_playlists;
mod media_items;
mod ncm_accounts;
mod ncm_track_sources;
mod playback_activity;
mod queue_entries;
mod runtime_state;
mod webdav_sources;

mod types;

pub use types::*;

pub struct AppDatabase {
    conn: Mutex<Connection>,
    db_path: PathBuf,
}

pub(super) fn media_item_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaItemRecord> {
    media_item_from_row_with_offset(row, 0)
}

pub(super) fn media_item_from_row_with_offset(
    row: &rusqlite::Row<'_>,
    offset: usize,
) -> rusqlite::Result<MediaItemRecord> {
    let stored_size: Option<i64> = row.get(offset + 18)?;
    let bitrate_bps = match row.get_ref(offset + 13)? {
        ValueRef::Null => None,
        _ => Some(row.get(offset + 13)?),
    };
    Ok(MediaItemRecord {
        media_id: row.get(offset)?,
        source_path: row.get(offset + 1)?,
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
        bitrate_bps,
        bits_per_sample: row.get::<_, Option<i64>>(offset + 14)?.map(|v| v as u32),
        has_cover_art: row.get::<_, i64>(offset + 16)? != 0,
        external_artwork_url: row.get(offset + 17)?,
        size_bytes: stored_size.map(|v| v as u64),
        updated_at_epoch_secs: row.get::<_, i64>(offset + 15)? as u64,
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

fn bool_to_sqlite(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests;
