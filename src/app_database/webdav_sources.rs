use rusqlite::{params, OptionalExtension};

use crate::webdav::WebDavConfig;

use super::{
    bool_to_sqlite, media_id_for_path, now_epoch_secs_i64, AppDatabase, StoredWebDavSource,
    WebDavSourceRecord,
};

pub(super) fn webdav_source_keys_for_media_path_tx(
    conn: &rusqlite::Connection,
    source_path: &str,
) -> Result<Vec<String>, String> {
    let media_id = media_id_for_path(source_path);
    let mut stmt = conn
        .prepare(
            r#"
            SELECT DISTINCT library_roots.source_key
            FROM media_items
            JOIN library_root_memberships
              ON library_root_memberships.media_id = media_items.media_id
            JOIN library_roots
              ON library_roots.root_id = library_root_memberships.root_id
            WHERE (media_items.media_id = ?1 OR media_items.source_path = ?2)
              AND library_roots.source_kind = 'webdav'
              AND library_roots.source_key IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM ncm_track_sources
                  WHERE ncm_track_sources.media_id = media_items.media_id
              )
            ORDER BY library_roots.source_key ASC
            "#,
        )
        .map_err(|e| format!("Failed to prepare media WebDAV ownership query: {}", e))?;
    let rows = stmt
        .query_map(params![media_id, source_path], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| format!("Failed to query media WebDAV ownership: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to decode media WebDAV ownership: {}", e))
}

fn webdav_source_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebDavSourceRecord> {
    Ok(WebDavSourceRecord {
        source_key: row.get(0)?,
        display_name: row.get(1)?,
        base_url: row.get(2)?,
        username: row.get(3)?,
        is_default: row.get::<_, i64>(4)? != 0,
        created_at_epoch_secs: row.get::<_, i64>(5)? as u64,
        updated_at_epoch_secs: row.get::<_, i64>(6)? as u64,
    })
}

fn webdav_config_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WebDavConfig> {
    Ok(WebDavConfig {
        base_url: row.get(0)?,
        username: row.get(1)?,
        password: row.get(2)?,
    })
}

impl AppDatabase {
    pub fn webdav_source_keys_for_media_path(
        &self,
        source_path: &str,
    ) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        webdav_source_keys_for_media_path_tx(&conn, source_path)
    }

    pub fn load_primary_webdav_source(&self) -> Result<Option<WebDavConfig>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT base_url, username, password
            FROM webdav_sources
            WHERE is_default = 1
            ORDER BY updated_at DESC
            LIMIT 1
            "#,
            [],
            webdav_config_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source: {}", e))
    }

    pub fn save_primary_webdav_source(&self, config: &WebDavConfig) -> Result<(), String> {
        self.upsert_webdav_source("primary", "Primary WebDAV", config, true)
    }

    pub fn list_webdav_sources(&self) -> Result<Vec<WebDavSourceRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                r#"
                SELECT source_key, display_name, base_url, username, is_default, created_at, updated_at
                FROM webdav_sources
                ORDER BY is_default DESC, updated_at DESC, source_key ASC
                "#,
            )
            .map_err(|e| format!("Failed to prepare WebDAV sources query: {}", e))?;

        let rows = stmt
            .query_map([], webdav_source_from_row)
            .map_err(|e| format!("Failed to query WebDAV sources: {}", e))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to decode WebDAV sources: {}", e))
    }

    pub fn get_webdav_source(
        &self,
        source_key: &str,
    ) -> Result<Option<WebDavSourceRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT source_key, display_name, base_url, username, is_default, created_at, updated_at
            FROM webdav_sources
            WHERE source_key = ?1
            "#,
            params![source_key],
            webdav_source_from_row,
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source: {}", e))
    }

    pub fn load_webdav_source_config(
        &self,
        source_key: &str,
    ) -> Result<Option<StoredWebDavSource>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            r#"
            SELECT source_key, display_name, base_url, username, password, is_default, created_at, updated_at
            FROM webdav_sources
            WHERE source_key = ?1
            "#,
            params![source_key],
            |row| {
                Ok(StoredWebDavSource {
                    source_key: row.get(0)?,
                    display_name: row.get(1)?,
                    config: WebDavConfig {
                        base_url: row.get(2)?,
                        username: row.get(3)?,
                        password: row.get(4)?,
                    },
                    is_default: row.get::<_, i64>(5)? != 0,
                    created_at_epoch_secs: row.get::<_, i64>(6)? as u64,
                    updated_at_epoch_secs: row.get::<_, i64>(7)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| format!("Failed to load WebDAV source config: {}", e))
    }

    pub fn upsert_webdav_source(
        &self,
        source_key: &str,
        display_name: &str,
        config: &WebDavConfig,
        make_default: bool,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start WebDAV source transaction: {}", e))?;
        let now = now_epoch_secs_i64();

        if make_default {
            tx.execute(
                "UPDATE webdav_sources SET is_default = 0 WHERE is_default = 1",
                [],
            )
            .map_err(|e| format!("Failed to clear default WebDAV source: {}", e))?;
        }

        tx.execute(
            r#"
            INSERT INTO webdav_sources
                (source_key, display_name, base_url, username, password, is_default, created_at, updated_at)
            VALUES
                (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
            ON CONFLICT(source_key) DO UPDATE SET
                display_name = excluded.display_name,
                base_url = excluded.base_url,
                username = excluded.username,
                password = excluded.password,
                is_default = excluded.is_default,
                updated_at = excluded.updated_at
            "#,
            params![
                source_key,
                display_name,
                config.base_url,
                config.username,
                config.password,
                bool_to_sqlite(make_default),
                now
            ],
        )
        .map_err(|e| format!("Failed to upsert WebDAV source: {}", e))?;

        tx.commit()
            .map_err(|e| format!("Failed to commit WebDAV source transaction: {}", e))?;
        Ok(())
    }

    pub fn set_default_webdav_source(
        &self,
        source_key: &str,
    ) -> Result<Option<WebDavConfig>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start default WebDAV source transaction: {}", e))?;

        let selected = tx
            .query_row(
                r#"
                SELECT base_url, username, password
                FROM webdav_sources
                WHERE source_key = ?1
                "#,
                params![source_key],
                webdav_config_from_row,
            )
            .optional()
            .map_err(|e| format!("Failed to load requested WebDAV source: {}", e))?;

        let Some(config) = selected else {
            return Ok(None);
        };

        tx.execute(
            "UPDATE webdav_sources SET is_default = 0 WHERE is_default = 1",
            [],
        )
        .map_err(|e| format!("Failed to clear existing default WebDAV source: {}", e))?;
        tx.execute(
            "UPDATE webdav_sources SET is_default = 1, updated_at = ?2 WHERE source_key = ?1",
            params![source_key, now_epoch_secs_i64()],
        )
        .map_err(|e| format!("Failed to set default WebDAV source: {}", e))?;
        tx.commit()
            .map_err(|e| format!("Failed to commit default WebDAV source transaction: {}", e))?;

        Ok(Some(config))
    }

    pub fn delete_webdav_source(&self, source_key: &str) -> Result<Option<WebDavConfig>, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn
            .transaction()
            .map_err(|e| format!("Failed to start delete WebDAV source transaction: {}", e))?;

        let was_default = tx
            .query_row(
                "SELECT is_default FROM webdav_sources WHERE source_key = ?1",
                params![source_key],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect WebDAV source before delete: {}", e))?;

        if was_default.is_none() {
            return Ok(None);
        }

        tx.execute(
            "DELETE FROM webdav_sources WHERE source_key = ?1",
            params![source_key],
        )
        .map_err(|e| format!("Failed to delete WebDAV source: {}", e))?;

        let fallback = if was_default == Some(1) {
            let fallback = tx
                .query_row(
                    r#"
                    SELECT source_key, base_url, username, password
                    FROM webdav_sources
                    ORDER BY updated_at DESC, created_at DESC, source_key ASC
                    LIMIT 1
                    "#,
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            WebDavConfig {
                                base_url: row.get(1)?,
                                username: row.get(2)?,
                                password: row.get(3)?,
                            },
                        ))
                    },
                )
                .optional()
                .map_err(|e| format!("Failed to select fallback WebDAV source: {}", e))?;

            if let Some((fallback_key, fallback_cfg)) = fallback {
                tx.execute(
                    "UPDATE webdav_sources SET is_default = 1, updated_at = ?2 WHERE source_key = ?1",
                    params![fallback_key, now_epoch_secs_i64()],
                )
                .map_err(|e| format!("Failed to promote fallback WebDAV source: {}", e))?;
                Some(fallback_cfg)
            } else {
                Some(WebDavConfig::default())
            }
        } else {
            None
        };

        tx.commit()
            .map_err(|e| format!("Failed to commit delete WebDAV source transaction: {}", e))?;
        Ok(fallback)
    }
}
