//! Process-wide decoded PCM memory reservations.

use std::fmt;
use std::sync::{Arc, OnceLock};

use parking_lot::Mutex;

use crate::diagnostics::decode_memory_budget;

const OWNER_COUNT: usize = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub(crate) enum DecodedMemoryOwner {
    ActiveWindow = 0,
    PendingPlayback = 1,
    ProducerScratch = 2,
    ResamplerCarry = 3,
    LegacyCurrentBuffer = 4,
    LegacyPendingBuffer = 5,
    LoadedResampleCache = 6,
}

impl DecodedMemoryOwner {
    pub(crate) const ALL: [Self; OWNER_COUNT] = [
        Self::ActiveWindow,
        Self::PendingPlayback,
        Self::ProducerScratch,
        Self::ResamplerCarry,
        Self::LegacyCurrentBuffer,
        Self::LegacyPendingBuffer,
        Self::LoadedResampleCache,
    ];

    const fn index(self) -> usize {
        self as usize
    }

    pub(crate) const fn label(self) -> &'static str {
        match self {
            Self::ActiveWindow => "active window",
            Self::PendingPlayback => "pending playback",
            Self::ProducerScratch => "producer scratch",
            Self::ResamplerCarry => "resampler carry",
            Self::LegacyCurrentBuffer => "legacy current buffer",
            Self::LegacyPendingBuffer => "legacy pending buffer",
            Self::LoadedResampleCache => "loaded resample cache",
        }
    }

    #[cfg(test)]
    pub(crate) const fn is_optional(self) -> bool {
        matches!(self, Self::PendingPlayback | Self::LegacyPendingBuffer)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecodedMemorySnapshot {
    pub(crate) limit_bytes: usize,
    pub(crate) reserved_bytes: usize,
    pub(crate) peak_reserved_bytes: usize,
    pub(crate) rejection_count: u64,
    pub(crate) reserved_by_owner: [usize; OWNER_COUNT],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DecodedMemoryReservationError {
    pub(crate) owner: DecodedMemoryOwner,
    pub(crate) requested_bytes: usize,
    pub(crate) reserved_bytes: usize,
    pub(crate) limit_bytes: usize,
}

impl fmt::Display for DecodedMemoryReservationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} reservation of {} bytes exceeds decoded memory budget: {} bytes already reserved, {} byte limit",
            self.owner.label(),
            self.requested_bytes,
            self.reserved_bytes,
            self.limit_bytes
        )
    }
}

impl std::error::Error for DecodedMemoryReservationError {}

#[derive(Debug)]
struct LedgerState {
    reserved_bytes: usize,
    peak_reserved_bytes: usize,
    rejection_count: u64,
    reserved_by_owner: [usize; OWNER_COUNT],
}

#[derive(Debug)]
pub(crate) struct DecodedMemoryLedger {
    limit_bytes: usize,
    state: Mutex<LedgerState>,
}

impl DecodedMemoryLedger {
    pub(crate) fn new(limit_bytes: usize) -> Self {
        Self {
            limit_bytes,
            state: Mutex::new(LedgerState {
                reserved_bytes: 0,
                peak_reserved_bytes: 0,
                rejection_count: 0,
                reserved_by_owner: [0; OWNER_COUNT],
            }),
        }
    }

    pub(crate) fn try_reserve(
        self: &Arc<Self>,
        owner: DecodedMemoryOwner,
        bytes: usize,
    ) -> Result<DecodedMemoryReservation, DecodedMemoryReservationError> {
        let mut state = self.state.lock();
        let Some(next_reserved) = state.reserved_bytes.checked_add(bytes) else {
            state.rejection_count = state.rejection_count.saturating_add(1);
            return Err(self.reservation_error(owner, bytes, state.reserved_bytes));
        };
        let Some(next_owner_bytes) = state.reserved_by_owner[owner.index()].checked_add(bytes)
        else {
            state.rejection_count = state.rejection_count.saturating_add(1);
            return Err(self.reservation_error(owner, bytes, state.reserved_bytes));
        };
        if next_reserved > self.limit_bytes {
            state.rejection_count = state.rejection_count.saturating_add(1);
            return Err(self.reservation_error(owner, bytes, state.reserved_bytes));
        }

        state.reserved_bytes = next_reserved;
        state.peak_reserved_bytes = state.peak_reserved_bytes.max(next_reserved);
        state.reserved_by_owner[owner.index()] = next_owner_bytes;
        drop(state);

        Ok(DecodedMemoryReservation {
            ledger: Arc::clone(self),
            owner,
            bytes,
        })
    }

    pub(crate) fn snapshot(&self) -> DecodedMemorySnapshot {
        let state = self.state.lock();
        DecodedMemorySnapshot {
            limit_bytes: self.limit_bytes,
            reserved_bytes: state.reserved_bytes,
            peak_reserved_bytes: state.peak_reserved_bytes,
            rejection_count: state.rejection_count,
            reserved_by_owner: state.reserved_by_owner,
        }
    }

    fn reservation_error(
        &self,
        owner: DecodedMemoryOwner,
        requested_bytes: usize,
        reserved_bytes: usize,
    ) -> DecodedMemoryReservationError {
        DecodedMemoryReservationError {
            owner,
            requested_bytes,
            reserved_bytes,
            limit_bytes: self.limit_bytes,
        }
    }

    fn release(&self, owner: DecodedMemoryOwner, bytes: usize) {
        let mut state = self.state.lock();
        state.reserved_bytes = state
            .reserved_bytes
            .checked_sub(bytes)
            .expect("decoded memory reservation total underflow");
        state.reserved_by_owner[owner.index()] = state.reserved_by_owner[owner.index()]
            .checked_sub(bytes)
            .expect("decoded memory owner reservation underflow");
    }
}

pub(crate) struct DecodedMemoryReservation {
    ledger: Arc<DecodedMemoryLedger>,
    owner: DecodedMemoryOwner,
    bytes: usize,
}

#[derive(Debug)]
pub(crate) struct DecodedMemoryLease {
    _reservation: DecodedMemoryReservation,
}

pub(crate) fn reserve_decoded_memory(
    owner: DecodedMemoryOwner,
    bytes: usize,
) -> Result<Arc<DecodedMemoryLease>, DecodedMemoryReservationError> {
    process_decoded_memory_ledger()
        .try_reserve(owner, bytes)
        .map(|reservation| {
            Arc::new(DecodedMemoryLease {
                _reservation: reservation,
            })
        })
}

impl DecodedMemoryReservation {
    #[cfg(test)]
    pub(crate) fn owner(&self) -> DecodedMemoryOwner {
        self.owner
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> usize {
        self.bytes
    }
}

impl fmt::Debug for DecodedMemoryReservation {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("DecodedMemoryReservation")
            .field("owner", &self.owner)
            .field("bytes", &self.bytes)
            .finish_non_exhaustive()
    }
}

impl Drop for DecodedMemoryReservation {
    fn drop(&mut self) {
        self.ledger.release(self.owner, self.bytes);
    }
}

pub(crate) fn process_decoded_memory_ledger() -> &'static Arc<DecodedMemoryLedger> {
    static LEDGER: OnceLock<Arc<DecodedMemoryLedger>> = OnceLock::new();
    LEDGER.get_or_init(|| Arc::new(DecodedMemoryLedger::new(decode_memory_budget().limit_bytes)))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Barrier};
    use std::thread;

    use super::*;

    #[test]
    fn reservation_releases_exact_owner_bytes_on_drop() {
        let ledger = Arc::new(DecodedMemoryLedger::new(1_024));
        let reservation = ledger
            .try_reserve(DecodedMemoryOwner::ActiveWindow, 640)
            .unwrap();

        assert_eq!(reservation.owner(), DecodedMemoryOwner::ActiveWindow);
        assert_eq!(reservation.bytes(), 640);
        assert_eq!(ledger.snapshot().reserved_bytes, 640);
        assert_eq!(ledger.snapshot().reserved_by_owner[0], 640);

        drop(reservation);
        assert_eq!(ledger.snapshot().reserved_bytes, 0);
        assert_eq!(ledger.snapshot().reserved_by_owner[0], 0);
    }

    #[test]
    fn failed_reservation_does_not_change_committed_bytes() {
        let ledger = Arc::new(DecodedMemoryLedger::new(100));
        let _active = ledger
            .try_reserve(DecodedMemoryOwner::ActiveWindow, 80)
            .unwrap();

        let error = ledger
            .try_reserve(DecodedMemoryOwner::ProducerScratch, 21)
            .unwrap_err();
        let snapshot = ledger.snapshot();

        assert_eq!(error.reserved_bytes, 80);
        assert_eq!(snapshot.reserved_bytes, 80);
        assert_eq!(snapshot.rejection_count, 1);
    }

    #[test]
    fn optional_pending_reservation_cannot_overcommit_active_playback_budget() {
        let ledger = Arc::new(DecodedMemoryLedger::new(100));
        let active = ledger
            .try_reserve(DecodedMemoryOwner::ActiveWindow, 80)
            .unwrap();

        assert!(DecodedMemoryOwner::PendingPlayback.is_optional());
        assert!(ledger
            .try_reserve(DecodedMemoryOwner::PendingPlayback, 21)
            .is_err());
        assert_eq!(ledger.snapshot().reserved_bytes, 80);

        drop(active);
        assert!(ledger
            .try_reserve(DecodedMemoryOwner::PendingPlayback, 100)
            .is_ok());
    }

    #[test]
    fn concurrent_reservations_never_exceed_limit() {
        const THREADS: usize = 16;
        let ledger = Arc::new(DecodedMemoryLedger::new(8));
        let barrier = Arc::new(Barrier::new(THREADS));
        let mut handles = Vec::new();

        for _ in 0..THREADS {
            let ledger = Arc::clone(&ledger);
            let barrier = Arc::clone(&barrier);
            handles.push(thread::spawn(move || {
                barrier.wait();
                ledger
                    .try_reserve(DecodedMemoryOwner::LegacyCurrentBuffer, 1)
                    .ok()
            }));
        }

        let reservations: Vec<_> = handles
            .into_iter()
            .filter_map(|handle| handle.join().unwrap())
            .collect();
        let snapshot = ledger.snapshot();

        assert_eq!(reservations.len(), 8);
        assert_eq!(snapshot.reserved_bytes, 8);
        assert_eq!(snapshot.peak_reserved_bytes, 8);
        assert_eq!(snapshot.rejection_count, 8);
        drop(reservations);
        assert_eq!(ledger.snapshot().reserved_bytes, 0);
    }

    #[test]
    fn owner_table_is_complete_and_stable() {
        for (index, owner) in DecodedMemoryOwner::ALL.into_iter().enumerate() {
            assert_eq!(owner.index(), index);
            assert!(!owner.label().is_empty());
        }
    }
}
