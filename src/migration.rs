//! Versioned migrations for the application domain database.

use rusqlite::{params, Connection};

const BASELINE_SQL: &str = include_str!("../migrations/001_baseline.sql");
const INDEXES_SQL: &str = include_str!("../migrations/003_indexes.sql");
const LIBRARY_ROOT_MEMBERSHIPS_SQL: &str =
    include_str!("../migrations/012_library_root_memberships.sql");
const QUEUE_ENTRY_SOURCE_KEY_SQL: &str =
    include_str!("../migrations/013_queue_entry_source_key.sql");

pub fn run_migrations(conn: &mut Connection) -> Result<(), String> {
    run_migrations_with_webdav_fallback(conn, None)
}

pub(crate) fn run_migrations_with_webdav_fallback(
    conn: &mut Connection,
    webdav_fallback_base_url: Option<&str>,
) -> Result<(), String> {
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
    if current < 12 {
        apply_library_root_memberships_migration(conn, webdav_fallback_base_url)?;
    }
    if current < 13 {
        apply_queue_entry_source_key_migration(conn)?;
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

fn apply_library_root_memberships_migration(
    conn: &mut Connection,
    webdav_fallback_base_url: Option<&str>,
) -> Result<(), String> {
    apply_migration_tx(conn, 12, |tx| {
        tx.execute_batch(LIBRARY_ROOT_MEMBERSHIPS_SQL)
            .map_err(|e| format!("Failed to create library root memberships: {}", e))?;
        let cleanup = crate::app_database::backfill_library_root_memberships_and_cleanup_tx(
            tx,
            webdav_fallback_base_url,
        )?;
        log::info!(
            "Library membership migration removed media={}, analysis_tasks={}, history={}, sessions={}, queue_entries={}, playlist_items={}, cover_art={}",
            cleanup.removed_media_count,
            cleanup.removed_analysis_task_count,
            cleanup.removed_history_count,
            cleanup.removed_session_count,
            cleanup.removed_queue_entry_count,
            cleanup.removed_playlist_item_count,
            cleanup.removed_cover_art_count,
        );
        Ok(())
    })
}

fn apply_queue_entry_source_key_migration(conn: &mut Connection) -> Result<(), String> {
    apply_migration_tx(conn, 13, |tx| {
        if !column_exists(tx, "playback_queue_entries", "source_key")? {
            tx.execute(
                "ALTER TABLE playback_queue_entries ADD COLUMN source_key TEXT REFERENCES webdav_sources(source_key) ON DELETE SET NULL",
                [],
            )
            .map_err(|e| format!("Failed to add playback_queue_entries.source_key: {}", e))?;
        }
        if !column_exists(tx, "playback_queue_entries", "source_identity")? {
            tx.execute(
                "ALTER TABLE playback_queue_entries ADD COLUMN source_identity TEXT NOT NULL DEFAULT 'infer' CHECK (source_identity IN ('infer', 'public', 'webdav'))",
                [],
            )
            .map_err(|e| {
                format!(
                    "Failed to add playback_queue_entries.source_identity: {}",
                    e
                )
            })?;
        }
        tx.execute_batch(QUEUE_ENTRY_SOURCE_KEY_SQL)
            .map_err(|e| format!("Failed to create queue source-key index: {}", e))
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

    fn connection_at_v11() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&mut conn).unwrap();
        conn.execute("DELETE FROM schema_version WHERE version >= 12", [])
            .unwrap();
        conn.execute("DELETE FROM library_root_memberships", [])
            .unwrap();
        conn
    }

    #[test]
    fn queue_source_key_migration_is_applied_and_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        run_migrations(&mut conn).unwrap();

        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 13);
        let indexed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_index_list('playback_queue_entries') WHERE name = 'idx_playback_queue_entries_source_key'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 1);
        assert!(column_exists(&conn, "playback_queue_entries", "source_identity").unwrap());

        conn.execute_batch(
            r#"
            INSERT INTO webdav_sources
                (source_key, display_name, base_url, is_default, created_at, updated_at)
            VALUES ('archive', 'Archive', 'https://dav.example.test/music', 1, 1, 1);
            INSERT INTO playback_queue_entries
                (queue_id, position_index, source_path, source_key, media_id, status, added_at, updated_at)
            VALUES (
                'active', 0, 'https://dav.example.test/music/song.flac', 'archive',
                'https://dav.example.test/music/song.flac', 'queued', 1, 1
            );
            DELETE FROM webdav_sources WHERE source_key = 'archive';
            "#,
        )
        .unwrap();
        let source_key: Option<String> = conn
            .query_row(
                "SELECT source_key FROM playback_queue_entries WHERE queue_id = 'active'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_key, None);
        let foreign_key_errors: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);

        run_migrations(&mut conn).unwrap();
        let versions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version = 13",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(versions, 1);
    }

    #[test]
    fn queue_source_key_migration_preserves_legacy_rows_as_unowned() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            CREATE TABLE webdav_sources (
                source_key TEXT PRIMARY KEY
            );
            CREATE TABLE playback_queue_entries (
                entry_id      INTEGER PRIMARY KEY AUTOINCREMENT,
                queue_id      TEXT NOT NULL,
                position_index INTEGER NOT NULL,
                shuffle_index INTEGER,
                source_path   TEXT NOT NULL,
                media_id      TEXT NOT NULL,
                status        TEXT NOT NULL,
                added_at      INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );
            CREATE TABLE schema_version (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );
            INSERT INTO schema_version (version, applied_at) VALUES (12, 1);
            INSERT INTO playback_queue_entries
                (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
            VALUES ('active', 0, 'https://example.test/legacy.flac', 'legacy', 'queued', 1, 1);
            "#,
        )
        .unwrap();

        run_migrations(&mut conn).unwrap();

        assert!(column_exists(&conn, "playback_queue_entries", "source_key").unwrap());
        let row: (String, Option<String>, String) = conn
            .query_row(
                "SELECT source_path, source_key, source_identity FROM playback_queue_entries WHERE queue_id = 'active'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(row.0, "https://example.test/legacy.flac");
        assert_eq!(row.1, None);
        assert_eq!(row.2, "infer");
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 13);
    }

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

    #[test]
    fn library_membership_migration_cleans_orphan_local_media_and_references() {
        let mut conn = connection_at_v11();
        let legacy_media_id = "//?/d:/music/legacy.flac";
        let source_path = r"\\?\D:\Music\Legacy.flac";
        conn.execute(
            r#"
            INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
            VALUES (?1, ?2, 'local', 1, 1)
            "#,
            params![legacy_media_id, source_path],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('https://remote.example/keep.flac', 'https://remote.example/keep.flac', 'remote', 1, 1)
            "#,
            [],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO playback_sessions
                (media_id, source_path, status, started_at, updated_at, exclusive_mode)
            VALUES (?1, ?2, 'ended', 1, 1, 0)
            "#,
            params![legacy_media_id, source_path],
        )
        .unwrap();
        let session_id = conn.last_insert_rowid();
        conn.execute(
            r#"
            INSERT INTO playback_history
                (session_id, media_id, source_path, event_type, event_at)
            VALUES (?1, 'd:/music/legacy.flac', 'D:/Music/Legacy.flac', 'load_requested', 1)
            "#,
            params![session_id],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO playback_queue_entries
                (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
            VALUES ('active', 0, 'D:/Music/Legacy.flac', 'd:/music/legacy.flac', 'queued', 1, 1)
            "#,
            [],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO analysis_tasks
                (task_id, task_type, source_path, status, created_at, updated_at)
            VALUES (900, 'loudness', ?1, 'success', 1, 1)
            "#,
            params![source_path],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO local_playlists
                (playlist_id, name, cover_media_id, created_at, updated_at)
            VALUES ('legacy-list', 'Legacy', ?1, 1, 1)
            "#,
            params![legacy_media_id],
        )
        .unwrap();
        conn.execute(
            r#"
            INSERT INTO local_playlist_items
                (playlist_id, media_id, position_index, added_at)
            VALUES ('legacy-list', ?1, 0, 1)
            "#,
            params![legacy_media_id],
        )
        .unwrap();

        run_migrations(&mut conn).unwrap();

        let local_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM media_items WHERE source_kind = 'local'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let remote_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM media_items WHERE source_kind = 'remote'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(local_count, 0);
        assert_eq!(remote_count, 1);
        for table in [
            "playback_history",
            "playback_sessions",
            "playback_queue_entries",
            "local_playlist_items",
            "analysis_tasks",
        ] {
            let count: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {}", table), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{} should be cleaned", table);
        }
        let playlist_cover: Option<String> = conn
            .query_row(
                "SELECT cover_media_id FROM local_playlists WHERE playlist_id = 'legacy-list'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(playlist_cover, None);
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 13);
        let foreign_key_errors: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(foreign_key_errors, 0);
    }

    #[test]
    fn library_membership_migration_backfills_overlapping_local_and_webdav_roots() {
        let mut conn = connection_at_v11();
        conn.execute_batch(
            r#"
            INSERT INTO webdav_sources
                (source_key, display_name, base_url, is_default, created_at, updated_at)
            VALUES ('primary', 'DAV', 'https://dav.example.test/dav', 1, 1, 1);
            INSERT INTO library_roots
                (root_id, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (1, 'D:/Music', 'local', 'Music', 'completed', 1);
            INSERT INTO library_roots
                (root_id, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (2, 'D:/Music/Album', 'local', 'Album', 'completed', 1);
            INSERT INTO library_roots
                (root_id, source_key, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (3, 'primary', '/albums', 'webdav', 'DAV', 'completed', 1);
            INSERT INTO library_roots
                (root_id, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (4, '/legacy', 'webdav', 'Legacy DAV', 'completed', 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('d:/music/album/a.flac', 'D:/Music/Album/a.flac', 'local', 1, 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('d:/outside.flac', 'D:/Outside.flac', 'local', 1, 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('https://dav.example.test/dav/albums/a.flac', 'https://dav.example.test/dav/albums/a.flac', 'remote', 1, 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('https://dav.example.test/dav/albums/ncm.flac', 'https://dav.example.test/dav/albums/ncm.flac', 'remote', 1, 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('https://dav.example.test/dav/legacy/b.flac', 'https://dav.example.test/dav/legacy/b.flac', 'remote', 1, 1);
            INSERT INTO ncm_track_sources
                (media_id, source_path, song_id, resolved_at)
            VALUES ('https://dav.example.test/dav/albums/ncm.flac', 'https://dav.example.test/dav/albums/ncm.flac', 42, 1);
            "#,
        )
        .unwrap();

        run_migrations(&mut conn).unwrap();

        let local_memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE media_id = 'd:/music/album/a.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let webdav_memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE media_id = 'https://dav.example.test/dav/albums/a.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let ncm_memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE media_id = 'https://dav.example.test/dav/albums/ncm.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let default_webdav_memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE root_id = 4 AND media_id = 'https://dav.example.test/dav/legacy/b.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let outside_local: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM media_items WHERE media_id = 'd:/outside.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let ncm_media: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM media_items WHERE media_id = 'https://dav.example.test/dav/albums/ncm.flac'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(local_memberships, 2);
        assert_eq!(webdav_memberships, 1);
        assert_eq!(default_webdav_memberships, 1);
        assert_eq!(ncm_memberships, 0);
        assert_eq!(outside_local, 0);
        assert_eq!(ncm_media, 1);
    }

    #[test]
    fn library_membership_migration_failure_rolls_back_cleanup_and_version() {
        let mut conn = connection_at_v11();
        conn.execute_batch(
            r#"
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES ('d:/music/fail.flac', 'D:/Music/fail.flac', 'local', 1, 1);
            CREATE TRIGGER reject_media_cleanup
            BEFORE DELETE ON media_items
            BEGIN
                SELECT RAISE(ABORT, 'cleanup rejected');
            END;
            "#,
        )
        .unwrap();

        let error = run_migrations(&mut conn).unwrap_err();

        assert!(error.contains("cleanup rejected"));
        let media_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM media_items", [], |row| row.get(0))
            .unwrap();
        let version_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_version WHERE version = 12",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(media_count, 1);
        assert_eq!(version_count, 0);
    }

    #[test]
    fn library_membership_migration_uses_runtime_webdav_fallback_for_legacy_root() {
        let mut conn = connection_at_v11();
        conn.execute_batch(
            r#"
            INSERT INTO library_roots
                (root_id, source_path, source_kind, display_name, scan_status, updated_at)
            VALUES (1, '/albums', 'webdav', 'Legacy DAV', 'completed', 1);
            INSERT INTO media_items
                (media_id, source_path, source_kind, added_at, updated_at)
            VALUES (
                'https://fallback.example.test/dav/albums/a.flac',
                'https://fallback.example.test/dav/albums/a.flac',
                'remote',
                1,
                1
            );
            "#,
        )
        .unwrap();

        run_migrations_with_webdav_fallback(&mut conn, Some("https://fallback.example.test/dav"))
            .unwrap();

        let memberships: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE root_id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(memberships, 1);
    }
}
