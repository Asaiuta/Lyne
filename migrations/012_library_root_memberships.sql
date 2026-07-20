CREATE TABLE IF NOT EXISTS library_root_memberships (
    root_id    INTEGER NOT NULL,
    media_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (root_id, media_id),
    FOREIGN KEY(root_id) REFERENCES library_roots(root_id) ON DELETE CASCADE,
    FOREIGN KEY(media_id) REFERENCES media_items(media_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_root_memberships_media_id
    ON library_root_memberships(media_id);
