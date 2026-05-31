//! Versioned migrations for the application domain database.

use rusqlite::{params, Connection};

const BASELINE_SQL: &str = include_str!("../migrations/001_baseline.sql");
const INDEXES_SQL: &str = include_str!("../migrations/003_indexes.sql");

pub fn run_migrations(conn: &mut Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );",
    )
    .map_err(|e| format!("Failed to create schema_version table: {}", e))?;

    let current = current_version(conn)?;

    if current < 1 {
        apply_sql_migration(conn, 1, BASELINE_SQL)?;
    }
    if current < 2 {
        apply_source_key_backfill_migration(conn)?;
    }
    if current < 3 {
        apply_sql_migration(conn, 3, INDEXES_SQL)?;
    }
    if current < 4 {
        apply_shuffle_index_migration(conn)?;
    }
    if current < 5 {
        apply_scan_incremental_migration(conn)?;
    }
    if current < 6 {
        apply_external_artwork_url_migration(conn)?;
    }
    if current < 7 {
        apply_ncm_accounts_migration(conn)?;
    }
    if current < 8 {
        apply_ncm_track_sources_migration(conn)?;
    }
    if current < 9 {
        apply_local_playlists_migration(conn)?;
    }
    if current < 10 {
        apply_audio_quality_metadata_migration(conn)?;
    }
    if current < 11 {
        apply_cover_art_file_cache_migration(conn)?;
    }

    Ok(())
}

fn current_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to read app database schema version: {}", e))
}

fn apply_migration_tx<F>(conn: &mut Connection, version: i64, body: F) -> Result<(), String>
where
    F: FnOnce(&rusqlite::Transaction<'_>) -> Result<(), String>,
{
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start migration {} transaction: {}", version, e))?;
    body(&tx)?;
    record_version_tx(&tx, version)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit migration {}: {}", version, e))?;
    log::info!("Applied app database migration {}", version);
    Ok(())
}

fn apply_sql_migration(conn: &mut Connection, version: i64, sql: &str) -> Result<(), String> {
    apply_migration_tx(conn, version, |tx| {
        tx.execute_batch(sql)
            .map_err(|e| format!("Failed to apply migration {}: {}", version, e))
    })
}

fn apply_source_key_backfill_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 2, |tx| {
        if !column_exists(tx, "library_roots", "source_key")? {
            tx.execute("ALTER TABLE library_roots ADD COLUMN source_key TEXT", [])
                .map_err(|e| format!("Failed to backfill library_roots.source_key: {}", e))?;
        }
        Ok(())
    })
}

fn apply_shuffle_index_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 4, |tx| {
        if !column_exists(tx, "playback_queue_entries", "shuffle_index")? {
            tx.execute(
                "ALTER TABLE playback_queue_entries ADD COLUMN shuffle_index INTEGER",
                [],
            )
            .map_err(|e| format!("Failed to add playback_queue_entries.shuffle_index: {}", e))?;
        }
        tx.execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_playback_queue_entries_effective_order
                ON playback_queue_entries(queue_id, status, shuffle_index, position_index, entry_id);
            "#,
        )
        .map_err(|e| format!("Failed to create shuffle queue indexes: {}", e))
    })
}

fn apply_scan_incremental_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 5, |tx| {
        if !column_exists(tx, "media_items", "mtime")? {
            tx.execute_batch("ALTER TABLE media_items ADD COLUMN mtime REAL")
                .map_err(|e| format!("Failed to add media_items.mtime: {}", e))?;
        }
        if !column_exists(tx, "media_items", "size_bytes")? {
            tx.execute_batch("ALTER TABLE media_items ADD COLUMN size_bytes INTEGER")
                .map_err(|e| format!("Failed to add media_items.size_bytes: {}", e))?;
        }
        Ok(())
    })
}

fn apply_external_artwork_url_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 6, |tx| {
        if !column_exists(tx, "media_items", "external_artwork_url")? {
            tx.execute_batch("ALTER TABLE media_items ADD COLUMN external_artwork_url TEXT")
                .map_err(|e| format!("Failed to add media_items.external_artwork_url: {}", e))?;
        }
        Ok(())
    })
}

fn apply_audio_quality_metadata_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 10, |tx| {
        if !column_exists(tx, "media_items", "bitrate_bps")? {
            tx.execute_batch("ALTER TABLE media_items ADD COLUMN bitrate_bps REAL")
                .map_err(|e| format!("Failed to add media_items.bitrate_bps: {}", e))?;
        }
        if !column_exists(tx, "media_items", "bits_per_sample")? {
            tx.execute_batch("ALTER TABLE media_items ADD COLUMN bits_per_sample INTEGER")
                .map_err(|e| format!("Failed to add media_items.bits_per_sample: {}", e))?;
        }
        Ok(())
    })
}

fn apply_cover_art_file_cache_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 11, |tx| {
        if !column_exists(tx, "cover_art_cache", "file_path")? {
            tx.execute_batch("ALTER TABLE cover_art_cache ADD COLUMN file_path TEXT")
                .map_err(|e| format!("Failed to add cover_art_cache.file_path: {}", e))?;
        }
        Ok(())
    })
}

fn apply_ncm_accounts_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 7, |tx| {
        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ncm_accounts (
                user_id         INTEGER PRIMARY KEY,
                nickname        TEXT,
                avatar_url      TEXT,
                cookie          TEXT NOT NULL,
                vip_type        INTEGER,
                level           INTEGER,
                signin_at_ms    INTEGER,
                added_at_ms     INTEGER NOT NULL,
                refreshed_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ncm_account_state (
                state_key       TEXT PRIMARY KEY,
                active_user_id  INTEGER,
                updated_at_ms   INTEGER NOT NULL
            );
            "#,
        )
        .map_err(|e| format!("Failed to create NCM account tables: {}", e))
    })
}

fn apply_ncm_track_sources_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 8, |tx| {
        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ncm_track_sources (
                media_id        TEXT PRIMARY KEY,
                source_path     TEXT NOT NULL,
                song_id         INTEGER NOT NULL,
                source_page_url TEXT,
                resolved_at     INTEGER NOT NULL,
                scrobbled_at    INTEGER,
                scrobble_secs   INTEGER,
                FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_ncm_track_sources_song_id
                ON ncm_track_sources(song_id);
            "#,
        )
        .map_err(|e| format!("Failed to create NCM track source table: {}", e))
    })
}

fn apply_local_playlists_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 9, |tx| {
        tx.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS local_playlists (
                playlist_id    TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                description    TEXT,
                cover_media_id TEXT,
                created_at     INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL,
                FOREIGN KEY(cover_media_id) REFERENCES media_items(media_id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS local_playlist_items (
                playlist_id    TEXT NOT NULL,
                media_id       TEXT NOT NULL,
                position_index INTEGER NOT NULL,
                added_at       INTEGER NOT NULL,
                PRIMARY KEY(playlist_id, media_id),
                FOREIGN KEY(playlist_id) REFERENCES local_playlists(playlist_id) ON DELETE CASCADE,
                FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_local_playlists_updated_at
                ON local_playlists(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_local_playlist_items_order
                ON local_playlist_items(playlist_id, position_index ASC, media_id ASC);
            "#,
        )
        .map_err(|e| format!("Failed to create local playlist tables: {}", e))
    })
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
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

fn record_version_tx(tx: &rusqlite::Transaction<'_>, version: i64) -> Result<(), String> {
    tx.execute(
        "INSERT INTO schema_version (version, applied_at) VALUES (?1, ?2)",
        params![version, now_epoch_secs_i64()],
    )
    .map_err(|e| format!("Failed to record migration {}: {}", version, e))?;
    Ok(())
}

fn now_epoch_secs_i64() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backfill_succeeds_when_source_key_is_missing() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE library_roots (
                root_id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                source_path             TEXT NOT NULL UNIQUE,
                source_kind             TEXT NOT NULL,
                display_name            TEXT NOT NULL,
                scan_status             TEXT NOT NULL DEFAULT 'idle',
                track_count             INTEGER NOT NULL DEFAULT 0,
                last_scan_started_at    INTEGER,
                last_scan_finished_at   INTEGER,
                updated_at              INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (1, 100);
            "#,
        )
        .unwrap();

        apply_source_key_backfill_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "library_roots", "source_key").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn backfill_succeeds_when_source_key_already_exists() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE library_roots (
                root_id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                source_key              TEXT,
                source_path             TEXT NOT NULL UNIQUE,
                source_kind             TEXT NOT NULL,
                display_name            TEXT NOT NULL,
                scan_status             TEXT NOT NULL DEFAULT 'idle',
                track_count             INTEGER NOT NULL DEFAULT 0,
                last_scan_started_at    INTEGER,
                last_scan_finished_at   INTEGER,
                updated_at              INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (1, 100);
            "#,
        )
        .unwrap();

        apply_source_key_backfill_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "library_roots", "source_key").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn external_artwork_url_migration_succeeds_when_column_is_missing() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                title          TEXT,
                artist         TEXT,
                album          TEXT,
                track_number   INTEGER,
                disc_number    INTEGER,
                genre          TEXT,
                year           INTEGER,
                duration_secs  REAL,
                sample_rate    INTEGER,
                channels       INTEGER,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (5, 100);
            "#,
        )
        .unwrap();

        apply_external_artwork_url_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "media_items", "external_artwork_url").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
    }

    #[test]
    fn external_artwork_url_migration_succeeds_when_column_already_exists() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                title          TEXT,
                artist         TEXT,
                album          TEXT,
                track_number   INTEGER,
                disc_number    INTEGER,
                genre          TEXT,
                year           INTEGER,
                duration_secs  REAL,
                sample_rate    INTEGER,
                channels       INTEGER,
                external_artwork_url TEXT,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (5, 100);
            "#,
        )
        .unwrap();

        apply_external_artwork_url_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "media_items", "external_artwork_url").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 6);
    }

    #[test]
    fn shuffle_index_migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE playback_queue_entries (
                entry_id         INTEGER PRIMARY KEY AUTOINCREMENT,
                queue_id         TEXT NOT NULL,
                position_index   INTEGER NOT NULL,
                source_path      TEXT NOT NULL,
                media_id         TEXT,
                status           TEXT NOT NULL DEFAULT 'queued',
                added_at         INTEGER NOT NULL,
                updated_at       INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (3, 100);
            "#,
        )
        .unwrap();

        apply_shuffle_index_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "playback_queue_entries", "shuffle_index").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 4);
    }

    #[test]
    fn ncm_accounts_migration_creates_session_tables() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (6, 100);
            "#,
        )
        .unwrap();

        apply_ncm_accounts_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "ncm_accounts", "cookie").unwrap());
        assert!(column_exists(&conn, "ncm_account_state", "active_user_id").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 7);
    }

    #[test]
    fn ncm_track_sources_migration_creates_mapping_table() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (7, 100);
            "#,
        )
        .unwrap();

        apply_ncm_track_sources_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "ncm_track_sources", "song_id").unwrap());
        assert!(column_exists(&conn, "ncm_track_sources", "scrobble_secs").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 8);
    }

    #[test]
    fn local_playlists_migration_creates_playlist_tables() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (8, 100);
            "#,
        )
        .unwrap();

        apply_local_playlists_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "local_playlists", "name").unwrap());
        assert!(column_exists(&conn, "local_playlist_items", "position_index").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 9);
    }

    #[test]
    fn audio_quality_metadata_migration_adds_media_columns() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (9, 100);
            "#,
        )
        .unwrap();

        apply_audio_quality_metadata_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "media_items", "bitrate_bps").unwrap());
        assert!(column_exists(&conn, "media_items", "bits_per_sample").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 10);
    }

    #[test]
    fn cover_art_file_cache_migration_adds_file_path_column() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE media_items (
                media_id       TEXT PRIMARY KEY,
                source_path    TEXT NOT NULL UNIQUE,
                source_kind    TEXT NOT NULL,
                added_at       INTEGER NOT NULL,
                updated_at     INTEGER NOT NULL
            );
            CREATE TABLE cover_art_cache (
                cover_art_id  TEXT PRIMARY KEY,
                media_id       TEXT NOT NULL,
                mime_type      TEXT,
                image_bytes    BLOB,
                byte_len       INTEGER NOT NULL,
                created_at     INTEGER NOT NULL,
                FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (10, 100);
            "#,
        )
        .unwrap();

        apply_cover_art_file_cache_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "cover_art_cache", "file_path").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 11);
    }

    #[test]
    fn cover_art_file_cache_migration_succeeds_when_column_already_exists() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE cover_art_cache (
                cover_art_id  TEXT PRIMARY KEY,
                media_id       TEXT NOT NULL,
                mime_type      TEXT,
                image_bytes    BLOB,
                file_path      TEXT,
                byte_len       INTEGER NOT NULL,
                created_at     INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (10, 100);
            "#,
        )
        .unwrap();

        apply_cover_art_file_cache_migration(&mut conn).unwrap();

        assert!(column_exists(&conn, "cover_art_cache", "file_path").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 11);
    }
}
