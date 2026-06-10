//! Streaming decoder facade.
//!
//! The public `crate::decoder::*` API stays here while implementation details
//! live in focused submodules.

mod error;
mod metadata;
mod source;
mod streaming;

pub use error::{DecodeCancelToken, DecoderError, NetworkError};
pub use metadata::{AudioInfo, TrackMetadata};
pub use source::HttpCredentials;
pub use streaming::StreamingDecoder;

#[cfg(test)]
mod tests;
