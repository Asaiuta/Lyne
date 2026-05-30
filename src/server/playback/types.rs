use super::*;
use actix_web::HttpResponse;
use serde::Deserialize;

#[derive(Deserialize)]
pub(super) struct ScanTaskPath {
    pub(super) task_id: u64,
}

#[derive(Deserialize)]
pub(super) struct AutomixAnalyzeRequest {
    pub(super) path: String,
    #[serde(default)]
    pub(super) mode: crate::processor::AutomixAnalysisMode,
    pub(super) max_analyze_time_sec: Option<f64>,
}

#[derive(Deserialize)]
pub(super) struct LibraryRootPath {
    pub(super) root_id: i64,
}

#[derive(Deserialize)]
pub(super) struct LimitQuery {
    pub(super) limit: Option<usize>,
    pub(super) task_type: Option<String>,
    pub(super) all: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct LibraryScanRequest {
    pub(super) path: String,
    pub(super) display_name: Option<String>,
    pub(super) source_key: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct QueueEnqueueRequest {
    pub(super) path: String,
}

#[derive(Deserialize)]
pub(super) struct QueueEnqueueManyRequest {
    pub(super) paths: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct QueueReplaceRequest {
    pub(super) paths: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct ExternalMediaMetadataRequest {
    pub(super) source_path: String,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) duration_secs: Option<f64>,
    pub(super) external_artwork_url: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct MediaItemsDeleteRequest {
    pub(super) media_ids: Vec<String>,
}

#[derive(Deserialize)]
pub(super) struct LibraryTrackPath {
    pub(super) track_key: i64,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum LibraryTrackViewSortFieldRequest {
    Default,
    Title,
    Artist,
    Album,
    TrackNumber,
    Filename,
    Duration,
    Size,
    CreateTime,
    UpdatedTime,
}

impl Default for LibraryTrackViewSortFieldRequest {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum LibraryTrackViewSortOrderRequest {
    Default,
    Asc,
    Desc,
}

impl Default for LibraryTrackViewSortOrderRequest {
    fn default() -> Self {
        Self::Default
    }
}

#[derive(Default, Deserialize)]
pub(super) struct LibraryTrackViewSortRequest {
    #[serde(default)]
    pub(super) field: LibraryTrackViewSortFieldRequest,
    #[serde(default)]
    pub(super) order: LibraryTrackViewSortOrderRequest,
}

#[derive(Deserialize)]
pub(super) struct LibraryTrackViewRangeRequest {
    pub(super) start: usize,
    pub(super) end: usize,
}

#[derive(Deserialize)]
pub(super) struct LibraryTrackViewRequest {
    #[serde(default)]
    pub(super) queries: Vec<String>,
    #[serde(default, alias = "folderPath")]
    pub(super) folder_path: Option<String>,
    #[serde(default)]
    pub(super) sort: LibraryTrackViewSortRequest,
    pub(super) range: Option<LibraryTrackViewRangeRequest>,
    #[serde(default, alias = "includeMediaIds")]
    pub(super) include_media_ids: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum LibraryTrackGroupKindRequest {
    Artists,
    Albums,
}

#[derive(Deserialize)]
pub(super) struct LibraryTrackGroupsRequest {
    pub(super) kind: LibraryTrackGroupKindRequest,
    #[serde(default)]
    pub(super) queries: Vec<String>,
    #[serde(default, alias = "folderPath")]
    pub(super) folder_path: Option<String>,
    #[serde(default)]
    pub(super) sort: LibraryTrackViewSortRequest,
    #[serde(default, alias = "selectedGroupKey")]
    pub(super) selected_group_key: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct LibraryQueueMediaIdsRequest {
    pub(super) media_ids: Vec<String>,
    #[serde(default)]
    pub(super) start_media_id: Option<String>,
}

pub(super) type MediaQueueRow = (String, String);

pub(super) struct LibraryQueuePlayback {
    pub(super) state: StateResponse,
    pub(super) queued_count: usize,
}

#[derive(Debug)]
pub(super) enum LibraryQueueFailure {
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

impl LibraryQueueFailure {
    pub(super) fn into_response(self) -> HttpResponse {
        match self {
            Self::BadRequest(message) => bad_request_response(message),
            Self::NotFound(message) => not_found_response(message),
            Self::Internal(message) => internal_server_error_response(message),
        }
    }
}

#[derive(Deserialize)]
pub(super) struct LocalPlaylistPath {
    pub(super) playlist_id: String,
}

#[derive(Deserialize)]
pub(super) struct LocalPlaylistCreateRequest {
    pub(super) name: String,
    pub(super) description: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct LocalPlaylistUpdateRequest {
    pub(super) name: Option<String>,
    pub(super) description: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct LocalPlaylistItemsRequest {
    pub(super) media_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum PlaylistLoadMode {
    ParseOnly,
    Append,
    Replace,
}

#[derive(Deserialize)]
pub(super) struct PlaylistLoadRequest {
    pub(super) path: String,
    pub(super) mode: PlaylistLoadMode,
}

#[derive(Deserialize)]
pub(super) struct QueueEntryPath {
    pub(super) entry_id: i64,
}

#[derive(Deserialize)]
pub(super) struct PlayQueueRequest {
    pub(super) entry_id: Option<i64>,
    pub(super) source_path: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct PlaybackModeRequest {
    pub(super) mode: String,
}

#[derive(Deserialize)]
pub(super) struct ConfigureResamplingRequest {
    pub(super) quality: Option<String>,
    pub(super) use_cache: Option<bool>,
    pub(super) preemptive_resample: Option<bool>,
}

#[derive(Deserialize)]
pub(super) struct MediaPath {
    pub(super) media_id: String,
}

#[derive(Deserialize)]
pub(super) struct MediaCoverArtQuery {
    pub(super) media_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CurrentLyricsRequest {
    pub(super) song_id: Option<i64>,
    pub(super) lyric_dirs: Vec<String>,
}
