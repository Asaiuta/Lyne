use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::{HashMap, HashSet};

use crate::webdav::WebDavConfig;

use super::{
    media_id_for_path, now_epoch_secs_i64, AppDatabase, LibraryCleanupReport,
    LibraryRootDeleteRecord, LibraryScanFinalizeRecord, LibraryScanSnapshotRecord,
};

pub(crate) const LIBRARY_ROOT_SCAN_IN_PROGRESS_ERROR: &str =
    "Library root cannot be deleted while a scan is in progress";

#[derive(Clone, Copy, Eq, PartialEq)]
enum LibraryScanFinalizeMode {
    Complete,
    Partial,
}

impl LibraryScanFinalizeMode {
    fn root_status(self) -> &'static str {
        match self {
            Self::Complete => "completed",
            Self::Partial => "partial",
        }
    }
}

#[derive(Debug, Clone)]
pub(super) struct LibraryCleanupTarget {
    pub(super) media_id: String,
    pub(super) source_path: String,
}

struct CleanupIdentities {
    actual_media_ids: HashSet<String>,
    normalized_media_ids: HashSet<String>,
}

impl CleanupIdentities {
    fn new(targets: &[LibraryCleanupTarget]) -> Self {
        let actual_media_ids = targets
            .iter()
            .map(|target| target.media_id.clone())
            .collect::<HashSet<_>>();
        let mut normalized_media_ids = HashSet::with_capacity(targets.len() * 2);
        for target in targets {
            normalized_media_ids.insert(media_id_for_path(&target.media_id));
            normalized_media_ids.insert(media_id_for_path(&target.source_path));
        }
        Self {
            actual_media_ids,
            normalized_media_ids,
        }
    }

    fn matches(&self, media_id: Option<&str>, source_path: Option<&str>) -> bool {
        media_id.is_some_and(|value| {
            self.actual_media_ids.contains(value)
                || self
                    .normalized_media_ids
                    .contains(&media_id_for_path(value))
        }) || source_path.is_some_and(|value| {
            self.normalized_media_ids
                .contains(&media_id_for_path(value))
        })
    }
}

pub(super) fn local_media_belongs_to_root(root_path: &str, source_path: &str) -> bool {
    let root = media_id_for_path(root_path)
        .trim_end_matches('/')
        .to_string();
    let media = media_id_for_path(source_path)
        .trim_end_matches('/')
        .to_string();
    if root.is_empty() || media.is_empty() {
        return false;
    }
    media == root || media.starts_with(&format!("{}/", root))
}

fn webdav_media_belongs_to_root(
    root_path: &str,
    source_base_url: Option<&str>,
    media_url: &str,
) -> bool {
    let root_url = reqwest::Url::parse(root_path).ok().or_else(|| {
        source_base_url.and_then(|base_url| {
            let config = WebDavConfig {
                base_url: base_url.to_string(),
                username: None,
                password: None,
            };
            config
                .resolve_url(root_path)
                .ok()
                .and_then(|url| reqwest::Url::parse(&url).ok())
        })
    });
    let Some(root_url) = root_url else {
        return false;
    };
    let Ok(media_url) = reqwest::Url::parse(media_url) else {
        return false;
    };
    if root_url.scheme() != media_url.scheme()
        || root_url.host_str().map(str::to_ascii_lowercase)
            != media_url.host_str().map(str::to_ascii_lowercase)
        || root_url.port_or_known_default() != media_url.port_or_known_default()
    {
        return false;
    }

    let root_path = root_url.path().trim_end_matches('/');
    let media_path = media_url.path().trim_end_matches('/');
    root_path.is_empty()
        || root_path == "/"
        || media_path == root_path
        || media_path.starts_with(&format!("{}/", root_path))
}

pub(crate) fn backfill_library_root_memberships_and_cleanup_tx(
    conn: &Connection,
    webdav_fallback_base_url: Option<&str>,
) -> Result<LibraryCleanupReport, String> {
    conn.execute("DELETE FROM library_root_memberships", [])
        .map_err(|e| format!("Failed to reset library root membership backfill: {}", e))?;

    let webdav_base_urls = {
        let mut stmt = conn
            .prepare("SELECT source_key, base_url FROM webdav_sources")
            .map_err(|e| format!("Failed to prepare WebDAV source backfill query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query WebDAV source backfill data: {}", e))?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| format!("Failed to decode WebDAV source backfill data: {}", e))?
    };
    let default_webdav_base_url = conn
        .query_row(
            r#"
            SELECT base_url
            FROM webdav_sources
            WHERE is_default = 1
            ORDER BY updated_at DESC, source_key ASC
            LIMIT 1
            "#,
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| format!("Failed to load default WebDAV source for backfill: {}", e))?
        .filter(|value| !value.trim().is_empty());
    let runtime_webdav_fallback = webdav_fallback_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let ncm_media_ids = {
        let mut stmt = conn
            .prepare("SELECT media_id FROM ncm_track_sources")
            .map_err(|e| format!("Failed to prepare NCM membership exclusion query: {}", e))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query NCM membership exclusions: {}", e))?;
        rows.collect::<Result<HashSet<_>, _>>()
            .map_err(|e| format!("Failed to decode NCM membership exclusions: {}", e))?
    };
    let roots = {
        let mut stmt = conn
            .prepare("SELECT root_id, source_key, source_path, source_kind FROM library_roots")
            .map_err(|e| format!("Failed to prepare library root backfill query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query library roots for backfill: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode library roots for backfill: {}", e))?
    };
    let media = load_all_cleanup_targets_with_kind(conn)?;
    let now = now_epoch_secs_i64();

    for (root_id, source_key, root_path, root_kind) in &roots {
        let source_base_url = match source_key.as_ref() {
            Some(key) => webdav_base_urls.get(key).map(String::as_str),
            None => default_webdav_base_url
                .as_deref()
                .or(runtime_webdav_fallback),
        };
        for (target, media_kind) in &media {
            let belongs = match root_kind.as_str() {
                "local" => {
                    media_kind == "local"
                        && local_media_belongs_to_root(root_path, &target.source_path)
                }
                "webdav" => {
                    media_kind == "remote"
                        && !ncm_media_ids.contains(&target.media_id)
                        && webdav_media_belongs_to_root(
                            root_path,
                            source_base_url,
                            &target.source_path,
                        )
                }
                _ => false,
            };
            if belongs {
                conn.execute(
                    r#"
                    INSERT OR IGNORE INTO library_root_memberships
                        (root_id, media_id, created_at, updated_at)
                    VALUES (?1, ?2, ?3, ?3)
                    "#,
                    params![root_id, target.media_id, now],
                )
                .map_err(|e| {
                    format!(
                        "Failed to backfill library membership root={} media='{}': {}",
                        root_id, target.media_id, e
                    )
                })?;
            }
        }
    }

    let local_targets = media
        .into_iter()
        .filter(|(_, kind)| kind == "local")
        .map(|(target, _)| target)
        .collect::<Vec<_>>();
    let orphaned_local = targets_without_memberships(conn, local_targets)?;
    cleanup_media_targets_tx(conn, &orphaned_local)
}

fn load_all_cleanup_targets_with_kind(
    conn: &Connection,
) -> Result<Vec<(LibraryCleanupTarget, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT media_id, source_path, source_kind FROM media_items")
        .map_err(|e| format!("Failed to prepare media membership backfill query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                LibraryCleanupTarget {
                    media_id: row.get(0)?,
                    source_path: row.get(1)?,
                },
                row.get(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query media membership backfill data: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to decode media membership backfill data: {}", e))
}

fn media_has_membership(conn: &Connection, media_id: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM library_root_memberships WHERE media_id = ?1 LIMIT 1",
        params![media_id],
        |_| Ok(()),
    )
    .optional()
    .map(|value| value.is_some())
    .map_err(|e| {
        format!(
            "Failed to inspect library membership for '{}': {}",
            media_id, e
        )
    })
}

fn targets_without_memberships(
    conn: &Connection,
    targets: Vec<LibraryCleanupTarget>,
) -> Result<Vec<LibraryCleanupTarget>, String> {
    let mut orphaned = Vec::new();
    for target in targets {
        if !media_has_membership(conn, &target.media_id)? {
            orphaned.push(target);
        }
    }
    Ok(orphaned)
}

pub(super) fn resolve_cleanup_targets_for_media_ids_tx(
    conn: &Connection,
    media_ids: &[String],
) -> Result<Vec<LibraryCleanupTarget>, String> {
    let requested_actual = media_ids
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .collect::<HashSet<_>>();
    let requested_normalized = requested_actual
        .iter()
        .map(|value| media_id_for_path(value))
        .collect::<HashSet<_>>();
    let all = load_all_cleanup_targets_with_kind(conn)?;
    Ok(all
        .into_iter()
        .map(|(target, _)| target)
        .filter(|target| {
            requested_actual.contains(&target.media_id)
                || requested_normalized.contains(&media_id_for_path(&target.media_id))
                || requested_normalized.contains(&media_id_for_path(&target.source_path))
        })
        .collect())
}

pub(super) fn cleanup_media_targets_tx(
    conn: &Connection,
    targets: &[LibraryCleanupTarget],
) -> Result<LibraryCleanupReport, String> {
    let mut unique_targets = Vec::with_capacity(targets.len());
    let mut seen_targets = HashSet::new();
    for target in targets {
        if seen_targets.insert(target.media_id.clone()) {
            unique_targets.push(target.clone());
        }
    }
    if unique_targets.is_empty() {
        return Ok(LibraryCleanupReport::default());
    }
    let identities = CleanupIdentities::new(&unique_targets);
    let mut report = LibraryCleanupReport {
        removed_runtime_paths: unique_targets
            .iter()
            .map(|target| target.source_path.clone())
            .collect(),
        ..LibraryCleanupReport::default()
    };

    let analysis_tasks = {
        let mut stmt = conn
            .prepare("SELECT task_id, source_path FROM analysis_tasks")
            .map_err(|e| format!("Failed to prepare analysis task cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query analysis tasks for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode analysis tasks for cleanup: {}", e))?
    };
    for (task_id, source_path) in analysis_tasks {
        if identities.matches(None, Some(&source_path)) {
            report.removed_analysis_task_count += conn
                .execute(
                    "DELETE FROM analysis_tasks WHERE task_id = ?1",
                    params![task_id],
                )
                .map_err(|e| format!("Failed to delete analysis task '{}': {}", task_id, e))?
                as u64;
        }
    }

    let sessions = {
        let mut stmt = conn
            .prepare("SELECT session_id, media_id, source_path FROM playback_sessions")
            .map_err(|e| format!("Failed to prepare playback session cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| format!("Failed to query playback sessions for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playback sessions for cleanup: {}", e))?
    };
    let mut session_ids = sessions
        .iter()
        .filter(|(_, media_id, source_path)| {
            identities.matches(media_id.as_deref(), Some(source_path))
        })
        .map(|(session_id, _, _)| *session_id)
        .collect::<HashSet<_>>();
    let histories = {
        let mut stmt = conn
            .prepare("SELECT id, session_id, media_id, source_path FROM playback_history")
            .map_err(|e| format!("Failed to prepare playback history cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query playback history for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playback history for cleanup: {}", e))?
    };
    for (_, session_id, media_id, source_path) in &histories {
        if identities.matches(media_id.as_deref(), Some(source_path)) {
            if let Some(session_id) = session_id {
                session_ids.insert(*session_id);
            }
        }
    }
    for (history_id, session_id, media_id, source_path) in histories {
        if identities.matches(media_id.as_deref(), Some(&source_path))
            || session_id.is_some_and(|value| session_ids.contains(&value))
        {
            report.removed_history_count += conn
                .execute(
                    "DELETE FROM playback_history WHERE id = ?1",
                    params![history_id],
                )
                .map_err(|e| format!("Failed to delete playback history '{}': {}", history_id, e))?
                as u64;
        }
    }
    let mut session_ids = session_ids.into_iter().collect::<Vec<_>>();
    session_ids.sort_unstable();
    for session_id in session_ids {
        let removed = conn
            .execute(
                "DELETE FROM playback_sessions WHERE session_id = ?1",
                params![session_id],
            )
            .map_err(|e| format!("Failed to delete playback session '{}': {}", session_id, e))?
            as u64;
        report.removed_session_count += removed;
        if removed > 0 {
            report.removed_session_ids.push(session_id);
        }
    }

    let queue_rows = {
        let mut stmt = conn
            .prepare("SELECT entry_id, queue_id, media_id, source_path FROM playback_queue_entries")
            .map_err(|e| format!("Failed to prepare queue cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })
            .map_err(|e| format!("Failed to query queue entries for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode queue entries for cleanup: {}", e))?
    };
    let mut affected_queue_ids = HashSet::new();
    for (entry_id, queue_id, media_id, source_path) in queue_rows {
        if identities.matches(media_id.as_deref(), Some(&source_path)) {
            report.removed_queue_entry_count += conn
                .execute(
                    "DELETE FROM playback_queue_entries WHERE entry_id = ?1",
                    params![entry_id],
                )
                .map_err(|e| format!("Failed to delete queue entry '{}': {}", entry_id, e))?
                as u64;
            affected_queue_ids.insert(queue_id);
        }
    }
    for queue_id in affected_queue_ids {
        reindex_queue_entries_in_conn(conn, &queue_id)?;
    }
    let queue_states = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT queue_key, current_track_path, pending_track_path,
                       needs_preload, pending_ready
                FROM playback_queue_state
                "#,
            )
            .map_err(|e| format!("Failed to prepare queue state cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| format!("Failed to query queue state for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode queue state for cleanup: {}", e))?
    };
    for (queue_key, current, pending, needs_preload, pending_ready) in queue_states {
        let clear_current = identities.matches(None, current.as_deref());
        let clear_pending = identities.matches(None, pending.as_deref());
        if clear_current || clear_pending {
            let next_current = if clear_current {
                None
            } else {
                current.as_deref()
            };
            let next_pending = if clear_pending {
                None
            } else {
                pending.as_deref()
            };
            conn.execute(
                r#"
                UPDATE playback_queue_state
                SET current_track_path = ?2,
                    pending_track_path = ?3,
                    needs_preload = ?4,
                    pending_ready = ?5,
                    updated_at = ?6
                WHERE queue_key = ?1
                "#,
                params![
                    queue_key,
                    next_current,
                    next_pending,
                    if clear_current || clear_pending {
                        0
                    } else {
                        needs_preload
                    },
                    if clear_pending { 0 } else { pending_ready },
                    now_epoch_secs_i64(),
                ],
            )
            .map_err(|e| format!("Failed to clear matching queue state: {}", e))?;
            report.cleared_queue_state_count += 1;
        }
    }

    let playlist_items = {
        let mut stmt = conn
            .prepare("SELECT playlist_id, media_id FROM local_playlist_items")
            .map_err(|e| format!("Failed to prepare playlist cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query playlist items for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playlist items for cleanup: {}", e))?
    };
    let mut affected_playlist_ids = HashSet::new();
    for (playlist_id, media_id) in playlist_items {
        if identities.matches(Some(&media_id), None) {
            report.removed_playlist_item_count += conn
                .execute(
                    "DELETE FROM local_playlist_items WHERE playlist_id = ?1 AND media_id = ?2",
                    params![playlist_id, media_id],
                )
                .map_err(|e| format!("Failed to delete local playlist item: {}", e))?
                as u64;
            affected_playlist_ids.insert(playlist_id);
        }
    }
    let playlist_covers = {
        let mut stmt = conn
            .prepare(
                "SELECT playlist_id, cover_media_id FROM local_playlists WHERE cover_media_id IS NOT NULL",
            )
            .map_err(|e| format!("Failed to prepare playlist cover cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query playlist covers for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode playlist covers for cleanup: {}", e))?
    };
    for (playlist_id, media_id) in playlist_covers {
        if identities.matches(Some(&media_id), None) {
            report.cleared_playlist_cover_count += conn
                .execute(
                    "UPDATE local_playlists SET cover_media_id = NULL WHERE playlist_id = ?1",
                    params![playlist_id],
                )
                .map_err(|e| format!("Failed to clear local playlist cover: {}", e))?
                as u64;
            affected_playlist_ids.insert(playlist_id);
        }
    }
    let playlist_updated_at = now_epoch_secs_i64();
    for playlist_id in affected_playlist_ids {
        reindex_local_playlist_items_in_conn(conn, &playlist_id)?;
        conn.execute(
            "UPDATE local_playlists SET updated_at = ?2 WHERE playlist_id = ?1",
            params![playlist_id, playlist_updated_at],
        )
        .map_err(|e| format!("Failed to update cleaned local playlist: {}", e))?;
    }

    let ncm_rows = {
        let mut stmt = conn
            .prepare("SELECT media_id, source_path FROM ncm_track_sources")
            .map_err(|e| format!("Failed to prepare NCM source cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query NCM sources for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode NCM sources for cleanup: {}", e))?
    };
    for (media_id, source_path) in ncm_rows {
        if identities.matches(Some(&media_id), Some(&source_path)) {
            report.removed_ncm_source_count += conn
                .execute(
                    "DELETE FROM ncm_track_sources WHERE media_id = ?1",
                    params![media_id],
                )
                .map_err(|e| format!("Failed to delete NCM source mapping: {}", e))?
                as u64;
        }
    }
    let cover_rows = {
        let mut stmt = conn
            .prepare("SELECT cover_art_id, media_id FROM cover_art_cache")
            .map_err(|e| format!("Failed to prepare cover cache cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query cover cache for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode cover cache for cleanup: {}", e))?
    };
    for (cover_art_id, media_id) in cover_rows {
        if identities.matches(Some(&media_id), None) {
            report.removed_cover_art_count += conn
                .execute(
                    "DELETE FROM cover_art_cache WHERE cover_art_id = ?1",
                    params![cover_art_id],
                )
                .map_err(|e| format!("Failed to delete cover cache entry: {}", e))?
                as u64;
        }
    }

    let membership_rows = {
        let mut stmt = conn
            .prepare("SELECT root_id, media_id FROM library_root_memberships")
            .map_err(|e| format!("Failed to prepare membership cleanup query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| format!("Failed to query memberships for cleanup: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode memberships for cleanup: {}", e))?
    };
    for (root_id, media_id) in membership_rows {
        if identities.matches(Some(&media_id), None) {
            conn.execute(
                "DELETE FROM library_root_memberships WHERE root_id = ?1 AND media_id = ?2",
                params![root_id, media_id],
            )
            .map_err(|e| format!("Failed to delete library membership: {}", e))?;
        }
    }

    for target in unique_targets {
        report.removed_media_count += conn
            .execute(
                "DELETE FROM media_items WHERE media_id = ?1",
                params![target.media_id],
            )
            .map_err(|e| {
                format!(
                    "Failed to delete media item '{}' during complete cleanup: {}",
                    target.media_id, e
                )
            })? as u64;
    }

    Ok(report)
}

fn reindex_queue_entries_in_conn(conn: &Connection, queue_id: &str) -> Result<(), String> {
    let entry_ids = {
        let mut stmt = conn
            .prepare(
                r#"
                SELECT entry_id
                FROM playback_queue_entries
                WHERE queue_id = ?1
                ORDER BY position_index ASC, entry_id ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare queue reindex query: {}", e))?;
        let rows = stmt
            .query_map(params![queue_id], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("Failed to query queue order: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode queue order: {}", e))?
    };
    let now = now_epoch_secs_i64();
    for (index, entry_id) in entry_ids.iter().enumerate() {
        conn.execute(
            "UPDATE playback_queue_entries SET position_index = ?2, updated_at = ?3 WHERE entry_id = ?1",
            params![entry_id, index as i64, now],
        )
        .map_err(|e| format!("Failed to reindex queue entry '{}': {}", entry_id, e))?;
    }
    Ok(())
}

pub(super) fn reindex_local_playlist_items_in_conn(
    conn: &Connection,
    playlist_id: &str,
) -> Result<(), String> {
    let media_ids = {
        let mut stmt = conn
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
        conn.execute(
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

pub(super) fn reconcile_library_membership_identity(
    conn: &Connection,
    old_media_id: &str,
    new_media_id: &str,
) -> Result<(), String> {
    if old_media_id == new_media_id {
        return Ok(());
    }
    conn.execute(
        r#"
        DELETE FROM library_root_memberships
        WHERE media_id = ?1
          AND EXISTS (
              SELECT 1
              FROM library_root_memberships canonical
              WHERE canonical.root_id = library_root_memberships.root_id
                AND canonical.media_id = ?2
          )
        "#,
        params![old_media_id, new_media_id],
    )
    .map_err(|e| format!("Failed to deduplicate library memberships: {}", e))?;
    conn.execute(
        "UPDATE library_root_memberships SET media_id = ?1, updated_at = ?3 WHERE media_id = ?2",
        params![new_media_id, old_media_id, now_epoch_secs_i64()],
    )
    .map_err(|e| format!("Failed to retarget library memberships: {}", e))?;
    Ok(())
}

impl AppDatabase {
    pub fn begin_library_scan_seen_set(&self, scan_task_id: u64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        ensure_library_scan_seen_table(&conn)?;
        conn.execute(
            "DELETE FROM temp.library_scan_seen WHERE task_id = ?1",
            params![scan_task_id as i64],
        )
        .map_err(|e| format!("Failed to reset library scan seen set: {}", e))?;
        Ok(())
    }

    pub fn mark_library_scan_seen_media_ids(
        &self,
        scan_task_id: u64,
        media_ids: &[String],
    ) -> Result<(), String> {
        if media_ids.is_empty() {
            return Ok(());
        }
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        ensure_library_scan_seen_table(&conn)?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start library scan seen transaction: {}", e))?;
        {
            let mut stmt = tx
                .prepare(
                    r#"
                    INSERT OR IGNORE INTO temp.library_scan_seen (task_id, media_id)
                    VALUES (?1, ?2)
                    "#,
                )
                .map_err(|e| format!("Failed to prepare library scan seen insert: {}", e))?;
            for media_id in media_ids {
                stmt.execute(params![scan_task_id as i64, media_id])
                    .map_err(|e| format!("Failed to mark media '{}' seen: {}", media_id, e))?;
            }
        }
        tx.commit()
            .map_err(|e| format!("Failed to commit library scan seen set: {}", e))?;
        Ok(())
    }

    pub fn clear_library_scan_seen_set(&self, scan_task_id: u64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        ensure_library_scan_seen_table(&conn)?;
        conn.execute(
            "DELETE FROM temp.library_scan_seen WHERE task_id = ?1",
            params![scan_task_id as i64],
        )
        .map_err(|e| format!("Failed to clear library scan seen set: {}", e))?;
        Ok(())
    }

    pub fn load_library_scan_snapshot(
        &self,
        root_id: i64,
    ) -> Result<HashMap<String, LibraryScanSnapshotRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT media_items.media_id, media_items.source_path, media_items.mtime,
                       media_items.size_bytes,
                       (
                           SELECT file_path FROM cover_art_cache
                           WHERE cover_art_cache.media_id = media_items.media_id
                             AND file_path IS NOT NULL
                           ORDER BY created_at DESC, cover_art_id DESC
                           LIMIT 1
                       ) AS cover_file_path
                FROM library_root_memberships
                JOIN media_items ON media_items.media_id = library_root_memberships.media_id
                JOIN library_roots ON library_roots.root_id = library_root_memberships.root_id
                WHERE library_root_memberships.root_id = ?1
                  AND (
                      (library_roots.source_kind = 'local' AND media_items.source_kind = 'local')
                      OR (
                          library_roots.source_kind = 'webdav'
                          AND media_items.source_kind = 'remote'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM ncm_track_sources
                              WHERE ncm_track_sources.media_id = media_items.media_id
                          )
                      )
                  )
                "#,
            )
            .map_err(|e| format!("Failed to prepare root scan snapshot query: {}", e))?;
        let rows = stmt
            .query_map(params![root_id], |row| {
                let size = row.get::<_, Option<i64>>(3)?;
                Ok((
                    row.get::<_, String>(1)?,
                    LibraryScanSnapshotRecord {
                        media_id: row.get(0)?,
                        mtime: row.get(2)?,
                        size_bytes: size.map(|value| value as u64),
                        cover_file_path: row.get(4)?,
                    },
                ))
            })
            .map_err(|e| format!("Failed to query root scan snapshot: {}", e))?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(|e| format!("Failed to decode root scan snapshot: {}", e))
    }

    pub fn finalize_library_root_scan(
        &self,
        root_id: i64,
        scan_task_id: u64,
        finished_at: u64,
    ) -> Result<LibraryScanFinalizeRecord, String> {
        self.finalize_library_root_scan_with_mode(
            root_id,
            scan_task_id,
            finished_at,
            LibraryScanFinalizeMode::Complete,
        )
    }

    pub fn finalize_partial_library_root_scan(
        &self,
        root_id: i64,
        scan_task_id: u64,
        finished_at: u64,
    ) -> Result<LibraryScanFinalizeRecord, String> {
        self.finalize_library_root_scan_with_mode(
            root_id,
            scan_task_id,
            finished_at,
            LibraryScanFinalizeMode::Partial,
        )
    }

    fn finalize_library_root_scan_with_mode(
        &self,
        root_id: i64,
        scan_task_id: u64,
        finished_at: u64,
        mode: LibraryScanFinalizeMode,
    ) -> Result<LibraryScanFinalizeRecord, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        ensure_library_scan_seen_table(&conn)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("Failed to start library scan finalize transaction: {}", e))?;
        let root_exists = tx
            .query_row(
                "SELECT 1 FROM library_roots WHERE root_id = ?1",
                params![root_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect library root '{}': {}", root_id, e))?;
        if root_exists.is_none() {
            return Err(format!("Library root '{}' no longer exists", root_id));
        }

        let stale_targets = if mode == LibraryScanFinalizeMode::Complete {
            let mut stmt = tx
                .prepare(
                    r#"
                    SELECT media_items.media_id, media_items.source_path
                    FROM library_root_memberships
                    JOIN media_items ON media_items.media_id = library_root_memberships.media_id
                    WHERE library_root_memberships.root_id = ?1
                      AND NOT EXISTS (
                          SELECT 1
                          FROM temp.library_scan_seen seen
                          WHERE seen.task_id = ?2
                            AND seen.media_id = library_root_memberships.media_id
                      )
                    "#,
                )
                .map_err(|e| format!("Failed to prepare stale membership query: {}", e))?;
            let rows = stmt
                .query_map(params![root_id, scan_task_id as i64], |row| {
                    Ok(LibraryCleanupTarget {
                        media_id: row.get(0)?,
                        source_path: row.get(1)?,
                    })
                })
                .map_err(|e| format!("Failed to query stale memberships: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to decode stale memberships: {}", e))?
        } else {
            Vec::new()
        };
        let now = now_epoch_secs_i64();
        tx.execute(
            r#"
            INSERT INTO library_root_memberships (root_id, media_id, created_at, updated_at)
            SELECT ?1, seen.media_id, ?3, ?3
            FROM temp.library_scan_seen seen
            JOIN media_items ON media_items.media_id = seen.media_id
            JOIN library_roots ON library_roots.root_id = ?1
            WHERE seen.task_id = ?2
              AND (
                  (library_roots.source_kind = 'local' AND media_items.source_kind = 'local')
                  OR (
                      library_roots.source_kind = 'webdav'
                      AND media_items.source_kind = 'remote'
                      AND NOT EXISTS (
                          SELECT 1
                          FROM ncm_track_sources
                          WHERE ncm_track_sources.media_id = media_items.media_id
                      )
                  )
              )
            ON CONFLICT(root_id, media_id) DO UPDATE SET updated_at = excluded.updated_at
            "#,
            params![root_id, scan_task_id as i64, now],
        )
        .map_err(|e| format!("Failed to commit seen library memberships: {}", e))?;
        let cleanup = if mode == LibraryScanFinalizeMode::Complete {
            tx.execute(
                r#"
                DELETE FROM library_root_memberships
                WHERE root_id = ?1
                  AND NOT EXISTS (
                      SELECT 1
                      FROM temp.library_scan_seen seen
                      WHERE seen.task_id = ?2
                        AND seen.media_id = library_root_memberships.media_id
                  )
                "#,
                params![root_id, scan_task_id as i64],
            )
            .map_err(|e| format!("Failed to remove stale library memberships: {}", e))?;
            let orphaned_targets = targets_without_memberships(&tx, stale_targets)?;
            cleanup_media_targets_tx(&tx, &orphaned_targets)?
        } else {
            LibraryCleanupReport::default()
        };
        let track_count = tx
            .query_row(
                "SELECT COUNT(*) FROM library_root_memberships WHERE root_id = ?1",
                params![root_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|e| format!("Failed to count finalized library memberships: {}", e))?
            as u64;
        tx.execute(
            r#"
            UPDATE library_roots
            SET scan_status = ?2,
                track_count = ?3,
                last_scan_finished_at = ?4,
                updated_at = ?5
            WHERE root_id = ?1
            "#,
            params![
                root_id,
                mode.root_status(),
                track_count as i64,
                finished_at as i64,
                now
            ],
        )
        .map_err(|e| format!("Failed to finalize library root scan state: {}", e))?;
        tx.execute(
            "DELETE FROM temp.library_scan_seen WHERE task_id = ?1",
            params![scan_task_id as i64],
        )
        .map_err(|e| format!("Failed to clear finalized library scan seen set: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit library scan finalize transaction: {}", e))?;
        Ok(LibraryScanFinalizeRecord {
            track_count,
            cleanup,
        })
    }

    pub fn delete_library_root(
        &self,
        root_id: i64,
    ) -> Result<Option<LibraryRootDeleteRecord>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| format!("Failed to start library root delete transaction: {}", e))?;
        let root = tx
            .query_row(
                "SELECT source_path, scan_status FROM library_roots WHERE root_id = ?1",
                params![root_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|e| format!("Failed to fetch library root '{}': {}", root_id, e))?;
        let Some((root_path, scan_status)) = root else {
            return Ok(None);
        };
        if scan_status == "scanning" {
            return Err(LIBRARY_ROOT_SCAN_IN_PROGRESS_ERROR.to_string());
        }
        let candidates = {
            let mut stmt = tx
                .prepare(
                    r#"
                    SELECT media_items.media_id, media_items.source_path
                    FROM library_root_memberships
                    JOIN media_items ON media_items.media_id = library_root_memberships.media_id
                    WHERE library_root_memberships.root_id = ?1
                    "#,
                )
                .map_err(|e| format!("Failed to prepare root member cleanup query: {}", e))?;
            let rows = stmt
                .query_map(params![root_id], |row| {
                    Ok(LibraryCleanupTarget {
                        media_id: row.get(0)?,
                        source_path: row.get(1)?,
                    })
                })
                .map_err(|e| format!("Failed to query root members for cleanup: {}", e))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("Failed to decode root members for cleanup: {}", e))?
        };
        tx.execute(
            "DELETE FROM library_roots WHERE root_id = ?1",
            params![root_id],
        )
        .map_err(|e| format!("Failed to delete library root '{}': {}", root_id, e))?;
        let orphaned_targets = targets_without_memberships(&tx, candidates)?;
        let cleanup = cleanup_media_targets_tx(&tx, &orphaned_targets)?;
        tx.commit()
            .map_err(|e| format!("Failed to commit library root deletion: {}", e))?;
        Ok(Some(LibraryRootDeleteRecord { root_path, cleanup }))
    }
}

fn ensure_library_scan_seen_table(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TEMP TABLE IF NOT EXISTS library_scan_seen (
            task_id INTEGER NOT NULL,
            media_id TEXT NOT NULL,
            PRIMARY KEY (task_id, media_id)
        );
        "#,
    )
    .map_err(|e| format!("Failed to prepare library scan seen table: {}", e))
}

#[cfg(test)]
mod tests {
    use super::{local_media_belongs_to_root, webdav_media_belongs_to_root};

    #[test]
    fn local_membership_uses_path_boundaries_and_windows_variants() {
        assert!(local_media_belongs_to_root(
            "D:/Music",
            r"\\?\D:\Music\Album\track.flac"
        ));
        assert!(!local_media_belongs_to_root(
            "D:/Music",
            "D:/Music2/track.flac"
        ));
        assert!(local_media_belongs_to_root(
            r"\\Server\Share\Music",
            "//?/UNC/Server/Share/Music/track.flac"
        ));
    }

    #[test]
    fn webdav_membership_requires_matching_origin_and_path_boundary() {
        assert!(webdav_media_belongs_to_root(
            "/albums",
            Some("https://dav.example.test/dav"),
            "https://dav.example.test/dav/albums/a.flac"
        ));
        assert!(!webdav_media_belongs_to_root(
            "/albums",
            Some("https://dav.example.test/dav"),
            "https://dav.example.test/dav/albums2/a.flac"
        ));
        assert!(!webdav_media_belongs_to_root(
            "/albums",
            Some("https://dav.example.test/dav"),
            "https://other.example.test/dav/albums/a.flac"
        ));
    }
}
