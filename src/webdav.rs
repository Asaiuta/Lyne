//! WebDAV Client Module
//!
//! Provides WebDAV directory browsing (PROPFIND) and credential management.
//! Audio playback of WebDAV files is handled by the decoder with Basic Auth.

use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const WEBDAV_BROWSE_PATH_MAX_LEN: usize = 4096;
const WEBDAV_SOURCE_KEY_MAX_LEN: usize = 80;

#[derive(Error, Debug)]
pub enum WebDavError {
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("XML parse error: {0}")]
    Xml(String),
    #[error("Invalid base URL: {0}")]
    InvalidBaseUrl(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
    #[error("Invalid WebDAV href: {0}")]
    InvalidHref(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct HttpOrigin {
    scheme: String,
    host: String,
    port: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct NormalizedWebDavUrl {
    pub(crate) url: Url,
    pub(crate) relative_href: String,
}

/// WebDAV server configuration
///
/// FIX for Defect 10: Custom Debug impl to mask password in log output.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct WebDavConfig {
    /// Base URL, e.g. "https://nas.local/music" (no trailing slash)
    pub base_url: String,
    pub username: Option<String>,
    /// P1-7 fix: Skip serializing password to prevent accidental exposure in JSON responses/logs
    #[serde(skip_serializing)]
    pub password: Option<String>,
}

impl std::fmt::Debug for WebDavConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebDavConfig")
            .field("base_url", &self.base_url)
            .field("username", &self.username)
            .field("password", &self.password.as_ref().map(|_| "********"))
            .finish()
    }
}

/// A single entry returned by PROPFIND
#[derive(Debug, Clone, Serialize)]
pub struct DavEntry {
    /// Full href as returned by server
    pub href: String,
    pub display_name: String,
    pub is_dir: bool,
    pub content_length: Option<u64>,
    pub content_type: Option<String>,
    /// Full playable URL (base_url + href, deduplicated)
    pub url: String,
}

pub(crate) fn normalize_source_key(source_key: &str) -> Result<String, String> {
    let trimmed = source_key.trim();
    if trimmed.is_empty() {
        return Err("source_key is required".to_string());
    }
    if trimmed.len() > WEBDAV_SOURCE_KEY_MAX_LEN {
        return Err("source_key is too long".to_string());
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(
            "source_key may only contain ASCII letters, numbers, '-', '_' or '.'".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

impl WebDavConfig {
    /// Returns true if a base_url has been set
    pub fn is_configured(&self) -> bool {
        !self.base_url.is_empty()
    }

    /// Get a normalized base_url with scheme prefix.
    /// If base_url doesn't start with http:// or https://, prepends http://
    fn normalized_base_url(&self) -> Result<Url, WebDavError> {
        parse_webdav_base_url(&self.base_url)
    }

    /// Build a full URL from a path.
    /// Handles two formats:
    /// 1. Server-root-relative path (e.g. "/dav/music/") - uses origin + path
    /// 2. Base-relative path (e.g. "/music/") - uses base_url + path
    ///
    /// Special case: path "/" means "browse base_url itself", returns base_url.
    pub fn resolve_url(&self, path: &str) -> Result<String, WebDavError> {
        validate_browse_path(path)?;
        let base = self.normalized_base_url()?;

        // Special case: "/" means browse the base_url directory itself
        if path == "/" || path.is_empty() {
            return Ok(base.to_string());
        }

        let normalized_path = if path.starts_with('/') {
            path.to_string()
        } else {
            format!("/{}", path)
        };
        let candidate = if path_is_within_collection(&normalized_path, base.path()) {
            base.join(&normalized_path)
        } else {
            collection_base_url(&base).join(normalized_path.trim_start_matches('/'))
        }
        .map_err(|_| WebDavError::InvalidPath("browse path could not be resolved".to_string()))?;
        let normalized = normalize_candidate_url(&base, candidate, WebDavError::InvalidPath)?;
        Ok(normalized.url.to_string())
    }

    pub(crate) fn normalize_media_url(&self, raw_url: &str) -> Result<String, WebDavError> {
        reject_unsafe_raw_path(raw_url, WebDavError::InvalidHref)?;
        let base = self.normalized_base_url()?;
        let candidate = Url::parse(raw_url)
            .map_err(|_| WebDavError::InvalidHref("media URL is not absolute".to_string()))?;
        Ok(
            normalize_candidate_url(&base, candidate, WebDavError::InvalidHref)?
                .url
                .to_string(),
        )
    }

    pub(crate) fn normalized_origin(&self) -> Result<String, WebDavError> {
        Ok(self.normalized_base_url()?.origin().ascii_serialization())
    }

    fn normalize_href(&self, href: &str) -> Result<NormalizedWebDavUrl, WebDavError> {
        reject_unsafe_raw_path(href, WebDavError::InvalidHref)?;
        let base = self.normalized_base_url()?;
        let candidate = if href.contains("://") || href.starts_with("//") {
            Url::parse(href)
                .map_err(|_| WebDavError::InvalidHref("href is malformed".to_string()))?
        } else {
            collection_base_url(&base)
                .join(href)
                .map_err(|_| WebDavError::InvalidHref("href could not be resolved".to_string()))?
        };
        normalize_candidate_url(&base, candidate, WebDavError::InvalidHref)
    }

    /// Issue a PROPFIND Depth:1 on `path` and return the directory listing.
    /// `path` is relative to the server root (e.g. "/music/jazz").
    pub fn list(&self, path: &str) -> Result<Vec<DavEntry>, WebDavError> {
        if !self.is_configured() {
            return Err(WebDavError::InvalidBaseUrl(
                "base URL is not configured".to_string(),
            ));
        }
        validate_browse_path(path)?;

        let normalized_base = self.normalized_base_url()?;
        let configured_origin = origin_from_url(&normalized_base)?;
        let url = self.resolve_url(path)?;
        log::info!(
            "WebDAV PROPFIND: {} (base={}, path={})",
            url,
            normalized_base,
            path
        );

        // FIX for Defect 28: Add timeout to prevent indefinite blocking
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .no_proxy()
            .redirect(reqwest::redirect::Policy::custom(
                move |attempt| match origin_from_url(attempt.url()) {
                    Ok(origin) if origin == configured_origin => attempt.follow(),
                    _ => attempt.error("WebDAV redirect crossed configured origin"),
                },
            ))
            .build()
            .map_err(|e| WebDavError::Http(format!("Failed to create HTTP client: {}", e)))?;
        let propfind = reqwest::Method::from_bytes(b"PROPFIND")
            .map_err(|e| WebDavError::Http(format!("Invalid WebDAV method: {}", e)))?;
        let mut req = client
            .request(propfind, &url)
            .header("Depth", "1")
            .header("Content-Type", "application/xml")
            .body(
                r#"<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <d:getcontentlength/>
    <d:getcontenttype/>
  </d:prop>
</d:propfind>"#,
            );

        if let (Some(u), Some(p)) = (&self.username, &self.password) {
            req = req.basic_auth(u, Some(p));
        }

        let response = req.send().map_err(|e| WebDavError::Http(e.to_string()))?;
        let status = response.status();
        if !status.is_success() && status.as_u16() != 207 {
            return Err(WebDavError::Http(format!("Server returned {}", status)));
        }

        let body = response
            .text()
            .map_err(|e| WebDavError::Http(e.to_string()))?;
        parse_propfind_response(&body, self)
    }

    /// Convert to decoder credentials
    pub fn http_credentials(&self) -> Option<crate::decoder::HttpCredentials> {
        match (&self.username, &self.password) {
            (Some(u), Some(p)) => Some(crate::decoder::HttpCredentials {
                username: u.clone(),
                password: p.clone(),
            }),
            _ => None,
        }
    }
}

pub(crate) fn validate_browse_path(path: &str) -> Result<(), WebDavError> {
    let trimmed = path.trim();
    if trimmed.len() > WEBDAV_BROWSE_PATH_MAX_LEN {
        return Err(WebDavError::InvalidPath(format!(
            "browse path must be at most {} bytes",
            WEBDAV_BROWSE_PATH_MAX_LEN
        )));
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.contains("://") {
        return Err(WebDavError::InvalidPath(
            "absolute URLs are not allowed for WebDAV browse paths".to_string(),
        ));
    }
    let lower = trimmed.to_ascii_lowercase();
    if trimmed.contains('\\')
        || lower.contains("%2f")
        || lower.contains("%5c")
        || trimmed.split('/').any(is_parent_path_segment)
    {
        return Err(WebDavError::InvalidPath(
            "path traversal characters are not allowed".to_string(),
        ));
    }
    if trimmed.chars().any(char::is_control) {
        return Err(WebDavError::InvalidPath(
            "control characters are not allowed".to_string(),
        ));
    }
    Ok(())
}

fn is_parent_path_segment(segment: &str) -> bool {
    if segment == ".." {
        return true;
    }
    segment.to_ascii_lowercase().replace("%2e", ".") == ".."
}

/// Parse a WebDAV multi-status XML response into DavEntry list.
fn parse_propfind_response(xml: &str, config: &WebDavConfig) -> Result<Vec<DavEntry>, WebDavError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut entries: Vec<DavEntry> = Vec::new();

    // Per-response state
    let mut in_response = false;
    let mut current_href = String::new();
    let mut current_name = String::new();
    let mut is_collection = false;
    let mut content_length: Option<u64> = None;
    let mut content_type: Option<String> = None;

    // Tag tracking
    let mut current_tag = String::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let local = local_name(e.name().as_ref());
                match local.as_str() {
                    "response" => {
                        in_response = true;
                        current_href.clear();
                        current_name.clear();
                        is_collection = false;
                        content_length = None;
                        content_type = None;
                    }
                    "collection" if in_response => {
                        is_collection = true;
                    }
                    _ => {}
                }
                // N-2 fix: move `local` into `current_tag` instead of cloning
                current_tag = local;
            }
            Ok(Event::Empty(ref e)) => {
                let local = local_name(e.name().as_ref());
                if local == "collection" && in_response {
                    is_collection = true;
                }
            }
            Ok(Event::Text(ref e)) => {
                if !in_response {
                    buf.clear();
                    continue;
                }
                let text = e.unescape().unwrap_or_default().to_string();
                match current_tag.as_str() {
                    "href" => current_href = text,
                    "displayname" => current_name = text,
                    "getcontentlength" => {
                        content_length = text.trim().parse().ok();
                    }
                    "getcontenttype" => {
                        content_type = Some(text);
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let local = local_name(e.name().as_ref());
                if local == "response" && in_response {
                    let display_name = if current_name.is_empty() {
                        // Fall back to last path segment
                        current_href
                            .trim_end_matches('/')
                            .rsplit('/')
                            .next()
                            .unwrap_or(&current_href)
                            .to_string()
                    } else {
                        current_name.clone()
                    };

                    match config.normalize_href(&current_href) {
                        Ok(mut normalized) => {
                            normalize_entry_trailing_slash(&mut normalized, is_collection);
                            log::debug!(
                                "Accepted WebDAV entry: relative_href={}, is_dir={}",
                                normalized.relative_href,
                                is_collection
                            );
                            entries.push(DavEntry {
                                href: normalized.relative_href,
                                display_name,
                                is_dir: is_collection,
                                content_length,
                                content_type: content_type.clone(),
                                url: normalized.url.to_string(),
                            });
                        }
                        Err(error) => {
                            log::warn!("Skipped invalid WebDAV href: {}", error);
                        }
                    }
                    in_response = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(WebDavError::Xml(e.to_string())),
            _ => {}
        }
        buf.clear();
    }

    Ok(entries)
}

/// Strip XML namespace prefix and return the local name
fn local_name(name: &[u8]) -> String {
    let s = std::str::from_utf8(name).unwrap_or("");
    s.rsplit(':').next().unwrap_or(s).to_lowercase()
}

fn parse_webdav_base_url(raw: &str) -> Result<Url, WebDavError> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(WebDavError::InvalidBaseUrl("base URL is empty".to_string()));
    }
    reject_unsafe_raw_path(trimmed, WebDavError::InvalidBaseUrl)?;
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };
    let mut url = Url::parse(&candidate)
        .map_err(|_| WebDavError::InvalidBaseUrl("URL is malformed".to_string()))?;
    validate_http_url_shape(&url, WebDavError::InvalidBaseUrl)?;
    let path = normalized_collection_path(url.path());
    url.set_path(&path);
    Ok(url)
}

fn validate_http_url_shape<F>(url: &Url, error: F) -> Result<(), WebDavError>
where
    F: Fn(String) -> WebDavError,
{
    if !matches!(url.scheme(), "http" | "https") {
        return Err(error("URL must use http or https".to_string()));
    }
    if url.host_str().is_none() {
        return Err(error("URL must include a host".to_string()));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(error("embedded credentials are not allowed".to_string()));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(error(
            "query and fragment components are not allowed".to_string(),
        ));
    }
    Ok(())
}

fn origin_from_url(url: &Url) -> Result<HttpOrigin, WebDavError> {
    validate_http_url_shape(url, WebDavError::InvalidHref)?;
    Ok(HttpOrigin {
        scheme: url.scheme().to_ascii_lowercase(),
        host: url
            .host_str()
            .ok_or_else(|| WebDavError::InvalidHref("URL has no host".to_string()))?
            .to_ascii_lowercase(),
        port: url
            .port_or_known_default()
            .ok_or_else(|| WebDavError::InvalidHref("URL has no supported port".to_string()))?,
    })
}

fn collection_base_url(base: &Url) -> Url {
    let mut url = base.clone();
    let path = if base.path() == "/" {
        "/".to_string()
    } else {
        format!("{}/", base.path().trim_end_matches('/'))
    };
    url.set_path(&path);
    url
}

fn normalized_collection_path(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else {
        trimmed.to_string()
    }
}

fn path_is_within_collection(path: &str, collection_path: &str) -> bool {
    let collection = normalized_collection_path(collection_path);
    if collection == "/" {
        return path.starts_with('/');
    }
    path == collection
        || path
            .strip_prefix(&collection)
            .is_some_and(|remaining| remaining.starts_with('/'))
}

fn normalize_candidate_url<F>(
    base: &Url,
    mut candidate: Url,
    error: F,
) -> Result<NormalizedWebDavUrl, WebDavError>
where
    F: Fn(String) -> WebDavError + Copy,
{
    validate_http_url_shape(&candidate, error)?;
    let base_origin = origin_from_url(base)?;
    let candidate_origin = origin_from_url(&candidate)?;
    if candidate_origin != base_origin {
        return Err(error("URL crosses the configured origin".to_string()));
    }
    if !path_is_within_collection(candidate.path(), base.path()) {
        return Err(error("URL escapes the configured collection".to_string()));
    }
    let collection = normalized_collection_path(base.path());
    let relative_href = if candidate.path() == collection {
        "/".to_string()
    } else if collection == "/" {
        candidate.path().to_string()
    } else {
        candidate.path()[collection.len()..].to_string()
    };
    candidate.set_query(None);
    candidate.set_fragment(None);
    Ok(NormalizedWebDavUrl {
        url: candidate,
        relative_href,
    })
}

fn reject_unsafe_raw_path<F>(raw: &str, error: F) -> Result<(), WebDavError>
where
    F: Fn(String) -> WebDavError,
{
    if raw.chars().any(char::is_control) || raw.contains('\\') {
        return Err(error(
            "control characters and backslashes are not allowed".to_string(),
        ));
    }
    let path = raw.split(['?', '#']).next().unwrap_or(raw);
    let lower = path.to_ascii_lowercase();
    if lower.contains("%2f") || lower.contains("%5c") {
        return Err(error("encoded path separators are not allowed".to_string()));
    }
    if path.split('/').any(is_parent_path_segment) {
        return Err(error("parent path segments are not allowed".to_string()));
    }
    Ok(())
}

fn normalize_entry_trailing_slash(entry: &mut NormalizedWebDavUrl, is_collection: bool) {
    let path = entry.url.path().trim_end_matches('/');
    let normalized_path = if path.is_empty() {
        "/".to_string()
    } else if is_collection {
        format!("{}/", path)
    } else {
        path.to_string()
    };
    entry.url.set_path(&normalized_path);

    if entry.relative_href != "/" {
        let relative = entry.relative_href.trim_end_matches('/');
        entry.relative_href = if is_collection {
            format!("{}/", relative)
        } else {
            relative.to_string()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_propfind_response, validate_browse_path, WebDavConfig, WebDavError};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;
    use std::time::{Duration, Instant};

    fn read_http_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        loop {
            let read = stream.read(&mut buffer).unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&buffer[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        String::from_utf8_lossy(&request).into_owned()
    }

    fn write_http_response(stream: &mut TcpStream, status: &str, headers: &str, body: &str) {
        let response = format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
    }

    fn assert_basic_auth(request: &str) {
        assert!(request
            .to_ascii_lowercase()
            .contains("authorization: basic ywxpy2u6c2vjcmv0\r\n"));
    }

    #[test]
    fn validate_browse_path_rejects_absolute_urls_and_traversal() {
        assert!(validate_browse_path("/music").is_ok());
        assert!(validate_browse_path("music/jazz").is_ok());
        assert!(validate_browse_path("https://evil.example/dav").is_err());
        assert!(validate_browse_path("ftp://evil.example/dav").is_err());
        assert!(validate_browse_path("/music/../secret").is_err());
        assert!(validate_browse_path("/music/%2e%2e/secret").is_err());
        assert!(validate_browse_path(r"\windows").is_err());
    }

    #[test]
    fn resolve_url_keeps_browse_paths_under_configured_base() {
        let config = WebDavConfig {
            base_url: "https://nas.example.test/dav".to_string(),
            username: None,
            password: None,
        };

        assert_eq!(
            config.resolve_url("/").unwrap(),
            "https://nas.example.test/dav"
        );
        assert_eq!(
            config.resolve_url("/music/song.flac").unwrap(),
            "https://nas.example.test/dav/music/song.flac"
        );
        assert!(config
            .resolve_url("https://evil.example/song.flac")
            .is_err());
    }

    #[test]
    fn normalize_media_url_requires_exact_origin_and_collection() {
        let config = WebDavConfig {
            base_url: "https://nas.example.test:443/dav/music/".to_string(),
            username: None,
            password: None,
        };

        assert_eq!(
            config
                .normalize_media_url("https://nas.example.test/dav/music/album/song.flac")
                .unwrap(),
            "https://nas.example.test/dav/music/album/song.flac"
        );
        assert!(config
            .normalize_media_url("https://other.example.test/dav/music/song.flac")
            .is_err());
        assert!(config
            .normalize_media_url("https://nas.example.test/dav/music-archive/song.flac")
            .is_err());
        assert!(config
            .normalize_media_url("https://user:secret@nas.example.test/dav/music/song.flac")
            .is_err());
        assert!(config
            .normalize_media_url("https://nas.example.test/dav/music/%2e%2e/secret.flac")
            .is_err());
    }

    #[test]
    fn propfind_skips_cross_origin_and_normalizes_directory_aliases() {
        let config = WebDavConfig {
            base_url: "https://nas.example.test/dav/music".to_string(),
            username: None,
            password: None,
        };
        let xml = r#"<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:">
              <d:response><d:href>/dav/music/album</d:href><d:propstat><d:prop><d:displayname>Album</d:displayname><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
              <d:response><d:href>https://evil.example/dav/music/leak.flac</d:href><d:propstat><d:prop><d:displayname>Leak</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>/dav/music/%2e%2e/secret.flac</d:href><d:propstat><d:prop><d:displayname>Secret</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>https://user:secret@nas.example.test/dav/music/userinfo.flac</d:href><d:propstat><d:prop><d:displayname>Userinfo</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>/dav/music/query.flac?token=secret</d:href><d:propstat><d:prop><d:displayname>Query</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>/dav/music/fragment.flac#part</d:href><d:propstat><d:prop><d:displayname>Fragment</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>/dav/music/album%2fescape.flac</d:href><d:propstat><d:prop><d:displayname>Slash</d:displayname></d:prop></d:propstat></d:response>
              <d:response><d:href>/dav/music-archive/escape.flac</d:href><d:propstat><d:prop><d:displayname>Collection Escape</d:displayname></d:prop></d:propstat></d:response>
            </d:multistatus>"#;

        let entries = parse_propfind_response(xml, &config).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].href, "/album/");
        assert_eq!(entries[0].url, "https://nas.example.test/dav/music/album/");
    }

    #[test]
    fn propfind_normalizes_same_origin_absolute_href_default_port() {
        let config = WebDavConfig {
            base_url: "https://nas.example.test:443/dav/music/".to_string(),
            username: None,
            password: None,
        };
        let xml = r#"<?xml version="1.0"?>
            <d:multistatus xmlns:d="DAV:">
              <d:response><d:href>https://nas.example.test/dav/music/song.flac</d:href><d:propstat><d:prop><d:displayname>Song</d:displayname></d:prop></d:propstat></d:response>
            </d:multistatus>"#;

        let entries = parse_propfind_response(xml, &config).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].href, "/song.flac");
        assert_eq!(
            entries[0].url,
            "https://nas.example.test/dav/music/song.flac"
        );
    }

    #[test]
    fn propfind_preserves_basic_auth_across_same_origin_redirect() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            let first_request = read_http_request(&mut first);
            write_http_response(&mut first, "302 Found", "Location: /dav/redirected\r\n", "");

            let (mut second, _) = listener.accept().unwrap();
            let second_request = read_http_request(&mut second);
            let body = r#"<?xml version="1.0"?>
                <d:multistatus xmlns:d="DAV:">
                  <d:response><d:href>/dav/song.flac</d:href><d:propstat><d:prop><d:displayname>Song</d:displayname></d:prop></d:propstat></d:response>
                </d:multistatus>"#;
            write_http_response(&mut second, "207 Multi-Status", "", body);
            (first_request, second_request)
        });
        let config = WebDavConfig {
            base_url: format!("http://{address}/dav"),
            username: Some("alice".to_string()),
            password: Some("secret".to_string()),
        };

        let entries = config.list("/").unwrap();
        let (first_request, second_request) = server.join().unwrap();

        assert_eq!(entries.len(), 1);
        assert_basic_auth(&first_request);
        assert_basic_auth(&second_request);
    }

    #[test]
    fn propfind_rejects_cross_origin_redirect_before_target_request() {
        let source_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let source_address = source_listener.local_addr().unwrap();
        let target_listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let target_address = target_listener.local_addr().unwrap();
        target_listener.set_nonblocking(true).unwrap();

        let source_server = thread::spawn(move || {
            let (mut stream, _) = source_listener.accept().unwrap();
            let request = read_http_request(&mut stream);
            write_http_response(
                &mut stream,
                "302 Found",
                &format!("Location: http://{target_address}/stolen\r\n"),
                "",
            );
            request
        });
        let target_server = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(1);
            loop {
                match target_listener.accept() {
                    Ok(_) => return true,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if Instant::now() >= deadline {
                            return false;
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("target accept failed: {error}"),
                }
            }
        });
        let config = WebDavConfig {
            base_url: format!("http://{source_address}/dav"),
            username: Some("alice".to_string()),
            password: Some("secret".to_string()),
        };

        let error = config
            .list("/")
            .expect_err("cross-origin redirect must fail");
        let source_request = source_server.join().unwrap();
        let target_received_request = target_server.join().unwrap();

        assert!(matches!(error, WebDavError::Http(_)));
        assert_basic_auth(&source_request);
        assert!(!target_received_request);
    }
}
