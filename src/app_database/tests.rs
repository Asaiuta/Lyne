use super::*;
use crate::decoder::TrackMetadata;
use crate::webdav::WebDavConfig;
use std::fs;

#[test]
fn persists_webdav_and_history() {
    let db = AppDatabase::in_memory().unwrap();

    let cfg = WebDavConfig {
        base_url: "https://example.test/music".to_string(),
        username: Some("alice".to_string()),
        password: Some("secret".to_string()),
    };
    db.save_primary_webdav_source(&cfg).unwrap();
    let loaded = db.load_primary_webdav_source().unwrap().unwrap();
    assert_eq!(loaded.base_url, cfg.base_url);
    assert_eq!(loaded.username, cfg.username);
    assert_eq!(loaded.password, cfg.password);
    let sources = db.list_webdav_sources().unwrap();
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].source_key, "primary");
    assert!(sources[0].is_default);
    assert_eq!(sources[0].base_url, cfg.base_url);

    let snapshot = PlaybackRuntimeSnapshot {
        position_secs: Some(1.5),
        duration_secs: Some(180.0),
        volume: Some(0.7),
        device_id: Some(1),
        exclusive_mode: true,
    };
    let session_id = db
        .start_playback_session("D:/music/test.flac", "loading", &snapshot)
        .unwrap();
    db.append_playback_history(
        Some(session_id),
        "D:/music/test.flac",
        "load_requested",
        Some(1.5),
        Some(&serde_json::json!({ "source": "test" })),
    )
    .unwrap();

    let history = db.recent_playback_history(10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].event_type, "load_requested");
}

#[test]
fn persists_ncm_accounts_without_serializing_cookie() {
    let db = AppDatabase::in_memory().unwrap();
    let record = db
        .upsert_ncm_account(&NcmAccountUpsert {
            user_id: 42,
            nickname: Some("Ada".to_string()),
            avatar_url: Some("https://example.test/a.jpg".to_string()),
            cookie: "MUSIC_U=secret".to_string(),
            vip_type: Some(11),
            level: Some(8),
            signin_at_ms: None,
        })
        .unwrap();

    assert!(record.has_cookie);
    assert_eq!(record.cookie, "MUSIC_U=secret");
    assert_eq!(
        db.active_ncm_cookie().unwrap().as_deref(),
        Some("MUSIC_U=secret")
    );

    let json = serde_json::to_value(&record).unwrap();
    assert_eq!(json.get("has_cookie").and_then(|v| v.as_bool()), Some(true));
    assert!(json.get("cookie").is_none());
}

#[test]
fn deleting_active_ncm_account_clears_active_state() {
    let db = AppDatabase::in_memory().unwrap();
    db.upsert_ncm_account(&NcmAccountUpsert {
        user_id: 7,
        nickname: None,
        avatar_url: None,
        cookie: "MUSIC_U=gone".to_string(),
        vip_type: None,
        level: None,
        signin_at_ms: None,
    })
    .unwrap();

    db.delete_ncm_account(7).unwrap();

    assert!(db.active_ncm_cookie().unwrap().is_none());
    let (accounts, active_user_id) = db.list_ncm_accounts().unwrap();
    assert!(accounts.is_empty());
    assert_eq!(active_user_id, None);
}

#[test]
fn persists_ncm_track_source_and_scrobble_marker() {
    let db = AppDatabase::in_memory().unwrap();
    let source_path = "https://stream.example.test/song.mp3";

    let record = db
        .record_ncm_track_source(source_path, 42, Some("https://music.163.com/#/song?id=42"))
        .unwrap();

    assert_eq!(record.song_id, 42);
    assert_eq!(record.source_path, source_path);
    assert_eq!(
        db.ncm_track_source_for_path(source_path).unwrap().unwrap(),
        record
    );

    db.mark_ncm_track_scrobbled(source_path, 37).unwrap();
    let updated = db.ncm_track_source_for_path(source_path).unwrap().unwrap();
    assert_eq!(updated.scrobble_secs, Some(37));
    assert!(updated.scrobbled_at_epoch_secs.is_some());
}

#[test]
fn playback_history_includes_media_metadata() {
    let db = AppDatabase::in_memory().unwrap();
    let path = "https://music.example.test/song.mp3";
    db.record_external_media_metadata(
        path,
        Some("Online Song"),
        Some("Online Artist"),
        Some("Online Album"),
        Some(213.5),
        Some("https://img.example.test/song.jpg"),
    )
    .unwrap();
    db.append_playback_history(None, path, "play", Some(0.0), None)
        .unwrap();

    let history = db.recent_playback_history(10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].title.as_deref(), Some("Online Song"));
    assert_eq!(history[0].artist.as_deref(), Some("Online Artist"));
    assert_eq!(history[0].album.as_deref(), Some("Online Album"));
    assert_eq!(history[0].duration_secs, Some(213.5));
    assert_eq!(
        history[0].external_artwork_url.as_deref(),
        Some("https://img.example.test/song.jpg")
    );
}

#[test]
fn playback_history_includes_ncm_track_identity() {
    let db = AppDatabase::in_memory().unwrap();
    let path = "https://m701.music.126.net/song.mp3";
    db.record_external_media_metadata(
        path,
        Some("NCM Song"),
        Some("NCM Artist"),
        Some("NCM Album"),
        Some(187.0),
        Some("https://p1.music.126.net/cover.jpg"),
    )
    .unwrap();
    db.record_ncm_track_source(path, 12345, Some("https://music.163.com/#/song?id=12345"))
        .unwrap();
    db.append_playback_history(None, path, "play", Some(0.0), None)
        .unwrap();

    let history = db.recent_playback_history(10).unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].ncm_song_id, Some(12345));
    assert_eq!(
        history[0].ncm_source_page_url.as_deref(),
        Some("https://music.163.com/#/song?id=12345")
    );
    assert_eq!(
        history[0].external_artwork_url.as_deref(),
        Some("https://p1.music.126.net/cover.jpg")
    );
}

#[test]
fn empty_stream_metadata_does_not_clear_external_metadata() {
    let db = AppDatabase::in_memory().unwrap();
    let path = "https://music.example.test/transient-stream.mp3";
    db.record_external_media_metadata(
        path,
        Some("Online Song"),
        Some("Online Artist"),
        Some("Online Album"),
        Some(213.5),
        Some("https://img.example.test/song.jpg"),
    )
    .unwrap();

    db.record_media_metadata(
        path,
        &TrackMetadata::default(),
        Some(214.0),
        Some(44100),
        Some(2),
    )
    .unwrap();

    let item = db.media_metadata_for_path(path).unwrap().unwrap();
    assert_eq!(item.title.as_deref(), Some("Online Song"));
    assert_eq!(item.artist.as_deref(), Some("Online Artist"));
    assert_eq!(item.album.as_deref(), Some("Online Album"));
    assert_eq!(item.duration_secs, Some(214.0));
    assert_eq!(
        item.external_artwork_url.as_deref(),
        Some("https://img.example.test/song.jpg")
    );
}

#[test]
fn media_item_queries_do_not_stat_files_when_size_is_missing() {
    let db = AppDatabase::in_memory().unwrap();
    let file_path = std::env::temp_dir().join(format!(
        "audio_engine_missing_size_{}_{}.flac",
        std::process::id(),
        now_epoch_secs_i64()
    ));
    fs::write(&file_path, [1_u8, 2, 3, 4]).unwrap();
    let source_path = file_path.to_string_lossy().to_string();

    db.record_media_stub(&source_path).unwrap();

    let item = db.media_metadata_for_path(&source_path).unwrap().unwrap();
    assert_eq!(item.size_bytes, None);

    let list_item = db
        .list_media_items()
        .unwrap()
        .into_iter()
        .find(|item| item.source_path == source_path)
        .unwrap();
    assert_eq!(list_item.size_bytes, None);

    let summary = db
        .list_library_track_summaries()
        .unwrap()
        .into_iter()
        .find(|track| track.media_id == item.media_id)
        .unwrap();
    assert_eq!(summary.size_bytes, None);

    let _ = fs::remove_file(file_path);
}

#[test]
fn record_media_stub_normalizes_legacy_media_id_for_existing_source_path() {
    let db = AppDatabase::in_memory().unwrap();
    let path = "https://Music.Example.test/Stream.mp3";
    let canonical_media_id = media_id_for_path(path);
    let legacy_media_id = "https://music.example.test/stream.mp3?legacy";
    let now = now_epoch_secs_i64();

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            r#"
                INSERT INTO media_items
                    (media_id, source_path, source_kind, title, artist, added_at, updated_at)
                VALUES (?1, ?2, 'remote', 'Legacy Title', 'Legacy Artist', ?3, ?3)
                "#,
            params![legacy_media_id, path, now],
        )
        .unwrap();
        conn.execute(
            r#"
                INSERT INTO playback_queue_entries
                    (queue_id, position_index, source_path, media_id, status, added_at, updated_at)
                VALUES ('active', 0, ?1, ?2, 'queued', ?3, ?3)
                "#,
            params![path, legacy_media_id, now],
        )
        .unwrap();
        conn.execute(
            r#"
                INSERT INTO playback_sessions
                    (media_id, source_path, status, started_at, updated_at, exclusive_mode)
                VALUES (?1, ?2, 'loaded', ?3, ?3, 0)
                "#,
            params![legacy_media_id, path, now],
        )
        .unwrap();
        conn.execute(
            r#"
                INSERT INTO playback_history
                    (media_id, source_path, event_type, event_at)
                VALUES (?1, ?2, 'load_requested', ?3)
                "#,
            params![legacy_media_id, path, now],
        )
        .unwrap();
    }

    let recorded_media_id = db.record_media_stub(path).unwrap();

    assert_eq!(recorded_media_id, canonical_media_id);
    let item = db.media_metadata_for_path(path).unwrap().unwrap();
    assert_eq!(item.media_id, canonical_media_id);
    assert_eq!(item.source_path, path);
    assert_eq!(item.title.as_deref(), Some("Legacy Title"));
    assert_eq!(item.artist.as_deref(), Some("Legacy Artist"));

    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue[0].media_id, Some(canonical_media_id.clone()));
    assert_eq!(queue[0].title.as_deref(), Some("Legacy Title"));

    let conn = db.conn.lock().unwrap();
    let legacy_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM media_items WHERE media_id = ?1",
            params![legacy_media_id],
            |row| row.get(0),
        )
        .unwrap();
    let session_media_id: Option<String> = conn
        .query_row(
            "SELECT media_id FROM playback_sessions WHERE source_path = ?1",
            params![path],
            |row| row.get(0),
        )
        .unwrap();
    let history_media_id: Option<String> = conn
        .query_row(
            "SELECT media_id FROM playback_history WHERE source_path = ?1",
            params![path],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(legacy_count, 0);
    assert_eq!(
        session_media_id.as_deref(),
        Some(canonical_media_id.as_str())
    );
    assert_eq!(
        history_media_id.as_deref(),
        Some(canonical_media_id.as_str())
    );
}

#[test]
fn record_media_stub_merges_duplicate_legacy_and_canonical_rows() {
    let db = AppDatabase::in_memory().unwrap();
    let canonical_path = "https://music.example.test/stream.mp3";
    let legacy_path = "https://MUSIC.example.test/stream.mp3";
    let canonical_media_id = media_id_for_path(canonical_path);
    let legacy_media_id = "legacy-media-id";
    let now = now_epoch_secs_i64();

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            r#"
                INSERT INTO media_items
                    (media_id, source_path, source_kind, added_at, updated_at)
                VALUES (?1, ?2, 'remote', ?3, ?3)
                "#,
            params![canonical_media_id, canonical_path, now],
        )
        .unwrap();
        conn.execute(
                r#"
                INSERT INTO media_items
                    (media_id, source_path, source_kind, title, external_artwork_url, added_at, updated_at)
                VALUES (?1, ?2, 'remote', 'Legacy Metadata', 'https://img.example.test/cover.jpg', ?3, ?3)
                "#,
                params![legacy_media_id, legacy_path, now],
            )
            .unwrap();
        conn.execute(
            r#"
                INSERT INTO ncm_track_sources
                    (media_id, source_path, song_id, resolved_at)
                VALUES (?1, ?2, 42, ?3)
                "#,
            params![legacy_media_id, legacy_path, now],
        )
        .unwrap();
    }

    let recorded_media_id = db.record_media_stub(legacy_path).unwrap();

    assert_eq!(recorded_media_id, canonical_media_id);
    let item = db.media_metadata_for_path(legacy_path).unwrap().unwrap();
    assert_eq!(item.media_id, canonical_media_id);
    assert_eq!(item.source_path, legacy_path);
    assert_eq!(item.title.as_deref(), Some("Legacy Metadata"));
    assert_eq!(
        item.external_artwork_url.as_deref(),
        Some("https://img.example.test/cover.jpg")
    );

    let track_source = db.ncm_track_source_for_path(legacy_path).unwrap().unwrap();
    assert_eq!(track_source.media_id, canonical_media_id);
    assert_eq!(track_source.song_id, 42);

    let conn = db.conn.lock().unwrap();
    let row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM media_items WHERE media_id IN (?1, ?2)",
            params![canonical_media_id, legacy_media_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(row_count, 1);
}

#[test]
fn list_queue_entries_includes_media_display_metadata() {
    let db = AppDatabase::in_memory().unwrap();
    let path = "https://music.example.test/queued-stream.mp3";
    db.record_external_media_metadata(
        path,
        Some("Queued Song"),
        Some("Queued Artist"),
        Some("Queued Album"),
        Some(199.5),
        Some("https://img.example.test/queued.jpg"),
    )
    .unwrap();
    db.append_queue_entry("active", path).unwrap();

    let queue = db.list_queue_entries("active").unwrap();

    assert_eq!(queue.len(), 1);
    assert_eq!(queue[0].title.as_deref(), Some("Queued Song"));
    assert_eq!(queue[0].artist.as_deref(), Some("Queued Artist"));
    assert_eq!(queue[0].album.as_deref(), Some("Queued Album"));
    assert_eq!(queue[0].duration_secs, Some(199.5));
    assert_eq!(
        queue[0].external_artwork_url.as_deref(),
        Some("https://img.example.test/queued.jpg")
    );
}

#[test]
fn manages_multiple_webdav_sources_and_default_switching() {
    let db = AppDatabase::in_memory().unwrap();

    let primary = WebDavConfig {
        base_url: "https://example.test/primary".to_string(),
        username: Some("alice".to_string()),
        password: Some("secret-a".to_string()),
    };
    let archive = WebDavConfig {
        base_url: "https://example.test/archive".to_string(),
        username: Some("bob".to_string()),
        password: Some("secret-b".to_string()),
    };

    db.upsert_webdav_source("primary", "Primary", &primary, true)
        .unwrap();
    db.upsert_webdav_source("archive", "Archive", &archive, false)
        .unwrap();

    let loaded = db.load_primary_webdav_source().unwrap().unwrap();
    assert_eq!(loaded.base_url, primary.base_url);

    let sources = db.list_webdav_sources().unwrap();
    assert_eq!(sources.len(), 2);
    assert_eq!(sources[0].source_key, "primary");
    assert!(sources[0].is_default);
    assert_eq!(sources[1].source_key, "archive");
    assert!(!sources[1].is_default);

    let archive_loaded = db
        .load_webdav_source_config("archive")
        .unwrap()
        .expect("archive source");
    assert_eq!(archive_loaded.display_name, "Archive");
    assert_eq!(archive_loaded.config.base_url, archive.base_url);

    let new_default = db
        .set_default_webdav_source("archive")
        .unwrap()
        .expect("archive default config");
    assert_eq!(new_default.base_url, archive.base_url);
    let loaded = db.load_primary_webdav_source().unwrap().unwrap();
    assert_eq!(loaded.base_url, archive.base_url);

    let fallback = db
        .delete_webdav_source("archive")
        .unwrap()
        .expect("fallback config");
    assert_eq!(fallback.base_url, primary.base_url);
    let loaded = db.load_primary_webdav_source().unwrap().unwrap();
    assert_eq!(loaded.base_url, primary.base_url);

    let deleted_non_default = db.delete_webdav_source("primary").unwrap();
    assert!(deleted_non_default.is_some());
    assert!(db.load_primary_webdav_source().unwrap().is_none());
}

#[test]
fn persists_analysis_tasks() {
    let db = AppDatabase::in_memory().unwrap();
    let result = serde_json::json!({ "integrated_lufs": -14.2 });

    db.upsert_analysis_task(
        42,
        "scan_loudness",
        "D:/music/test.flac",
        "success",
        true,
        100,
        101,
        Some(&result),
        None,
    )
    .unwrap();

    let stored = db.get_analysis_task(42).unwrap().unwrap();
    assert_eq!(stored.task_id, 42);
    assert_eq!(stored.status, "success");
    assert_eq!(stored.result.unwrap()["integrated_lufs"], -14.2);

    db.upsert_analysis_task(
        43,
        "library_scan",
        "/library",
        "success",
        true,
        102,
        103,
        Some(&serde_json::json!({ "indexed_files": 3 })),
        None,
    )
    .unwrap();
    let only_library_scans = db
        .recent_analysis_tasks_by_type(Some("library_scan"), 10)
        .unwrap();
    assert_eq!(only_library_scans.len(), 1);
    assert_eq!(only_library_scans[0].task_id, 43);
}

#[test]
fn persists_library_roots_and_queue_entries() {
    let db = AppDatabase::in_memory().unwrap();

    let root_id = db
        .upsert_library_root(None, "D:/music", "local", "Music", "idle")
        .unwrap();
    db.update_library_root_scan_status(root_id, "completed", Some(12), Some(10), Some(20))
        .unwrap();

    let remote_root_id = db
        .upsert_library_root(Some("archive"), "/library", "webdav", "Archive", "idle")
        .unwrap();
    db.update_library_root_scan_status(remote_root_id, "scanning", None, Some(30), None)
        .unwrap();

    let roots = db.list_library_roots().unwrap();
    assert_eq!(roots.len(), 2);
    let local_root = roots
        .iter()
        .find(|root| root.source_kind == "local")
        .unwrap();
    assert_eq!(local_root.track_count, 12);
    assert_eq!(local_root.scan_status, "completed");
    assert!(local_root.source_key.is_none());
    let remote_root = roots
        .iter()
        .find(|root| root.source_kind == "webdav")
        .unwrap();
    assert_eq!(remote_root.source_key.as_deref(), Some("archive"));
    assert_eq!(remote_root.source_path, "/library");
    assert_eq!(remote_root.scan_status, "scanning");

    let metadata = TrackMetadata {
        title: Some("Track A".to_string()),
        cover_art: Some(vec![1, 2, 3, 4]),
        cover_art_mime: Some("image/png".to_string()),
        ..TrackMetadata::default()
    };
    let media_id = db
        .record_media_metadata(
            "D:/music/a.flac",
            &metadata,
            Some(180.0),
            Some(44100),
            Some(2),
        )
        .unwrap();
    let cover = db
        .get_cover_art_for_media(&media_id)
        .unwrap()
        .expect("cover art record");
    assert_eq!(cover.0.media_id, media_id);
    assert_eq!(cover.0.mime_type.as_deref(), Some("image/png"));
    assert_eq!(cover.1, vec![1, 2, 3, 4]);
    assert_eq!(
        db.source_path_for_media_id(&media_id).unwrap().as_deref(),
        Some("D:/music/a.flac")
    );

    db.append_queue_entry("active", "D:/music/a.flac").unwrap();
    db.append_queue_entry("active", "D:/music/b.flac").unwrap();
    db.append_queue_entries(
        "active",
        &["D:/music/c.flac".to_string(), "D:/music/d.flac".to_string()],
    )
    .unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue.len(), 4);
    assert_eq!(queue[0].position_index, 0);
    assert_eq!(queue[1].position_index, 1);
    assert_eq!(queue[2].position_index, 2);
    assert_eq!(queue[3].position_index, 3);

    db.remove_queue_entry("active", queue[0].entry_id).unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue.len(), 3);
    assert_eq!(queue[0].position_index, 0);
    assert_eq!(queue[1].position_index, 1);
    assert_eq!(queue[2].position_index, 2);

    db.clear_queue("active").unwrap();
    assert!(db.list_queue_entries("active").unwrap().is_empty());
}

#[test]
fn migrations_create_schema_version_and_expected_columns() {
    let db = AppDatabase::in_memory().unwrap();

    assert!(db.has_column("library_roots", "source_key").unwrap());
    assert!(db
        .has_column("playback_queue_entries", "shuffle_index")
        .unwrap());
    assert!(db.has_column("ncm_track_sources", "song_id").unwrap());
    assert!(db.has_column("ncm_track_sources", "scrobble_secs").unwrap());
    assert!(db.has_column("local_playlists", "playlist_id").unwrap());
    assert!(db
        .has_column("local_playlist_items", "position_index")
        .unwrap());
    assert!(db.has_column("media_items", "bitrate_bps").unwrap());
    assert!(db.has_column("media_items", "bits_per_sample").unwrap());

    let conn = db.conn.lock().unwrap();
    let versions = conn
        .prepare("SELECT version FROM schema_version ORDER BY version ASC")
        .unwrap()
        .query_map([], |row| row.get::<_, i64>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    let index_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_playback_queue_entries_status_position'",
                [],
                |row| row.get(0),
            )
            .unwrap();
    assert_eq!(index_count, 1);
}

#[test]
fn local_playlists_prepend_remove_and_cascade_deleted_media() {
    let db = AppDatabase::in_memory().unwrap();
    let media_a = db.record_media_stub("D:/music/a.flac").unwrap();
    let media_b = db.record_media_stub("D:/music/b.flac").unwrap();
    let media_c = db.record_media_stub("D:/music/c.flac").unwrap();
    let playlist = db.create_local_playlist("Road", Some("drive")).unwrap();

    assert_eq!(
        db.add_media_to_local_playlist(&playlist.playlist_id, &[media_a.clone(), media_b.clone()])
            .unwrap(),
        2
    );
    assert_eq!(
        db.add_media_to_local_playlist(&playlist.playlist_id, &[media_c.clone()])
            .unwrap(),
        1
    );
    let detail = db
        .get_local_playlist(&playlist.playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        detail
            .items
            .iter()
            .map(|item| item.media_id.as_str())
            .collect::<Vec<_>>(),
        vec![media_c.as_str(), media_a.as_str(), media_b.as_str()]
    );
    assert_eq!(detail.playlist.track_count, 3);

    assert_eq!(
        db.remove_media_from_local_playlist(&playlist.playlist_id, &[media_a.clone()])
            .unwrap(),
        1
    );
    let detail = db
        .get_local_playlist(&playlist.playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        detail
            .items
            .iter()
            .map(|item| item.media_id.as_str())
            .collect::<Vec<_>>(),
        vec![media_c.as_str(), media_b.as_str()]
    );

    assert_eq!(db.delete_media_items(&[media_c.clone()]).unwrap(), 1);
    let detail = db
        .get_local_playlist(&playlist.playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        detail
            .items
            .iter()
            .map(|item| item.media_id.as_str())
            .collect::<Vec<_>>(),
        vec![media_b.as_str()]
    );
    assert_eq!(detail.playlist.track_count, 1);
}

#[test]
fn deleting_library_root_removes_local_media_and_playlist_refs() {
    let db = AppDatabase::in_memory().unwrap();
    let root_id = db
        .upsert_library_root(None, "D:/music", "local", "Music", "completed")
        .unwrap();
    let media_a = db.record_media_stub("D:/music/a.flac").unwrap();
    let media_b = db.record_media_stub("D:/music/nested/b.flac").unwrap();
    let outside_media = db.record_media_stub("D:/other/c.flac").unwrap();
    let playlist = db.create_local_playlist("Road", None).unwrap();

    db.add_media_to_local_playlist(
        &playlist.playlist_id,
        &[media_a.clone(), media_b.clone(), outside_media.clone()],
    )
    .unwrap();

    let deleted = db.delete_library_root(root_id).unwrap();

    assert_eq!(deleted, Some(("D:/music".to_string(), 2)));
    assert!(db.source_path_for_media_id(&media_a).unwrap().is_none());
    assert!(db.source_path_for_media_id(&media_b).unwrap().is_none());
    assert_eq!(
        db.source_path_for_media_id(&outside_media)
            .unwrap()
            .as_deref(),
        Some("D:/other/c.flac")
    );
    assert!(db.list_library_roots().unwrap().is_empty());

    let detail = db
        .get_local_playlist(&playlist.playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(detail.playlist.track_count, 1);
    assert_eq!(detail.items[0].media_id, outside_media);
}

#[test]
fn local_playlist_batch_add_filters_invalid_ids_across_lookup_chunks() {
    let db = AppDatabase::in_memory().unwrap();
    let media_ids = (0..505)
        .map(|index| {
            db.record_media_stub(&format!("D:/music/batch-{}.flac", index))
                .unwrap()
        })
        .collect::<Vec<_>>();
    let playlist = db.create_local_playlist("Batch", None).unwrap();

    assert_eq!(
        db.add_media_to_local_playlist(&playlist.playlist_id, &[media_ids[0].clone()])
            .unwrap(),
        1
    );

    let mut requested = media_ids.clone();
    requested.push(media_ids[1].clone());
    requested.push("missing-media-id".to_string());
    requested.push("   ".to_string());

    assert_eq!(
        db.add_media_to_local_playlist(&playlist.playlist_id, &requested)
            .unwrap(),
        504
    );

    let detail = db
        .get_local_playlist(&playlist.playlist_id)
        .unwrap()
        .unwrap();
    assert_eq!(detail.playlist.track_count, 505);
    assert_eq!(
        detail
            .items
            .iter()
            .map(|item| item.media_id.as_str())
            .collect::<Vec<_>>(),
        media_ids[1..]
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(media_ids[0].as_str()))
            .collect::<Vec<_>>()
    );
}

#[test]
fn shuffle_order_changes_and_unshuffle_restores_natural_order() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &[
            "D:/music/a.flac".to_string(),
            "D:/music/b.flac".to_string(),
            "D:/music/c.flac".to_string(),
        ],
    )
    .unwrap();

    let natural = db.list_queue_entries("active").unwrap();
    assert!(natural.iter().all(|entry| entry.shuffle_index.is_none()));

    db.shuffle_entries("active").unwrap();
    let shuffled = db.list_queue_entries("active").unwrap();
    assert!(shuffled.iter().all(|entry| entry.shuffle_index.is_some()));
    assert_ne!(
        shuffled
            .iter()
            .map(|entry| entry.source_path.as_str())
            .collect::<Vec<_>>(),
        natural
            .iter()
            .map(|entry| entry.source_path.as_str())
            .collect::<Vec<_>>(),
    );

    db.unshuffle_entries("active").unwrap();
    let restored = db.list_queue_entries("active").unwrap();
    assert!(restored.iter().all(|entry| entry.shuffle_index.is_none()));
    assert_eq!(
        restored
            .iter()
            .map(|entry| entry.source_path.as_str())
            .collect::<Vec<_>>(),
        natural
            .iter()
            .map(|entry| entry.source_path.as_str())
            .collect::<Vec<_>>(),
    );
}

#[test]
fn peek_next_queue_entry_uses_effective_shuffle_order() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &[
            "D:/music/a.flac".to_string(),
            "D:/music/b.flac".to_string(),
            "D:/music/c.flac".to_string(),
        ],
    )
    .unwrap();

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 2 WHERE source_path = 'D:/music/a.flac'",
                [],
            )
            .unwrap();
        conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 0 WHERE source_path = 'D:/music/b.flac'",
                [],
            )
            .unwrap();
        conn.execute(
                "UPDATE playback_queue_entries SET shuffle_index = 1 WHERE source_path = 'D:/music/c.flac'",
                [],
            )
            .unwrap();
    }

    let first = db.peek_next_queue_entry("active", None).unwrap().unwrap();
    assert_eq!(first.source_path, "D:/music/b.flac");

    let next = db
        .peek_next_queue_entry("active", Some("D:/music/b.flac"))
        .unwrap()
        .unwrap();
    assert_eq!(next.source_path, "D:/music/c.flac");

    let previous = db
        .peek_previous_queue_entry("active", Some("D:/music/c.flac"))
        .unwrap()
        .unwrap();
    assert_eq!(previous.source_path, "D:/music/b.flac");
}

#[test]
fn repeat_all_reset_requeues_played_entries() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &["D:/music/a.flac".to_string(), "D:/music/b.flac".to_string()],
    )
    .unwrap();
    db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &["queued"], "played")
        .unwrap();
    db.mark_queue_entry_status_by_path("active", "D:/music/b.flac", &["queued"], "playing")
        .unwrap();

    let first = db
        .reset_queue_cycle_for_repeat_all("active")
        .unwrap()
        .unwrap();
    assert_eq!(first.source_path, "D:/music/a.flac");
    let queue = db.list_queue_entries("active").unwrap();
    assert!(queue.iter().all(|entry| entry.status == "queued"));
}

#[test]
fn media_id_normalizes_paths_for_state_exposure() {
    assert_eq!(
        media_id_for_path("D:\\Music\\Artist\\Track.FLAC"),
        "d:/music/artist/track.flac"
    );
    assert_eq!(
        media_id_for_path(r"\\?\D:\Music\Artist\Track.FLAC"),
        "d:/music/artist/track.flac"
    );
    assert_eq!(
        media_id_for_path("//?/D:/Music/Artist/Track.FLAC"),
        "d:/music/artist/track.flac"
    );
    assert_eq!(
        media_id_for_path("//?/UNC/Server/Share/Artist/Track.FLAC"),
        "server/share/artist/track.flac"
    );
}

#[test]
fn media_art_lookup_accepts_raw_and_normalized_identity() {
    let db = AppDatabase::in_memory().unwrap();
    let metadata = TrackMetadata {
        cover_art: Some(vec![9, 8, 7]),
        cover_art_mime: Some("image/jpeg".to_string()),
        ..TrackMetadata::default()
    };

    let media_id = db
        .record_media_metadata(
            r"D:\Music\Artist\Track.flac",
            &metadata,
            Some(120.0),
            Some(44100),
            Some(2),
        )
        .unwrap();

    assert_eq!(media_id, "d:/music/artist/track.flac");
    assert_eq!(
        db.source_path_for_media_id(r"\\?\D:\Music\Artist\Track.FLAC")
            .unwrap()
            .as_deref(),
        Some(r"D:\Music\Artist\Track.flac")
    );
    assert_eq!(
        db.get_cover_art_for_media(r"\\?\D:\Music\Artist\Track.FLAC")
            .unwrap()
            .expect("cover art")
            .1,
        vec![9, 8, 7]
    );
}

#[test]
fn queue_cursor_matches_extended_length_windows_paths() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &[
            "D:\\Music\\a.flac".to_string(),
            "D:\\Music\\b.flac".to_string(),
            "D:\\Music\\c.flac".to_string(),
        ],
    )
    .unwrap();

    let next = db
        .peek_next_queue_entry("active", Some(r"\\?\D:\Music\a.flac"))
        .unwrap()
        .unwrap();

    assert_eq!(next.source_path, "D:\\Music\\b.flac");

    let previous = db
        .peek_previous_queue_entry("active", Some(r"\\?\D:\Music\c.flac"))
        .unwrap()
        .unwrap();

    assert_eq!(previous.source_path, "D:\\Music\\b.flac");
}

#[test]
fn peek_next_queue_entry_can_advance_to_preloading_entry() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &[
            "D:/music/a.flac".to_string(),
            "D:/music/b.flac".to_string(),
            "D:/music/c.flac".to_string(),
        ],
    )
    .unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    db.mark_queue_entry_status("active", queue[1].entry_id, "preloading")
        .unwrap();

    let next = db
        .peek_next_queue_entry("active", Some("D:/music/a.flac"))
        .unwrap()
        .unwrap();

    assert_eq!(next.source_path, "D:/music/b.flac");
    assert_eq!(next.status, "preloading");
}

#[test]
fn mark_queue_entry_playing_keeps_single_active_entry() {
    let db = AppDatabase::in_memory().unwrap();
    db.append_queue_entries(
        "active",
        &[
            "D:/music/a.flac".to_string(),
            "D:/music/b.flac".to_string(),
            "D:/music/c.flac".to_string(),
        ],
    )
    .unwrap();
    let queue = db.list_queue_entries("active").unwrap();

    db.mark_queue_entry_status("active", queue[0].entry_id, "playing")
        .unwrap();
    db.mark_queue_entry_status("active", queue[1].entry_id, "preloading")
        .unwrap();
    db.mark_queue_entry_playing("active", queue[2].entry_id)
        .unwrap();

    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue[0].status, "queued");
    assert_eq!(queue[1].status, "queued");
    assert_eq!(queue[2].status, "playing");
}

#[test]
fn startup_gc_removes_old_rows_and_marks_stale_sessions() {
    let db = AppDatabase::in_memory().unwrap();
    let now = now_epoch_secs_i64();
    let old = now - 31 * 24 * 3600;
    let recent = now - 60;
    let stale_started = now - 25 * 3600;

    let snapshot = PlaybackRuntimeSnapshot {
        position_secs: Some(0.0),
        duration_secs: Some(180.0),
        volume: Some(0.5),
        device_id: None,
        exclusive_mode: false,
    };
    let stale_session_id = db
        .start_playback_session("D:/music/stale.flac", "playing", &snapshot)
        .unwrap();
    db.append_playback_history(
        Some(stale_session_id),
        "D:/music/stale.flac",
        "play",
        Some(1.0),
        None,
    )
    .unwrap();

    {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE playback_sessions SET started_at = ?1, updated_at = ?1 WHERE session_id = ?2",
            params![stale_started, stale_session_id],
        )
        .unwrap();
        conn.execute(
            "UPDATE playback_history SET event_at = ?1 WHERE session_id = ?2",
            params![recent, stale_session_id],
        )
        .unwrap();
        conn.execute(
                r#"
                INSERT INTO playback_history (session_id, media_id, source_path, event_type, event_at, position_secs, payload_json)
                VALUES (NULL, NULL, 'D:/music/old.flac', 'old', ?1, NULL, NULL)
                "#,
                params![old],
            )
            .unwrap();
        conn.execute(
                r#"
                INSERT INTO analysis_tasks
                    (task_id, task_type, source_path, status, store_result, created_at, updated_at, result_json, error_text)
                VALUES
                    (1, 'scan_loudness', 'old-success.flac', 'success', 1, ?1, ?1, NULL, NULL),
                    (2, 'scan_loudness', 'old-running.flac', 'running', 1, ?1, ?1, NULL, NULL),
                    (3, 'scan_loudness', 'recent-error.flac', 'error', 1, ?2, ?2, NULL, NULL)
                "#,
                params![old, recent],
            )
            .unwrap();
        conn.execute(
                r#"
                INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                VALUES ('orphan', 'missing-media', 'image/png', x'0102', 2, ?1)
                "#,
                params![old],
            )
            .unwrap_or_else(|_| {
                conn.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
                conn.execute(
                    r#"
                    INSERT INTO cover_art_cache (cover_art_id, media_id, mime_type, image_bytes, byte_len, created_at)
                    VALUES ('orphan', 'missing-media', 'image/png', x'0102', 2, ?1)
                    "#,
                    params![old],
                )
                .unwrap();
                conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
                1
            });
    }

    db.gc_on_startup().unwrap();

    let conn = db.conn.lock().unwrap();
    let old_history_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playback_history WHERE source_path = 'D:/music/old.flac'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(old_history_count, 0);

    let referenced_history_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playback_history WHERE session_id = ?1",
            params![stale_session_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(referenced_history_count, 1);

    let (status, ended_at): (String, Option<i64>) = conn
        .query_row(
            "SELECT status, ended_at FROM playback_sessions WHERE session_id = ?1",
            params![stale_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "abandoned");
    assert!(ended_at.is_some());

    let old_terminal_tasks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM analysis_tasks WHERE task_id = 1",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(old_terminal_tasks, 0);
    let kept_tasks: i64 = conn
        .query_row("SELECT COUNT(*) FROM analysis_tasks", [], |row| row.get(0))
        .unwrap();
    assert_eq!(kept_tasks, 2);

    let orphan_cover_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cover_art_cache WHERE cover_art_id = 'orphan'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(orphan_cover_count, 0);
}

#[test]
fn file_backed_database_enables_wal() {
    let db_path = std::env::temp_dir().join(format!(
        "audio_engine_app_db_wal_{}_{}.db",
        std::process::id(),
        now_epoch_secs_i64()
    ));
    let db = AppDatabase::open(&db_path).unwrap();
    let conn = db.conn.lock().unwrap();
    let mode: String = conn
        .pragma_query_value(None, "journal_mode", |row| row.get(0))
        .unwrap();
    assert_eq!(mode.to_lowercase(), "wal");
    drop(conn);
    drop(db);
    let _ = fs::remove_file(&db_path);
    let _ = fs::remove_file(db_path.with_extension("db-wal"));
    let _ = fs::remove_file(db_path.with_extension("db-shm"));
}

#[test]
fn mark_queue_entry_status_by_path_supports_dynamic_status_filters() {
    let db = AppDatabase::in_memory().unwrap();

    db.append_queue_entry("active", "D:/music/a.flac").unwrap();
    db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &[], "playing")
        .unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue[0].status, "playing");

    db.mark_queue_entry_status_by_path("active", "D:/music/a.flac", &["queued"], "skipped")
        .unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue[0].status, "playing");

    db.mark_queue_entry_status_by_path(
        "active",
        "D:/music/a.flac",
        &["queued", "playing", "preloading"],
        "played",
    )
    .unwrap();
    let queue = db.list_queue_entries("active").unwrap();
    assert_eq!(queue[0].status, "played");
}

#[test]
fn library_track_key_lookup_preserves_order_and_keeps_summaries_light() {
    let db = AppDatabase::in_memory().unwrap();
    let media_a = db.record_media_stub("D:/music/a.flac").unwrap();
    let media_b = db.record_media_stub("D:/music/b.flac").unwrap();
    db.record_media_stub("D:/music/nested/c.flac").unwrap();

    let summaries = db.list_library_track_summaries().unwrap();
    let missing_media_id = "deadbeefcafebabe".to_string();

    let rows = db
        .source_paths_for_media_ids(&[
            media_b.clone(),
            missing_media_id,
            media_a.clone(),
            media_b.clone(),
        ])
        .unwrap();
    assert_eq!(
        rows,
        vec![
            (media_b.clone(), "D:/music/b.flac".to_string()),
            (media_a.clone(), "D:/music/a.flac".to_string()),
            (media_b.clone(), "D:/music/b.flac".to_string())
        ]
    );

    let folders = db.library_folder_summaries_for_tracks(&summaries);
    assert!(folders
        .iter()
        .any(|folder| folder.path == "D:/music" && folder.count == 2));
    let serialized = serde_json::to_value(&summaries[0]).unwrap();
    assert!(serialized.get("folder_path").is_none());
    assert!(serialized.get("media_id").is_some());
}
