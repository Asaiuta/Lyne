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
        apply_backfill_v1(conn)?;
    }
    if current < 3 {
        apply_sql_migration(conn, 3, INDEXES_SQL)?;
    }
    if current < 4 {
        apply_shuffle_index_migration(conn)?;
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

fn apply_sql_migration(conn: &mut Connection, version: i64, sql: &str) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start migration {} transaction: {}", version, e))?;
    tx.execute_batch(sql)
        .map_err(|e| format!("Failed to apply migration {}: {}", version, e))?;
    record_version_tx(&tx, version)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit migration {}: {}", version, e))?;
    log::info!("Applied app database migration {}", version);
    Ok(())
}

fn apply_backfill_v1(conn: &mut Connection) -> Result<(), String> {
    let version = 2;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start migration {} transaction: {}", version, e))?;

    if !column_exists(&tx, "library_roots", "source_key")? {
        tx.execute("ALTER TABLE library_roots ADD COLUMN source_key TEXT", [])
            .map_err(|e| format!("Failed to backfill library_roots.source_key: {}", e))?;
    }

    record_version_tx(&tx, version)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit migration {}: {}", version, e))?;
    log::info!("Applied app database migration {}", version);
    Ok(())
}

fn apply_shuffle_index_migration(conn: &mut Connection) -> Result<(), String> {
    let version = 4;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start migration {} transaction: {}", version, e))?;

    if !column_exists(&tx, "playback_queue_entries", "shuffle_index")? {
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
    .map_err(|e| format!("Failed to create shuffle queue indexes: {}", e))?;

    record_version_tx(&tx, version)?;
    tx.commit()
        .map_err(|e| format!("Failed to commit migration {}: {}", version, e))?;
    log::info!("Applied app database migration {}", version);
    Ok(())
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

        apply_backfill_v1(&mut conn).unwrap();

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

        apply_backfill_v1(&mut conn).unwrap();

        assert!(column_exists(&conn, "library_roots", "source_key").unwrap());
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);
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
}
