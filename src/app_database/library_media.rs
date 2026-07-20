use rusqlite::types::ValueRef;
use rusqlite::{params, params_from_iter, OptionalExtension};
use std::collections::HashMap;

use super::library_memberships::{
    cleanup_media_targets_tx, resolve_cleanup_targets_for_media_ids_tx,
};
use super::{
    media_item_from_row, media_item_from_row_with_offset, normalize_media_path_for_id, AppDatabase,
    LibraryFolderSummaryRecord, LibrarySummaryStatsRecord, LibraryTrackDetailRecord,
    LibraryTrackGroupKind, LibraryTrackGroupSummaryRecord, LibraryTrackGroupsQuery,
    LibraryTrackGroupsRecord, LibraryTrackSummaryRecord, LibraryTrackViewQuery,
    LibraryTrackViewRecord, LibraryTrackViewSortField, LibraryTrackViewSortOrder, MediaItemRecord,
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

fn normalize_query(value: &str) -> String {
    value.trim().to_lowercase()
}

fn track_matches_queries(track: &LibraryTrackSummaryRecord, queries: &[String]) -> bool {
    if queries.is_empty() {
        return true;
    }
    let haystack = [
        track.title.as_deref(),
        track.artist.as_deref(),
        track.album.as_deref(),
        Some(track.file_name.as_str()),
        Some(track.folder_label.as_str()),
    ]
    .into_iter()
    .flatten()
    .filter(|value| !value.is_empty())
    .collect::<Vec<_>>()
    .join("\n")
    .to_lowercase();
    queries.iter().all(|query| haystack.contains(query))
}

fn normalized_folder_path(value: &str) -> String {
    normalize_media_path_for_id(value)
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}

fn track_is_in_folder(track: &LibraryTrackSummaryRecord, folder_path: &str) -> bool {
    let parent = normalized_folder_path(folder_path);
    let child = normalized_folder_path(&track.folder_path);
    child == parent || child.starts_with(&format!("{}/", parent))
}

fn compare_text(left: Option<&str>, right: Option<&str>) -> std::cmp::Ordering {
    left.unwrap_or("")
        .trim()
        .to_lowercase()
        .cmp(&right.unwrap_or("").trim().to_lowercase())
}

fn fallback_group_key(kind: LibraryTrackGroupKind) -> &'static str {
    match kind {
        LibraryTrackGroupKind::Artists => "__unknown_artist",
        LibraryTrackGroupKind::Albums => "__unknown_album",
    }
}

fn split_artist_groups(artist: Option<&str>, fallback_key: &str) -> Vec<(String, Option<String>)> {
    let Some(artist) = artist.map(str::trim).filter(|value| !value.is_empty()) else {
        return vec![(fallback_key.to_string(), None)];
    };
    let groups = artist
        .split(|ch| matches!(ch, '/' | '、' | '，' | ',' | ';' | '&'))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| (value.to_string(), Some(value.to_string())))
        .collect::<Vec<_>>();
    if groups.is_empty() {
        vec![(fallback_key.to_string(), None)]
    } else {
        groups
    }
}

fn track_group_keys(
    track: &LibraryTrackSummaryRecord,
    kind: LibraryTrackGroupKind,
) -> Vec<(String, Option<String>)> {
    let fallback_key = fallback_group_key(kind);
    match kind {
        LibraryTrackGroupKind::Artists => {
            split_artist_groups(track.artist.as_deref(), fallback_key)
        }
        LibraryTrackGroupKind::Albums => {
            let label = track
                .album
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match label {
                Some(value) => vec![(value.to_string(), Some(value.to_string()))],
                None => vec![(fallback_key.to_string(), None)],
            }
        }
    }
}

fn group_summaries_for_tracks(
    tracks: &[LibraryTrackSummaryRecord],
    kind: LibraryTrackGroupKind,
) -> Vec<LibraryTrackGroupSummaryRecord> {
    #[derive(Default)]
    struct GroupAccumulator {
        label: Option<String>,
        count: u64,
        artwork_track_key: Option<i64>,
        has_cover_art: bool,
        external_artwork_url: Option<String>,
    }

    let mut groups = HashMap::<String, GroupAccumulator>::new();
    for track in tracks {
        for (key, label) in track_group_keys(track, kind) {
            let entry = groups.entry(key).or_insert_with(|| GroupAccumulator {
                label: label.clone(),
                ..Default::default()
            });
            if entry.label.is_none() {
                entry.label = label;
            }
            entry.count += 1;
            if entry.artwork_track_key.is_none()
                && (track.has_cover_art || track.external_artwork_url.is_some())
            {
                entry.artwork_track_key = Some(track.track_key);
                entry.has_cover_art = track.has_cover_art;
                entry.external_artwork_url = track.external_artwork_url.clone();
            }
        }
    }

    let mut summaries = groups
        .into_iter()
        .map(|(key, group)| LibraryTrackGroupSummaryRecord {
            key,
            label: group.label,
            count: group.count,
            artwork_track_key: group.artwork_track_key,
            has_cover_art: group.has_cover_art,
            external_artwork_url: group.external_artwork_url,
        })
        .collect::<Vec<_>>();
    summaries.sort_by(|left, right| {
        left.label
            .as_deref()
            .unwrap_or(&left.key)
            .to_lowercase()
            .cmp(&right.label.as_deref().unwrap_or(&right.key).to_lowercase())
    });
    summaries
}

fn track_is_in_group(
    track: &LibraryTrackSummaryRecord,
    kind: LibraryTrackGroupKind,
    group_key: &str,
) -> bool {
    track_group_keys(track, kind)
        .iter()
        .any(|(key, _)| key == group_key)
}

fn sort_tracks_for_view(
    tracks: &mut [LibraryTrackSummaryRecord],
    field: LibraryTrackViewSortField,
    order: LibraryTrackViewSortOrder,
) {
    if field == LibraryTrackViewSortField::Default || order == LibraryTrackViewSortOrder::Default {
        return;
    }
    tracks.sort_by(|left, right| {
        let result = match field {
            LibraryTrackViewSortField::Default => std::cmp::Ordering::Equal,
            LibraryTrackViewSortField::Title => compare_text(
                left.title.as_deref().or(Some(left.file_name.as_str())),
                right.title.as_deref().or(Some(right.file_name.as_str())),
            ),
            LibraryTrackViewSortField::Artist => {
                compare_text(left.artist.as_deref(), right.artist.as_deref())
            }
            LibraryTrackViewSortField::Album => {
                compare_text(left.album.as_deref(), right.album.as_deref())
            }
            LibraryTrackViewSortField::TrackNumber => left
                .track_number
                .unwrap_or(0)
                .cmp(&right.track_number.unwrap_or(0)),
            LibraryTrackViewSortField::Filename => compare_text(
                Some(left.file_name.as_str()),
                Some(right.file_name.as_str()),
            ),
            LibraryTrackViewSortField::Duration => left
                .duration_secs
                .unwrap_or(0.0)
                .total_cmp(&right.duration_secs.unwrap_or(0.0)),
            LibraryTrackViewSortField::Size => left
                .size_bytes
                .unwrap_or(0)
                .cmp(&right.size_bytes.unwrap_or(0)),
            LibraryTrackViewSortField::CreateTime => {
                left.added_at_epoch_secs.cmp(&right.added_at_epoch_secs)
            }
            LibraryTrackViewSortField::UpdatedTime => {
                left.updated_at_epoch_secs.cmp(&right.updated_at_epoch_secs)
            }
        };
        if order == LibraryTrackViewSortOrder::Desc {
            result.reverse()
        } else {
            result
        }
    });
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
             WHERE EXISTS (
                 SELECT 1
                 FROM library_root_memberships
                 WHERE library_root_memberships.media_id = media_items.media_id
             )
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
                 WHERE EXISTS (
                     SELECT 1
                     FROM library_root_memberships
                     WHERE library_root_memberships.media_id = media_items.media_id
                 )
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

    pub fn library_track_view(
        &self,
        query: LibraryTrackViewQuery,
    ) -> Result<LibraryTrackViewRecord, String> {
        let stats = self.library_summary_stats()?;
        let tracks = self.list_library_track_summaries()?;
        let queries = query
            .queries
            .iter()
            .map(|value| normalize_query(value))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();

        let query_filtered = tracks
            .into_iter()
            .filter(|track| track_matches_queries(track, &queries))
            .collect::<Vec<_>>();
        let folders = self.library_folder_summaries_for_tracks(&query_filtered);
        let mut folder_filtered = match query.folder_path.as_deref() {
            Some(folder_path) if !folder_path.trim().is_empty() => query_filtered
                .into_iter()
                .filter(|track| track_is_in_folder(track, folder_path))
                .collect::<Vec<_>>(),
            _ => query_filtered,
        };
        sort_tracks_for_view(&mut folder_filtered, query.sort.field, query.sort.order);

        let total_count = folder_filtered.len() as u64;
        let total_size_bytes = folder_filtered
            .iter()
            .map(|track| track.size_bytes.unwrap_or(0))
            .sum::<u64>();
        let media_ids = query.include_media_ids.then(|| {
            folder_filtered
                .iter()
                .map(|track| track.media_id.clone())
                .collect()
        });
        let rows = match query.range {
            Some(range) => {
                let start = range.start.min(folder_filtered.len());
                let end = range.end.max(start).min(folder_filtered.len());
                folder_filtered[start..end].to_vec()
            }
            None => folder_filtered,
        };

        Ok(LibraryTrackViewRecord {
            revision: stats.revision,
            library_total_count: stats.total_count,
            library_total_size_bytes: stats.total_size_bytes,
            total_count,
            total_size_bytes,
            folders,
            rows,
            media_ids,
        })
    }

    pub fn library_track_groups(
        &self,
        query: LibraryTrackGroupsQuery,
    ) -> Result<LibraryTrackGroupsRecord, String> {
        let stats = self.library_summary_stats()?;
        let tracks = self.list_library_track_summaries()?;
        let queries = query
            .queries
            .iter()
            .map(|value| normalize_query(value))
            .filter(|value| !value.is_empty())
            .collect::<Vec<_>>();

        let query_filtered = tracks
            .into_iter()
            .filter(|track| track_matches_queries(track, &queries))
            .collect::<Vec<_>>();
        let folders = self.library_folder_summaries_for_tracks(&query_filtered);
        let mut folder_filtered = match query.folder_path.as_deref() {
            Some(folder_path) if !folder_path.trim().is_empty() => query_filtered
                .into_iter()
                .filter(|track| track_is_in_folder(track, folder_path))
                .collect::<Vec<_>>(),
            _ => query_filtered,
        };
        sort_tracks_for_view(&mut folder_filtered, query.sort.field, query.sort.order);

        let groups = group_summaries_for_tracks(&folder_filtered, query.kind);
        let selected_group_key = query
            .selected_group_key
            .filter(|key| groups.iter().any(|group| group.key == *key))
            .or_else(|| groups.first().map(|group| group.key.clone()));
        let rows = selected_group_key
            .as_deref()
            .map(|group_key| {
                folder_filtered
                    .iter()
                    .filter(|track| track_is_in_group(track, query.kind, group_key))
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let total_count = folder_filtered.len() as u64;
        let total_size_bytes = folder_filtered
            .iter()
            .map(|track| track.size_bytes.unwrap_or(0))
            .sum::<u64>();

        Ok(LibraryTrackGroupsRecord {
            revision: stats.revision,
            library_total_count: stats.total_count,
            library_total_size_bytes: stats.total_size_bytes,
            total_count,
            total_size_bytes,
            folders,
            groups,
            selected_group_key,
            rows,
        })
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
               AND EXISTS (
                   SELECT 1
                   FROM library_root_memberships
                   WHERE library_root_memberships.media_id = media_items.media_id
               )
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
            r#"
            SELECT media_id
            FROM media_items
            WHERE rowid = ?1
              AND EXISTS (
                  SELECT 1
                  FROM library_root_memberships
                  WHERE library_root_memberships.media_id = media_items.media_id
              )
            LIMIT 1
            "#,
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
                "SELECT media_id, source_path FROM media_items WHERE media_id IN ({}) AND EXISTS (SELECT 1 FROM library_root_memberships WHERE library_root_memberships.media_id = media_items.media_id)",
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
        Ok(self
            .delete_media_items_with_cleanup_report(media_ids)?
            .removed_media_count)
    }

    pub fn delete_media_items_with_cleanup_report(
        &self,
        media_ids: &[String],
    ) -> Result<super::LibraryCleanupReport, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start complete media delete transaction: {}", e))?;
        let targets = resolve_cleanup_targets_for_media_ids_tx(&tx, media_ids)?;
        let report = cleanup_media_targets_tx(&tx, &targets)?;

        tx.commit()
            .map_err(|e| format!("Failed to commit complete media delete transaction: {}", e))?;
        Ok(report)
    }
}
