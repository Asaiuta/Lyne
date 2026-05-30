use super::super::types::{NcmCloudTracksPage, NcmTrackDetail, NcmTrackSummary};
use super::{read_artist_summaries, read_artists, read_non_empty_string};
use serde_json::Value;

const EXPLICIT_CONTENT_MARK: i64 = 1_048_576;
const PRIVILEGE_LEVEL_KEYS: [&str; 6] = [
    "playMaxBrLevel",
    "downloadMaxBrLevel",
    "maxBrLevel",
    "flLevel",
    "dlLevel",
    "plLevel",
];

fn read_quality_label(item: &serde_json::Map<String, Value>) -> Option<String> {
    let privilege = item.get("privilege").and_then(Value::as_object);
    let level = item.get("level").and_then(Value::as_str);

    for (keys, candidate_level, label) in [
        (&["jm", "jmMusic"][..], "jymaster", "Master"),
        (&["db", "dbMusic"][..], "dolby", "Dolby"),
        (&["sk", "skMusic"][..], "sky", "Spatial"),
        (&["je", "jeMusic"][..], "jyeffect", "Surround"),
        (&["hr", "hrMusic"][..], "hires", "Hi-Res"),
        (&["sq", "sqMusic"][..], "lossless", "SQ"),
        (&["h", "hMusic"][..], "exhigh", "HQ"),
        (&["m", "mMusic"][..], "higher", "MQ"),
        (&["l", "lMusic"][..], "standard", "LQ"),
    ] {
        let has_quality_field = keys
            .iter()
            .any(|key| has_positive_quality_bitrate(item.get(*key)));
        let matches_level = level.is_some_and(|value| value.eq_ignore_ascii_case(candidate_level));
        let matches_privilege = privilege.is_some_and(|privilege| {
            PRIVILEGE_LEVEL_KEYS.iter().any(|key| {
                privilege
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(|value| value.eq_ignore_ascii_case(candidate_level))
            })
        });

        if has_quality_field || matches_level || matches_privilege {
            return Some(label.to_string());
        }
    }

    None
}

fn has_positive_quality_bitrate(value: Option<&Value>) -> bool {
    value
        .and_then(|value| value.get("br").or_else(|| value.get("bitrate")))
        .and_then(Value::as_i64)
        .is_some_and(|br| br > 0)
}

fn read_privilege_tag(item: &serde_json::Map<String, Value>) -> Option<String> {
    match item.get("fee").and_then(Value::as_i64).unwrap_or(0) {
        1 => Some("VIP".to_string()),
        4 => Some("EP".to_string()),
        _ => None,
    }
}

fn read_original_tag(item: &serde_json::Map<String, Value>) -> Option<String> {
    match item.get("originCoverType").and_then(Value::as_i64) {
        Some(1) => Some("原".to_string()),
        Some(2) => Some("翻唱".to_string()),
        _ => None,
    }
}

fn read_mv_id(item: &serde_json::Map<String, Value>) -> Option<i64> {
    item.get("mv")
        .or_else(|| item.get("mvid"))
        .and_then(Value::as_i64)
        .filter(|id| *id > 0)
}

pub(in crate::server::netease) fn read_song_url(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("url"))
        .and_then(read_non_empty_string)
}

pub(in crate::server::netease) fn read_song_detail(
    payload: &Value,
    fallback_song_id: i64,
) -> Option<NcmTrackDetail> {
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
        artists: read_artist_summaries(target.get("ar").or_else(|| target.get("artists"))),
        album: album
            .and_then(|album| album.get("name"))
            .and_then(read_non_empty_string),
        album_id: album
            .and_then(|album| album.get("id"))
            .and_then(Value::as_i64)
            .filter(|id| *id > 0),
        cover_url: album
            .and_then(|album| album.get("picUrl"))
            .and_then(read_non_empty_string)
            .or_else(|| target.get("picUrl").and_then(read_non_empty_string)),
    })
}

pub(in crate::server::netease) fn read_song_dynamic_cover_url(payload: &Value) -> Option<String> {
    payload
        .get("data")
        .and_then(|data| data.get("videoPlayUrl"))
        .and_then(read_non_empty_string)
        .or_else(|| payload.get("videoPlayUrl").and_then(read_non_empty_string))
}

pub(in crate::server::netease) fn read_search_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("result")
        .and_then(|result| result.get("songs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_daily_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(|data| data.get("dailySongs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_top_song_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .or_else(|| payload.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_wrapped_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_song_detail_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("songs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_personal_fm_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_heartbeat_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("songInfo")
                .and_then(read_track_summary)
                .or_else(|| read_track_summary(item))
        })
        .collect()
}

pub(in crate::server::netease) fn read_daily_dislike_replacement(
    payload: &Value,
) -> Option<NcmTrackSummary> {
    payload
        .get("data")
        .and_then(|data| {
            read_track_summary(data).or_else(|| {
                data.get("song")
                    .or_else(|| data.get("simpleSong"))
                    .and_then(read_track_summary)
            })
        })
        .or_else(|| payload.get("song").and_then(read_track_summary))
}

pub(in crate::server::netease) fn read_artist_tracks(payload: &Value) -> Vec<NcmTrackSummary> {
    payload
        .get("songs")
        .or_else(|| payload.get("hotSongs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(read_track_summary)
        .collect()
}

pub(in crate::server::netease) fn read_likelist_ids(payload: &Value) -> Vec<i64> {
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

pub(in crate::server::netease) fn read_cloud_tracks_page(payload: &Value) -> NcmCloudTracksPage {
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
    track.is_cloud = true;
    track.size_bytes = item
        .get("fileSize")
        .or_else(|| item.get("size"))
        .and_then(Value::as_i64)
        .or_else(|| song.get("size").and_then(Value::as_i64));
    Some(track)
}

pub(in crate::server::netease) fn read_track_summary(value: &Value) -> Option<NcmTrackSummary> {
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
        quality_label: read_quality_label(item),
        privilege_tag: read_privilege_tag(item),
        explicit: item
            .get("mark")
            .and_then(Value::as_i64)
            .is_some_and(|mark| mark & EXPLICIT_CONTENT_MARK != 0),
        original_tag: read_original_tag(item),
        mv_id: read_mv_id(item),
        is_cloud: item.get("pc").and_then(Value::as_bool).unwrap_or(false),
    })
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
