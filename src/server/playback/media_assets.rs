use super::*;
use actix_web::{web, HttpResponse};
use encoding_rs::{GBK, UTF_16BE, UTF_16LE, UTF_8};
use std::path::{Path, PathBuf};
use std::sync::Arc;

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
    let metadata = metadata_with_external_cover(path, &local_metadata.metadata);

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
        let mut lyric_lines = lyrics::read_lyric_lines_from_source(&lyric_text, &source);
        if lyric_lines.is_empty() {
            lyric_lines = lyrics::read_embedded_lyric_lines(&lyric_text);
        }
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

fn read_embedded_lyrics_if_present(lyric_text: &str) -> Option<Vec<lyrics::LyricLine>> {
    let lyric_lines = lyrics::read_embedded_lyric_lines(lyric_text);
    (!lyric_lines.is_empty()).then_some(lyric_lines)
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
    use super::{decode_lyric_bytes, read_current_local_lyrics};
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
