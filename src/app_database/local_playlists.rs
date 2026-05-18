use rand::Rng;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::collections::HashSet;

use super::{
    media_item_from_row, now_epoch_secs_i64, AppDatabase, LocalPlaylistDetailRecord,
    LocalPlaylistRecord,
};

const MEDIA_ID_LOOKUP_CHUNK_SIZE: usize = 500;

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

fn existing_media_ids_tx(
    tx: &rusqlite::Transaction<'_>,
    media_ids: &[String],
) -> Result<HashSet<String>, String> {
    let mut existing = HashSet::with_capacity(media_ids.len());
    for chunk in media_ids.chunks(MEDIA_ID_LOOKUP_CHUNK_SIZE) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders = std::iter::repeat("?")
            .take(chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT media_id FROM media_items WHERE media_id IN ({})",
            placeholders
        );
        let mut stmt = tx
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare media item existence lookup: {}", e))?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| format!("Failed to query media item existence lookup: {}", e))?;
        for row in rows {
            existing.insert(
                row.map_err(|e| format!("Failed to decode media item existence lookup: {}", e))?,
            );
        }
    }
    Ok(existing)
}

fn existing_local_playlist_media_ids_tx(
    tx: &rusqlite::Transaction<'_>,
    playlist_id: &str,
    media_ids: &[String],
) -> Result<HashSet<String>, String> {
    let mut existing = HashSet::with_capacity(media_ids.len());
    for chunk in media_ids.chunks(MEDIA_ID_LOOKUP_CHUNK_SIZE) {
        if chunk.is_empty() {
            continue;
        }
        let placeholders = std::iter::repeat("?")
            .take(chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT media_id FROM local_playlist_items WHERE playlist_id = ? AND media_id IN ({})",
            placeholders
        );
        let mut stmt = tx
            .prepare(&sql)
            .map_err(|e| format!("Failed to prepare local playlist membership query: {}", e))?;
        let rows = stmt
            .query_map(
                params_from_iter(
                    std::iter::once(playlist_id).chain(chunk.iter().map(String::as_str)),
                ),
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| format!("Failed to query local playlist membership: {}", e))?;
        for row in rows {
            existing.insert(
                row.map_err(|e| format!("Failed to decode local playlist membership: {}", e))?,
            );
        }
    }
    Ok(existing)
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
        let rows = stmt
            .query_map(params![playlist_id], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query local playlist item order: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode local playlist item order: {}", e))?
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

impl AppDatabase {
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
                       media_items.sample_rate, media_items.channels, media_items.bitrate_bps,
                       media_items.bits_per_sample, media_items.updated_at,
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

        let mut seen = HashSet::new();
        let mut candidates = Vec::new();
        for media_id in media_ids {
            let trimmed = media_id.trim();
            if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
                continue;
            }
            candidates.push(trimmed.to_string());
        }

        let existing_playlist_media =
            existing_local_playlist_media_ids_tx(&tx, playlist_id, &candidates)?;
        let new_candidates = candidates
            .into_iter()
            .filter(|media_id| !existing_playlist_media.contains(media_id))
            .collect::<Vec<_>>();
        let existing_media = existing_media_ids_tx(&tx, &new_candidates)?;
        let additions = new_candidates
            .into_iter()
            .filter(|media_id| existing_media.contains(media_id))
            .collect::<Vec<_>>();

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
        let mut seen = HashSet::new();

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
}
