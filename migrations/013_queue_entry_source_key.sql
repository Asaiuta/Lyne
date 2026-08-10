CREATE INDEX IF NOT EXISTS idx_playback_queue_entries_source_key
    ON playback_queue_entries(source_key);
