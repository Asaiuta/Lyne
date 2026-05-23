use super::super::types::{NcmPlaylistSummary, NcmTrackSummary};
use super::read_non_empty_string;
use super::tracks::read_track_summary;
use serde_json::Value;

pub(in crate::server::netease) fn read_user_playlists(payload: &Value) -> Vec<NcmPlaylistSummary> {
    payload
        .get("playlist")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

pub(in crate::server::netease) fn filter_playlist_summaries(
    playlists: Vec<NcmPlaylistSummary>,
    user_id: i64,
    mode: Option<&str>,
) -> Vec<NcmPlaylistSummary> {
    match mode {
        Some("created-playlists") => playlists
            .into_iter()
            .filter(|playlist| playlist.user_id == Some(user_id))
            .skip(1)
            .collect(),
        Some("collected-playlists") => playlists
            .into_iter()
            .filter(|playlist| playlist.user_id != Some(user_id))
            .collect(),
        _ => playlists,
    }
}

pub(in crate::server::netease) fn read_search_playlists(
    payload: &Value,
) -> Vec<NcmPlaylistSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("playlists"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

pub(in crate::server::netease) fn read_playlist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    let root_songs = payload.get("songs").and_then(Value::as_array);
    let playlist_tracks = payload
        .get("playlist")
        .and_then(|playlist| playlist.get("tracks"))
        .and_then(Value::as_array);
    root_songs
        .or(playlist_tracks)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_playlist_summary(
    value: &Value,
) -> Option<NcmPlaylistSummary> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let name = item.get("name").and_then(read_non_empty_string)?;
    let creator = item.get("creator");
    let user_id = item
        .get("userId")
        .and_then(Value::as_i64)
        .or_else(|| {
            creator
                .and_then(|creator| creator.get("userId"))
                .and_then(Value::as_i64)
        })
        .or_else(|| {
            creator
                .and_then(|creator| creator.get("id"))
                .and_then(Value::as_i64)
        });
    let creator_id = creator
        .and_then(|creator| creator.get("userId"))
        .and_then(Value::as_i64)
        .or_else(|| {
            creator
                .and_then(|creator| creator.get("id"))
                .and_then(Value::as_i64)
        })
        .or(user_id);
    Some(NcmPlaylistSummary {
        id,
        name,
        user_id,
        creator_id,
        creator: creator
            .and_then(|creator| creator.get("nickname").or_else(|| creator.get("name")))
            .and_then(read_non_empty_string),
        cover_url: item.get("coverImgUrl").and_then(read_non_empty_string),
        track_count: item.get("trackCount").and_then(Value::as_i64),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item.get("description").and_then(read_non_empty_string),
        tags: item
            .get("tags")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(read_non_empty_string)
            .collect(),
        create_time: item.get("createTime").and_then(Value::as_i64),
        update_time: item.get("updateTime").and_then(Value::as_i64),
        privacy: item.get("privacy").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}
