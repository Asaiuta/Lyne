use rusqlite::{params, params_from_iter, OptionalExtension};
use rusqlite::types::ValueRef;
use std::collections::{HashMap, HashSet};

use super::{
    media_id_for_path, media_item_from_row, media_item_from_row_with_offset,
    normalize_media_path_for_id, AppDatabase, LibraryFolderSummaryRecord,
    LibrarySummaryStatsRecord, LibraryTrackDetailRecord, LibraryTrackSummaryRecord,
    MediaItemRecord,
};

fn library_track_summary_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<LibraryTrackSummaryRecord> {
    let source_path: String = row.get(1)?;
    let (folder_path, folder_label, file_name) = split_source_path_for_library(&source_path);
    let stored_size: Option<i64> = row.get(15)?;
    let bitrate_bps = match row.get_ref(8)? {
        ValueRef::Null => None,
        _ => Some(row.get(8)?),
    };
    Ok(LibraryTrackSummaryRecord {
        track_key: row.get(0)?,
        media_id: row.get(10)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        track_number: row.get::<_, Option<i64>>(5)?.map(|value| value as u32),
        file_name,
        folder_key: stable_key_for_text(&folder_path),
        folder_path,
        folder_label,
        duration_secs: row.get(6)?,
        sample_rate: row.get::<_, Option<i64>>(7)?.map(|value| value as u32),
        bitrate_bps,
        bits_per_sample: row.get::<_, Option<i64>>(9)?.map(|value| value as u32),
        has_cover_art: row.get::<_, i64>(13)? != 0,
        external_artwork_url: row.get(14)?,
        size_bytes: stored_size.map(|value| value as u64),
        added_at_epoch_secs: row.get::<_, i64>(11)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(12)? as u64,
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

impl AppDatabase {
    pub fn recent_media_items(&self, limit: usize) -> Result<Vec<MediaItemRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
                       genre, year, duration_secs, sample_rate, channels, bitrate_bps, bits_per_sample,
                       updated_at,
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
                       genre, year, duration_secs, sample_rate, channels, bitrate_bps, bits_per_sample,
                       updated_at,
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
                       sample_rate, bitrate_bps, bits_per_sample,
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
                   genre, year, duration_secs, sample_rate, channels, bitrate_bps, bits_per_sample,
                   updated_at,
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

    pub fn source_paths_for_media_ids(
        &self,
        media_ids: &[String],
    ) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut path_by_media_id = HashMap::with_capacity(media_ids.len());
        for chunk in media_ids.chunks(500) {
            if chunk.is_empty() {
                continue;
            }
            let placeholders = std::iter::repeat("?")
                .take(chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT media_id, source_path FROM media_items WHERE media_id IN ({})",
                placeholders
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("Failed to prepare library media id lookup: {}", e))?;
            let rows = stmt
                .query_map(params_from_iter(chunk.iter()), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| format!("Failed to query library media id lookup: {}", e))?;
            for row in rows {
                let (media_id, source_path) =
                    row.map_err(|e| format!("Failed to decode library media id lookup: {}", e))?;
                path_by_media_id.insert(media_id, source_path);
            }
        }
        Ok(media_ids
            .iter()
            .filter_map(|media_id| {
                path_by_media_id
                    .get(media_id)
                    .map(|source_path| (media_id.clone(), source_path.clone()))
            })
            .collect())
    }

    pub fn delete_media_items(&self, media_ids: &[String]) -> Result<u64, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start media delete transaction: {}", e))?;
        let mut removed = 0_u64;
        let mut seen = HashSet::new();

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

    /// Load a snapshot of existing local media items for incremental scanning.
    /// Returns a map of source_path -> (mtime, size_bytes, has_cover_art).
    pub fn load_scan_snapshot(
        &self,
    ) -> Result<HashMap<String, (Option<f64>, Option<u64>, bool)>, String> {
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

        let records = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode scan snapshot: {}", e))?;
        let mut map = HashMap::with_capacity(records.len());
        for row in records {
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
            .collect::<HashSet<_>>();
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
}
