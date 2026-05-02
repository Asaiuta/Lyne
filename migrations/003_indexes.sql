CREATE INDEX IF NOT EXISTS idx_cover_art_cache_media_created
    ON cover_art_cache(media_id, created_at DESC, cover_art_id DESC);

CREATE INDEX IF NOT EXISTS idx_playback_queue_entries_path_position
    ON playback_queue_entries(queue_id, source_path, position_index ASC, entry_id ASC);

CREATE INDEX IF NOT EXISTS idx_playback_queue_entries_status_position
    ON playback_queue_entries(queue_id, status, position_index ASC, entry_id ASC);

CREATE INDEX IF NOT EXISTS idx_playback_sessions_open_updated
    ON playback_sessions(ended_at, updated_at DESC, session_id DESC);

CREATE INDEX IF NOT EXISTS idx_webdav_sources_default_updated
    ON webdav_sources(is_default, updated_at DESC);
