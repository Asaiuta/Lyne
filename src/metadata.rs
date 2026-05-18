use lofty::file::AudioFile;
use lofty::prelude::*;
use lofty::probe::Probe;

use crate::decoder::{StreamingDecoder, TrackMetadata};

/// Metadata extracted via `lofty` (more reliable than Symphonia for tags/cover art).
#[derive(Debug, Clone, Default)]
pub struct LoftyMetadata {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<u32>,
    pub disc_number: Option<u32>,
    pub genre: Option<String>,
    pub year: Option<u32>,
    pub cover_art: Option<Vec<u8>>,
    pub cover_art_mime: Option<String>,
    pub lyrics: Option<String>,
    pub duration_secs: Option<f64>,
    pub bitrate_bps: Option<f64>,
}

#[derive(Debug, Clone, Default)]
pub struct LocalMetadata {
    pub metadata: TrackMetadata,
    pub duration_secs: Option<f64>,
    pub sample_rate: Option<u32>,
    pub channels: Option<usize>,
    pub bitrate_bps: Option<f64>,
    pub bits_per_sample: Option<u32>,
    pub has_lofty_title: bool,
}

/// Extract metadata from an audio file using `lofty`.
///
/// Returns `None` if the file cannot be probed or has no tag.
/// Cover art is read lazily (only the first picture is taken).
pub fn extract_lofty_metadata(path: &str) -> Option<LoftyMetadata> {
    let tagged_file = Probe::open(path).ok()?.read().ok()?;

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;

    let mut meta = LoftyMetadata::default();

    meta.title = tag.title().map(|s| s.to_string());
    meta.artist = tag.artist().map(|s| s.to_string());
    meta.album = tag.album().map(|s| s.to_string());
    meta.album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
    meta.track_number = tag.track().map(|v| v as u32);
    meta.disc_number = tag.disk().map(|v| v as u32);
    meta.genre = tag.genre().map(|s| s.to_string());
    meta.lyrics = tag
        .get_string(&ItemKey::Lyrics)
        .and_then(non_empty_tag_string)
        .or_else(|| {
            [
                "LYRICS",
                "UNSYNCEDLYRICS",
                "UNSYNCED LYRICS",
                "UNSYNCHRONISEDLYRICS",
                "UNSYNCHRONISED LYRICS",
                "UNSYNCHRONIZEDLYRICS",
                "UNSYNCHRONIZED LYRICS",
                "SYNCEDLYRICS",
                "SYNCED LYRICS",
            ]
            .into_iter()
            .find_map(|key| {
                tag.get_string(&ItemKey::Unknown(key.to_string()))
                    .and_then(non_empty_tag_string)
            })
        });

    // lofty returns year from the Date tag; extract just the year component.
    if let Some(date_str) = tag.get_string(&ItemKey::RecordingDate) {
        meta.year = parse_year_from_date(date_str);
    } else if let Some(year_val) = tag.year() {
        meta.year = Some(year_val as u32);
    }

    // Cover art — take the first picture (typically front cover).
    if let Some(picture) = tag.pictures().first() {
        meta.cover_art = Some(picture.data().to_vec());
        meta.cover_art_mime = picture.mime_type().map(|m| m.to_string());
    }

    // Audio properties (duration, bitrate) — extracted in the same pass.
    let properties = tagged_file.properties();
    meta.duration_secs = Some(properties.duration().as_millis() as f64 / 1000.0);
    meta.bitrate_bps = properties
        .audio_bitrate()
        .map(|kbps| f64::from(kbps) * 1000.0);

    Some(meta)
}

/// Read local-file metadata through the same sources the player and library use.
///
/// Symphonia is the runtime source and can expose embedded visuals that lofty may
/// miss for some containers. Lofty then overlays richer text tags while keeping
/// Symphonia cover art when lofty has no picture.
pub fn read_local_metadata(path: &str) -> Result<LocalMetadata, String> {
    let mut result = LocalMetadata::default();

    match StreamingDecoder::open(path) {
        Ok(decoder) => {
            let info = decoder.info.clone();
            result.metadata = info.metadata;
            result.duration_secs = info.duration_secs;
            result.sample_rate = Some(info.sample_rate);
            result.channels = Some(info.channels);
            result.bits_per_sample = info.bits_per_sample;
        }
        Err(e) => {
            log::debug!("Symphonia metadata read failed for '{}': {}", path, e);
        }
    }

    if let Some(lofty_meta) = extract_lofty_metadata(path) {
        result.has_lofty_title = lofty_meta.title.as_deref().is_some();
        if result.duration_secs.is_none() {
            result.duration_secs = lofty_meta.duration_secs;
        }
        if result.bitrate_bps.is_none() {
            result.bitrate_bps = lofty_meta.bitrate_bps;
        }
        merge_lofty_into(&mut result.metadata, &lofty_meta);
    }

    if result.duration_secs.is_none()
        && result.sample_rate.is_none()
        && result.channels.is_none()
        && result.metadata.title.is_none()
        && result.metadata.artist.is_none()
        && result.metadata.album.is_none()
        && result.metadata.cover_art.is_none()
    {
        return Err(format!("No readable metadata for '{}'", path));
    }

    Ok(result)
}

/// Parse a 4-digit year from a date string that may be `"2023"`, `"2023-01-15"`, etc.
fn parse_year_from_date(date_str: &str) -> Option<u32> {
    let trimmed = date_str.trim();
    if trimmed.len() >= 4 {
        trimmed[..4].parse::<u32>().ok()
    } else {
        trimmed.parse::<u32>().ok()
    }
}

fn non_empty_tag_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Merge lofty metadata into Symphonia's `TrackMetadata`.
///
/// Fields from `lofty` take precedence because its tag parsing is more complete.
/// Cover art from `lofty` is only used if Symphonia didn't find any.
pub fn merge_lofty_into(symphonia: &mut TrackMetadata, lofty_meta: &LoftyMetadata) {
    if let Some(ref v) = lofty_meta.title {
        symphonia.title = Some(v.clone());
    }
    if let Some(ref v) = lofty_meta.artist {
        symphonia.artist = Some(v.clone());
    }
    if let Some(ref v) = lofty_meta.album {
        symphonia.album = Some(v.clone());
    }
    if let Some(v) = lofty_meta.track_number {
        symphonia.track_number = Some(v);
    }
    if let Some(v) = lofty_meta.disc_number {
        symphonia.disc_number = Some(v);
    }
    if let Some(ref v) = lofty_meta.genre {
        symphonia.genre = Some(v.clone());
    }
    if let Some(v) = lofty_meta.year {
        symphonia.year = Some(v);
    }
    if let Some(ref v) = lofty_meta.lyrics {
        symphonia.lyrics = Some(v.clone());
    }
    // Only use lofty cover art if Symphonia didn't extract any.
    if symphonia.cover_art.is_none() {
        if let Some(ref art) = lofty_meta.cover_art {
            symphonia.cover_art = Some(art.clone());
            symphonia.cover_art_mime = lofty_meta.cover_art_mime.clone();
        }
    }
}
