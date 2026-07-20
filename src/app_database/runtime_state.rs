use rusqlite::{params, OptionalExtension};
use serde_json::Value as JsonValue;

use super::{
    bool_to_sqlite, now_epoch_secs_i64, AppDatabase, DeviceConfigRecord, DspConfigRecord,
    LibraryRootRecord, QueueSnapshotRecord,
};

fn device_config_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DeviceConfigRecord> {
    Ok(DeviceConfigRecord {
        profile_key: row.get(0)?,
        device_id: row.get::<_, Option<i64>>(1)?.map(|v| v as usize),
        exclusive_mode: row.get::<_, i64>(2)? != 0,
        updated_at_epoch_secs: row.get::<_, i64>(3)? as u64,
        last_seen_at_epoch_secs: row.get::<_, i64>(4)? as u64,
    })
}

fn dsp_config_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DspConfigRecord> {
    let payload_json: String = row.get(1)?;
    Ok(DspConfigRecord {
        config_key: row.get(0)?,
        payload: serde_json::from_str(&payload_json).unwrap_or(JsonValue::Null),
        updated_at_epoch_secs: row.get::<_, i64>(2)? as u64,
    })
}

fn queue_snapshot_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueueSnapshotRecord> {
    Ok(QueueSnapshotRecord {
        current_track_path: row.get(0)?,
        pending_track_path: row.get(1)?,
        needs_preload: row.get::<_, i64>(2)? != 0,
        pending_ready: row.get::<_, i64>(3)? != 0,
        updated_at_epoch_secs: row.get::<_, i64>(4)? as u64,
    })
}

fn library_root_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryRootRecord> {
    Ok(LibraryRootRecord {
        root_id: row.get(0)?,
        source_key: row.get(1)?,
        source_path: row.get(2)?,
        source_kind: row.get(3)?,
        display_name: row.get(4)?,
        scan_status: row.get(5)?,
        track_count: row.get::<_, i64>(6)? as u64,
        last_scan_started_at_epoch_secs: row.get::<_, Option<i64>>(7)?.map(|v| v as u64),
        last_scan_finished_at_epoch_secs: row.get::<_, Option<i64>>(8)?.map(|v| v as u64),
        updated_at_epoch_secs: row.get::<_, i64>(9)? as u64,
    })
}

impl AppDatabase {
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
            device_config_from_row,
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
            .query_map([], dsp_config_from_row)
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
            queue_snapshot_from_row,
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
            .query_map([], library_root_from_row)
            .map_err(|e| format!("Failed to query library roots: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode library roots: {}", e))
    }
}
