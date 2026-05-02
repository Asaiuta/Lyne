PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS webdav_sources (
    source_key   TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    base_url     TEXT NOT NULL,
    username     TEXT,
    password     TEXT,
    is_default   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_tasks (
    task_id       INTEGER PRIMARY KEY,
    task_type     TEXT NOT NULL,
    source_path   TEXT NOT NULL,
    status        TEXT NOT NULL,
    store_result  INTEGER NOT NULL DEFAULT 1,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    result_json   TEXT,
    error_text    TEXT
);

CREATE TABLE IF NOT EXISTS media_items (
    media_id       TEXT PRIMARY KEY,
    source_path    TEXT NOT NULL UNIQUE,
    source_kind    TEXT NOT NULL,
    title          TEXT,
    artist         TEXT,
    album          TEXT,
    track_number   INTEGER,
    disc_number    INTEGER,
    genre          TEXT,
    year           INTEGER,
    duration_secs  REAL,
    sample_rate    INTEGER,
    channels       INTEGER,
    added_at       INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cover_art_cache (
    cover_art_id  TEXT PRIMARY KEY,
    media_id       TEXT NOT NULL,
    mime_type      TEXT,
    image_bytes    BLOB,
    byte_len       INTEGER NOT NULL,
    created_at     INTEGER NOT NULL,
    FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playback_sessions (
    session_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id         TEXT,
    source_path      TEXT NOT NULL,
    status           TEXT NOT NULL,
    started_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    ended_at         INTEGER,
    position_secs    REAL,
    duration_secs    REAL,
    volume           REAL,
    device_id        INTEGER,
    exclusive_mode   INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(media_id) REFERENCES media_items(media_id)
);

CREATE TABLE IF NOT EXISTS playback_history (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     INTEGER,
    media_id       TEXT,
    source_path    TEXT NOT NULL,
    event_type     TEXT NOT NULL,
    event_at       INTEGER NOT NULL,
    position_secs  REAL,
    payload_json   TEXT,
    FOREIGN KEY(session_id) REFERENCES playback_sessions(session_id)
);

CREATE TABLE IF NOT EXISTS device_configs (
    profile_key     TEXT PRIMARY KEY,
    device_id        INTEGER,
    exclusive_mode   INTEGER NOT NULL DEFAULT 0,
    updated_at       INTEGER NOT NULL,
    last_seen_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dsp_configs (
    config_key    TEXT PRIMARY KEY,
    payload_json  TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_queue_state (
    queue_key            TEXT PRIMARY KEY,
    current_track_path   TEXT,
    pending_track_path   TEXT,
    needs_preload        INTEGER NOT NULL DEFAULT 0,
    pending_ready        INTEGER NOT NULL DEFAULT 0,
    updated_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS library_roots (
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

CREATE TABLE IF NOT EXISTS playback_queue_entries (
    entry_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id         TEXT NOT NULL,
    position_index   INTEGER NOT NULL,
    source_path      TEXT NOT NULL,
    media_id         TEXT,
    status           TEXT NOT NULL DEFAULT 'queued',
    added_at         INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_updated_at
    ON analysis_tasks(updated_at);
CREATE INDEX IF NOT EXISTS idx_media_items_source_path
    ON media_items(source_path);
CREATE INDEX IF NOT EXISTS idx_playback_history_event_at
    ON playback_history(event_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_sessions_updated_at
    ON playback_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_roots_updated_at
    ON library_roots(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_playback_queue_entries_queue_position
    ON playback_queue_entries(queue_id, position_index ASC);
