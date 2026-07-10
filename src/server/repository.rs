//! Thin async repository facade over [`AppDatabase`].
//!
//! `AppDatabase` exposes only synchronous methods that block on a single
//! `Mutex<Connection>`. Calling them directly from an actix `async fn` handler
//! blocks the Tokio executor thread (audit #2). This facade wraps each needed
//! method in `actix_web::rt::task::spawn_blocking` so the connection lock is
//! acquired only inside the blocking closure and **never held across `.await`**.
//!
//! Design notes:
//! - Every method clones the `Arc<AppDatabase>` and moves owned inputs into the
//!   closure (no borrows, no `MutexGuard` crossing the boundary).
//! - Error type stays `String` to match all ~70 synchronous `AppDatabase`
//!   methods (thiserror migration is a separate task). The only new error source
//!   is `JoinError`, mapped to `String` here.
//! - This is a thin 1:1 wrapper; it never duplicates SQL or query logic.

use std::sync::Arc;

use crate::app_database::{
    AppDatabase, CoverArtRecord, LibraryFolderSummaryRecord, LibrarySummaryStatsRecord,
    LibraryTrackGroupsQuery, LibraryTrackGroupsRecord, LibraryTrackSummaryRecord,
    LibraryTrackViewQuery, LibraryTrackViewRecord, NcmTrackSourceRecord,
};
use crate::decoder::TrackMetadata;

/// Async facade that offloads blocking `AppDatabase` calls onto the actix/tokio
/// blocking thread pool. Cheap to clone (holds a single `Arc`).
#[derive(Clone)]
pub struct AsyncRepo {
    db: Arc<AppDatabase>,
}

impl AsyncRepo {
    /// Wrap an existing shared `AppDatabase`. Shares the same connection/lock as
    /// any other holder of the `Arc` (no extra connection is opened).
    pub fn new(db: Arc<AppDatabase>) -> Self {
        Self { db }
    }

    async fn run_blocking<T, F>(&self, op: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&AppDatabase) -> Result<T, String> + Send + 'static,
    {
        let db = Arc::clone(&self.db);
        actix_web::rt::task::spawn_blocking(move || op(&db))
            .await
            .map_err(|e| format!("repository task join failed: {e}"))?
    }

    // ---- cover-art ----

    pub async fn get_cover_art_for_media(
        &self,
        media_id: String,
    ) -> Result<Option<(CoverArtRecord, Vec<u8>)>, String> {
        self.run_blocking(move |db| db.get_cover_art_for_media(&media_id))
            .await
    }

    pub async fn source_path_for_media_id(
        &self,
        media_id: String,
    ) -> Result<Option<String>, String> {
        self.run_blocking(move |db| db.source_path_for_media_id(&media_id))
            .await
    }

    pub async fn media_id_for_track_key(&self, track_key: i64) -> Result<Option<String>, String> {
        self.run_blocking(move |db| db.media_id_for_track_key(track_key))
            .await
    }

    /// Lazy cover-art write-back. Takes owned metadata so it can move into the
    /// blocking closure.
    pub async fn record_media_metadata(
        &self,
        source_path: String,
        metadata: TrackMetadata,
        duration_secs: Option<f64>,
        sample_rate: Option<u32>,
        channels: Option<usize>,
    ) -> Result<String, String> {
        self.run_blocking(move |db| {
            db.record_media_metadata(
                &source_path,
                &metadata,
                duration_secs,
                sample_rate,
                channels,
            )
        })
        .await
    }

    // ---- library views ----

    /// Offloads the existing whole-table load + Rust-side filter/sort/page logic.
    /// Behavior is byte-for-byte identical to the synchronous method; only the
    /// thread it runs on changes (SQL pushdown is a separate task).
    pub async fn library_track_view(
        &self,
        query: LibraryTrackViewQuery,
    ) -> Result<LibraryTrackViewRecord, String> {
        self.run_blocking(move |db| db.library_track_view(query))
            .await
    }

    /// See [`AsyncRepo::library_track_view`]: offload only, no algorithm change.
    pub async fn library_track_groups(
        &self,
        query: LibraryTrackGroupsQuery,
    ) -> Result<LibraryTrackGroupsRecord, String> {
        self.run_blocking(move |db| db.library_track_groups(query))
            .await
    }

    /// Combined `/domain/library/track_summaries` data: stats, the full
    /// lightweight summary list, and de-duplicated folder descriptors. Bundled
    /// into one blocking closure so the whole-table read runs off the executor.
    pub async fn library_track_summaries_bundle(
        &self,
    ) -> Result<
        (
            LibrarySummaryStatsRecord,
            Vec<LibraryTrackSummaryRecord>,
            Vec<LibraryFolderSummaryRecord>,
        ),
        String,
    > {
        self.run_blocking(move |db| {
            let stats = db.library_summary_stats()?;
            let tracks = db.list_library_track_summaries()?;
            let folders = db.library_folder_summaries_for_tracks(&tracks);
            Ok((stats, tracks, folders))
        })
        .await
    }

    // ---- ncm metadata persistence ----

    /// Persist resolved NCM display metadata. Owned `Option<String>` fields move
    /// into the blocking closure; the SQLite write happens entirely off the
    /// executor thread.
    #[allow(clippy::too_many_arguments)]
    pub async fn record_external_media_metadata(
        &self,
        source_path: String,
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        duration_secs: Option<f64>,
        external_artwork_url: Option<String>,
    ) -> Result<String, String> {
        self.run_blocking(move |db| {
            db.record_external_media_metadata(
                &source_path,
                title.as_deref(),
                artist.as_deref(),
                album.as_deref(),
                duration_secs,
                external_artwork_url.as_deref(),
            )
        })
        .await
    }

    /// Persist the `stream_url -> song_id` mapping for an NCM track. Owned inputs
    /// move into the blocking closure.
    pub async fn record_ncm_track_source(
        &self,
        source_path: String,
        song_id: i64,
        source_page_url: Option<String>,
    ) -> Result<NcmTrackSourceRecord, String> {
        self.run_blocking(move |db| {
            db.record_ncm_track_source(&source_path, song_id, source_page_url.as_deref())
        })
        .await
    }
}
