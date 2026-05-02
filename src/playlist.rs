//! Playlist parsing and validation.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlaylistEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlaylistLoadResult {
    pub entries: Vec<PlaylistEntry>,
    pub rejected: Vec<RejectedPlaylistEntry>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RejectedPlaylistEntry {
    pub path: String,
    pub reason: String,
}

pub fn parse_m3u(content: &str) -> Vec<PlaylistEntry> {
    let mut entries = Vec::new();
    let mut pending_title = None;
    let mut pending_duration = None;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        if let Some(extinf) = line.strip_prefix("#EXTINF:") {
            let (duration, title) = parse_extinf(extinf);
            pending_duration = duration;
            pending_title = title;
            continue;
        }

        if line.starts_with('#') {
            continue;
        }

        entries.push(PlaylistEntry {
            path: line.to_string(),
            title: pending_title.take(),
            duration: pending_duration.take(),
        });
    }

    entries
}

pub fn parse_pls(content: &str) -> Vec<PlaylistEntry> {
    let mut files: Vec<(usize, String)> = Vec::new();
    let mut titles: Vec<(usize, String)> = Vec::new();
    let mut lengths: Vec<(usize, f64)> = Vec::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.eq_ignore_ascii_case("[playlist]") {
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim();

        if let Some(index) = numbered_key_index(key, "File") {
            files.push((index, value.to_string()));
        } else if let Some(index) = numbered_key_index(key, "Title") {
            titles.push((index, value.to_string()));
        } else if let Some(index) = numbered_key_index(key, "Length") {
            if let Ok(length) = value.parse::<f64>() {
                if length >= 0.0 {
                    lengths.push((index, length));
                }
            }
        }
    }

    files.sort_by_key(|(index, _)| *index);
    files
        .into_iter()
        .map(|(index, path)| PlaylistEntry {
            path,
            title: find_numbered_value(&titles, index),
            duration: find_numbered_value(&lengths, index),
        })
        .collect()
}

pub fn load_playlist(
    path: &str,
    validate_path: impl Fn(&str) -> Result<String, String>,
) -> Result<PlaylistLoadResult, String> {
    let playlist_path = validate_path(path)?;
    let playlist_path_ref = Path::new(&playlist_path);
    let content = fs::read_to_string(playlist_path_ref)
        .map_err(|e| format!("Failed to read playlist '{}': {}", playlist_path, e))?;
    let base_dir = playlist_path_ref.parent();
    load_playlist_content(&content, Some(playlist_path_ref), base_dir, validate_path)
}

fn load_playlist_content(
    content: &str,
    playlist_path: Option<&Path>,
    base_dir: Option<&Path>,
    validate_path: impl Fn(&str) -> Result<String, String>,
) -> Result<PlaylistLoadResult, String> {
    let parsed = parse_playlist_content(content, playlist_path);
    validate_entries(parsed, base_dir, validate_path)
}

fn parse_playlist_content(content: &str, playlist_path: Option<&Path>) -> Vec<PlaylistEntry> {
    if playlist_path
        .and_then(|path| path.extension())
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pls"))
        .unwrap_or(false)
    {
        return parse_pls(content);
    }

    let first_meaningful = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    if first_meaningful.eq_ignore_ascii_case("[playlist]") {
        parse_pls(content)
    } else {
        parse_m3u(content)
    }
}

fn validate_entries(
    entries: Vec<PlaylistEntry>,
    base_dir: Option<&Path>,
    validate_path: impl Fn(&str) -> Result<String, String>,
) -> Result<PlaylistLoadResult, String> {
    let mut accepted = Vec::new();
    let mut rejected = Vec::new();

    for entry in entries {
        match validate_entry(&entry, base_dir, &validate_path) {
            Ok(validated) => accepted.push(validated),
            Err(reason) => {
                log::warn!("playlist: rejected entry {:?}: {}", entry, reason);
                rejected.push(RejectedPlaylistEntry {
                    path: entry.path,
                    reason,
                });
            }
        }
    }

    if accepted.is_empty() {
        return Err("no valid entries in playlist".into());
    }

    Ok(PlaylistLoadResult {
        entries: accepted,
        rejected,
    })
}

fn validate_entry(
    entry: &PlaylistEntry,
    base_dir: Option<&Path>,
    validate_path: &impl Fn(&str) -> Result<String, String>,
) -> Result<PlaylistEntry, String> {
    let path = entry.path.trim();
    if is_url(path) {
        validate_url_scheme(path)?;
        let mut validated = entry.clone();
        validated.path = playable_url(path);
        return Ok(validated);
    }

    let resolved = resolve_local_path(path, base_dir);
    let validated_path = validate_path(&resolved.to_string_lossy())?;
    let mut validated = entry.clone();
    validated.path = validated_path;
    Ok(validated)
}

fn resolve_local_path(path: &str, base_dir: Option<&Path>) -> PathBuf {
    let path_ref = Path::new(path);
    if path_ref.is_absolute() {
        path_ref.to_path_buf()
    } else if let Some(base_dir) = base_dir {
        base_dir.join(path_ref)
    } else {
        path_ref.to_path_buf()
    }
}

fn parse_extinf(value: &str) -> (Option<f64>, Option<String>) {
    let (duration_part, title_part) = value.split_once(',').unwrap_or((value, ""));
    let duration = duration_part
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|v| *v >= 0.0);
    let title = title_part
        .trim()
        .is_empty()
        .then_some(None)
        .unwrap_or_else(|| Some(title_part.trim().to_string()));
    (duration, title)
}

fn numbered_key_index(key: &str, prefix: &str) -> Option<usize> {
    key.get(..prefix.len())
        .filter(|value| value.eq_ignore_ascii_case(prefix))?;
    key.get(prefix.len()..)?.parse::<usize>().ok()
}

fn find_numbered_value<T: Clone>(values: &[(usize, T)], index: usize) -> Option<T> {
    values
        .iter()
        .find(|(candidate, _)| *candidate == index)
        .map(|(_, value)| value.clone())
}

fn is_url(path: &str) -> bool {
    path.contains("://")
}

fn validate_url_scheme(path: &str) -> Result<(), String> {
    let Some((scheme, rest)) = path.split_once("://") else {
        return Err("Invalid URL".into());
    };
    if rest.trim().is_empty() {
        return Err("Invalid URL: missing host".into());
    }
    match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" | "webdav" | "webdavs" => Ok(()),
        _ => Err(format!("URL scheme '{}' is not allowed", scheme)),
    }
}

fn playable_url(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("webdav://") {
        format!("http://{}", rest)
    } else if let Some(rest) = path.strip_prefix("webdavs://") {
        format!("https://{}", rest)
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn accept_existing_for_test(path: &str) -> Result<String, String> {
        if path.contains("..") {
            Err("Path traversal not allowed".into())
        } else if path.contains("missing") {
            Err("File not found".into())
        } else {
            Ok(path.replace('\\', "/"))
        }
    }

    #[test]
    fn parses_m3u_extinf_paths_urls_and_skips_hls_tags() {
        let entries = parse_m3u(
            r#"#EXTM3U
#EXT-X-VERSION:3
#EXTINF:123.5,Artist - Title
track.flac
#EXT-X-ENDLIST
https://example.test/live.aac
"#,
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "track.flac");
        assert_eq!(entries[0].title.as_deref(), Some("Artist - Title"));
        assert_eq!(entries[0].duration, Some(123.5));
        assert_eq!(entries[1].path, "https://example.test/live.aac");
    }

    #[test]
    fn parses_pls_entries_by_index() {
        let entries = parse_pls(
            r#"[playlist]
File2=second.flac
Title2=Second
Length2=42
File1=first.flac
Title1=First
"#,
        );

        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].path, "first.flac");
        assert_eq!(entries[0].title.as_deref(), Some("First"));
        assert_eq!(entries[1].path, "second.flac");
        assert_eq!(entries[1].duration, Some(42.0));
    }

    #[test]
    fn validates_relative_paths_against_playlist_directory() {
        let base = PathBuf::from("D:/music/lists");
        let result = load_playlist_content(
            "album/track.flac",
            None,
            Some(&base),
            accept_existing_for_test,
        )
        .unwrap();

        assert_eq!(result.entries[0].path, "D:/music/lists/album/track.flac");
    }

    #[test]
    fn rejects_traversal_and_bad_url_schemes_without_failing_valid_entries() {
        let base = PathBuf::from("D:/music");
        let result = load_playlist_content(
            "../../../secret.flac\nftp://example.test/a.flac\nhttps://example.test/a.flac",
            None,
            Some(&base),
            accept_existing_for_test,
        )
        .unwrap();

        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].path, "https://example.test/a.flac");
        assert_eq!(result.rejected.len(), 2);
    }

    #[test]
    fn fails_when_every_entry_is_rejected() {
        let result = load_playlist_content(
            "file://D:/music/a.flac\nmissing.flac",
            None,
            Some(Path::new("D:/music")),
            accept_existing_for_test,
        );

        assert_eq!(result.unwrap_err(), "no valid entries in playlist");
    }
}
