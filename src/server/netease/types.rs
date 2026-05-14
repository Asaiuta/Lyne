use super::super::lyrics::LyricLine;
use crate::app_database::NcmAccountRecord;
use ncm_api_rs::NcmError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Deserialize)]
pub(super) struct NeteasePath {
    pub(super) tail: String,
}

#[derive(Deserialize)]
pub(super) struct ResolveNcmTrackRequest {
    pub(super) song_id: i64,
    pub(super) level: Option<String>,
    pub(super) cookie: Option<String>,
    pub(super) source_page_url: String,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) duration_secs: Option<f64>,
    pub(super) artwork_url: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct ResolveNcmTrackSupplementRequest {
    pub(super) song_id: i64,
    pub(super) cookie: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct HomeFeedRequest {
    pub(super) user_id: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct DiscoverPlaylistsRequest {
    pub(super) cat: Option<String>,
    pub(super) kind: Option<String>,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
    pub(super) before: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct DiscoverAlbumsRequest {
    pub(super) area: Option<String>,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct DiscoverArtistsRequest {
    #[serde(rename = "type")]
    pub(super) artist_type: Option<i64>,
    pub(super) area: Option<i64>,
    pub(super) initial: Option<Value>,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct DiscoverSongsRequest {
    #[serde(rename = "type")]
    pub(super) song_type: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct UpsertNcmAccountRequest {
    pub(super) user_id: i64,
    pub(super) nickname: Option<String>,
    pub(super) avatar_url: Option<String>,
    pub(super) cookie: String,
    pub(super) vip_type: Option<i64>,
    pub(super) level: Option<i64>,
    pub(super) signin_at_ms: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct ActiveNcmAccountRequest {
    pub(super) user_id: i64,
}

#[derive(Deserialize)]
pub(super) struct NcmAccountPath {
    pub(super) user_id: i64,
}

#[derive(Deserialize)]
pub(super) struct UserPlaylistsRequest {
    pub(super) uid: i64,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
    pub(super) mode: Option<String>,
}

#[derive(Deserialize)]
pub(super) struct SearchTracksRequest {
    pub(super) keywords: String,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct PlaylistTracksRequest {
    pub(super) id: i64,
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct EntityTracksRequest {
    pub(super) id: i64,
}

#[derive(Deserialize)]
pub(super) struct PersonalFmTrashRequest {
    pub(super) song_id: i64,
}

#[derive(Deserialize)]
pub(super) struct SongDetailTracksRequest {
    pub(super) ids: Vec<i64>,
}

#[derive(Deserialize)]
pub(super) struct LikelistRequest {
    pub(super) uid: i64,
}

#[derive(Deserialize)]
pub(super) struct CloudTracksRequest {
    pub(super) limit: Option<i64>,
    pub(super) offset: Option<i64>,
}

#[derive(Deserialize)]
pub(super) struct CloudDeleteRequest {
    pub(super) song_id: i64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct ResolvedNcmTrack {
    pub(super) song_id: i64,
    pub(super) stream_url: String,
    pub(super) source_page_url: String,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) duration_secs: Option<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct ResolvedNcmTrackSupplement {
    pub(super) song_id: i64,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) lyrics: Vec<LyricLine>,
    pub(super) detail_error: Option<String>,
    pub(super) lyrics_error: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct NcmTrackDetail {
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) cover_url: Option<String>,
}

#[derive(Debug)]
pub(super) enum NcmTrackResolveError {
    BadRequest(String),
    BadGateway(String),
    Upstream(NcmError),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct NcmProfileSnapshot {
    pub(super) user_id: i64,
    pub(super) nickname: Option<String>,
    pub(super) avatar_url: Option<String>,
    pub(super) vip_type: Option<i64>,
    pub(super) level: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmPlaylistSummary {
    pub(super) id: i64,
    pub(super) name: String,
    pub(super) creator: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) track_count: Option<i64>,
    pub(super) subscribed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmTrackSummary {
    pub(super) id: String,
    pub(super) song_id: i64,
    pub(super) source_path: String,
    pub(super) title: Option<String>,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) duration_secs: Option<f64>,
    pub(super) artwork_url: Option<String>,
    pub(super) size_bytes: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(super) struct NcmCloudTracksPage {
    pub(super) tracks: Vec<NcmTrackSummary>,
    pub(super) count: i64,
    pub(super) size_bytes: i64,
    pub(super) max_size_bytes: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(super) struct NcmHomeFeed {
    pub(super) daily_picks: Vec<NcmHomeFeedCard>,
    pub(super) daily_song_covers: Vec<NcmHomeTrackCover>,
    pub(super) liked_song_covers: Vec<NcmHomeTrackCover>,
    pub(super) personal_fm_covers: Vec<NcmHomeTrackCover>,
    pub(super) personal_fm_preview: Option<NcmHomePersonalFmPreview>,
    pub(super) radar_playlists: Vec<NcmHomeFeedCard>,
    pub(super) recommended_playlists: Vec<NcmHomeFeedCard>,
    pub(super) new_albums: Vec<NcmHomeFeedCard>,
    pub(super) featured_artists: Vec<NcmHomeFeedCard>,
    pub(super) recommended_mvs: Vec<NcmHomeFeedCard>,
    pub(super) podcasts: Vec<NcmHomeFeedCard>,
    pub(super) errors: Vec<NcmHomeFeedError>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmHomeFeedCard {
    pub(super) id: i64,
    pub(super) title: String,
    pub(super) subtitle: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) play_count: Option<f64>,
    pub(super) description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmHomeTrackCover {
    pub(super) id: i64,
    pub(super) url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmHomePersonalFmPreview {
    pub(super) title: String,
    pub(super) artist: Option<String>,
    pub(super) album: Option<String>,
    pub(super) cover_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmHomeFeedError {
    pub(super) section: String,
    pub(super) message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmDiscoverCard {
    pub(super) id: i64,
    pub(super) title: String,
    pub(super) subtitle: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) cursor: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmDiscoverToplistTrack {
    pub(super) title: String,
    pub(super) artist: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmDiscoverToplist {
    pub(super) id: i64,
    pub(super) title: String,
    pub(super) subtitle: Option<String>,
    pub(super) description: Option<String>,
    pub(super) cover_url: Option<String>,
    pub(super) tracks: Vec<NcmDiscoverToplistTrack>,
    pub(super) is_official: bool,
    pub(super) cursor: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(super) struct NcmDiscoverPlaylistCategories {
    pub(super) categories: HashMap<i64, String>,
    pub(super) entries: Vec<NcmDiscoverPlaylistCategoryEntry>,
    pub(super) hq_names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(super) struct NcmDiscoverPlaylistCategoryEntry {
    pub(super) name: String,
    pub(super) category: i64,
    pub(super) hot: bool,
}

#[derive(Debug, Serialize)]
pub(super) struct NcmAccountStateResponse {
    pub(super) status: &'static str,
    pub(super) accounts: Vec<NcmAccountRecord>,
    pub(super) active_user_id: Option<i64>,
}

impl NcmAccountStateResponse {
    pub(super) fn success(accounts: Vec<NcmAccountRecord>, active_user_id: Option<i64>) -> Self {
        Self {
            status: "success",
            accounts,
            active_user_id,
        }
    }
}
