use rand::seq::SliceRandom;
use rusqlite::{params, OptionalExtension};

use super::{
    media_id_for_path, now_epoch_secs_i64, AppDatabase, QueueEntryInput, QueueEntryRecord,
};

fn resolve_queue_source_key_tx(
    conn: &rusqlite::Connection,
    entry: &QueueEntryInput,
) -> Result<(Option<String>, &'static str), String> {
    if let Some(source_key) = entry.source_key.as_deref() {
        let exists = conn
            .query_row(
                "SELECT 1 FROM webdav_sources WHERE source_key = ?1",
                params![source_key],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| format!("Failed to validate queue WebDAV source: {}", e))?
            .is_some();
        if !exists {
            return Err(format!("WebDAV source '{}' does not exist", source_key));
        }
        return Ok((Some(source_key.to_string()), "webdav"));
    }
    if !entry.infer_source_key {
        return Ok((None, "public"));
    }

    let source_keys =
        super::webdav_sources::webdav_source_keys_for_media_path_tx(conn, &entry.source_path)?;
    match source_keys.as_slice() {
        [] => Ok((None, "infer")),
        [source_key] => Ok((Some(source_key.clone()), "webdav")),
        _ => Err("Queue entry has ambiguous WebDAV source ownership".to_string()),
    }
}

fn queue_entry_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueueEntryRecord> {
    Ok(QueueEntryRecord {
        queue_id: row.get(0)?,
        entry_id: row.get(1)?,
        position_index: row.get(2)?,
        shuffle_index: row.get(3)?,
        source_path: row.get(4)?,
        source_key: row.get(5)?,
        source_identity: row.get(6)?,
        media_id: row.get(7)?,
        status: row.get(8)?,
        added_at_epoch_secs: row.get::<_, i64>(9)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(10)? as u64,
        title: row.get(11)?,
        artist: row.get(12)?,
        album: row.get(13)?,
        duration_secs: row.get(14)?,
        has_cover_art: row.get::<_, i64>(15)? != 0,
        external_artwork_url: row.get(16)?,
    })
}

const QUEUE_ENTRY_SELECT_WITH_METADATA: &str = r#"
    SELECT q.queue_id, q.entry_id, q.position_index, q.shuffle_index, q.source_path, q.source_key,
           q.source_identity, q.media_id, q.status, q.added_at, q.updated_at,
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

impl AppDatabase {
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

    pub fn replace_queue_entries(&self, queue_id: &str, entries: &[String]) -> Result<(), String> {
        let inputs = entries
            .iter()
            .cloned()
            .map(QueueEntryInput::new)
            .collect::<Vec<_>>();
        self.replace_queue_entries_with_sources(queue_id, &inputs)
    }

    pub fn replace_queue_entries_with_sources(
        &self,
        queue_id: &str,
        entries: &[QueueEntryInput],
    ) -> Result<(), String> {
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
        for (index, entry) in entries.iter().enumerate() {
            let (source_key, source_identity) = resolve_queue_source_key_tx(&tx, entry)?;
            tx.execute(
                r#"
                INSERT INTO playback_queue_entries
                    (queue_id, position_index, source_path, source_key, source_identity, media_id, status, added_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?7)
                "#,
                params![
                    queue_id,
                    index as i64,
                    entry.source_path,
                    source_key,
                    source_identity,
                    media_id_for_path(&entry.source_path),
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
        self.append_queue_entry_with_source(queue_id, &QueueEntryInput::new(source_path))
    }

    pub fn append_queue_entry_with_source(
        &self,
        queue_id: &str,
        entry: &QueueEntryInput,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        let next_position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position_index) + 1, 0) FROM playback_queue_entries WHERE queue_id = ?1",
                params![queue_id],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to compute next queue position: {}", e))?;
        let (source_key, source_identity) = resolve_queue_source_key_tx(&conn, entry)?;
        conn.execute(
            r#"
            INSERT INTO playback_queue_entries
                (queue_id, position_index, source_path, source_key, source_identity, media_id, status, added_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?7)
            "#,
            params![
                queue_id,
                next_position,
                entry.source_path,
                source_key,
                source_identity,
                media_id_for_path(&entry.source_path),
                now
            ],
        )
        .map_err(|e| format!("Failed to append queue entry: {}", e))?;
        Ok(())
    }

    pub fn append_queue_entries(&self, queue_id: &str, entries: &[String]) -> Result<(), String> {
        let inputs = entries
            .iter()
            .cloned()
            .map(QueueEntryInput::new)
            .collect::<Vec<_>>();
        self.append_queue_entries_with_sources(queue_id, &inputs)
    }

    pub fn append_queue_entries_with_sources(
        &self,
        queue_id: &str,
        entries: &[QueueEntryInput],
    ) -> Result<(), String> {
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

        for (offset, entry) in entries.iter().enumerate() {
            let (source_key, source_identity) = resolve_queue_source_key_tx(&tx, entry)?;
            tx.execute(
                r#"
                INSERT INTO playback_queue_entries
                    (queue_id, position_index, source_path, source_key, source_identity, media_id, status, added_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', ?7, ?7)
                "#,
                params![
                    queue_id,
                    next_position + offset as i64,
                    entry.source_path,
                    source_key,
                    source_identity,
                    media_id_for_path(&entry.source_path),
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
        after_entry_id: Option<i64>,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let query_with_cursor = format!(
            r#"
            {}
            WHERE q.queue_id = ?1
              AND q.status IN ('queued', 'preloading')
              AND COALESCE(q.shuffle_index, q.position_index) > (
                  SELECT COALESCE(q2.shuffle_index, q2.position_index)
                  FROM playback_queue_entries q2
                  WHERE q2.queue_id = ?1 AND q2.entry_id = ?2
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

        let result = if let Some(entry_id) = after_entry_id {
            conn.query_row(
                &query_with_cursor,
                params![queue_id, entry_id],
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
        before_entry_id: Option<i64>,
    ) -> Result<Option<QueueEntryRecord>, String> {
        let Some(entry_id) = before_entry_id else {
            return Ok(None);
        };

        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT q.queue_id, q.entry_id, q.position_index, q.shuffle_index, q.source_path, q.source_key,
                   q.source_identity, q.media_id, q.status, q.added_at, q.updated_at,
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
                  WHERE q2.queue_id = ?1 AND q2.entry_id = ?2
              )
            ORDER BY COALESCE(q.shuffle_index, q.position_index) DESC, q.entry_id DESC
            LIMIT 1
            "#,
            params![queue_id, entry_id],
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
}
