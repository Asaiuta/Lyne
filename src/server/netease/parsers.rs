use super::types::*;
use serde_json::Value;
use std::collections::HashMap;

pub(super) fn read_song_url(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("url"))
        .and_then(read_non_empty_string)
}

pub(super) fn read_song_detail(payload: &Value, fallback_song_id: i64) -> Option<NcmTrackDetail> {
    let songs = payload.get("songs")?.as_array()?;
    let target = songs
        .iter()
        .find(|song| {
            song.get("id")
                .and_then(Value::as_i64)
                .is_some_and(|id| id == fallback_song_id)
        })
        .or_else(|| songs.first())?;
    let album = target
        .get("al")
        .and_then(Value::as_object)
        .or_else(|| target.get("album").and_then(Value::as_object));

    Some(NcmTrackDetail {
        title: target.get("name").and_then(read_non_empty_string),
        artist: read_artists(target.get("ar"))
            .or_else(|| read_artists(target.get("artists")))
            .or_else(|| {
                target
                    .get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(read_non_empty_string)
            }),
        album: album
            .and_then(|album| album.get("name"))
            .and_then(read_non_empty_string),
        cover_url: album
            .and_then(|album| album.get("picUrl"))
            .and_then(read_non_empty_string)
            .or_else(|| target.get("picUrl").and_then(read_non_empty_string)),
    })
}

fn read_non_empty_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_artists(value: Option<&Value>) -> Option<String> {
    let names = value?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("name").and_then(read_non_empty_string))
        .collect::<Vec<_>>();
    if names.is_empty() {
        None
    } else {
        Some(names.join(", "))
    }
}

pub(super) fn read_profile_snapshot(payload: &Value) -> Option<NcmProfileSnapshot> {
    let root = payload.as_object()?;
    let data = root.get("data").and_then(Value::as_object).unwrap_or(root);
    let profile = data.get("profile").and_then(Value::as_object);
    let account = data.get("account").and_then(Value::as_object);
    let user_id = profile
        .and_then(|value| value.get("userId"))
        .and_then(Value::as_i64)
        .or_else(|| {
            account
                .and_then(|value| value.get("id"))
                .and_then(Value::as_i64)
        })?;

    Some(NcmProfileSnapshot {
        user_id,
        nickname: profile
            .and_then(|value| value.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| {
                account
                    .and_then(|value| value.get("userName"))
                    .and_then(read_non_empty_string)
            }),
        avatar_url: profile
            .and_then(|value| value.get("avatarUrl"))
            .and_then(read_non_empty_string),
        vip_type: profile
            .and_then(|value| value.get("vipType"))
            .and_then(Value::as_i64)
            .or_else(|| {
                account
                    .and_then(|value| value.get("vipType"))
                    .and_then(Value::as_i64)
            }),
        level: data.get("level").and_then(Value::as_i64),
    })
}

pub(super) fn read_user_playlists(payload: &Value) -> Vec<NcmPlaylistSummary> {
    payload
        .get("playlist")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

fn read_playlist_summary(value: &Value) -> Option<NcmPlaylistSummary> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let name = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmPlaylistSummary {
        id,
        name,
        creator: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: item.get("coverImgUrl").and_then(read_non_empty_string),
        track_count: item.get("trackCount").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

pub(super) fn filter_playlist_summaries(
    playlists: Vec<NcmPlaylistSummary>,
    mode: Option<&str>,
) -> Vec<NcmPlaylistSummary> {
    match mode {
        Some("created-playlists") => playlists
            .into_iter()
            .filter(|playlist| !playlist.subscribed)
            .collect(),
        Some("collected-playlists") => playlists
            .into_iter()
            .filter(|playlist| playlist.subscribed)
            .collect(),
        _ => playlists,
    }
}

pub(super) fn read_discover_playlist_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("playlists")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_playlist_card)
        .collect()
}

pub(super) fn read_discover_album_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("albums")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_album_card)
        .collect()
}

pub(super) fn read_discover_artist_cards(payload: &Value) -> Vec<NcmDiscoverCard> {
    payload
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_artist_card)
        .collect()
}

pub(super) fn read_discover_toplists(payload: &Value) -> Vec<NcmDiscoverToplist> {
    payload
        .get("list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_toplist)
        .collect()
}

fn read_discover_playlist_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("copywriter").and_then(read_non_empty_string)),
        cover_url: item
            .get("coverImgUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_album_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: item
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists")))
            .or_else(|| read_artists(item.get("ar"))),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_artist_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverCard {
        id,
        title,
        subtitle: None,
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("img1v1Url").and_then(read_non_empty_string)),
        cursor: None,
    })
}

fn read_discover_toplist(value: &Value) -> Option<NcmDiscoverToplist> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmDiscoverToplist {
        id,
        title,
        subtitle: item.get("updateTip").and_then(read_non_empty_string),
        description: item.get("description").and_then(read_non_empty_string),
        cover_url: item
            .get("coverImgUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        tracks: item
            .get("tracks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(read_discover_toplist_track)
            .collect(),
        is_official: item
            .get("ToplistType")
            .and_then(read_non_empty_string)
            .is_some(),
        cursor: read_discover_cursor(item),
    })
}

fn read_discover_toplist_track(value: &Value) -> Option<NcmDiscoverToplistTrack> {
    let item = value.as_object()?;
    let title = item
        .get("first")
        .and_then(read_non_empty_string)
        .or_else(|| item.get("name").and_then(read_non_empty_string))?;
    Some(NcmDiscoverToplistTrack {
        title,
        artist: item
            .get("second")
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("ar")))
            .or_else(|| read_artists(item.get("artists"))),
    })
}

pub(super) fn read_discover_playlist_categories(
    cat_payload: &Value,
    hq_payload: &Value,
) -> NcmDiscoverPlaylistCategories {
    let categories = cat_payload
        .get("categories")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(key, value)| Some((key.parse::<i64>().ok()?, read_non_empty_string(value)?)))
        .collect::<HashMap<_, _>>();
    let entries = cat_payload
        .get("sub")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_playlist_category_entry)
        .collect();
    let hq_names = hq_payload
        .get("tags")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(read_non_empty_string))
        .collect();
    NcmDiscoverPlaylistCategories {
        categories,
        entries,
        hq_names,
    }
}

fn read_discover_playlist_category_entry(
    value: &Value,
) -> Option<NcmDiscoverPlaylistCategoryEntry> {
    let item = value.as_object()?;
    Some(NcmDiscoverPlaylistCategoryEntry {
        name: item.get("name").and_then(read_non_empty_string)?,
        category: item.get("category").and_then(Value::as_i64).unwrap_or(0),
        hot: item.get("hot").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn read_discover_cursor(item: &serde_json::Map<String, Value>) -> Option<i64> {
    item.get("updateTime")
        .and_then(Value::as_i64)
        .or_else(|| item.get("trackNumberUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("trackUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("publishTime").and_then(Value::as_i64))
}

pub(super) fn read_page_has_more(
    payload: &Value,
    limit: i64,
    offset: i64,
    item_count: usize,
) -> bool {
    payload
        .get("more")
        .and_then(Value::as_bool)
        .or_else(|| payload.get("hasMore").and_then(Value::as_bool))
        .or_else(|| {
            payload
                .get("total")
                .and_then(Value::as_i64)
                .map(|total| offset.saturating_add(limit) < total)
        })
        .unwrap_or(item_count as i64 >= limit)
}

pub(super) fn discover_initial_param(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => number.as_i64().map(|value| value.to_string()),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        _ => None,
    }
}

pub(super) fn read_personalized_playlist_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_playlist_card)
        .collect()
}

pub(super) fn read_recommend_resource_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("recommend")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_recommend_resource_card)
        .collect()
}

pub(super) fn read_newest_album_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("albums")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_newest_album_card)
        .collect()
}

pub(super) fn read_top_artist_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_top_artist_card)
        .collect()
}

pub(super) fn read_personalized_mv_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_mv_card)
        .collect()
}

pub(super) fn read_personalized_dj_cards(payload: &Value) -> Vec<NcmHomeFeedCard> {
    payload
        .get("result")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_personalized_dj_card)
        .collect()
}

fn read_personalized_playlist_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("copywriter").and_then(read_non_empty_string)),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_recommend_resource_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item
            .get("playcount")
            .and_then(Value::as_f64)
            .or_else(|| item.get("playCount").and_then(Value::as_f64)),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_newest_album_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("artist")
            .and_then(|artist| artist.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists"))),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: None,
        description: item.get("description").and_then(read_non_empty_string),
    })
}

fn read_top_artist_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: None,
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("img1v1Url").and_then(read_non_empty_string)),
        play_count: None,
        description: None,
    })
}

fn read_personalized_mv_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("artistName")
            .and_then(read_non_empty_string)
            .or_else(|| read_artists(item.get("artists"))),
        cover_url: item
            .get("picUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("cover").and_then(read_non_empty_string)),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

fn read_personalized_dj_card(value: &Value) -> Option<NcmHomeFeedCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
        cover_url: item.get("picUrl").and_then(read_non_empty_string),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: item
            .get("copywriter")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("description").and_then(read_non_empty_string)),
    })
}

pub(super) fn read_radar_playlist_card(payload: &Value) -> Option<NcmHomeFeedCard> {
    let playlist = payload.get("playlist")?.as_object()?;
    let id = playlist.get("id").and_then(Value::as_i64)?;
    let title = playlist.get("name").and_then(read_non_empty_string)?;
    Some(NcmHomeFeedCard {
        id,
        title,
        subtitle: playlist
            .get("creator")
            .and_then(|creator| creator.get("nickname"))
            .and_then(read_non_empty_string),
        cover_url: playlist.get("coverImgUrl").and_then(read_non_empty_string),
        play_count: playlist.get("playCount").and_then(Value::as_f64),
        description: playlist.get("description").and_then(read_non_empty_string),
    })
}

pub(super) fn track_covers(tracks: &[NcmTrackSummary]) -> Vec<NcmHomeTrackCover> {
    tracks
        .iter()
        .map(|track| NcmHomeTrackCover {
            id: track.song_id,
            url: track.artwork_url.clone(),
        })
        .collect()
}

pub(super) fn personal_fm_preview(tracks: &[NcmTrackSummary]) -> Option<NcmHomePersonalFmPreview> {
    let track = tracks.first()?;
    let title = track.title.clone()?;
    Some(NcmHomePersonalFmPreview {
        title,
        artist: track.artist.clone(),
        album: track.album.clone(),
        cover_url: track.artwork_url.clone(),
    })
}

pub(super) fn read_search_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("songs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(super) fn read_search_playlists(payload: &Value) -> Vec<NcmPlaylistSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("playlists"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_playlist_summary)
        .collect()
}

pub(super) fn read_playlist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
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

pub(super) fn read_daily_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(|data| data.get("dailySongs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(super) fn read_top_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_wrapped_track_summary)
        .collect()
}

pub(super) fn read_song_detail_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("songs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(super) fn read_personal_fm_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

fn read_wrapped_track_summary(value: &Value) -> Option<NcmTrackSummary> {
    let item = value.as_object()?;
    let song = item.get("song").and_then(Value::as_object).unwrap_or(item);
    let mut rebuilt = song.clone();
    if !rebuilt.contains_key("id") {
        if let Some(id) = item.get("id") {
            rebuilt.insert("id".to_string(), id.clone());
        }
    }
    if !rebuilt.contains_key("name") {
        if let Some(name) = item.get("name") {
            rebuilt.insert("name".to_string(), name.clone());
        }
    }
    if !rebuilt.contains_key("picUrl") {
        if let Some(pic_url) = item.get("picUrl") {
            rebuilt.insert("picUrl".to_string(), pic_url.clone());
        }
    }
    if !rebuilt.contains_key("al") {
        if let Some(album) = song.get("al").or_else(|| song.get("album")) {
            rebuilt.insert("al".to_string(), album.clone());
        }
    }
    if !rebuilt.contains_key("ar") {
        let artists = song.get("ar").or_else(|| song.get("artists"));
        if let Some(artists) = artists {
            rebuilt.insert("ar".to_string(), artists.clone());
        }
    }
    if !rebuilt.contains_key("dt") {
        if let Some(duration) = song.get("dt").or_else(|| song.get("duration")) {
            rebuilt.insert("dt".to_string(), duration.clone());
        }
    }
    read_track_summary(&Value::Object(rebuilt))
}

pub(super) fn read_artist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("hotSongs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(super) fn read_likelist_ids(payload: &Value) -> Vec<i64> {
    payload
        .get("data")
        .and_then(|data| data.get("ids"))
        .or_else(|| payload.get("ids"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect()
}

pub(super) fn read_cloud_tracks_page(payload: &Value) -> NcmCloudTracksPage {
    NcmCloudTracksPage {
        tracks: read_cloud_tracks(payload),
        count: payload.get("count").and_then(Value::as_i64).unwrap_or(0),
        size_bytes: payload.get("size").and_then(Value::as_i64).unwrap_or(0),
        max_size_bytes: payload.get("maxSize").and_then(Value::as_i64).unwrap_or(0),
    }
}

fn read_cloud_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_cloud_track_summary)
        .collect()
}

fn read_cloud_track_summary(value: &Value) -> Option<NcmTrackSummary> {
    let item = value.as_object()?;
    let song = item
        .get("simpleSong")
        .or_else(|| item.get("songInfo"))
        .unwrap_or(value);
    let mut track = read_track_summary(song)?;
    track.id = format!("ncm-cloud-song-{}", track.song_id);
    track.size_bytes = item
        .get("fileSize")
        .or_else(|| item.get("size"))
        .and_then(Value::as_i64)
        .or_else(|| song.get("size").and_then(Value::as_i64));
    Some(track)
}

fn read_track_summary(value: &Value) -> Option<NcmTrackSummary> {
    let item = value.as_object()?;
    let song_id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    let album = item
        .get("al")
        .and_then(Value::as_object)
        .or_else(|| item.get("album").and_then(Value::as_object));
    let duration_ms = item
        .get("dt")
        .and_then(Value::as_f64)
        .or_else(|| item.get("duration").and_then(Value::as_f64));

    Some(NcmTrackSummary {
        id: format!("ncm-song-{}", song_id),
        song_id,
        source_path: format!("https://music.163.com/#/song?id={}", song_id),
        title: Some(title),
        artist: read_artists(item.get("ar"))
            .or_else(|| read_artists(item.get("artists")))
            .or_else(|| {
                item.get("artist")
                    .and_then(|artist| artist.get("name"))
                    .and_then(read_non_empty_string)
            }),
        album: album
            .and_then(|album| album.get("name"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("album").and_then(read_non_empty_string)),
        duration_secs: duration_ms.map(|value| value / 1000.0),
        artwork_url: album
            .and_then(|album| album.get("picUrl"))
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        size_bytes: item.get("size").and_then(Value::as_i64),
    })
}
