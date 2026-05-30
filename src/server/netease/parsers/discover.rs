use super::super::types::{
    NcmDiscoverCard, NcmDiscoverPlaylistCategories, NcmDiscoverPlaylistCategoryEntry,
    NcmDiscoverToplist, NcmDiscoverToplistTrack,
};
use super::{read_artists, read_non_empty_string};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub(in crate::server::netease) fn read_discover_playlist_cards(
    payload: &Value,
) -> Vec<NcmDiscoverCard> {
    payload
        .get("playlists")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_playlist_card)
        .collect()
}

pub(in crate::server::netease) fn read_discover_album_cards(
    payload: &Value,
) -> Vec<NcmDiscoverCard> {
    payload
        .get("albums")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_album_card)
        .collect()
}

pub(in crate::server::netease) fn read_discover_artist_cards(
    payload: &Value,
) -> Vec<NcmDiscoverCard> {
    payload
        .get("artists")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_artist_card)
        .collect()
}

pub(in crate::server::netease) fn read_discover_toplists(
    payload: &Value,
) -> Vec<NcmDiscoverToplist> {
    payload
        .get("list")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_toplist)
        .collect()
}

pub(in crate::server::netease) fn read_discover_playlist_categories(
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

pub(in crate::server::netease) fn read_page_has_more(
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

pub(in crate::server::netease) fn discover_initial_param(value: &Value) -> Option<String> {
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

fn read_discover_playlist_card(value: &Value) -> Option<NcmDiscoverCard> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    let user_id = read_discover_user_id(item);
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
        user_id,
        creator_id: read_discover_creator_id(item).or(user_id),
        track_count: read_discover_track_count(item),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: read_discover_description(item),
        tags: read_discover_tags(item),
        create_time: item.get("createTime").and_then(Value::as_i64),
        update_time: read_discover_update_time(item),
        privacy: item.get("privacy").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
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
        user_id: None,
        creator_id: None,
        track_count: read_discover_track_count(item),
        play_count: item.get("playCount").and_then(Value::as_f64),
        description: read_discover_description(item),
        tags: read_discover_tags(item),
        create_time: item
            .get("publishTime")
            .and_then(Value::as_i64)
            .or_else(|| item.get("createTime").and_then(Value::as_i64)),
        update_time: read_discover_update_time(item),
        privacy: item.get("privacy").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
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
        user_id: None,
        creator_id: None,
        track_count: item
            .get("musicSize")
            .and_then(Value::as_i64)
            .or_else(|| item.get("albumSize").and_then(Value::as_i64)),
        play_count: item.get("fans").and_then(Value::as_f64),
        description: read_discover_description(item),
        tags: read_discover_tags(item),
        create_time: None,
        update_time: read_discover_update_time(item),
        privacy: item.get("privacy").and_then(Value::as_i64),
        subscribed: item
            .get("followed")
            .and_then(Value::as_bool)
            .or_else(|| item.get("subscribed").and_then(Value::as_bool))
            .unwrap_or(false),
    })
}

fn read_discover_toplist(value: &Value) -> Option<NcmDiscoverToplist> {
    let item = value.as_object()?;
    let id = item.get("id").and_then(Value::as_i64)?;
    let title = item.get("name").and_then(read_non_empty_string)?;
    let tracks = item
        .get("tracks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_discover_toplist_track)
        .collect::<Vec<_>>();
    let user_id = read_discover_user_id(item);
    Some(NcmDiscoverToplist {
        id,
        title,
        subtitle: item.get("updateTip").and_then(read_non_empty_string),
        description: item.get("description").and_then(read_non_empty_string),
        cover_url: item
            .get("coverImgUrl")
            .and_then(read_non_empty_string)
            .or_else(|| item.get("picUrl").and_then(read_non_empty_string)),
        tracks,
        is_official: item
            .get("ToplistType")
            .and_then(read_non_empty_string)
            .is_some(),
        cursor: read_discover_cursor(item),
        user_id,
        creator_id: read_discover_creator_id(item).or(user_id),
        track_count: read_discover_track_count(item),
        play_count: item.get("playCount").and_then(Value::as_f64),
        tags: read_discover_tags(item),
        create_time: item.get("createTime").and_then(Value::as_i64),
        update_time: read_discover_update_time(item),
        privacy: item.get("privacy").and_then(Value::as_i64),
        subscribed: item
            .get("subscribed")
            .and_then(Value::as_bool)
            .unwrap_or(false),
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

fn read_discover_cursor(item: &Map<String, Value>) -> Option<i64> {
    read_discover_update_time(item)
}

fn read_discover_update_time(item: &Map<String, Value>) -> Option<i64> {
    item.get("updateTime")
        .and_then(Value::as_i64)
        .or_else(|| item.get("trackNumberUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("trackUpdateTime").and_then(Value::as_i64))
        .or_else(|| item.get("publishTime").and_then(Value::as_i64))
}

fn read_discover_user_id(item: &Map<String, Value>) -> Option<i64> {
    item.get("userId")
        .and_then(Value::as_i64)
        .or_else(|| {
            item.get("creator")
                .and_then(|creator| creator.get("userId"))
                .and_then(Value::as_i64)
        })
        .or_else(|| {
            item.get("creator")
                .and_then(|creator| creator.get("id"))
                .and_then(Value::as_i64)
        })
}

fn read_discover_creator_id(item: &Map<String, Value>) -> Option<i64> {
    item.get("creator")
        .and_then(|creator| creator.get("userId"))
        .and_then(Value::as_i64)
        .or_else(|| {
            item.get("creator")
                .and_then(|creator| creator.get("id"))
                .and_then(Value::as_i64)
        })
}

fn read_discover_track_count(item: &Map<String, Value>) -> Option<i64> {
    item.get("trackCount")
        .and_then(Value::as_i64)
        .or_else(|| item.get("size").and_then(Value::as_i64))
        .or_else(|| item.get("programCount").and_then(Value::as_i64))
}

fn read_discover_description(item: &Map<String, Value>) -> Option<String> {
    item.get("description")
        .and_then(read_non_empty_string)
        .or_else(|| item.get("desc").and_then(read_non_empty_string))
        .or_else(|| item.get("copywriter").and_then(read_non_empty_string))
        .or_else(|| item.get("updateFrequency").and_then(read_non_empty_string))
}

fn read_discover_tags(item: &Map<String, Value>) -> Vec<String> {
    item.get("tags")
        .or_else(|| item.get("algTags"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_non_empty_string)
        .chain(
            item.get("videoGroup")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|tag| tag.get("name").and_then(read_non_empty_string)),
        )
        .chain(item.get("category").and_then(read_non_empty_string))
        .collect()
}
