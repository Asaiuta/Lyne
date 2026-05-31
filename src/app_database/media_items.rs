use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::decoder::TrackMetadata;

use super::ncm_track_sources::ncm_track_source_from_row;
use super::{
    media_id_for_path, media_item_from_row, now_epoch_secs_i64, AppDatabase, CoverArtRecord,
    MediaItemRecord, MediaMetadataBatchWriteReport, MediaMetadataCoverArtFileInput,
    MediaMetadataScanInput,
};

impl AppDatabase {
    pub fn record_media_stub(&self, source_path: &str) -> Result<String, String> {
        let media_id = media_id_for_path(source_path);
        let source_kind = media_source_kind(source_path);
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_epoch_secs_i64();
        record_media_stub_in_conn(&conn, &media_id, source_path, source_kind, now)?;
        Ok(media_id)
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
        bitrate_bps: Option<f64>,
        bits_per_sample: Option<u32>,
        mtime: Option<f64>,
        size_bytes: Option<u64>,
    ) -> Result<String, String> {
        let input = MediaMetadataScanInput {
            source_path,
            metadata,
            duration_secs,
            sample_rate,
            channels,
            bitrate_bps,
            bits_per_sample,
            mtime,
            size_bytes,
            cover_art_file: None,
        };
        let mut results = self.record_media_metadata_batch_with_scan_info(&[input])?;
        results
            .pop()
            .unwrap_or_else(|| Err("Failed to write media metadata: empty batch".to_string()))
    }

    pub fn record_media_metadata_batch_with_scan_info(
        &self,
        records: &[MediaMetadataScanInput<'_>],
    ) -> Result<Vec<Result<String, String>>, String> {
        if records.is_empty() {
            return Ok(Vec::new());
        }

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("Failed to start media metadata batch transaction: {}", e))?;
        let now = now_epoch_secs_i64();
        let mut results = Vec::with_capacity(records.len());

        for record in records {
            results.push(record_media_metadata_savepoint(&tx, |conn| {
                record_media_metadata_with_scan_info_in_conn(conn, record, now)
            })?);
        }

        tx.commit()
            .map_err(|e| format!("Failed to commit media metadata batch transaction: {}", e))?;
        Ok(results)
    }

    pub fn record_local_scan_metadata_batch(
        &self,
        records: &[MediaMetadataScanInput<'_>],
    ) -> Result<MediaMetadataBatchWriteReport, String> {
        if records.is_empty() {
            return Ok(MediaMetadataBatchWriteReport {
                results: Vec::new(),
                fallback_count: 0,
            });
        }

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| {
                format!(
                    "Failed to start local scan metadata batch transaction: {}",
                    e
                )
            })?;
        let now = now_epoch_secs_i64();
        let (results, fallback_count) =
            match record_local_scan_fast_batch_savepoint(&tx, records, now)? {
                Ok(results) => (results, 0),
                Err(_) => record_local_scan_metadata_batch_with_fallback(&tx, records, now)?,
            };

        tx.commit().map_err(|e| {
            format!(
                "Failed to commit local scan metadata batch transaction: {}",
                e
            )
        })?;
        Ok(MediaMetadataBatchWriteReport {
            results,
            fallback_count,
        })
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

    pub fn media_metadata_for_path(
        &self,
        source_path: &str,
    ) -> Result<Option<MediaItemRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
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
            WHERE media_id = ?1 OR source_path = ?2
            LIMIT 1
            "#,
            params![media_id_for_path(source_path), source_path],
            media_item_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read media metadata for '{}': {}", source_path, e))
    }

    pub fn get_cover_art_for_media(
        &self,
        media_id: &str,
    ) -> Result<Option<(CoverArtRecord, Vec<u8>)>, String> {
        let normalized_media_id = media_id_for_path(media_id);
        let cover_row = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row(
                r#"
                SELECT cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at
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
                            byte_len: row.get::<_, i64>(5)? as u64,
                            created_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                        },
                        row.get::<_, Option<Vec<u8>>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| format!("Failed to read cover art cache: {}", e))?
        };

        let Some((record, image_bytes, file_path)) = cover_row else {
            return Ok(None);
        };
        if let Some(bytes) = image_bytes {
            return Ok(Some((record, bytes)));
        }
        let Some(file_path) = file_path else {
            return Ok(None);
        };
        match std::fs::read(&file_path) {
            Ok(bytes) => Ok(Some((record, bytes))),
            Err(e) => {
                log::warn!(
                    "Ignoring unreadable file-backed cover art '{}': {}",
                    file_path,
                    e
                );
                self.delete_cover_art_cache_entry(&record.cover_art_id);
                Ok(None)
            }
        }
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

    fn delete_cover_art_cache_entry(&self, cover_art_id: &str) {
        let result = self
            .conn
            .lock()
            .map_err(|e| e.to_string())
            .and_then(|conn| {
                conn.execute(
                    "DELETE FROM cover_art_cache WHERE cover_art_id = ?1",
                    params![cover_art_id],
                )
                .map(|_| ())
                .map_err(|e| format!("Failed to delete stale cover art cache entry: {}", e))
            });
        if let Err(e) = result {
            log::warn!("{}", e);
        }
    }
}

fn media_source_kind(source_path: &str) -> &'static str {
    if source_path.starts_with("http://") || source_path.starts_with("https://") {
        "remote"
    } else {
        "local"
    }
}

fn record_local_scan_fast_batch_savepoint(
    conn: &Connection,
    records: &[MediaMetadataScanInput<'_>],
    now: i64,
) -> Result<Result<Vec<Result<String, String>>, String>, String> {
    conn.execute_batch("SAVEPOINT local_scan_metadata_batch")
        .map_err(|e| format!("Failed to start local scan metadata batch savepoint: {}", e))?;

    let mut results = Vec::with_capacity(records.len());
    for record in records {
        match record_local_scan_metadata_fast_in_conn(conn, record, now) {
            Ok(media_id) => results.push(Ok(media_id)),
            Err(err) => {
                conn.execute_batch(
                    "ROLLBACK TO SAVEPOINT local_scan_metadata_batch; RELEASE SAVEPOINT local_scan_metadata_batch;",
                )
                .map_err(|e| {
                    format!(
                        "Failed to roll back local scan metadata batch savepoint after '{}': {}",
                        err, e
                    )
                })?;
                return Ok(Err(err));
            }
        }
    }

    conn.execute_batch("RELEASE SAVEPOINT local_scan_metadata_batch")
        .map_err(|e| {
            format!(
                "Failed to release local scan metadata batch savepoint: {}",
                e
            )
        })?;
    Ok(Ok(results))
}

fn record_local_scan_metadata_batch_with_fallback(
    conn: &Connection,
    records: &[MediaMetadataScanInput<'_>],
    now: i64,
) -> Result<(Vec<Result<String, String>>, usize), String> {
    let mut results = Vec::with_capacity(records.len());
    let mut fallback_count = 0_usize;

    for record in records {
        match record_media_metadata_savepoint(conn, |conn| {
            record_local_scan_metadata_fast_in_conn(conn, record, now)
        })? {
            Ok(media_id) => results.push(Ok(media_id)),
            Err(fast_err) => {
                fallback_count += 1;
                let fallback_result = record_media_metadata_savepoint(conn, |conn| {
                    record_media_metadata_with_scan_info_in_conn(conn, record, now)
                })?;
                results.push(fallback_result.map_err(|fallback_err| {
                    format!(
                        "Fast local scan metadata write failed: {}; fallback metadata write failed: {}",
                        fast_err, fallback_err
                    )
                }));
            }
        }
    }

    Ok((results, fallback_count))
}

fn record_media_metadata_savepoint<F>(
    conn: &Connection,
    write: F,
) -> Result<Result<String, String>, String>
where
    F: FnOnce(&Connection) -> Result<String, String>,
{
    conn.execute_batch("SAVEPOINT media_metadata_record")
        .map_err(|e| format!("Failed to start media metadata record savepoint: {}", e))?;
    match write(conn) {
        Ok(media_id) => {
            conn.execute_batch("RELEASE SAVEPOINT media_metadata_record")
                .map_err(|e| format!("Failed to release media metadata record savepoint: {}", e))?;
            Ok(Ok(media_id))
        }
        Err(err) => {
            conn.execute_batch(
                "ROLLBACK TO SAVEPOINT media_metadata_record; RELEASE SAVEPOINT media_metadata_record;",
            )
            .map_err(|e| {
                format!(
                    "Failed to roll back media metadata record savepoint after '{}': {}",
                    err, e
                )
            })?;
            Ok(Err(err))
        }
    }
}

fn record_media_metadata_with_scan_info_in_conn(
    conn: &Connection,
    record: &MediaMetadataScanInput<'_>,
    now: i64,
) -> Result<String, String> {
    let media_id = media_id_for_path(record.source_path);
    record_media_stub_statements(
        conn,
        &media_id,
        record.source_path,
        media_source_kind(record.source_path),
        now,
    )?;
    update_media_metadata_in_conn(
        conn,
        &media_id,
        record.metadata,
        record.duration_secs,
        record.sample_rate,
        record.channels,
        record.bitrate_bps,
        record.bits_per_sample,
        record.mtime,
        record.size_bytes,
        record.cover_art_file,
        now,
    )?;
    Ok(media_id)
}

fn record_local_scan_metadata_fast_in_conn(
    conn: &Connection,
    record: &MediaMetadataScanInput<'_>,
    now: i64,
) -> Result<String, String> {
    let media_id = media_id_for_path(record.source_path);
    conn.execute(
        r#"
        INSERT INTO media_items (media_id, source_path, source_kind, added_at, updated_at)
        VALUES (?1, ?2, 'local', ?3, ?3)
        ON CONFLICT(media_id) DO UPDATE SET
            source_path = excluded.source_path,
            source_kind = 'local',
            updated_at = excluded.updated_at
        "#,
        params![media_id, record.source_path, now],
    )
    .map_err(|e| {
        format!(
            "Failed to fast-record local scan media item '{}': {}",
            record.source_path, e
        )
    })?;
    update_media_metadata_in_conn(
        conn,
        &media_id,
        record.metadata,
        record.duration_secs,
        record.sample_rate,
        record.channels,
        record.bitrate_bps,
        record.bits_per_sample,
        record.mtime,
        record.size_bytes,
        record.cover_art_file,
        now,
    )?;
    Ok(media_id)
}

fn update_media_metadata_in_conn(
    conn: &Connection,
    media_id: &str,
    metadata: &TrackMetadata,
    duration_secs: Option<f64>,
    sample_rate: Option<u32>,
    channels: Option<usize>,
    bitrate_bps: Option<f64>,
    bits_per_sample: Option<u32>,
    mtime: Option<f64>,
    size_bytes: Option<u64>,
    cover_art_file: Option<MediaMetadataCoverArtFileInput<'_>>,
    now: i64,
) -> Result<(), String> {
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
            bitrate_bps = COALESCE(?12, bitrate_bps),
            bits_per_sample = COALESCE(?13, bits_per_sample),
            mtime = COALESCE(?15, mtime),
            size_bytes = COALESCE(?16, size_bytes),
            updated_at = ?14
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
            bitrate_bps,
            bits_per_sample.map(|v| v as i64),
            now,
            mtime,
            size_bytes.map(|v| v as i64),
        ],
    )
    .map_err(|e| format!("Failed to update media metadata: {}", e))?;

    if let Some(cover_art_file) = cover_art_file {
        let cover_art_id = format!("{}:cover", media_id);
        conn.execute(
            r#"
            INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at)
            VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)
            ON CONFLICT(cover_art_id) DO UPDATE SET
                mime_type = excluded.mime_type,
                image_bytes = excluded.image_bytes,
                file_path = excluded.file_path,
                byte_len = excluded.byte_len,
                created_at = excluded.created_at
            "#,
            params![
                cover_art_id,
                media_id,
                cover_art_file.mime_type,
                cover_art_file.path,
                cover_art_file.byte_len as i64,
                now,
            ],
        )
        .map_err(|e| format!("Failed to update cover art cache: {}", e))?;
    } else if let Some(ref art) = metadata.cover_art {
        let cover_art_id = format!("{}:cover", media_id);
        conn.execute(
            r#"
            INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, file_path, byte_len, created_at)
            VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
            ON CONFLICT(cover_art_id) DO UPDATE SET
                mime_type = excluded.mime_type,
                image_bytes = excluded.image_bytes,
                file_path = excluded.file_path,
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

    Ok(())
}

fn record_media_stub_in_conn(
    conn: &Connection,
    media_id: &str,
    source_path: &str,
    source_kind: &str,
    now: i64,
) -> Result<(), String> {
    conn.execute_batch("BEGIN IMMEDIATE TRANSACTION;")
        .map_err(|e| format!("Failed to start media item transaction: {}", e))?;

    let result = record_media_stub_statements(conn, media_id, source_path, source_kind, now);

    match result {
        Ok(()) => conn
            .execute_batch("COMMIT;")
            .map_err(|e| format!("Failed to commit media item transaction: {}", e)),
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(err)
        }
    }
}

fn record_media_stub_statements(
    conn: &Connection,
    media_id: &str,
    source_path: &str,
    source_kind: &str,
    now: i64,
) -> Result<(), String> {
    let existing_by_id = conn
        .query_row(
            "SELECT media_id FROM media_items WHERE media_id = ?1",
            params![media_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read media item by id '{}': {}", media_id, e))?;
    let existing_by_path = conn
        .query_row(
            "SELECT media_id FROM media_items WHERE source_path = ?1",
            params![source_path],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to read media item by path '{}': {}", source_path, e))?;

    match (existing_by_id.as_deref(), existing_by_path.as_deref()) {
        (Some(_), Some(path_media_id)) if path_media_id != media_id => {
            merge_media_identity(conn, path_media_id, media_id, now)?;
        }
        (None, Some(path_media_id)) if path_media_id != media_id => {
            rename_media_identity(conn, path_media_id, media_id, source_path, source_kind, now)?;
        }
        _ => {}
    }

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
    Ok(())
}

fn rename_media_identity(
    conn: &Connection,
    old_media_id: &str,
    new_media_id: &str,
    source_path: &str,
    source_kind: &str,
    now: i64,
) -> Result<(), String> {
    let legacy_source_path = format!("{}#legacy-media-id:{}", source_path, old_media_id);
    conn.execute(
        "UPDATE media_items SET source_path = ?1, updated_at = ?2 WHERE media_id = ?3",
        params![legacy_source_path, now, old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to release legacy media source path '{}' for '{}': {}",
            source_path, old_media_id, e
        )
    })?;
    conn.execute(
        r#"
        INSERT INTO media_items (
            media_id, source_path, source_kind, title, artist, album, track_number, disc_number,
            genre, year, duration_secs, sample_rate, channels, bitrate_bps, bits_per_sample,
            external_artwork_url, added_at,
            updated_at, mtime, size_bytes
        )
        SELECT ?1, ?2, ?3, title, artist, album, track_number, disc_number,
               genre, year, duration_secs, sample_rate, channels, bitrate_bps, bits_per_sample,
               external_artwork_url, added_at,
               ?4, mtime, size_bytes
        FROM media_items
        WHERE media_id = ?5
        "#,
        params![new_media_id, source_path, source_kind, now, old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to create normalized media item '{}' from '{}': {}",
            new_media_id, old_media_id, e
        )
    })?;
    update_media_identity_references(conn, old_media_id, new_media_id)?;
    conn.execute(
        "DELETE FROM media_items WHERE media_id = ?1",
        params![old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to remove legacy media item '{}' after normalizing to '{}': {}",
            old_media_id, new_media_id, e
        )
    })?;
    Ok(())
}

fn merge_media_identity(
    conn: &Connection,
    old_media_id: &str,
    canonical_media_id: &str,
    now: i64,
) -> Result<(), String> {
    conn.execute(
        r#"
        UPDATE media_items
        SET title = COALESCE(NULLIF(title, ''), (SELECT NULLIF(title, '') FROM media_items WHERE media_id = ?2)),
            artist = COALESCE(NULLIF(artist, ''), (SELECT NULLIF(artist, '') FROM media_items WHERE media_id = ?2)),
            album = COALESCE(NULLIF(album, ''), (SELECT NULLIF(album, '') FROM media_items WHERE media_id = ?2)),
            track_number = COALESCE(track_number, (SELECT track_number FROM media_items WHERE media_id = ?2)),
            disc_number = COALESCE(disc_number, (SELECT disc_number FROM media_items WHERE media_id = ?2)),
            genre = COALESCE(NULLIF(genre, ''), (SELECT NULLIF(genre, '') FROM media_items WHERE media_id = ?2)),
            year = COALESCE(year, (SELECT year FROM media_items WHERE media_id = ?2)),
            duration_secs = COALESCE(duration_secs, (SELECT duration_secs FROM media_items WHERE media_id = ?2)),
            sample_rate = COALESCE(sample_rate, (SELECT sample_rate FROM media_items WHERE media_id = ?2)),
            channels = COALESCE(channels, (SELECT channels FROM media_items WHERE media_id = ?2)),
            bitrate_bps = COALESCE(bitrate_bps, (SELECT bitrate_bps FROM media_items WHERE media_id = ?2)),
            bits_per_sample = COALESCE(bits_per_sample, (SELECT bits_per_sample FROM media_items WHERE media_id = ?2)),
            external_artwork_url = COALESCE(NULLIF(external_artwork_url, ''), (SELECT NULLIF(external_artwork_url, '') FROM media_items WHERE media_id = ?2)),
            mtime = COALESCE(mtime, (SELECT mtime FROM media_items WHERE media_id = ?2)),
            size_bytes = COALESCE(size_bytes, (SELECT size_bytes FROM media_items WHERE media_id = ?2)),
            updated_at = ?3
        WHERE media_id = ?1
        "#,
        params![canonical_media_id, old_media_id, now],
    )
    .map_err(|e| {
        format!(
            "Failed to merge media item '{}' into '{}': {}",
            old_media_id, canonical_media_id, e
        )
    })?;
    update_media_identity_references(conn, old_media_id, canonical_media_id)?;
    reconcile_ncm_track_source_merge(conn, old_media_id, canonical_media_id, now)?;
    reconcile_local_playlist_items_merge(conn, old_media_id, canonical_media_id)?;
    conn.execute(
        "DELETE FROM media_items WHERE media_id = ?1",
        params![old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to delete merged media item '{}': {}",
            old_media_id, e
        )
    })?;
    Ok(())
}

fn update_media_identity_references(
    conn: &Connection,
    old_media_id: &str,
    new_media_id: &str,
) -> Result<(), String> {
    if old_media_id == new_media_id {
        return Ok(());
    }

    let updates = [
        (
            "cover_art_cache",
            "media_id",
            "UPDATE cover_art_cache SET media_id = ?1 WHERE media_id = ?2",
        ),
        (
            "playback_sessions",
            "media_id",
            "UPDATE playback_sessions SET media_id = ?1 WHERE media_id = ?2",
        ),
        (
            "playback_history",
            "media_id",
            "UPDATE playback_history SET media_id = ?1 WHERE media_id = ?2",
        ),
        (
            "playback_queue_entries",
            "media_id",
            "UPDATE playback_queue_entries SET media_id = ?1 WHERE media_id = ?2",
        ),
        (
            "local_playlists",
            "cover_media_id",
            "UPDATE local_playlists SET cover_media_id = ?1 WHERE cover_media_id = ?2",
        ),
    ];

    for (table, column, sql) in updates {
        conn.execute(sql, params![new_media_id, old_media_id])
            .map_err(|e| {
                format!(
                    "Failed to update {}.{} from '{}' to '{}': {}",
                    table, column, old_media_id, new_media_id, e
                )
            })?;
    }

    Ok(())
}

fn reconcile_ncm_track_source_merge(
    conn: &Connection,
    old_media_id: &str,
    canonical_media_id: &str,
    now: i64,
) -> Result<(), String> {
    let old_row = conn
        .query_row(
            r#"
            SELECT media_id, source_path, song_id, source_page_url, resolved_at, scrobbled_at, scrobble_secs
            FROM ncm_track_sources
            WHERE media_id = ?1
            "#,
            params![old_media_id],
            ncm_track_source_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to read legacy NCM track source '{}': {}", old_media_id, e))?;
    let Some(old_row) = old_row else {
        return Ok(());
    };

    let canonical_row = conn
        .query_row(
            r#"
            SELECT media_id, source_path, song_id, source_page_url, resolved_at, scrobbled_at, scrobble_secs
            FROM ncm_track_sources
            WHERE media_id = ?1
            "#,
            params![canonical_media_id],
            ncm_track_source_from_row,
        )
        .optional()
        .map_err(|e| {
            format!(
                "Failed to read canonical NCM track source '{}': {}",
                canonical_media_id, e
            )
        })?;

    let merged_source_path = old_row.source_path.clone();
    let merged_song_id = old_row.song_id;
    let merged_source_page_url = old_row.source_page_url.clone();
    let merged_resolved_at = old_row.resolved_at_epoch_secs;
    let merged_scrobbled_at = old_row.scrobbled_at_epoch_secs;
    let merged_scrobble_secs = old_row.scrobble_secs;

    if canonical_row.is_some() {
        conn.execute(
            r#"
            UPDATE ncm_track_sources
            SET source_path = ?2,
                song_id = COALESCE(song_id, ?3),
                source_page_url = COALESCE(source_page_url, ?4),
                resolved_at = COALESCE(resolved_at, ?5),
                scrobbled_at = COALESCE(scrobbled_at, ?6),
                scrobble_secs = COALESCE(scrobble_secs, ?7)
            WHERE media_id = ?1
            "#,
            params![
                canonical_media_id,
                merged_source_path,
                merged_song_id,
                merged_source_page_url,
                merged_resolved_at,
                merged_scrobbled_at,
                merged_scrobble_secs,
            ],
        )
        .map_err(|e| {
            format!(
                "Failed to merge NCM track source '{}' into '{}': {}",
                old_media_id, canonical_media_id, e
            )
        })?;
        conn.execute(
            "DELETE FROM ncm_track_sources WHERE media_id = ?1",
            params![old_media_id],
        )
        .map_err(|e| {
            format!(
                "Failed to delete merged NCM track source '{}': {}",
                old_media_id, e
            )
        })?;
        return Ok(());
    }

    conn.execute(
        r#"
        UPDATE ncm_track_sources
        SET media_id = ?1,
            source_path = ?2,
            resolved_at = ?3
        WHERE media_id = ?4
        "#,
        params![canonical_media_id, merged_source_path, now, old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to retarget NCM track source '{}' to '{}': {}",
            old_media_id, canonical_media_id, e
        )
    })?;

    Ok(())
}

fn reconcile_local_playlist_items_merge(
    conn: &Connection,
    old_media_id: &str,
    canonical_media_id: &str,
) -> Result<(), String> {
    conn.execute(
        r#"
        DELETE FROM local_playlist_items
        WHERE media_id = ?1
          AND EXISTS (
              SELECT 1
              FROM local_playlist_items dup
              WHERE dup.playlist_id = local_playlist_items.playlist_id
                AND dup.media_id = ?2
          )
        "#,
        params![old_media_id, canonical_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to remove duplicate local playlist items for '{}' and '{}': {}",
            old_media_id, canonical_media_id, e
        )
    })?;
    conn.execute(
        "UPDATE local_playlist_items SET media_id = ?1 WHERE media_id = ?2",
        params![canonical_media_id, old_media_id],
    )
    .map_err(|e| {
        format!(
            "Failed to retarget local playlist items from '{}' to '{}': {}",
            old_media_id, canonical_media_id, e
        )
    })?;
    Ok(())
}
