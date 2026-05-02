use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{self, LineWriter, Write};
use std::path::{Path, PathBuf};

pub use audio_runtime_paths::{
    ENV_APP_DATA_LEGACY, ENV_AUDIO_APP_DATA_DIR, ENV_AUDIO_APP_DB_PATH, ENV_AUDIO_CACHE_DIR,
    ENV_AUDIO_LOG_DIR, ENV_AUDIO_LOUDNESS_DB_PATH, ENV_AUDIO_SETTINGS_PATH,
};

const DEFAULT_APP_DIR_NAME: &str = "AudioPlayer";

#[derive(Debug, Clone)]
pub struct RuntimePaths {
    pub app_data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub log_dir: PathBuf,
    pub settings_path: PathBuf,
    pub loudness_db_path: PathBuf,
    pub app_db_path: PathBuf,
}

impl RuntimePaths {
    pub fn resolve() -> Self {
        let app_data_dir = read_path_env(ENV_AUDIO_APP_DATA_DIR)
            .or_else(|| read_path_env(ENV_APP_DATA_LEGACY))
            .unwrap_or_else(default_app_data_dir);
        let cache_dir =
            read_path_env(ENV_AUDIO_CACHE_DIR).unwrap_or_else(|| app_data_dir.join("cache"));
        let log_dir = read_path_env(ENV_AUDIO_LOG_DIR).unwrap_or_else(|| app_data_dir.join("logs"));
        let settings_path = read_path_env(ENV_AUDIO_SETTINGS_PATH)
            .unwrap_or_else(|| app_data_dir.join("audio_settings.json"));
        let loudness_db_path = read_path_env(ENV_AUDIO_LOUDNESS_DB_PATH)
            .unwrap_or_else(|| app_data_dir.join("loudness_cache.db"));
        let app_db_path = read_path_env(ENV_AUDIO_APP_DB_PATH)
            .unwrap_or_else(|| app_data_dir.join("app_state.db"));

        Self {
            app_data_dir,
            cache_dir,
            log_dir,
            settings_path,
            loudness_db_path,
            app_db_path,
        }
    }

    pub fn ensure(&self) -> Result<(), String> {
        ensure_dir(&self.app_data_dir)?;
        ensure_dir(&self.cache_dir)?;
        ensure_dir(&self.log_dir)?;
        ensure_parent_dir(&self.settings_path)?;
        ensure_parent_dir(&self.loudness_db_path)?;
        ensure_parent_dir(&self.app_db_path)?;
        Ok(())
    }

    pub fn apply_to_process_env(&self) {
        env::set_var(ENV_AUDIO_APP_DATA_DIR, &self.app_data_dir);
        env::set_var(ENV_APP_DATA_LEGACY, &self.app_data_dir);
        env::set_var(ENV_AUDIO_CACHE_DIR, &self.cache_dir);
        env::set_var(ENV_AUDIO_LOG_DIR, &self.log_dir);
        env::set_var(ENV_AUDIO_SETTINGS_PATH, &self.settings_path);
        env::set_var(ENV_AUDIO_LOUDNESS_DB_PATH, &self.loudness_db_path);
        env::set_var(ENV_AUDIO_APP_DB_PATH, &self.app_db_path);
    }

    pub fn server_log_path(&self) -> PathBuf {
        self.log_dir.join("audio_server.log")
    }
}

pub fn init_file_logger(paths: &RuntimePaths) -> Result<(), String> {
    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(paths.server_log_path())
        .map_err(|e| format!("Failed to open server log file: {}", e))?;

    let mut builder =
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"));
    builder.format_timestamp_millis();
    builder.target(env_logger::Target::Pipe(Box::new(TeeWriter::new(log_file))));
    builder
        .try_init()
        .map_err(|e| format!("Failed to initialize logger: {}", e))
}

fn read_path_env(key: &str) -> Option<PathBuf> {
    env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn default_app_data_dir() -> PathBuf {
    #[cfg(windows)]
    {
        if let Some(local) = read_path_env("LOCALAPPDATA") {
            return local.join(DEFAULT_APP_DIR_NAME);
        }
        if let Some(roaming) = read_path_env("APPDATA") {
            return roaming.join(DEFAULT_APP_DIR_NAME);
        }
    }

    if let Some(xdg_data_home) = read_path_env("XDG_DATA_HOME") {
        return xdg_data_home.join(DEFAULT_APP_DIR_NAME);
    }

    if let Some(home_dir) = read_path_env("HOME") {
        return home_dir
            .join(".local")
            .join("share")
            .join(DEFAULT_APP_DIR_NAME);
    }

    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".audio_player")
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| {
        format!(
            "Failed to create runtime directory '{}': {}",
            path.display(),
            e
        )
    })
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    match path.parent() {
        Some(parent) => ensure_dir(parent),
        None => Ok(()),
    }
}

struct TeeWriter {
    file: LineWriter<File>,
    stderr: io::Stderr,
}

impl TeeWriter {
    fn new(file: File) -> Self {
        Self {
            file: LineWriter::new(file),
            stderr: io::stderr(),
        }
    }
}

impl Write for TeeWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.stderr.write_all(buf)?;
        self.file.write_all(buf)?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stderr.flush()?;
        self.file.flush()
    }
}
