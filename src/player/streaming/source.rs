//! Source-opening contract for persistent streaming sessions.

use std::fs::Metadata;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use thiserror::Error;

use crate::decoder::{DecodeCancelToken, HttpCredentials, OpenedMediaSource};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StreamOpenIntent {
    InitialPlayback,
    GaplessPreload,
    SourceSeekRecovery,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StreamFetchPolicy {
    LocalOnly,
    AllowRemote,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LocalSourceIdentity {
    canonical_path: PathBuf,
    file_len: u64,
    modified_nanos: Option<u128>,
}

impl LocalSourceIdentity {
    fn from_metadata(canonical_path: PathBuf, metadata: &Metadata) -> Self {
        let modified_nanos = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_nanos());
        Self {
            canonical_path,
            file_len: metadata.len(),
            modified_nanos,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StreamSourceIdentity {
    Local(LocalSourceIdentity),
    Remote { url_fingerprint: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct StreamSourceCapabilities {
    pub seekable: bool,
    pub reopen_for_seek: bool,
    pub startup_frames: u64,
    pub target_ahead_millis: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum StreamRecoveryPolicy {
    ReopenWithExpectedIdentity,
}

pub(crate) struct OpenRequest<'a> {
    pub generation: u64,
    pub intent: StreamOpenIntent,
    pub path: &'a Path,
    pub cancel: DecodeCancelToken,
    pub credentials: Option<&'a HttpCredentials>,
    pub expected_identity: Option<&'a StreamSourceIdentity>,
    pub fetch_policy: StreamFetchPolicy,
}

pub(crate) struct OpenedSource {
    pub generation: u64,
    pub source: OpenedMediaSource,
    pub capabilities: StreamSourceCapabilities,
    pub identity: StreamSourceIdentity,
    pub recovery: StreamRecoveryPolicy,
}

#[derive(Debug, Error)]
pub(crate) enum StreamSourceError {
    #[error("source open was cancelled")]
    Cancelled,
    #[error("local source path is not a regular file: {0}")]
    NotRegularFile(PathBuf),
    #[error("source policy does not allow this path: {0}")]
    PolicyRejected(PathBuf),
    #[error("failed to resolve local source '{path}': {message}")]
    ResolveLocal { path: PathBuf, message: String },
    #[error("opened source identity differs from the expected source")]
    IdentityMismatch,
    #[error("failed to open local source '{path}': {message}")]
    OpenLocal { path: PathBuf, message: String },
    #[error("failed to open remote source")]
    OpenRemote(String),
}

pub(crate) trait StreamSourceFactory {
    fn open(&self, request: OpenRequest<'_>) -> Result<OpenedSource, StreamSourceError>;
}

#[derive(Default)]
pub(crate) struct LocalFileSourceFactory;

impl StreamSourceFactory for LocalFileSourceFactory {
    fn open(&self, request: OpenRequest<'_>) -> Result<OpenedSource, StreamSourceError> {
        if request.cancel.is_cancelled() {
            return Err(StreamSourceError::Cancelled);
        }
        if request.fetch_policy != StreamFetchPolicy::LocalOnly || is_url_like(request.path) {
            return Err(StreamSourceError::PolicyRejected(
                request.path.to_path_buf(),
            ));
        }

        let canonical_path =
            request
                .path
                .canonicalize()
                .map_err(|error| StreamSourceError::ResolveLocal {
                    path: request.path.to_path_buf(),
                    message: error.to_string(),
                })?;
        if request.cancel.is_cancelled() {
            return Err(StreamSourceError::Cancelled);
        }

        let source = OpenedMediaSource::open_local(&canonical_path, Some(request.cancel.clone()))
            .map_err(|error| {
            if request.cancel.is_cancelled() {
                StreamSourceError::Cancelled
            } else {
                StreamSourceError::OpenLocal {
                    path: canonical_path.clone(),
                    message: error.to_string(),
                }
            }
        })?;
        let metadata =
            canonical_path
                .metadata()
                .map_err(|error| StreamSourceError::ResolveLocal {
                    path: canonical_path.clone(),
                    message: error.to_string(),
                })?;
        if !metadata.is_file() {
            return Err(StreamSourceError::NotRegularFile(canonical_path));
        }
        let identity = StreamSourceIdentity::Local(LocalSourceIdentity::from_metadata(
            canonical_path.clone(),
            &metadata,
        ));
        if request
            .expected_identity
            .is_some_and(|expected| expected != &identity)
        {
            return Err(StreamSourceError::IdentityMismatch);
        }

        // These are results of a successful local open, not path guesses made
        // before touching the source.
        let capabilities = StreamSourceCapabilities {
            seekable: true,
            reopen_for_seek: false,
            startup_frames: 12_288,
            target_ahead_millis: match request.intent {
                StreamOpenIntent::InitialPlayback => 2_000,
                StreamOpenIntent::GaplessPreload => 1_000,
                StreamOpenIntent::SourceSeekRecovery => 500,
            },
        };

        let _ = request.credentials;
        Ok(OpenedSource {
            generation: request.generation,
            source,
            capabilities,
            identity,
            recovery: StreamRecoveryPolicy::ReopenWithExpectedIdentity,
        })
    }
}

#[derive(Default)]
pub(crate) struct RemoteHttpSourceFactory;

impl StreamSourceFactory for RemoteHttpSourceFactory {
    fn open(&self, request: OpenRequest<'_>) -> Result<OpenedSource, StreamSourceError> {
        if request.cancel.is_cancelled() {
            return Err(StreamSourceError::Cancelled);
        }
        if request.fetch_policy != StreamFetchPolicy::AllowRemote || !is_url_like(request.path) {
            return Err(StreamSourceError::PolicyRejected(
                request.path.to_path_buf(),
            ));
        }
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        request.path.to_string_lossy().hash(&mut hasher);
        let identity = StreamSourceIdentity::Remote {
            url_fingerprint: hasher.finish(),
        };
        if request
            .expected_identity
            .is_some_and(|expected| expected != &identity)
        {
            return Err(StreamSourceError::IdentityMismatch);
        }
        let source = OpenedMediaSource::open_path_with_credentials_and_cancel(
            request.path,
            request.credentials,
            Some(request.cancel.clone()),
        )
        .map_err(|error| {
            if request.cancel.is_cancelled() {
                StreamSourceError::Cancelled
            } else {
                StreamSourceError::OpenRemote(error.to_string())
            }
        })?;
        Ok(OpenedSource {
            generation: request.generation,
            source,
            capabilities: StreamSourceCapabilities {
                seekable: true,
                reopen_for_seek: false,
                startup_frames: 12_288,
                target_ahead_millis: 3_000,
            },
            identity,
            recovery: StreamRecoveryPolicy::ReopenWithExpectedIdentity,
        })
    }
}

fn is_url_like(path: &Path) -> bool {
    path.to_string_lossy().contains("://")
}

#[cfg(test)]
mod tests {
    use std::io::Write;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    use crate::decoder::StreamingDecoder;

    use super::*;

    struct TempSource {
        path: PathBuf,
    }

    impl TempSource {
        fn wav() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lyne-source-factory-{}-{:?}.wav",
                std::process::id(),
                std::thread::current().id()
            ));
            let mut file = std::fs::File::create(&path).expect("create fixture");
            file.write_all(&minimal_wav()).expect("write fixture");
            file.flush().expect("flush fixture");
            Self { path }
        }
    }

    impl Drop for TempSource {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.path);
        }
    }

    fn minimal_wav() -> Vec<u8> {
        let mut bytes = Vec::with_capacity(48);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&40_u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16_u32.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&1_u16.to_le_bytes());
        bytes.extend_from_slice(&44_100_u32.to_le_bytes());
        bytes.extend_from_slice(&88_200_u32.to_le_bytes());
        bytes.extend_from_slice(&2_u16.to_le_bytes());
        bytes.extend_from_slice(&16_u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&4_u32.to_le_bytes());
        bytes.extend_from_slice(&[0, 0, 0, 0]);
        bytes
    }

    fn token(cancelled: bool) -> DecodeCancelToken {
        DecodeCancelToken::new(Arc::new(AtomicBool::new(cancelled)))
    }

    #[test]
    fn local_factory_opens_once_then_decoder_consumes_opened_source() {
        let fixture = TempSource::wav();
        let opened = LocalFileSourceFactory
            .open(OpenRequest {
                generation: 7,
                intent: StreamOpenIntent::InitialPlayback,
                path: &fixture.path,
                cancel: token(false),
                credentials: None,
                expected_identity: None,
                fetch_policy: StreamFetchPolicy::LocalOnly,
            })
            .expect("open source");

        assert_eq!(opened.generation, 7);
        assert!(opened.capabilities.seekable);
        assert!(!opened.capabilities.reopen_for_seek);
        let decoder = StreamingDecoder::from_opened_source(opened.source, None)
            .expect("construct decoder without reopening path");
        assert_eq!(decoder.info.sample_rate, 44_100);
        assert_eq!(decoder.info.channels, 1);
    }

    #[test]
    fn local_recovery_rejects_changed_identity_after_open() {
        let fixture = TempSource::wav();
        let first = LocalFileSourceFactory
            .open(OpenRequest {
                generation: 1,
                intent: StreamOpenIntent::InitialPlayback,
                path: &fixture.path,
                cancel: token(false),
                credentials: None,
                expected_identity: None,
                fetch_policy: StreamFetchPolicy::LocalOnly,
            })
            .expect("first open");
        std::fs::OpenOptions::new()
            .append(true)
            .open(&fixture.path)
            .expect("open changed fixture")
            .write_all(&[0])
            .expect("change fixture identity");

        let result = LocalFileSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::SourceSeekRecovery,
            path: &fixture.path,
            cancel: token(false),
            credentials: None,
            expected_identity: Some(&first.identity),
            fetch_policy: StreamFetchPolicy::LocalOnly,
        });

        assert!(matches!(result, Err(StreamSourceError::IdentityMismatch)));
    }

    #[test]
    fn local_factory_honors_cancellation_before_filesystem_work() {
        let result = LocalFileSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::InitialPlayback,
            path: Path::new("Z:/not-touched.flac"),
            cancel: token(true),
            credentials: None,
            expected_identity: None,
            fetch_policy: StreamFetchPolicy::LocalOnly,
        });

        assert!(matches!(result, Err(StreamSourceError::Cancelled)));
    }

    #[test]
    fn local_factory_rejects_remote_policy_and_url_paths() {
        let result = LocalFileSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::InitialPlayback,
            path: Path::new("https://example.test/audio.flac"),
            cancel: token(false),
            credentials: None,
            expected_identity: None,
            fetch_policy: StreamFetchPolicy::AllowRemote,
        });

        assert!(matches!(result, Err(StreamSourceError::PolicyRejected(_))));
    }

    #[test]
    fn remote_factory_honors_cancel_and_policy_before_network_work() {
        let cancelled = RemoteHttpSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::InitialPlayback,
            path: Path::new("https://user:secret@example.invalid/audio.flac?token=secret"),
            cancel: token(true),
            credentials: None,
            expected_identity: None,
            fetch_policy: StreamFetchPolicy::AllowRemote,
        });
        assert!(matches!(cancelled, Err(StreamSourceError::Cancelled)));

        let rejected = RemoteHttpSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::InitialPlayback,
            path: Path::new("https://example.invalid/audio.flac"),
            cancel: token(false),
            credentials: None,
            expected_identity: None,
            fetch_policy: StreamFetchPolicy::LocalOnly,
        });
        assert!(matches!(
            rejected,
            Err(StreamSourceError::PolicyRejected(_))
        ));
    }

    #[test]
    fn remote_recovery_rejects_identity_change_without_leaking_url() {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        "https://example.invalid/old.flac".hash(&mut hasher);
        let expected = StreamSourceIdentity::Remote {
            url_fingerprint: hasher.finish(),
        };
        let result = RemoteHttpSourceFactory.open(OpenRequest {
            generation: 1,
            intent: StreamOpenIntent::SourceSeekRecovery,
            path: Path::new("https://example.invalid/new.flac?token=secret"),
            cancel: token(false),
            credentials: None,
            expected_identity: Some(&expected),
            fetch_policy: StreamFetchPolicy::AllowRemote,
        });
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("identity mismatch should fail before opening"),
        };
        assert!(matches!(error, StreamSourceError::IdentityMismatch));
        let message = error.to_string();
        assert!(!message.contains("example.invalid"));
        assert!(!message.contains("secret"));
    }
}
