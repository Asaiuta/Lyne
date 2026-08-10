use crate::app_database::{AppDatabase, QueueEntryRecord, StoredWebDavSource};
use crate::player::MediaSourceAccess;
use crate::webdav::normalize_source_key;

use super::validate_path;

pub(super) struct ResolvedMediaSource {
    pub(super) path: String,
    pub(super) source_key: Option<String>,
    pub(super) access: MediaSourceAccess,
}

pub(super) fn resolve_media_source(
    app_db: &AppDatabase,
    raw_path: &str,
    explicit_source_key: Option<&str>,
) -> Result<ResolvedMediaSource, String> {
    if let Some(source_key) = explicit_source_key {
        let source_key = normalize_source_key(source_key)?;
        return resolve_configured_source(app_db, raw_path, &source_key);
    }

    let source_keys = app_db.webdav_source_keys_for_media_path(raw_path)?;
    match source_keys.as_slice() {
        [] => Ok(ResolvedMediaSource {
            path: validate_path(raw_path)?,
            source_key: None,
            access: MediaSourceAccess::public_only(),
        }),
        [source_key] => resolve_configured_source(app_db, raw_path, source_key),
        _ => Err("Media belongs to multiple WebDAV sources; source_key is required".to_string()),
    }
}

pub(super) fn resolve_public_media_source(raw_path: &str) -> Result<ResolvedMediaSource, String> {
    Ok(ResolvedMediaSource {
        path: validate_path(raw_path)?,
        source_key: None,
        access: MediaSourceAccess::public_only(),
    })
}

pub(super) fn resolve_queue_media_source(
    app_db: &AppDatabase,
    entry: &QueueEntryRecord,
) -> Result<ResolvedMediaSource, String> {
    match entry.source_identity.as_str() {
        "public" => resolve_public_media_source(&entry.source_path),
        "webdav" => {
            let source_key = entry.source_key.as_deref().ok_or_else(|| {
                format!(
                    "Queue entry {} lost its configured WebDAV source",
                    entry.entry_id
                )
            })?;
            resolve_media_source(app_db, &entry.source_path, Some(source_key))
        }
        "infer" => resolve_media_source(app_db, &entry.source_path, None),
        other => Err(format!(
            "Queue entry {} has invalid source identity '{}'",
            entry.entry_id, other
        )),
    }
}

fn resolve_configured_source(
    app_db: &AppDatabase,
    raw_path: &str,
    source_key: &str,
) -> Result<ResolvedMediaSource, String> {
    let stored = app_db
        .load_webdav_source_config(source_key)?
        .ok_or_else(|| format!("WebDAV source '{}' does not exist", source_key))?;
    configured_source_access(raw_path, stored)
}

fn configured_source_access(
    raw_path: &str,
    stored: StoredWebDavSource,
) -> Result<ResolvedMediaSource, String> {
    let path = stored
        .config
        .normalize_media_url(raw_path)
        .map_err(|error| {
            format!(
                "Media URL is not owned by source '{}': {}",
                stored.source_key, error
            )
        })?;
    let origin = stored
        .config
        .normalized_origin()
        .map_err(|error| format!("Invalid WebDAV source '{}': {}", stored.source_key, error))?;
    let access = MediaSourceAccess::trusted_origin(
        &origin,
        stored.config.http_credentials(),
        &stored.source_key,
    )?;
    Ok(ResolvedMediaSource {
        path,
        source_key: Some(stored.source_key),
        access,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_database::QueueEntryInput;
    use crate::webdav::WebDavConfig;

    fn add_webdav_membership(
        db: &AppDatabase,
        source_key: &str,
        base_url: &str,
        root_path: &str,
        media_url: &str,
        scan_task_id: u64,
    ) {
        db.upsert_webdav_source(
            source_key,
            source_key,
            &WebDavConfig {
                base_url: base_url.to_string(),
                username: Some(source_key.to_string()),
                password: Some(format!("{source_key}-secret")),
            },
            false,
        )
        .unwrap();
        let root_id = db
            .upsert_library_root(
                Some(source_key),
                root_path,
                "webdav",
                source_key,
                "completed",
            )
            .unwrap();
        let media_id = db.record_media_stub(media_url).unwrap();
        db.begin_library_scan_seen_set(scan_task_id).unwrap();
        db.mark_library_scan_seen_media_ids(scan_task_id, &[media_id])
            .unwrap();
        db.finalize_library_root_scan(root_id, scan_task_id, scan_task_id)
            .unwrap();
    }

    #[test]
    fn explicit_source_binds_credentials_to_its_collection() {
        let db = AppDatabase::in_memory().unwrap();
        db.upsert_webdav_source(
            "nas",
            "NAS",
            &WebDavConfig {
                base_url: "http://127.0.0.1:8123/dav/music".to_string(),
                username: Some("alice".to_string()),
                password: Some("secret".to_string()),
            },
            true,
        )
        .unwrap();

        let resolved = resolve_media_source(
            &db,
            "http://127.0.0.1:8123/dav/music/album/song.flac",
            Some("nas"),
        )
        .unwrap();
        assert_eq!(resolved.source_key.as_deref(), Some("nas"));
        assert!(resolved.access.has_credentials());

        assert!(resolve_media_source(
            &db,
            "http://127.0.0.1:8123/dav/music-archive/song.flac",
            Some("nas"),
        )
        .is_err());
        assert!(resolve_media_source(
            &db,
            "http://127.0.0.1:8124/dav/music/song.flac",
            Some("nas"),
        )
        .is_err());
    }

    #[test]
    fn public_url_never_inherits_configured_credentials() {
        let db = AppDatabase::in_memory().unwrap();
        db.upsert_webdav_source(
            "nas",
            "NAS",
            &WebDavConfig {
                base_url: "https://nas.example.test/dav".to_string(),
                username: Some("alice".to_string()),
                password: Some("secret".to_string()),
            },
            true,
        )
        .unwrap();

        let resolved = resolve_media_source(&db, "https://example.com/song.flac", None).unwrap();
        assert!(resolved.source_key.is_none());
        assert!(!resolved.access.has_credentials());
    }

    #[test]
    fn unique_library_membership_recovers_configured_access() {
        let db = AppDatabase::in_memory().unwrap();
        let media_url = "http://127.0.0.1:8123/dav/music/album/song.flac";
        add_webdav_membership(
            &db,
            "nas",
            "http://127.0.0.1:8123/dav/music",
            "/nas",
            media_url,
            1,
        );

        let resolved = resolve_media_source(&db, media_url, None).unwrap();

        assert_eq!(resolved.source_key.as_deref(), Some("nas"));
        assert!(resolved.access.has_credentials());
    }

    #[test]
    fn ambiguous_library_memberships_require_explicit_source_identity() {
        let db = AppDatabase::in_memory().unwrap();
        let media_url = "https://shared.example.test/dav/music/song.flac";
        add_webdav_membership(
            &db,
            "first",
            "https://shared.example.test/dav/music",
            "/first",
            media_url,
            1,
        );
        add_webdav_membership(
            &db,
            "second",
            "https://shared.example.test/dav/music",
            "/second",
            media_url,
            2,
        );

        let error = resolve_media_source(&db, media_url, None)
            .err()
            .expect("ambiguous membership must fail closed");

        assert!(error.contains("multiple WebDAV sources"));
        let explicit = resolve_media_source(&db, media_url, Some("second")).unwrap();
        assert_eq!(explicit.source_key.as_deref(), Some("second"));
    }

    #[test]
    fn ncm_mapping_excludes_webdav_membership_from_credential_resolution() {
        let db = AppDatabase::in_memory().unwrap();
        let media_url = "https://media.example.test/dav/music/song.flac";
        add_webdav_membership(
            &db,
            "nas",
            "https://media.example.test/dav/music",
            "/nas",
            media_url,
            1,
        );
        db.record_ncm_track_source(media_url, 42, None).unwrap();

        let resolved = resolve_media_source(&db, media_url, None).unwrap();

        assert!(resolved.source_key.is_none());
        assert!(!resolved.access.has_credentials());
    }

    #[test]
    fn explicit_public_resolution_ignores_webdav_membership() {
        let db = AppDatabase::in_memory().unwrap();
        let media_url = "https://media.example.test/dav/music/song.flac";
        add_webdav_membership(
            &db,
            "nas",
            "https://media.example.test/dav/music",
            "/nas",
            media_url,
            1,
        );

        let resolved = resolve_public_media_source(media_url).unwrap();

        assert!(resolved.source_key.is_none());
        assert!(!resolved.access.has_credentials());

        db.append_queue_entry_with_source("active", &QueueEntryInput::public(media_url))
            .unwrap();
        let entry = db.list_queue_entries("active").unwrap().remove(0);
        assert_eq!(entry.source_identity, "public");
        let queued = resolve_queue_media_source(&db, &entry).unwrap();
        assert!(queued.source_key.is_none());
        assert!(!queued.access.has_credentials());
    }

    #[test]
    fn duplicate_url_queue_entries_resolve_their_persisted_source_credentials() {
        let db = AppDatabase::in_memory().unwrap();
        let shared_url = "https://shared.example.test/dav/music/song.flac";
        for source_key in ["first", "second"] {
            db.upsert_webdav_source(
                source_key,
                source_key,
                &WebDavConfig {
                    base_url: "https://shared.example.test/dav/music".to_string(),
                    username: Some(format!("{source_key}-user")),
                    password: Some(format!("{source_key}-secret")),
                },
                source_key == "first",
            )
            .unwrap();
        }
        db.replace_queue_entries_with_sources(
            "active",
            &[
                QueueEntryInput::with_source_key(shared_url, "first"),
                QueueEntryInput::with_source_key(shared_url, "second"),
            ],
        )
        .unwrap();

        let entries = db.list_queue_entries("active").unwrap();
        let first = resolve_queue_media_source(&db, &entries[0]).unwrap();
        let second = resolve_queue_media_source(&db, &entries[1]).unwrap();
        assert_eq!(
            first
                .access
                .credentials()
                .map(|credentials| &credentials.username),
            Some(&"first-user".to_string())
        );
        assert_eq!(
            second
                .access
                .credentials()
                .map(|credentials| &credentials.username),
            Some(&"second-user".to_string())
        );
    }
}
