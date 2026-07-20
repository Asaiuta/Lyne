//! Bundled integration-plugin host.
//!
//! Phase-one plugins are trusted first-party integration processes. Process
//! separation contains failures; it is not an operating-system sandbox.

use std::collections::{BTreeMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{path::BaseDirectory, Manager};

use crate::sidecar::ApiRuntimeState;

const HOST_PROTOCOL: u32 = 1;
const HOST_API: &str = "1";
const CONFIG_VERSION: u32 = 1;
const MAX_CONFIG_BYTES: usize = 512 * 1024;
const MAX_CONFIG_FIELDS: usize = 64;
const MAX_DIAGNOSTIC_BYTES: usize = 8 * 1024;
const MAX_PLUGIN_FAILURES: u32 = 3;
const REQUEST_ID_LIMIT: usize = 1024;
const SECRET_PLACEHOLDER: &str = "[REDACTED]";

const ALLOWED_CAPABILITIES: &[&str] = &[
    "audio.library.list",
    "audio.library.search",
    "audio.library.resolve_track",
    "audio.playback.load_and_play",
    "audio.playback.play",
    "audio.playback.pause",
    "audio.playback.next",
    "audio.playback.previous",
    "audio.playback.state",
    "plugin.config.read",
];

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub host_api: String,
    pub entrypoint: Entrypoint,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub settings: SettingsSchema,
    #[serde(default)]
    pub limits: PluginLimits,
    #[serde(default)]
    pub outbound_origins: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Entrypoint {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsSchema {
    #[serde(default)]
    pub fields: Vec<SettingField>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingField {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(rename = "type", default = "default_setting_type")]
    pub kind: String,
    #[serde(default)]
    pub secret: bool,
    #[serde(default)]
    pub default: Value,
}

fn default_setting_type() -> String {
    "string".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PluginLimits {
    #[serde(default = "default_startup_ms")]
    pub startup_ms: u64,
    #[serde(default = "default_call_ms")]
    pub call_ms: u64,
    #[serde(default = "default_frame_bytes")]
    pub max_frame_bytes: usize,
}

impl Default for PluginLimits {
    fn default() -> Self {
        Self {
            startup_ms: default_startup_ms(),
            call_ms: default_call_ms(),
            max_frame_bytes: default_frame_bytes(),
        }
    }
}

fn default_startup_ms() -> u64 {
    5_000
}

fn default_call_ms() -> u64 {
    15_000
}

fn default_frame_bytes() -> usize {
    256 * 1024
}

impl PluginManifest {
    fn validate(&self) -> Result<(), String> {
        validate_plugin_id(&self.id)?;
        if self.name.trim().is_empty() || self.name.len() > 160 {
            return Err("plugin name must be between 1 and 160 bytes".to_string());
        }
        if !is_semver_like(&self.version) {
            return Err(format!("plugin '{}' has an invalid version", self.id));
        }
        if self.host_api != HOST_API {
            return Err(format!(
                "plugin '{}' requires unsupported host API '{}'",
                self.id, self.host_api
            ));
        }
        validate_relative_entrypoint(&self.entrypoint.program)?;
        if self.entrypoint.args.len() > 64
            || self.entrypoint.args.iter().any(|arg| arg.len() > 4096)
        {
            return Err(format!(
                "plugin '{}' has unsafe entrypoint arguments",
                self.id
            ));
        }
        let mut capabilities = HashSet::new();
        for capability in &self.capabilities {
            if !ALLOWED_CAPABILITIES.contains(&capability.as_str()) {
                return Err(format!(
                    "plugin '{}' declares unsupported capability '{}'",
                    self.id, capability
                ));
            }
            if !capabilities.insert(capability) {
                return Err(format!(
                    "plugin '{}' declares duplicate capability '{}'",
                    self.id, capability
                ));
            }
        }
        self.settings.validate()?;
        for field in &self.settings.fields {
            validate_config_value(self, field, &field.default)?;
        }
        self.limits.validate(&self.id)?;
        for origin in &self.outbound_origins {
            validate_origin(origin)?;
        }
        Ok(())
    }
}

impl SettingsSchema {
    fn validate(&self) -> Result<(), String> {
        if self.fields.len() > MAX_CONFIG_FIELDS {
            return Err("plugin settings declare too many fields".to_string());
        }
        let mut ids = HashSet::new();
        for field in &self.fields {
            if !is_setting_id(&field.id) || !ids.insert(&field.id) {
                return Err(format!(
                    "invalid or duplicate plugin setting '{}'",
                    field.id
                ));
            }
            if !["string", "url", "boolean", "number"].contains(&field.kind.as_str()) {
                return Err(format!("unsupported setting type '{}'", field.kind));
            }
            if serialized_len(&field.default) > 16 * 1024 {
                return Err(format!(
                    "plugin setting '{}' has an oversized default",
                    field.id
                ));
            }
            validate_setting_value(field, &field.default)?;
        }
        Ok(())
    }
}

impl PluginLimits {
    fn validate(&self, id: &str) -> Result<(), String> {
        if !(100..=60_000).contains(&self.startup_ms)
            || !(100..=120_000).contains(&self.call_ms)
            || !(4 * 1024..=1024 * 1024).contains(&self.max_frame_bytes)
        {
            return Err(format!("plugin '{}' declares unsafe runtime limits", id));
        }
        Ok(())
    }
}

fn validate_plugin_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 64
        || !id.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
    {
        return Err(format!("invalid plugin id '{id}'"));
    }
    Ok(())
}

fn is_setting_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_' || byte == b'.'
        })
}

fn is_semver_like(version: &str) -> bool {
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty() && part.chars().all(|character| character.is_ascii_digit())
        })
}

fn validate_relative_entrypoint(program: &str) -> Result<(), String> {
    if program.is_empty() || program.len() > 260 {
        return Err("plugin entrypoint must be between 1 and 260 bytes".to_string());
    }
    let path = Path::new(program);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        || program.contains(':')
    {
        return Err(format!("unsafe plugin entrypoint '{program}'"));
    }
    Ok(())
}

fn validate_origin(origin: &str) -> Result<(), String> {
    let parsed = Url::parse(origin).map_err(|error| format!("invalid plugin origin: {error}"))?;
    if (parsed.path() != "/" && !parsed.path().is_empty())
        || parsed.username() != ""
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("plugin origins may not contain paths, credentials, or query data".to_string());
    }
    match parsed.scheme() {
        "wss" => Ok(()),
        "ws" => {
            let host = parsed.host_str().unwrap_or_default();
            let is_loopback_name = matches!(host, "localhost" | "127.0.0.1" | "[::1]" | "::1");
            let is_loopback_ip = host
                .parse::<IpAddr>()
                .map(|address| address.is_loopback())
                .unwrap_or(false);
            if is_loopback_name || is_loopback_ip {
                Ok(())
            } else {
                Err("plaintext plugin WebSockets are limited to loopback origins".to_string())
            }
        }
        scheme => Err(format!("unsupported plugin origin scheme '{scheme}'")),
    }
}

fn validate_setting_value(field: &SettingField, value: &Value) -> Result<(), String> {
    let valid = match field.kind.as_str() {
        "string" | "url" => value.is_string() || value.is_null(),
        "boolean" => value.is_boolean() || value.is_null(),
        "number" => {
            value
                .as_f64()
                .map(|number| number.is_finite())
                .unwrap_or(false)
                || value.is_null()
        }
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "setting '{}' has a value of the wrong type",
            field.id
        ))
    }
}

fn validate_config_value(
    manifest: &PluginManifest,
    field: &SettingField,
    value: &Value,
) -> Result<(), String> {
    validate_setting_value(field, value)?;
    if field.kind != "url" || value.is_null() {
        return Ok(());
    }
    let configured = value
        .as_str()
        .ok_or_else(|| format!("setting '{}' must be a URL", field.id))?;
    validate_origin(configured)?;
    if !manifest.outbound_origins.is_empty()
        && !manifest
            .outbound_origins
            .iter()
            .any(|allowed| allowed == configured)
    {
        return Err(format!(
            "setting '{}' is outside the plugin's declared origins",
            field.id
        ));
    }
    Ok(())
}

fn serialized_len(value: &Value) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

fn resolve_entrypoint(package_root: &Path, program: &str) -> Result<PathBuf, String> {
    validate_relative_entrypoint(program)?;
    let root = package_root
        .canonicalize()
        .map_err(|error| format!("failed to resolve plugin package root: {error}"))?;
    let resolved = root
        .join(program)
        .canonicalize()
        .map_err(|error| format!("failed to resolve plugin entrypoint '{program}': {error}"))?;
    if !resolved.starts_with(&root) || !resolved.is_file() {
        return Err(format!(
            "plugin entrypoint is outside its package or is not a file: '{}'",
            resolved.display()
        ));
    }
    Ok(resolved)
}

fn read_manifest(path: &Path) -> Result<PluginManifest, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("failed to read '{}': {error}", path.display()))?;
    if bytes.len() > 128 * 1024 {
        return Err(format!("manifest '{}' exceeds 128 KiB", path.display()));
    }
    let manifest: PluginManifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse '{}': {error}", path.display()))?;
    manifest.validate()?;
    Ok(manifest)
}

fn discover_manifests(root: &Path) -> Result<Vec<(PluginManifest, PathBuf)>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    if !root.is_dir() {
        return Err(format!(
            "plugin resource root is not a directory: '{}'",
            root.display()
        ));
    }
    let mut discovered = Vec::new();
    let mut ids = HashSet::new();
    for entry in
        fs::read_dir(root).map_err(|error| format!("failed to read plugin root: {error}"))?
    {
        let entry = entry.map_err(|error| format!("failed to enumerate plugin root: {error}"))?;
        let package_root = entry.path();
        let manifest_path = package_root.join("plugin.json");
        if !package_root.is_dir() || !manifest_path.is_file() {
            continue;
        }
        let manifest = read_manifest(&manifest_path)?;
        if !ids.insert(manifest.id.clone()) {
            return Err(format!("duplicate bundled plugin id '{}'", manifest.id));
        }
        discovered.push((manifest, package_root));
    }
    discovered.sort_by(|left, right| left.0.id.cmp(&right.0.id));
    Ok(discovered)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingSnapshot {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub secret: bool,
    pub value: Option<Value>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnapshot {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub status: String,
    pub last_error: Option<String>,
    pub settings: Vec<PluginSettingSnapshot>,
    pub outbound_origins: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredPluginConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    values: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConfigFile {
    #[serde(default = "default_config_version")]
    version: u32,
    #[serde(default)]
    plugins: BTreeMap<String, StoredPluginConfig>,
}

fn default_config_version() -> u32 {
    CONFIG_VERSION
}

pub trait AudioCapabilityBroker: Send + Sync + std::fmt::Debug {
    fn call(&self, plugin_id: &str, method: &str, params: Value) -> Result<Value, String>;
}

#[derive(Debug)]
struct SidecarBroker {
    client: Client,
    base_url: String,
    token: String,
}

impl SidecarBroker {
    fn new(base_url: String, token: String) -> Result<Self, String> {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|error| format!("failed to construct plugin sidecar client: {error}"))?;
        Ok(Self {
            client,
            base_url,
            token,
        })
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut request = self
            .client
            .request(method, format!("{}{}", self.base_url, path))
            .bearer_auth(&self.token)
            .header("Content-Type", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .map_err(|error| format!("sidecar request '{path}' failed: {error}"))?;
        let status = response.status();
        let payload: Value = response
            .json()
            .map_err(|error| format!("sidecar response '{path}' was not JSON: {error}"))?;
        if !status.is_success() {
            let _ = payload;
            return Err(format!("sidecar operation '{path}' failed with {status}"));
        }
        Ok(payload)
    }

    fn library_view(
        &self,
        query: Option<&str>,
        offset: usize,
        limit: usize,
    ) -> Result<Value, String> {
        let queries = query
            .map(|value| vec![value.to_string()])
            .unwrap_or_default();
        self.request(
            reqwest::Method::POST,
            "/domain/library/view",
            Some(json!({
                "queries": queries,
                "folder_path": null,
                "sort": {"field": "title", "order": "asc"},
                "range": {"start": offset, "end": offset.saturating_add(limit)},
                "include_media_ids": true
            })),
        )
    }

    fn playback_command(&self, path: &str) -> Result<Value, String> {
        let payload = self.request(reqwest::Method::POST, path, None)?;
        Ok(json!({"status": "success", "state": sanitize_state(&payload)}))
    }

    fn resolve_library_track(&self, track_id: &str) -> Result<Option<Value>, String> {
        let mut offset = 0usize;
        loop {
            let page = sanitize_library_page(self.library_view(None, offset, 100)?)?;
            let tracks = page
                .get("tracks")
                .and_then(Value::as_array)
                .ok_or_else(|| "invalid sanitized library page".to_string())?;
            if let Some(track) = tracks.iter().find(|track| {
                track.get("trackId").and_then(Value::as_str) == Some(track_id)
            }) {
                return Ok(Some(track.clone()));
            }
            let total = page.get("total").and_then(Value::as_u64).unwrap_or(0) as usize;
            let next_offset = offset.saturating_add(tracks.len());
            if tracks.is_empty() || next_offset >= total || next_offset > 100_000 {
                return Ok(None);
            }
            offset = next_offset;
        }
    }
}

impl AudioCapabilityBroker for SidecarBroker {
    fn call(&self, _plugin_id: &str, method: &str, params: Value) -> Result<Value, String> {
        match method {
            "audio.library.list" => {
                let offset = bounded_usize(params.get("offset"), 0, 100_000);
                let limit = bounded_usize(params.get("limit"), 50, 100);
                sanitize_library_page(self.library_view(None, offset, limit)?)
            }
            "audio.library.search" => {
                let query = params
                    .get("query")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "audio.library.search requires query".to_string())?
                    .trim();
                if query.is_empty() || query.len() > 256 {
                    return Err("audio.library.search query must be 1-256 bytes".to_string());
                }
                let limit = bounded_usize(params.get("limit"), 20, 100);
                sanitize_library_page(self.library_view(Some(query), 0, limit)?)
            }
            "audio.library.resolve_track" => {
                let track_id = required_string(&params, "trackId", 256)?;
                self.resolve_library_track(&track_id)?
                    .map(|track| json!({"track": track}))
                    .ok_or_else(|| "track was not found".to_string())
            }
            "audio.playback.load_and_play" => {
                let track_id = required_string(&params, "trackId", 256)?;
                let payload = self.request(
                    reqwest::Method::POST,
                    "/domain/library/queue_from_media_ids",
                    Some(json!({
                        "media_ids": [track_id],
                        "start_media_id": track_id
                    })),
                )?;
                Ok(json!({
                    "status": "success",
                    "trackId": track_id,
                    "state": sanitize_state(&payload)
                }))
            }
            "audio.playback.play" => self.playback_command("/play"),
            "audio.playback.pause" => self.playback_command("/pause"),
            "audio.playback.next" => self.playback_command("/domain/queue/play_next"),
            "audio.playback.previous" => self.playback_command("/domain/queue/play_previous"),
            "audio.playback.state" => {
                let payload = self.request(reqwest::Method::GET, "/state", None)?;
                Ok(sanitize_state(&payload))
            }
            _ => Err(format!("unsupported audio capability '{method}'")),
        }
    }
}

fn bounded_usize(value: Option<&Value>, default: usize, max: usize) -> usize {
    value
        .and_then(Value::as_u64)
        .map(|number| number as usize)
        .unwrap_or(default)
        .min(max)
}

fn required_string(params: &Value, field: &str, max: usize) -> Result<String, String> {
    let value = params
        .get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("missing string parameter '{field}'"))?
        .trim();
    if value.is_empty() || value.len() > max {
        return Err(format!(
            "parameter '{field}' must be between 1 and {max} bytes"
        ));
    }
    Ok(value.to_string())
}

fn sanitize_library_page(payload: Value) -> Result<Value, String> {
    let rows = payload
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(|| "invalid library page response".to_string())?;
    let tracks = rows.iter().filter_map(sanitize_track).collect::<Vec<_>>();
    let total = payload
        .get("total_count")
        .and_then(Value::as_u64)
        .unwrap_or(tracks.len() as u64);
    Ok(json!({"status": "success", "total": total, "tracks": tracks}))
}

fn sanitize_track(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    let track_id = object.get("media_id")?.as_str()?;
    if track_id.is_empty() || track_id.len() > 512 {
        return None;
    }
    let mut result = Map::new();
    result.insert("trackId".to_string(), Value::String(track_id.to_string()));
    for (source, target) in [
        ("title", "title"),
        ("artist", "artist"),
        ("album", "album"),
        ("duration_secs", "durationSecs"),
        ("track_number", "trackNumber"),
        ("has_cover_art", "hasCoverArt"),
    ] {
        if let Some(value) = object.get(source) {
            result.insert(target.to_string(), value.clone());
        }
    }
    Some(Value::Object(result))
}

fn sanitize_state(payload: &Value) -> Value {
    let state = payload.get("state").unwrap_or(payload);
    let Some(object) = state.as_object() else {
        return json!({
            "status": "unavailable",
            "message": "invalid playback state"
        });
    };
    let mut result = Map::new();
    for (source, target) in [
        ("is_playing", "isPlaying"),
        ("is_paused", "isPaused"),
        ("is_loading", "isLoading"),
        ("duration", "duration"),
        ("current_time", "currentTime"),
        ("title", "title"),
        ("artist", "artist"),
        ("album", "album"),
        ("track_number", "trackNumber"),
    ] {
        if let Some(value) = object.get(source) {
            result.insert(target.to_string(), value.clone());
        }
    }
    Value::Object(result)
}

#[derive(Debug)]
struct IncomingFrame {
    kind: String,
    request_id: Option<String>,
    method: Option<String>,
    params: Value,
    plugin_id: Option<String>,
    event: Option<String>,
}

fn parse_frame(line: &[u8], max_bytes: usize) -> Result<IncomingFrame, String> {
    if line.len() > max_bytes {
        return Err(format!("plugin frame exceeds {max_bytes} bytes"));
    }
    let value: Value = serde_json::from_slice(line)
        .map_err(|error| format!("invalid plugin JSON frame: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "plugin frame must be a JSON object".to_string())?;
    if object.get("protocol").and_then(Value::as_u64) != Some(HOST_PROTOCOL as u64) {
        return Err("plugin frame has an unsupported protocol version".to_string());
    }
    let kind = object
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "plugin frame is missing type".to_string())?
        .to_string();
    if !matches!(
        kind.as_str(),
        "hello_ack" | "call" | "event" | "shutdown_ack"
    ) {
        return Err(format!("unsupported plugin frame type '{kind}'"));
    }
    let request_id = object
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_string);
    if request_id
        .as_ref()
        .map(|id| id.is_empty() || id.len() > 128)
        .unwrap_or(false)
    {
        return Err("plugin requestId is empty or oversized".to_string());
    }
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    if kind == "call" && method.is_none() {
        return Err("plugin call is missing method".to_string());
    }
    let params = object.get("params").cloned().unwrap_or_else(|| json!({}));
    if !params.is_object() && !params.is_null() {
        return Err("plugin call params must be an object".to_string());
    }
    Ok(IncomingFrame {
        kind,
        request_id,
        method,
        params,
        plugin_id: object
            .get("pluginId")
            .and_then(Value::as_str)
            .map(str::to_string),
        event: object
            .get("event")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

fn write_frame(
    stdin: &Arc<Mutex<ChildStdin>>,
    frame: Value,
    max_bytes: usize,
) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(&frame)
        .map_err(|error| format!("failed to encode plugin frame: {error}"))?;
    if bytes.len() > max_bytes {
        return Err(format!("host frame exceeds {max_bytes} bytes"));
    }
    bytes.push(b'\n');
    let mut guard = stdin
        .lock()
        .map_err(|_| "plugin stdin lock was poisoned".to_string())?;
    guard
        .write_all(&bytes)
        .map_err(|error| format!("failed to write plugin frame: {error}"))?;
    guard
        .flush()
        .map_err(|error| format!("failed to flush plugin frame: {error}"))
}

fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    max_bytes: usize,
) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let buffer = reader
            .fill_buf()
            .map_err(|error| format!("failed to read plugin stdout: {error}"))?;
        if buffer.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Ok(Some(line))
            };
        }
        let newline = buffer.iter().position(|byte| *byte == b'\n');
        let take = newline.map(|index| index + 1).unwrap_or(buffer.len());
        if line.len().saturating_add(take) > max_bytes {
            return Err(format!("plugin frame exceeds {max_bytes} bytes"));
        }
        line.extend_from_slice(&buffer[..take]);
        reader.consume(take);
        if newline.is_some() {
            return Ok(Some(line));
        }
    }
}

fn host_hello(manifest: &PluginManifest) -> Value {
    json!({
        "protocol": HOST_PROTOCOL,
        "type": "hello",
        "pluginId": manifest.id,
        "hostApi": HOST_API,
        "capabilities": manifest.capabilities,
        "settings": manifest.settings.fields.iter().map(|field| json!({
            "id": field.id,
            "type": field.kind,
            "secret": field.secret
        })).collect::<Vec<_>>()
    })
}

fn lifecycle_event(name: &str) -> Value {
    json!({"protocol": HOST_PROTOCOL, "type": "event", "event": name})
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RuntimeStatus {
    Disabled,
    Starting,
    Ready,
    Degraded,
    DisabledAfterFailure,
}

impl RuntimeStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Starting => "starting",
            Self::Ready => "ready",
            Self::Degraded => "degraded",
            Self::DisabledAfterFailure => "disabledAfterFailure",
        }
    }
}

#[derive(Debug)]
struct RuntimeInfo {
    status: RuntimeStatus,
    last_error: Option<String>,
}

impl Default for RuntimeInfo {
    fn default() -> Self {
        Self {
            status: RuntimeStatus::Disabled,
            last_error: None,
        }
    }
}

#[derive(Debug)]
struct ManagedPlugin {
    manifest: PluginManifest,
    package_root: PathBuf,
    config: Mutex<StoredPluginConfig>,
    runtime: Mutex<RuntimeInfo>,
    supervisor: Mutex<Option<SupervisorHandle>>,
}

#[derive(Debug)]
struct SupervisorHandle {
    stop: mpsc::Sender<SupervisorCommand>,
    join: Option<JoinHandle<()>>,
}

#[derive(Debug)]
enum SupervisorCommand {
    Stop,
}

#[derive(Debug)]
struct PluginHostInner {
    config_path: RwLock<PathBuf>,
    plugins: RwLock<BTreeMap<String, Arc<ManagedPlugin>>>,
    broker: RwLock<Arc<dyn AudioCapabilityBroker>>,
    shutdown: Mutex<bool>,
}

#[derive(Debug)]
pub struct PluginHostState {
    inner: Arc<PluginHostInner>,
}

#[derive(Debug)]
struct ScopedBroker {
    audio: Arc<dyn AudioCapabilityBroker>,
    plugin: Arc<ManagedPlugin>,
}

impl AudioCapabilityBroker for ScopedBroker {
    fn call(&self, plugin_id: &str, method: &str, params: Value) -> Result<Value, String> {
        if plugin_id != self.plugin.manifest.id {
            return Err("plugin identity did not match its host session".to_string());
        }
        if !self
            .plugin
            .manifest
            .capabilities
            .iter()
            .any(|capability| capability == method)
        {
            return Err(format!(
                "plugin '{}' is not allowed to call '{}'",
                plugin_id, method
            ));
        }
        if method == "plugin.config.read" {
            let field_id = required_string(&params, "fieldId", 64)?;
            let field = self
                .plugin
                .manifest
                .settings
                .fields
                .iter()
                .find(|field| field.id == field_id)
                .ok_or_else(|| format!("unknown plugin setting '{field_id}'"))?;
            let config = self
                .plugin
                .config
                .lock()
                .map_err(|_| "plugin config lock was poisoned".to_string())?;
            return Ok(json!({
                "fieldId": field.id,
                "value": config.values.get(&field.id).cloned().unwrap_or_else(|| field.default.clone())
            }));
        }
        self.audio.call(plugin_id, method, params)
    }
}

#[derive(Debug)]
struct NullBroker;

impl AudioCapabilityBroker for NullBroker {
    fn call(&self, _plugin_id: &str, _method: &str, _params: Value) -> Result<Value, String> {
        Err("plugin host is not connected to the audio sidecar".to_string())
    }
}

#[derive(Debug)]
enum ProcessEvent {
    HelloAck(Option<String>),
    PluginEvent(String),
    ShutdownAck,
    ProtocolError(String),
    Eof,
}

#[derive(Debug)]
struct ProcessSession {
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    events: mpsc::Receiver<ProcessEvent>,
}

fn spawn_process(
    manifest: &PluginManifest,
    package_root: &Path,
    broker: Arc<dyn AudioCapabilityBroker>,
    secrets: Vec<String>,
) -> Result<ProcessSession, String> {
    let executable = resolve_entrypoint(package_root, &manifest.entrypoint.program)?;
    let mut command = Command::new(&executable);
    command
        .args(&manifest.entrypoint.args)
        .current_dir(package_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env_clear();
    for key in ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to start plugin '{}': {error}", manifest.id))?;
    let stdin = Arc::new(Mutex::new(
        child
            .stdin
            .take()
            .ok_or_else(|| "plugin stdin was unavailable".to_string())?,
    ));
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "plugin stdout was unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "plugin stderr was unavailable".to_string())?;
    let child = Arc::new(Mutex::new(child));
    let (events_tx, events_rx) = mpsc::channel();
    let max_frame_bytes = manifest.limits.max_frame_bytes;
    let call_timeout = Duration::from_millis(manifest.limits.call_ms);
    let plugin_id = manifest.id.clone();
    let reader_stdin = Arc::clone(&stdin);
    let reader_broker = Arc::clone(&broker);
    thread::Builder::new()
        .name(format!("lyne-plugin-{}-stdout", manifest.id))
        .spawn(move || {
            let mut seen = HashSet::new();
            let mut reader = BufReader::new(stdout);
            loop {
                match read_bounded_line(&mut reader, max_frame_bytes) {
                    Ok(None) => {
                        let _ = events_tx.send(ProcessEvent::Eof);
                        break;
                    }
                    Ok(Some(line)) => {
                        let trimmed = line.strip_suffix(&[b'\n']).unwrap_or(&line);
                        let trimmed = trimmed.strip_suffix(&[b'\r']).unwrap_or(trimmed);
                        let frame = match parse_frame(trimmed, max_frame_bytes) {
                            Ok(frame) => frame,
                            Err(error) => {
                                let _ = events_tx.send(ProcessEvent::ProtocolError(error));
                                break;
                            }
                        };
                        match frame.kind.as_str() {
                            "hello_ack" => {
                                let _ = events_tx.send(ProcessEvent::HelloAck(frame.plugin_id));
                            }
                            "shutdown_ack" => {
                                let _ = events_tx.send(ProcessEvent::ShutdownAck);
                            }
                            "event" => {
                                if let Some(event) = frame.event {
                                    let _ = events_tx.send(ProcessEvent::PluginEvent(event));
                                }
                            }
                            "call" => {
                                let Some(request_id) = frame.request_id else {
                                    let _ = events_tx.send(ProcessEvent::ProtocolError(
                                        "plugin call is missing requestId".to_string(),
                                    ));
                                    break;
                                };
                                if !seen.insert(request_id.clone()) {
                                    let _ = write_frame(
                                        &reader_stdin,
                                        json!({
                                            "protocol": HOST_PROTOCOL,
                                            "type": "result",
                                            "requestId": request_id,
                                            "ok": false,
                                            "error": "duplicate requestId"
                                        }),
                                        max_frame_bytes,
                                    );
                                    continue;
                                }
                                if seen.len() > REQUEST_ID_LIMIT {
                                    let _ = events_tx.send(ProcessEvent::ProtocolError(
                                        "plugin requestId window exceeded".to_string(),
                                    ));
                                    break;
                                }
                                let method = frame.method.unwrap_or_default();
                                let result = call_with_timeout(
                                    Arc::clone(&reader_broker),
                                    &plugin_id,
                                    &method,
                                    frame.params,
                                    call_timeout,
                                );
                                let response = match result {
                                    Ok(value) => json!({
                                        "protocol": HOST_PROTOCOL,
                                        "type": "result",
                                        "requestId": request_id,
                                        "ok": true,
                                        "result": value
                                    }),
                                    Err(error) => json!({
                                        "protocol": HOST_PROTOCOL,
                                        "type": "result",
                                        "requestId": request_id,
                                        "ok": false,
                                        "error": error
                                    }),
                                };
                                if let Err(error) =
                                    write_frame(&reader_stdin, response, max_frame_bytes)
                                {
                                    let _ = events_tx.send(ProcessEvent::ProtocolError(error));
                                    break;
                                }
                            }
                            _ => unreachable!(),
                        }
                    }
                    Err(error) => {
                        let _ = events_tx.send(ProcessEvent::ProtocolError(format!("{error}")));
                        break;
                    }
                }
            }
        })
        .map_err(|error| format!("failed to create plugin stdout reader: {error}"))?;
    let diagnostic_id = manifest.id.clone();
    thread::Builder::new()
        .name(format!("lyne-plugin-{}-stderr", manifest.id))
        .spawn(move || {
            let mut reader = BufReader::new(stderr);
            let mut retained = String::new();
            while let Ok(Some(line)) = read_bounded_line(&mut reader, MAX_DIAGNOSTIC_BYTES) {
                retained.push_str(&String::from_utf8_lossy(&line));
                if retained.len() > MAX_DIAGNOSTIC_BYTES {
                    let mut start = retained.len() - MAX_DIAGNOSTIC_BYTES;
                    while !retained.is_char_boundary(start) {
                        start += 1;
                    }
                    retained.drain(..start);
                }
            }
            if !retained.trim().is_empty() {
                eprintln!(
                    "[audio-desktop] plugin {diagnostic_id} stderr: {}",
                    sanitize_diagnostic(&retained, &secrets)
                );
            }
        })
        .map_err(|error| format!("failed to create plugin stderr reader: {error}"))?;
    write_frame(&stdin, host_hello(manifest), max_frame_bytes)?;
    Ok(ProcessSession {
        child,
        stdin,
        events: events_rx,
    })
}

fn call_with_timeout(
    broker: Arc<dyn AudioCapabilityBroker>,
    plugin_id: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, String> {
    let plugin_id = plugin_id.to_string();
    let method_name = method.to_string();
    let timeout_method = method_name.clone();
    let (tx, rx) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("lyne-plugin-broker-call".to_string())
        .spawn(move || {
            let result = broker.call(&plugin_id, &method_name, params);
            let _ = tx.send(result);
        })
        .map_err(|error| format!("failed to start broker call: {error}"))?;
    rx.recv_timeout(timeout)
        .map_err(|_| format!("plugin broker call '{timeout_method}' timed out"))?
}

fn sanitize_diagnostic(value: &str, secrets: &[String]) -> String {
    let mut result = value.to_string();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        result = result.replace(secret, SECRET_PLACEHOLDER);
    }
    result
}

fn send_shutdown(session: &ProcessSession, manifest: &PluginManifest) {
    let _ = write_frame(
        &session.stdin,
        json!({"protocol": HOST_PROTOCOL, "type": "shutdown"}),
        manifest.limits.max_frame_bytes,
    );
}

fn kill_child(child: &Arc<Mutex<Child>>) {
    if let Ok(mut child) = child.lock() {
        let is_running = child
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(true);
        #[cfg(windows)]
        if is_running {
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn wait_for_shutdown(session: &ProcessSession, manifest: &PluginManifest) {
    send_shutdown(session, manifest);
    let deadline =
        std::time::Instant::now() + Duration::from_millis(manifest.limits.startup_ms.min(2_000));
    while std::time::Instant::now() < deadline {
        if let Ok(event) = session.events.recv_timeout(Duration::from_millis(50)) {
            if matches!(event, ProcessEvent::ShutdownAck | ProcessEvent::Eof) {
                break;
            }
            if matches!(event, ProcessEvent::PluginEvent(_)) {
                continue;
            }
        }
    }
    kill_child(&session.child);
}

fn wait_for_ready(
    session: &ProcessSession,
    manifest: &PluginManifest,
    control: &mpsc::Receiver<SupervisorCommand>,
) -> Result<(), String> {
    let deadline = std::time::Instant::now() + Duration::from_millis(manifest.limits.startup_ms);
    while std::time::Instant::now() < deadline {
        if matches!(control.try_recv(), Ok(SupervisorCommand::Stop)) {
            return Err("plugin startup stopped by user".to_string());
        }
        match session.events.recv_timeout(Duration::from_millis(50)) {
            Ok(ProcessEvent::HelloAck(plugin_id)) => {
                if plugin_id
                    .as_deref()
                    .map(|id| id == manifest.id)
                    .unwrap_or(true)
                {
                    return Ok(());
                }
                return Err("plugin hello_ack contained the wrong plugin id".to_string());
            }
            Ok(ProcessEvent::ProtocolError(error)) => return Err(error),
            Ok(ProcessEvent::Eof) => return Err("plugin stdout closed during startup".to_string()),
            Ok(ProcessEvent::PluginEvent(_)) => {}
            Ok(ProcessEvent::ShutdownAck) => {
                return Err("plugin shut down during startup".to_string())
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("plugin event channel disconnected".to_string())
            }
        }
    }
    Err("plugin hello_ack timed out".to_string())
}

fn wait_backoff(control: &mpsc::Receiver<SupervisorCommand>, failures: u32) -> bool {
    let delay = Duration::from_millis(
        250u64.saturating_mul(2u64.saturating_pow(failures.saturating_sub(1))),
    );
    !matches!(
        control.recv_timeout(delay),
        Ok(SupervisorCommand::Stop) | Err(mpsc::RecvTimeoutError::Disconnected)
    )
}

fn set_runtime(plugin: &ManagedPlugin, status: RuntimeStatus, error: Option<String>) {
    if let Ok(mut runtime) = plugin.runtime.lock() {
        runtime.status = status;
        runtime.last_error = error.map(|value| sanitize_diagnostic(&value, &[]));
    }
}

fn supervisor_loop(
    plugin: Arc<ManagedPlugin>,
    broker: Arc<dyn AudioCapabilityBroker>,
    control: mpsc::Receiver<SupervisorCommand>,
) {
    let mut failures = 0;
    loop {
        if failures >= MAX_PLUGIN_FAILURES {
            set_runtime(
                &plugin,
                RuntimeStatus::DisabledAfterFailure,
                Some("plugin disabled after repeated failures".to_string()),
            );
            break;
        }
        set_runtime(&plugin, RuntimeStatus::Starting, None);
        let scoped_broker = Arc::new(ScopedBroker {
            audio: Arc::clone(&broker),
            plugin: Arc::clone(&plugin),
        }) as Arc<dyn AudioCapabilityBroker>;
        let secrets = plugin
            .config
            .lock()
            .ok()
            .map(|config| {
                plugin
                    .manifest
                    .settings
                    .fields
                    .iter()
                    .filter(|field| field.secret)
                    .filter_map(|field| config.values.get(&field.id))
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let session = match spawn_process(
            &plugin.manifest,
            &plugin.package_root,
            scoped_broker,
            secrets,
        ) {
            Ok(session) => session,
            Err(error) => {
                failures += 1;
                set_runtime(&plugin, RuntimeStatus::Degraded, Some(error));
                if !wait_backoff(&control, failures) {
                    set_runtime(&plugin, RuntimeStatus::Disabled, None);
                    break;
                }
                continue;
            }
        };
        if let Err(error) = wait_for_ready(&session, &plugin.manifest, &control) {
            wait_for_shutdown(&session, &plugin.manifest);
            if error == "plugin startup stopped by user" {
                set_runtime(&plugin, RuntimeStatus::Disabled, None);
                break;
            }
            failures += 1;
            set_runtime(&plugin, RuntimeStatus::Degraded, Some(error));
            if !wait_backoff(&control, failures) {
                set_runtime(&plugin, RuntimeStatus::Disabled, None);
                break;
            }
            continue;
        }
        set_runtime(&plugin, RuntimeStatus::Ready, None);
        let _ = write_frame(
            &session.stdin,
            lifecycle_event("ready"),
            plugin.manifest.limits.max_frame_bytes,
        );
        let failure = loop {
            match control.recv_timeout(Duration::from_millis(100)) {
                Ok(SupervisorCommand::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    wait_for_shutdown(&session, &plugin.manifest);
                    set_runtime(&plugin, RuntimeStatus::Disabled, None);
                    return;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if let Ok(event) = session.events.try_recv() {
                match event {
                    ProcessEvent::ProtocolError(error) => {
                        break error;
                    }
                    ProcessEvent::Eof => {
                        break "plugin stdout closed unexpectedly".to_string();
                    }
                    ProcessEvent::HelloAck(_) | ProcessEvent::ShutdownAck => {}
                    ProcessEvent::PluginEvent(event) => {
                        let _ = event;
                    }
                }
            }
            if let Ok(mut child) = session.child.lock() {
                if let Ok(Some(status)) = child.try_wait() {
                    break format!("plugin exited with status {status}");
                }
            }
        };
        wait_for_shutdown(&session, &plugin.manifest);
        failures += 1;
        set_runtime(&plugin, RuntimeStatus::Degraded, Some(failure));
        if !wait_backoff(&control, failures) {
            set_runtime(&plugin, RuntimeStatus::Disabled, None);
            break;
        }
    }
}

impl PluginHostState {
    pub fn empty() -> Self {
        Self {
            inner: Arc::new(PluginHostInner {
                config_path: RwLock::new(PathBuf::new()),
                plugins: RwLock::new(BTreeMap::new()),
                broker: RwLock::new(Arc::new(NullBroker)),
                shutdown: Mutex::new(false),
            }),
        }
    }

    pub fn initialize(
        &self,
        app: &tauri::AppHandle,
        runtime_state: &ApiRuntimeState,
    ) -> Result<(), String> {
        let runtime = runtime_state.snapshot()?;
        let broker = Arc::new(SidecarBroker::new(runtime.base_url, runtime.token)?)
            as Arc<dyn AudioCapabilityBroker>;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve plugin app data directory: {error}"))?;
        fs::create_dir_all(&app_data)
            .map_err(|error| format!("failed to create plugin app data directory: {error}"))?;
        let config_path = app_data.join("plugin-host.json");
        let persisted = load_config(&config_path)?;
        let resource_root = app
            .path()
            .resolve("plugins", BaseDirectory::Resource)
            .ok()
            .filter(|path| path.is_dir())
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("plugins"));
        let manifests = discover_manifests(&resource_root)?;
        let mut plugins = BTreeMap::new();
        for (manifest, package_root) in manifests {
            let stored = persisted
                .plugins
                .get(&manifest.id)
                .cloned()
                .unwrap_or_default();
            let values = merge_defaults(&manifest, stored.values);
            let plugin = Arc::new(ManagedPlugin {
                manifest,
                package_root,
                config: Mutex::new(StoredPluginConfig {
                    enabled: stored.enabled,
                    values,
                }),
                runtime: Mutex::new(RuntimeInfo::default()),
                supervisor: Mutex::new(None),
            });
            plugins.insert(plugin.manifest.id.clone(), plugin);
        }
        *self
            .inner
            .config_path
            .write()
            .map_err(|_| "plugin config path lock was poisoned".to_string())? = config_path;
        *self
            .inner
            .broker
            .write()
            .map_err(|_| "plugin broker lock was poisoned".to_string())? = broker;
        *self
            .inner
            .plugins
            .write()
            .map_err(|_| "plugin host lock was poisoned".to_string())? = plugins;
        if let Ok(mut shutdown) = self.inner.shutdown.lock() {
            *shutdown = false;
        }
        self.persist()?;
        for id in self.plugin_ids() {
            if self.is_enabled(&id) {
                self.start_plugin(&id)?;
            }
        }
        Ok(())
    }

    fn plugin_ids(&self) -> Vec<String> {
        self.inner
            .plugins
            .read()
            .map(|plugins| plugins.keys().cloned().collect())
            .unwrap_or_default()
    }

    fn plugin(&self, id: &str) -> Result<Arc<ManagedPlugin>, String> {
        self.inner
            .plugins
            .read()
            .map_err(|_| "plugin host lock was poisoned".to_string())?
            .get(id)
            .cloned()
            .ok_or_else(|| format!("unknown plugin '{id}'"))
    }

    fn is_enabled(&self, id: &str) -> bool {
        self.plugin(id)
            .ok()
            .and_then(|plugin| plugin.config.lock().ok().map(|config| config.enabled))
            .unwrap_or(false)
    }

    fn current_broker(&self) -> Arc<dyn AudioCapabilityBroker> {
        self.inner
            .broker
            .read()
            .map(|broker| Arc::clone(&broker))
            .unwrap_or_else(|_| Arc::new(NullBroker))
    }

    fn start_plugin(&self, id: &str) -> Result<(), String> {
        let is_shutting_down = self
            .inner
            .shutdown
            .lock()
            .map_err(|_| "plugin shutdown lock was poisoned".to_string())?
            .to_owned();
        if is_shutting_down {
            return Err("plugin host is shutting down".to_string());
        }
        let plugin = self.plugin(id)?;
        let mut supervisor = plugin
            .supervisor
            .lock()
            .map_err(|_| "plugin supervisor lock was poisoned".to_string())?;
        if supervisor.is_some() {
            return Ok(());
        }
        let (stop, control) = mpsc::channel();
        let broker = self.current_broker();
        let plugin_for_thread = Arc::clone(&plugin);
        let join = thread::Builder::new()
            .name(format!("lyne-plugin-{}-supervisor", id))
            .spawn(move || supervisor_loop(plugin_for_thread, broker, control))
            .map_err(|error| format!("failed to start plugin supervisor: {error}"))?;
        *supervisor = Some(SupervisorHandle {
            stop,
            join: Some(join),
        });
        Ok(())
    }

    fn stop_plugin(&self, id: &str) -> Result<(), String> {
        let plugin = self.plugin(id)?;
        let handle = plugin
            .supervisor
            .lock()
            .map_err(|_| "plugin supervisor lock was poisoned".to_string())?
            .take();
        if let Some(mut handle) = handle {
            let _ = handle.stop.send(SupervisorCommand::Stop);
            if let Some(join) = handle.join.take() {
                let _ = join.join();
            }
        }
        set_runtime(&plugin, RuntimeStatus::Disabled, None);
        Ok(())
    }

    fn persist(&self) -> Result<(), String> {
        let path = self
            .inner
            .config_path
            .read()
            .map_err(|_| "plugin config path lock was poisoned".to_string())?
            .clone();
        if path.as_os_str().is_empty() {
            return Ok(());
        }
        let plugins = self
            .inner
            .plugins
            .read()
            .map_err(|_| "plugin host lock was poisoned".to_string())?;
        let mut file = ConfigFile {
            version: CONFIG_VERSION,
            plugins: BTreeMap::new(),
        };
        for (id, plugin) in plugins.iter() {
            let config = plugin
                .config
                .lock()
                .map_err(|_| "plugin config lock was poisoned".to_string())?;
            file.plugins.insert(id.clone(), config.clone());
        }
        atomic_write_json(&path, &file)
    }

    fn snapshots(&self) -> Vec<PluginSnapshot> {
        let Ok(plugins) = self.inner.plugins.read() else {
            return Vec::new();
        };
        plugins
            .values()
            .filter_map(|plugin| {
                let config = plugin.config.lock().ok()?;
                let runtime = plugin.runtime.lock().ok()?;
                let settings = plugin
                    .manifest
                    .settings
                    .fields
                    .iter()
                    .map(|field| PluginSettingSnapshot {
                        id: field.id.clone(),
                        label: field.label.clone(),
                        kind: field.kind.clone(),
                        secret: field.secret,
                        value: if field.secret {
                            None
                        } else {
                            Some(
                                config
                                    .values
                                    .get(&field.id)
                                    .cloned()
                                    .unwrap_or_else(|| field.default.clone()),
                            )
                        },
                    })
                    .collect();
                Some(PluginSnapshot {
                    id: plugin.manifest.id.clone(),
                    name: plugin.manifest.name.clone(),
                    version: plugin.manifest.version.clone(),
                    enabled: config.enabled,
                    status: runtime.status.as_str().to_string(),
                    last_error: runtime.last_error.clone(),
                    settings,
                    outbound_origins: plugin.manifest.outbound_origins.clone(),
                })
            })
            .collect()
    }

    pub fn set_enabled(&self, id: &str, enabled: bool) -> Result<Vec<PluginSnapshot>, String> {
        let plugin = self.plugin(id)?;
        // A user enable also clears an exhausted supervisor and retries from zero.
        self.stop_plugin(id)?;
        {
            let mut config = plugin
                .config
                .lock()
                .map_err(|_| "plugin config lock was poisoned".to_string())?;
            config.enabled = enabled;
        }
        self.persist()?;
        if enabled {
            self.start_plugin(id)?;
        }
        Ok(self.snapshots())
    }

    pub fn update_settings(
        &self,
        id: &str,
        values: BTreeMap<String, Value>,
    ) -> Result<Vec<PluginSnapshot>, String> {
        let plugin = self.plugin(id)?;
        for (field_id, value) in &values {
            let field = plugin
                .manifest
                .settings
                .fields
                .iter()
                .find(|field| field.id == *field_id)
                .ok_or_else(|| format!("unknown setting '{field_id}'"))?;
            validate_config_value(&plugin.manifest, field, value)?;
        }
        let was_enabled = plugin
            .config
            .lock()
            .map_err(|_| "plugin config lock was poisoned".to_string())?
            .enabled;
        if was_enabled {
            self.stop_plugin(id)?;
        }
        {
            let mut config = plugin
                .config
                .lock()
                .map_err(|_| "plugin config lock was poisoned".to_string())?;
            config.values.extend(values);
        }
        self.persist()?;
        if was_enabled {
            self.start_plugin(id)?;
        }
        Ok(self.snapshots())
    }

    pub fn stop_all(&self) {
        if let Ok(mut shutdown) = self.inner.shutdown.lock() {
            *shutdown = true;
        }
        for id in self.plugin_ids() {
            let _ = self.stop_plugin(&id);
        }
    }
}

fn merge_defaults(
    manifest: &PluginManifest,
    mut values: BTreeMap<String, Value>,
) -> BTreeMap<String, Value> {
    let mut validated = BTreeMap::new();
    for field in &manifest.settings.fields {
        let value = values
            .remove(&field.id)
            .unwrap_or_else(|| field.default.clone());
        if validate_config_value(manifest, field, &value).is_ok() {
            validated.insert(field.id.clone(), value);
        } else {
            validated.insert(field.id.clone(), field.default.clone());
        }
    }
    validated
}

fn load_config(path: &Path) -> Result<ConfigFile, String> {
    if !path.exists() {
        return Ok(ConfigFile {
            version: CONFIG_VERSION,
            plugins: BTreeMap::new(),
        });
    }
    let bytes = fs::read(path).map_err(|error| format!("failed to read plugin config: {error}"))?;
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err("plugin config exceeds 512 KiB".to_string());
    }
    let file: ConfigFile = serde_json::from_slice(&bytes)
        .map_err(|error| format!("failed to parse plugin config: {error}"))?;
    if file.version != CONFIG_VERSION {
        return Err(format!(
            "unsupported plugin config version {}",
            file.version
        ));
    }
    Ok(file)
}

fn atomic_write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("failed to encode plugin config: {error}"))?;
    if bytes.len() > MAX_CONFIG_BYTES {
        return Err("plugin config exceeds 512 KiB".to_string());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "plugin config has no parent directory".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create plugin config directory: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temp_path = parent.join(format!(".plugin-host-{nonce}-{}.tmp", std::process::id()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| format!("failed to create plugin config temp file: {error}"))?;
    file.write_all(&bytes)
        .map_err(|error| format!("failed to write plugin config temp file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("failed to flush plugin config temp file: {error}"))?;
    drop(file);
    replace_file(&temp_path, path)
}

fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, ReplaceFileW, MOVEFILE_WRITE_THROUGH,
        };

        let from: Vec<u16> = temp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let to: Vec<u16> = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let result = if target.exists() {
            // SAFETY: Both paths are NUL-terminated UTF-16 buffers that remain
            // alive for the duration of the synchronous Windows API call.
            unsafe {
                ReplaceFileW(
                    to.as_ptr(),
                    from.as_ptr(),
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            }
        } else {
            // SAFETY: Both paths are NUL-terminated UTF-16 buffers that remain
            // alive for the duration of the synchronous Windows API call.
            unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), MOVEFILE_WRITE_THROUGH) }
        };
        if result == 0 {
            Err(format!(
                "failed to atomically replace plugin config: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }
    #[cfg(not(windows))]
    {
        fs::rename(temp, target)
            .map_err(|error| format!("failed to atomically replace plugin config: {error}"))
    }
}

#[tauri::command]
pub fn plugin_host_list(
    state: tauri::State<'_, PluginHostState>,
) -> Result<Vec<PluginSnapshot>, String> {
    Ok(state.snapshots())
}

#[tauri::command]
pub fn plugin_host_set_enabled(
    id: String,
    enabled: bool,
    state: tauri::State<'_, PluginHostState>,
) -> Result<Vec<PluginSnapshot>, String> {
    state.set_enabled(&id, enabled)
}

#[tauri::command]
pub fn plugin_host_update_settings(
    id: String,
    values: BTreeMap<String, Value>,
    state: tauri::State<'_, PluginHostState>,
) -> Result<Vec<PluginSnapshot>, String> {
    state.update_settings(&id, values)
}

pub fn start(
    app: &tauri::AppHandle,
    state: &PluginHostState,
    runtime_state: &ApiRuntimeState,
) -> Result<(), String> {
    state.initialize(app, runtime_state)
}

pub fn stop(state: &PluginHostState) {
    state.stop_all();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> PluginManifest {
        PluginManifest {
            id: "test-plugin".to_string(),
            name: "Test Plugin".to_string(),
            version: "1.0.0".to_string(),
            host_api: HOST_API.to_string(),
            entrypoint: Entrypoint {
                program: "runner.exe".to_string(),
                args: Vec::new(),
            },
            capabilities: vec!["plugin.config.read".to_string()],
            settings: SettingsSchema {
                fields: vec![SettingField {
                    id: "key".to_string(),
                    label: "Key".to_string(),
                    kind: "string".to_string(),
                    secret: true,
                    default: Value::Null,
                }],
            },
            limits: PluginLimits::default(),
            outbound_origins: vec!["ws://127.0.0.1:8080".to_string()],
        }
    }

    #[test]
    fn manifest_rejects_traversal_and_unsafe_origin() {
        let mut value = manifest();
        value.entrypoint.program = "../runner.exe".to_string();
        assert!(value.validate().is_err());
        value.entrypoint.program = "runner.exe".to_string();
        value.outbound_origins = vec!["ws://192.168.1.2:8080".to_string()];
        assert!(value.validate().is_err());

        let mut value = manifest();
        value.settings.fields.push(SettingField {
            id: "endpoint".to_string(),
            label: "Endpoint".to_string(),
            kind: "url".to_string(),
            secret: false,
            default: Value::String("ws://192.168.1.2:8080".to_string()),
        });
        assert!(value.validate().is_err());
    }

    #[test]
    fn frame_parser_rejects_malformed_and_accepts_calls() {
        assert!(parse_frame(b"not-json", 1024).is_err());
        assert!(parse_frame(&vec![b'a'; 1025], 1024).is_err());
        assert!(parse_frame(br#"{"protocol":1,"type":"unknown"}"#, 1024).is_err());
        assert!(parse_frame(
            br#"{"protocol":1,"type":"call","requestId":"a","method":"plugin.config.read","params":{}}"#,
            1024
        )
        .is_ok());
    }

    #[test]
    fn persisted_values_are_revalidated_against_the_manifest() {
        let mut value = manifest();
        value.settings.fields.push(SettingField {
            id: "endpoint".to_string(),
            label: "Endpoint".to_string(),
            kind: "url".to_string(),
            secret: false,
            default: Value::Null,
        });
        let merged = merge_defaults(
            &value,
            BTreeMap::from([
                ("key".to_string(), Value::Bool(true)),
                (
                    "endpoint".to_string(),
                    Value::String("wss://undeclared.example".to_string()),
                ),
                (
                    "obsolete".to_string(),
                    Value::String("discarded".to_string()),
                ),
            ]),
        );
        assert_eq!(merged.get("key"), Some(&Value::Null));
        assert_eq!(merged.get("endpoint"), Some(&Value::Null));
        assert!(!merged.contains_key("obsolete"));
    }

    #[test]
    fn sanitizer_drops_source_paths() {
        let payload = json!({
            "rows": [{
                "media_id": "m1",
                "title": "Song",
                "folder_path": "C:\\secret\\song.mp3",
                "file_name": "song.mp3"
            }],
            "total_count": 1
        });
        let sanitized = sanitize_library_page(payload).expect("sanitized page");
        let text = sanitized.to_string();
        assert!(text.contains("m1"));
        assert!(!text.contains("secret"));
        assert!(!text.contains("file_name"));
    }

    #[test]
    fn atomic_config_round_trip() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lyne-plugin-host-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create test directory");
        let path = root.join("config.json");
        let mut config = ConfigFile {
            version: CONFIG_VERSION,
            plugins: BTreeMap::new(),
        };
        config.plugins.insert(
            "test-plugin".to_string(),
            StoredPluginConfig {
                enabled: false,
                values: BTreeMap::new(),
            },
        );
        atomic_write_json(&path, &config).expect("write config");
        assert_eq!(load_config(&path).expect("read config").plugins.len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discovery_loads_valid_manifest_and_rejects_duplicate_ids() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lyne-plugin-discovery-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("first")).expect("create first package");
        fs::write(
            root.join("first/plugin.json"),
            serde_json::to_vec(&manifest()).expect("encode manifest"),
        )
        .expect("write manifest");
        assert_eq!(
            discover_manifests(&root)
                .expect("discover valid package")
                .len(),
            1
        );
        fs::create_dir_all(root.join("second")).expect("create second package");
        fs::write(
            root.join("second/plugin.json"),
            serde_json::to_vec(&manifest()).expect("encode duplicate manifest"),
        )
        .expect("write duplicate manifest");
        assert!(discover_manifests(&root).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn secret_values_are_masked_and_capabilities_are_scoped() {
        let value = "fixture-secret".to_string();
        let plugin = Arc::new(ManagedPlugin {
            manifest: manifest(),
            package_root: std::env::temp_dir(),
            config: Mutex::new(StoredPluginConfig {
                enabled: false,
                values: BTreeMap::from([("key".to_string(), Value::String(value.clone()))]),
            }),
            runtime: Mutex::new(RuntimeInfo::default()),
            supervisor: Mutex::new(None),
        });
        let state = PluginHostState::empty();
        state
            .inner
            .plugins
            .write()
            .expect("plugin lock")
            .insert(plugin.manifest.id.clone(), Arc::clone(&plugin));
        let snapshot = state.snapshots().pop().expect("plugin snapshot");
        assert!(snapshot.settings[0].secret);
        assert!(snapshot.settings[0].value.is_none());
        let scoped = ScopedBroker {
            audio: Arc::new(TestBroker),
            plugin,
        };
        assert!(scoped
            .call("test-plugin", "audio.playback.state", json!({}))
            .is_err());
        let secret = scoped
            .call(
                "test-plugin",
                "plugin.config.read",
                json!({"fieldId": "key"}),
            )
            .expect("read declared secret");
        assert_eq!(secret["value"], value);
    }

    #[test]
    fn process_fixture_completes_protocol_lifecycle() {
        let mut fixture = std::env::current_exe().expect("test executable path");
        fixture.pop();
        fixture.pop();
        fixture.push(if cfg!(windows) {
            "plugin-host-fixture.exe"
        } else {
            "plugin-host-fixture"
        });
        assert!(
            fixture.is_file(),
            "plugin-host-fixture must be built before the process smoke test; run `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin plugin-host-fixture`"
        );
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock after epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "lyne-plugin-process-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create fixture package");
        let runner = root.join(if cfg!(windows) {
            "runner.exe"
        } else {
            "runner"
        });
        fs::copy(&fixture, &runner).expect("copy fixture runner");
        let mut test_manifest = manifest();
        test_manifest.entrypoint.program = runner.file_name().unwrap().to_string_lossy().into();
        let broker = Arc::new(TestBroker) as Arc<dyn AudioCapabilityBroker>;
        let session = spawn_process(&test_manifest, &root, broker, Vec::new())
            .expect("spawn fixture process");
        assert!(matches!(
            session.events.recv_timeout(Duration::from_secs(2)),
            Ok(ProcessEvent::HelloAck(Some(id))) if id == "test-plugin"
        ));
        write_frame(
            &session.stdin,
            lifecycle_event("ready"),
            test_manifest.limits.max_frame_bytes,
        )
        .expect("send ready event");
        assert!(matches!(
            session.events.recv_timeout(Duration::from_secs(2)),
            Ok(ProcessEvent::PluginEvent(event)) if event == "fixture_seen_ready"
        ));
        assert!(matches!(
            session.events.recv_timeout(Duration::from_secs(2)),
            Ok(ProcessEvent::PluginEvent(event)) if event == "fixture_received_result"
        ));
        wait_for_shutdown(&session, &test_manifest);
        let _ = fs::remove_dir_all(root);
    }

    #[derive(Debug)]
    struct TestBroker;

    impl AudioCapabilityBroker for TestBroker {
        fn call(&self, _plugin_id: &str, method: &str, _params: Value) -> Result<Value, String> {
            if method == "plugin.config.read" {
                Ok(json!({"fieldId": "key", "value": "fixture-secret"}))
            } else {
                Err("unexpected fixture method".to_string())
            }
        }
    }
}
