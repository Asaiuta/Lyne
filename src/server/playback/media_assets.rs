use super::*;
use actix_web::{web, HttpResponse};
use encoding_rs::{GBK, UTF_16BE, UTF_16LE, UTF_8};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const LOCAL_OVERRIDE_LYRIC_EXTENSIONS: [&str; 2] = ["ttml", "lrc"];

pub(super) fn get_media_cover_art_by_id(
    data: &web::Data<Arc<AppState>>,
    media_id: &str,
) -> HttpResponse {
    match data.app_db.get_cover_art_for_media(media_id) {
        Ok(Some((record, bytes))) => {
            let mime = record
                .mime_type
                .clone()
                .unwrap_or_else(|| "application/octet-stream".to_string());
            HttpResponse::Ok()
                .insert_header(("Content-Type", mime))
                .insert_header(("Content-Length", bytes.len().to_string()))
                .insert_header(("X-Cover-Art-Id", record.cover_art_id))
                .body(bytes)
        }
        Ok(None) => match runtime_cover_art_for_media(data, media_id) {
            Some((mime, bytes)) => HttpResponse::Ok()
                .insert_header(("Content-Type", mime))
                .insert_header(("Content-Length", bytes.len().to_string()))
                .insert_header(("X-Cover-Art-Id", format!("{}:runtime-cover", media_id)))
                .body(bytes),
            None => match local_cover_art_for_media(data, media_id) {
                Ok(Some((mime, bytes))) => HttpResponse::Ok()
                    .insert_header(("Content-Type", mime))
                    .insert_header(("Content-Length", bytes.len().to_string()))
                    .insert_header(("X-Cover-Art-Id", format!("{}:local-cover", media_id)))
                    .body(bytes),
                Ok(None) => not_found_response("Cover art not found"),
                Err(e) => internal_server_error_response(e),
            },
        },
        Err(e) => internal_server_error_response(e),
    }
}

fn runtime_cover_art_for_media(
    data: &web::Data<Arc<AppState>>,
    media_id: &str,
) -> Option<(String, Vec<u8>)> {
    let player = data.player.lock();
    let shared = player.shared_state();
    let current_track_path = shared.current_track_path.read().clone();
    let file_path = shared.file_path.read().clone();
    let current_path = current_track_path.or(file_path)?;
    if !same_media_identity(&current_path, media_id) {
        return None;
    }

    let metadata = shared.track_metadata.read();
    let bytes = metadata.cover_art.clone()?;
    let mime = metadata
        .cover_art_mime
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    Some((mime, bytes))
}

fn local_cover_art_for_media(
    data: &web::Data<Arc<AppState>>,
    media_id: &str,
) -> Result<Option<(String, Vec<u8>)>, String> {
    let Some(source_path) = data.app_db.source_path_for_media_id(media_id)? else {
        return Ok(None);
    };
    if source_path.starts_with("http://") || source_path.starts_with("https://") {
        return Ok(None);
    }

    let path = Path::new(&source_path);
    let local_metadata = match crate::metadata::read_local_metadata(&source_path) {
        Ok(value) => value,
        Err(e) => {
            log::warn!(
                "Cover art metadata read failed for '{}': {}",
                source_path,
                e
            );
            return Ok(None);
        }
    };
    let metadata = metadata_with_external_cover(
        path,
        &local_metadata.metadata,
        data.analysis.library_scan_cover_max_bytes,
    );

    let Some(bytes) = metadata.cover_art.clone() else {
        return Ok(None);
    };
    let mime = metadata
        .cover_art_mime
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let duration_secs = local_metadata.duration_secs;

    data.app_db
        .record_media_metadata(&source_path, &metadata, duration_secs, None, None)?;

    Ok(Some((mime, bytes)))
}

pub(super) fn read_current_local_lyrics(
    path: &str,
    runtime_lyrics: Option<&str>,
) -> Result<Option<(Vec<lyrics::LyricLine>, String)>, String> {
    if let Some((lyric_text, source)) = read_sidecar_lyrics(path)? {
        let lyric_lines = parse_lyric_text_for_display(&lyric_text, &source);
        if !lyric_lines.is_empty() {
            return Ok(Some((lyric_lines, source)));
        }
    }

    if let Some(lyric_lines) = runtime_lyrics.and_then(read_embedded_lyrics_if_present) {
        return Ok(Some((lyric_lines, "embedded".to_string())));
    }

    match crate::metadata::read_local_metadata(path) {
        Ok(local_metadata) => Ok(local_metadata
            .metadata
            .lyrics
            .as_deref()
            .and_then(read_embedded_lyrics_if_present)
            .map(|lines| (lines, "embedded".to_string()))),
        Err(e) => {
            log::debug!("Embedded lyric metadata read failed for '{}': {}", path, e);
            Ok(None)
        }
    }
}

pub(super) fn read_local_override_lyrics(
    lyric_dirs: &[String],
    song_id: i64,
) -> Result<Option<(Vec<lyrics::LyricLine>, String)>, String> {
    if song_id <= 0 || lyric_dirs.is_empty() {
        return Ok(None);
    }

    let dirs = canonical_local_lyric_dirs(lyric_dirs);
    if dirs.is_empty() {
        return Ok(None);
    }

    for extension in LOCAL_OVERRIDE_LYRIC_EXTENSIONS {
        for dir in &dirs {
            let Some(candidate) = find_local_override_lyric_file(dir, song_id, extension)? else {
                continue;
            };
            let content = read_lyric_file_lossy(&candidate).map_err(|error| {
                format!(
                    "Failed to read local lyric override '{}': {}",
                    candidate.display(),
                    error
                )
            })?;
            if content.trim().is_empty() {
                continue;
            }

            let lyric_lines = parse_lyric_text_for_display(&content, extension);
            if !lyric_lines.is_empty() {
                return Ok(Some((lyric_lines, format!("local-override:{extension}"))));
            }
        }
    }

    Ok(None)
}

fn parse_lyric_text_for_display(lyric_text: &str, source: &str) -> Vec<lyrics::LyricLine> {
    let mut lyric_lines = lyrics::read_lyric_lines_from_source(lyric_text, source);
    if lyric_lines.is_empty() {
        lyric_lines = lyrics::read_embedded_lyric_lines(lyric_text);
    }
    lyric_lines
}

fn read_embedded_lyrics_if_present(lyric_text: &str) -> Option<Vec<lyrics::LyricLine>> {
    let lyric_lines = lyrics::read_embedded_lyric_lines(lyric_text);
    (!lyric_lines.is_empty()).then_some(lyric_lines)
}

fn canonical_local_lyric_dirs(lyric_dirs: &[String]) -> Vec<PathBuf> {
    lyric_dirs
        .iter()
        .filter_map(|raw_dir| {
            let dir = raw_dir.trim();
            if dir.is_empty()
                || dir
                    .get(..7)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case("http://"))
                || dir
                    .get(..8)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case("https://"))
            {
                return None;
            }
            match validate_path(dir) {
                Ok(path) => {
                    let path = PathBuf::from(path);
                    if path.is_dir() {
                        Some(path)
                    } else {
                        log::debug!("Local lyric override path is not a directory: '{}'", dir);
                        None
                    }
                }
                Err(error) => {
                    log::debug!(
                        "Local lyric override directory rejected '{}': {}",
                        dir,
                        error
                    );
                    None
                }
            }
        })
        .collect()
}

fn find_local_override_lyric_file(
    root: &Path,
    song_id: i64,
    extension: &str,
) -> Result<Option<PathBuf>, String> {
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(error) => {
                log::debug!(
                    "Failed to read local lyric override directory '{}': {}",
                    dir.display(),
                    error
                );
                continue;
            }
        };

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Failed to read local lyric override entry under '{}': {}",
                    dir.display(),
                    error
                )
            })?;
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(error) => {
                    log::debug!(
                        "Failed to inspect local lyric override entry '{}': {}",
                        entry.path().display(),
                        error
                    );
                    continue;
                }
            };

            if file_type.is_symlink() {
                continue;
            }

            let path = entry.path();
            if file_type.is_dir() {
                stack.push(path);
                continue;
            }
            if file_type.is_file() && matches_local_override_lyric_name(&path, song_id, extension) {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn matches_local_override_lyric_name(path: &Path, song_id: i64, extension: &str) -> bool {
    let Some(file_extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !file_extension.eq_ignore_ascii_case(extension) {
        return false;
    }

    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let song_id = song_id.to_string();
    stem == song_id || stem.ends_with(&format!(".{song_id}"))
}

/// On-disk cache path for lyrics fetched online by track title/artist. Keyed by a
/// hash of the normalized metadata so the same song resolves regardless of file path.
fn online_lyrics_cache_file(cache_dir: &Path, title: &str, artist: Option<&str>) -> PathBuf {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    title.trim().to_lowercase().hash(&mut hasher);
    artist.unwrap_or("").trim().to_lowercase().hash(&mut hasher);
    cache_dir
        .join("online-lyrics")
        .join(format!("{:016x}.json", hasher.finish()))
}

/// Read previously fetched online lyrics for this track, if cached. Returns `None`
/// on a cache miss, unreadable file, or empty/corrupt payload.
pub(super) fn read_cached_online_lyrics(
    cache_dir: &Path,
    title: &str,
    artist: Option<&str>,
) -> Option<Vec<lyrics::LyricLine>> {
    let path = online_lyrics_cache_file(cache_dir, title, artist);
    let bytes = std::fs::read(&path).ok()?;
    match serde_json::from_slice::<Vec<lyrics::LyricLine>>(&bytes) {
        Ok(lines) if !lines.is_empty() => Some(lines),
        _ => None,
    }
}

/// Persist online-fetched lyrics so subsequent plays resolve instantly and offline.
/// Cache write failures are logged but never surfaced to the caller.
pub(super) fn write_cached_online_lyrics(
    cache_dir: &Path,
    title: &str,
    artist: Option<&str>,
    lines: &[lyrics::LyricLine],
) {
    let path = online_lyrics_cache_file(cache_dir, title, artist);
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            log::warn!("Failed to create online-lyrics cache dir: {e}");
            return;
        }
    }
    match serde_json::to_vec(lines) {
        Ok(bytes) => {
            if let Err(e) = std::fs::write(&path, bytes) {
                log::warn!(
                    "Failed to write online-lyrics cache '{}': {e}",
                    path.display()
                );
            }
        }
        Err(e) => log::warn!("Failed to serialize online lyrics for cache: {e}"),
    }
}

fn read_sidecar_lyrics(path: &str) -> Result<Option<(String, String)>, String> {
    let track_path = Path::new(path);
    let stem = match track_path.file_stem().and_then(|value| value.to_str()) {
        Some(value) if !value.trim().is_empty() => value,
        _ => return Ok(None),
    };
    let parent = match track_path.parent() {
        Some(value) => value,
        None => return Ok(None),
    };

    for extension in [
        "ttml", "yrc", "lrc", "qrc", "lys", "eslrc", "srt", "ass", "ssa",
    ] {
        let Some(candidate) = find_sidecar_lyric_file(parent, stem, path, extension) else {
            continue;
        };

        let content = read_lyric_file_lossy(&candidate).map_err(|error| {
            format!(
                "Failed to read lyric file '{}': {}",
                candidate.display(),
                error
            )
        })?;

        if content.trim().is_empty() {
            continue;
        }

        return Ok(Some((content, extension.to_string())));
    }

    Ok(None)
}

fn find_sidecar_lyric_file(
    parent: &Path,
    stem: &str,
    path: &str,
    extension: &str,
) -> Option<PathBuf> {
    let expected_name = format!("{stem}.{extension}");
    let expected_lower = expected_name.to_ascii_lowercase();

    if let Ok(entries) = std::fs::read_dir(parent) {
        if let Some(candidate) = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|candidate| {
                candidate
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(|name| name.to_ascii_lowercase() == expected_lower)
                    .unwrap_or(false)
                    && candidate.is_file()
            })
        {
            return Some(candidate);
        }
    }

    let same_stem_candidate = parent.join(expected_name);
    if same_stem_candidate.is_file() {
        return Some(same_stem_candidate);
    }

    let suffixed_candidate = Path::new(&format!("{path}.{extension}")).to_path_buf();
    suffixed_candidate.is_file().then_some(suffixed_candidate)
}

fn read_lyric_file_lossy(path: &Path) -> Result<String, std::io::Error> {
    let bytes = std::fs::read(path)?;
    Ok(decode_lyric_bytes(&bytes))
}

fn decode_lyric_bytes(bytes: &[u8]) -> String {
    if let Some(content) = decode_bom_prefixed_lyric_bytes(bytes) {
        return content;
    }

    if let Some(content) = decode_utf16_without_bom(bytes) {
        return content;
    }

    let (content, _, had_errors) = UTF_8.decode(bytes);
    if !had_errors {
        return content.into_owned();
    }

    let (content, _, _) = GBK.decode(bytes);
    content.into_owned()
}

fn decode_bom_prefixed_lyric_bytes(bytes: &[u8]) -> Option<String> {
    if let Some(content) = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        let (content, _, _) = UTF_8.decode(content);
        return Some(content.into_owned());
    }
    if let Some(content) = bytes.strip_prefix(&[0xFF, 0xFE]) {
        let (content, _, _) = UTF_16LE.decode(content);
        return Some(content.into_owned());
    }
    if let Some(content) = bytes.strip_prefix(&[0xFE, 0xFF]) {
        let (content, _, _) = UTF_16BE.decode(content);
        return Some(content.into_owned());
    }

    None
}

fn decode_utf16_without_bom(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 4 || bytes.len() % 2 != 0 {
        return None;
    }

    let pairs = bytes.len() / 2;
    let even_zeroes = bytes.iter().step_by(2).filter(|byte| **byte == 0).count();
    let odd_zeroes = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|byte| **byte == 0)
        .count();
    let likely_utf16le = odd_zeroes * 2 >= pairs && even_zeroes * 8 <= pairs;
    let likely_utf16be = even_zeroes * 2 >= pairs && odd_zeroes * 8 <= pairs;

    if likely_utf16le {
        let (content, _, _) = UTF_16LE.decode(bytes);
        return Some(content.into_owned());
    }
    if likely_utf16be {
        let (content, _, _) = UTF_16BE.decode(bytes);
        return Some(content.into_owned());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{decode_lyric_bytes, read_current_local_lyrics, read_local_override_lyrics};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_lyric_dir(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("audio_player_{name}_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn read_current_local_lyrics_uses_runtime_embedded_when_present() {
        let result =
            read_current_local_lyrics("D:/music/example.flac", Some("[00:01.00]Hello world"))
                .unwrap();

        let Some((lines, source)) = result else {
            panic!("expected embedded lyrics");
        };

        assert_eq!(source, "embedded");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Hello world");
    }

    #[test]
    fn read_current_local_lyrics_finds_sidecar_case_insensitively() {
        let dir = temp_lyric_dir("case_sidecar");
        let track_path = dir.join("Example.flac");
        let lyric_path = dir.join("example.LRC");
        fs::write(&track_path, b"not-a-real-audio-file").unwrap();
        fs::write(&lyric_path, "[00:01.00]Case matched").unwrap();

        let result = read_current_local_lyrics(track_path.to_str().unwrap(), None).unwrap();

        let Some((lines, source)) = result else {
            panic!("expected sidecar lyrics");
        };
        assert_eq!(source, "lrc");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Case matched");

        let _ = fs::remove_file(track_path);
        let _ = fs::remove_file(lyric_path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn read_current_local_lyrics_accepts_plain_text_sidecar() {
        let dir = temp_lyric_dir("plain_sidecar");
        let track_path = dir.join("Plain.flac");
        let lyric_path = dir.join("Plain.lrc");
        fs::write(&track_path, b"not-a-real-audio-file").unwrap();
        fs::write(&lyric_path, "First line\n\n[by:tag]\nSecond line").unwrap();

        let result = read_current_local_lyrics(track_path.to_str().unwrap(), None).unwrap();

        let Some((lines, source)) = result else {
            panic!("expected plain sidecar lyrics");
        };
        assert_eq!(source, "lrc");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text, "First line");
        assert_eq!(lines[1].text, "Second line");

        let _ = fs::remove_file(track_path);
        let _ = fs::remove_file(lyric_path);
        let _ = fs::remove_dir(dir);
    }

    #[test]
    fn read_local_override_lyrics_finds_nested_splayer_id_suffix() {
        let dir = temp_lyric_dir("override_nested");
        let nested = dir.join("artist").join("album");
        fs::create_dir_all(&nested).unwrap();
        let lyric_path = nested.join("Artist - Title.12345.lrc");
        fs::write(&lyric_path, "[00:01.00]Override lyric").unwrap();

        let result =
            read_local_override_lyrics(&[dir.to_string_lossy().to_string()], 12345).unwrap();

        let Some((lines, source)) = result else {
            panic!("expected local override lyrics");
        };
        assert_eq!(source, "local-override:lrc");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Override lyric");

        let _ = fs::remove_file(lyric_path);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn read_local_override_lyrics_prefers_ttml_over_lrc() {
        let dir = temp_lyric_dir("override_priority");
        fs::write(dir.join("12345.lrc"), "[00:01.00]LRC lyric").unwrap();
        fs::write(
            dir.join("12345.ttml"),
            "<tt><body><p begin=\"00:01.000\" end=\"00:02.000\">TTML lyric</p></body></tt>",
        )
        .unwrap();

        let result =
            read_local_override_lyrics(&[dir.to_string_lossy().to_string()], 12345).unwrap();

        let Some((lines, source)) = result else {
            panic!("expected local override lyrics");
        };
        assert_eq!(source, "local-override:ttml");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "TTML lyric");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn decode_lyric_bytes_accepts_gbk_sidecar_text() {
        let bytes = [
            0x5B, 0x30, 0x30, 0x3A, 0x30, 0x31, 0x2E, 0x30, 0x30, 0x5D, 0xC4, 0xE3, 0xBA, 0xC3,
        ];
        assert_eq!(decode_lyric_bytes(&bytes), "[00:01.00]你好");
    }

    #[test]
    fn decode_lyric_bytes_accepts_utf16le_without_bom() {
        let bytes = [
            0x5B, 0x00, 0x30, 0x00, 0x30, 0x00, 0x3A, 0x00, 0x30, 0x00, 0x31, 0x00, 0x2E, 0x00,
            0x30, 0x00, 0x30, 0x00, 0x5D, 0x00, 0x60, 0x4F, 0x7D, 0x59,
        ];
        assert_eq!(decode_lyric_bytes(&bytes), "[00:01.00]你好");
    }
}
