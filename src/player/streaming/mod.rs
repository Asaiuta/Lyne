//! Streaming playback v2 primitives.
//!
//! Modules in this directory are introduced behind isolated tests and
//! benchmarks before the player callback or producer starts using them.

#[allow(dead_code)]
pub(crate) mod callback_window;
pub(crate) mod memory;
pub(crate) mod pcm_window;
// Persistent worker control lands before the decoder-to-window data loop.
#[allow(dead_code)]
pub(crate) mod producer;
// Staged behind isolated tests until the Phase 4 session owns its producers and
// the Phase 5 callback integration can consume the API without compatibility glue.
#[allow(dead_code)]
pub(crate) mod rt_view;
#[allow(dead_code)]
pub(crate) mod session;
// Source/session contracts land before the persistent producer consumes them.
#[allow(dead_code)]
pub(crate) mod source;
