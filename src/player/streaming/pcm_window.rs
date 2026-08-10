//! Preallocated absolute-frame PCM storage for streaming playback.
//!
//! The payload is one aligned allocation. A single producer and a single
//! realtime consumer exchange individual slots through packed atomic stamps;
//! sample memory is never accessed unless the caller owns the corresponding
//! `Writing` or `Reading` state.

use std::alloc::{alloc, dealloc, Layout};
use std::cell::UnsafeCell;
use std::fmt;
use std::marker::PhantomData;
use std::mem::{size_of, MaybeUninit};
use std::ptr::NonNull;
use std::slice;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use super::memory::{process_decoded_memory_ledger, DecodedMemoryOwner, DecodedMemoryReservation};

const PCM_ALIGNMENT: usize = 64;
const TARGET_SLOT_PAYLOAD_BYTES: usize = 64 * 1024;
const MIN_SLOT_FRAMES: usize = 512;
const MAX_SLOT_FRAMES: usize = 4096;
const STAMP_STATE_MASK: u64 = 0b11;
const VACANT_STAMP: u64 = 0;
const WRITING_STATE: u64 = 0b01;
const READY_STATE: u64 = 0b10;
const READING_STATE: u64 = 0b11;
const MAX_SEQUENCE: u64 = (u64::MAX >> 2) - 1;
const RESETTING_BIT: u64 = 1;
const MAX_EPOCH: u64 = u64::MAX >> 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PcmWindowGeometry {
    channels: usize,
    slot_frames: usize,
    slot_samples: usize,
    slot_payload_bytes: usize,
    slot_count: usize,
    slot_count_mask: usize,
    slot_frame_shift: u32,
    payload_samples: usize,
    payload_bytes: usize,
    metadata_bytes: usize,
    reservation_bytes: usize,
}

impl PcmWindowGeometry {
    pub fn for_capacity_bytes(
        channels: usize,
        requested_capacity_bytes: usize,
    ) -> Result<Self, PcmWindowError> {
        if channels == 0 {
            return Err(PcmWindowError::InvalidChannelCount { channels });
        }
        if channels > usize::from(u16::MAX) {
            return Err(PcmWindowError::InvalidChannelCount { channels });
        }

        let bytes_per_frame = channels
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("bytes per frame"))?;
        let raw_slot_frames = TARGET_SLOT_PAYLOAD_BYTES / bytes_per_frame;
        let clamped_slot_frames = raw_slot_frames.clamp(MIN_SLOT_FRAMES, MAX_SLOT_FRAMES);
        let slot_frames = floor_power_of_two(clamped_slot_frames);
        let slot_samples = slot_frames
            .checked_mul(channels)
            .ok_or(PcmWindowError::ArithmeticOverflow("samples per slot"))?;
        let slot_payload_bytes = slot_samples
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("bytes per slot"))?;

        let requested_slot_count = requested_capacity_bytes / slot_payload_bytes;
        if requested_slot_count == 0 {
            return Err(PcmWindowError::CapacityTooSmall {
                requested_bytes: requested_capacity_bytes,
                minimum_bytes: slot_payload_bytes,
            });
        }
        let slot_count = floor_power_of_two(requested_slot_count);
        let payload_samples = slot_samples
            .checked_mul(slot_count)
            .ok_or(PcmWindowError::ArithmeticOverflow("payload samples"))?;
        let payload_bytes = payload_samples
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("payload bytes"))?;
        let metadata_bytes = slot_count
            .checked_mul(size_of::<PcmSlotMeta>())
            .ok_or(PcmWindowError::ArithmeticOverflow("slot metadata bytes"))?;
        let reservation_bytes = payload_bytes
            .checked_add(metadata_bytes)
            .and_then(|bytes| bytes.checked_add(PCM_ALIGNMENT - 1))
            .ok_or(PcmWindowError::ArithmeticOverflow(
                "window reservation bytes",
            ))?;

        Ok(Self {
            channels,
            slot_frames,
            slot_samples,
            slot_payload_bytes,
            slot_count,
            slot_count_mask: slot_count - 1,
            slot_frame_shift: slot_frames.trailing_zeros(),
            payload_samples,
            payload_bytes,
            metadata_bytes,
            reservation_bytes,
        })
    }

    pub fn for_slot_count(
        channels: usize,
        requested_slot_count: usize,
    ) -> Result<Self, PcmWindowError> {
        if requested_slot_count == 0 {
            return Err(PcmWindowError::InvalidSlotCount {
                requested: requested_slot_count,
            });
        }

        let bytes_per_frame = channels
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("bytes per frame"))?;
        if channels == 0 || channels > usize::from(u16::MAX) {
            return Err(PcmWindowError::InvalidChannelCount { channels });
        }
        let raw_slot_frames = TARGET_SLOT_PAYLOAD_BYTES / bytes_per_frame;
        let slot_frames =
            floor_power_of_two(raw_slot_frames.clamp(MIN_SLOT_FRAMES, MAX_SLOT_FRAMES));
        let slot_samples = slot_frames
            .checked_mul(channels)
            .ok_or(PcmWindowError::ArithmeticOverflow("samples per slot"))?;
        let slot_payload_bytes = slot_samples
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("bytes per slot"))?;
        let requested_capacity_bytes = slot_payload_bytes
            .checked_mul(requested_slot_count)
            .ok_or(PcmWindowError::ArithmeticOverflow("requested window bytes"))?;
        Self::for_capacity_bytes(channels, requested_capacity_bytes)
    }

    pub fn channels(self) -> usize {
        self.channels
    }

    pub fn slot_frames(self) -> usize {
        self.slot_frames
    }

    pub fn slot_samples(self) -> usize {
        self.slot_samples
    }

    pub fn slot_payload_bytes(self) -> usize {
        self.slot_payload_bytes
    }

    pub fn slot_count(self) -> usize {
        self.slot_count
    }

    pub(crate) fn sequence_for_frame(
        self,
        origin_frame: u64,
        absolute_frame: u64,
    ) -> Result<u64, PcmWindowAccessError> {
        self.frame_location(origin_frame, absolute_frame)
            .map(|location| location.sequence)
    }

    pub fn capacity_frames(self) -> usize {
        self.slot_frames * self.slot_count
    }

    pub fn payload_bytes(self) -> usize {
        self.payload_bytes
    }

    pub fn metadata_bytes(self) -> usize {
        self.metadata_bytes
    }

    pub fn reservation_bytes(self) -> usize {
        self.reservation_bytes
    }

    fn slot_index(self, sequence: u64) -> usize {
        sequence as usize & self.slot_count_mask
    }

    fn frame_location(
        self,
        origin_frame: u64,
        absolute_frame: u64,
    ) -> Result<FrameLocation, PcmWindowAccessError> {
        let relative_frame = absolute_frame.checked_sub(origin_frame).ok_or(
            PcmWindowAccessError::BeforeWindowOrigin {
                frame: absolute_frame,
                origin: origin_frame,
            },
        )?;
        let sequence = relative_frame >> self.slot_frame_shift;
        ensure_sequence(sequence)?;
        let frame_offset = (relative_frame as usize) & (self.slot_frames - 1);
        Ok(FrameLocation {
            sequence,
            frame_offset,
        })
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PcmWindowError {
    #[error("PCM window channel count must be between 1 and {max}, got {channels}", max = u16::MAX)]
    InvalidChannelCount { channels: usize },
    #[error("PCM window slot count must be non-zero, got {requested}")]
    InvalidSlotCount { requested: usize },
    #[error(
        "PCM window capacity {requested_bytes} bytes is smaller than one slot ({minimum_bytes} bytes)"
    )]
    CapacityTooSmall {
        requested_bytes: usize,
        minimum_bytes: usize,
    },
    #[error("PCM window arithmetic overflow while calculating {0}")]
    ArithmeticOverflow(&'static str),
    #[error("PCM window epoch {epoch} exceeds the supported maximum {MAX_EPOCH}")]
    EpochOverflow { epoch: u64 },
    #[error("failed to allocate {bytes} aligned PCM payload bytes")]
    AllocationFailed { bytes: usize },
    #[error("failed to reserve decoded memory for PCM window: {0}")]
    MemoryReservation(String),
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum PcmWindowAccessError {
    #[error("PCM window reset is in progress for epoch {epoch}")]
    ResetInProgress { epoch: u64 },
    #[error("PCM window epoch mismatch: expected {expected}, actual {actual}")]
    EpochMismatch { expected: u64, actual: u64 },
    #[error("PCM window epoch must increase: current {current}, requested {requested}")]
    NonMonotonicEpoch { current: u64, requested: u64 },
    #[error("PCM window epoch {epoch} exceeds the supported maximum {MAX_EPOCH}")]
    EpochOverflow { epoch: u64 },
    #[error("PCM window sequence {sequence} exceeds the packed stamp range")]
    SequenceOverflow { sequence: u64 },
    #[error("PCM slot {slot_index} is currently {state:?}")]
    SlotBusy { slot_index: usize, state: SlotState },
    #[error(
        "PCM slot {slot_index} contains sequence {existing_sequence}, which is not reclaimable before {reclaim_before_sequence}"
    )]
    SlotNotReclaimable {
        slot_index: usize,
        existing_sequence: u64,
        reclaim_before_sequence: u64,
    },
    #[error("PCM slot {slot_index} does not contain ready sequence {expected_sequence}")]
    SequenceUnavailable {
        slot_index: usize,
        expected_sequence: u64,
    },
    #[error("absolute frame {frame} is before PCM window origin {origin}")]
    BeforeWindowOrigin { frame: u64, origin: u64 },
    #[error(
        "frame offset {frame_offset} is outside the initialized span of {valid_frames} frames"
    )]
    FrameUnavailable {
        frame_offset: usize,
        valid_frames: usize,
    },
    #[error("interleaved sample count {samples} is not divisible by {channels} channels")]
    IncompleteFrame { samples: usize, channels: usize },
    #[error(
        "PCM slot has {remaining_samples} samples remaining, cannot append {requested_samples}"
    )]
    SlotCapacityExceeded {
        requested_samples: usize,
        remaining_samples: usize,
    },
    #[error("cannot publish an empty PCM slot")]
    EmptyPublication,
    #[error("PCM slot metadata exposed invalid frame count {valid_frames}")]
    InvalidPublishedFrameCount { valid_frames: usize },
    #[error("PCM slot contained an invalid packed stamp {stamp:#x}")]
    InvalidStamp { stamp: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotState {
    Vacant,
    Writing,
    Ready,
    Reading,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublishedSlot {
    pub sequence: u64,
    pub valid_frames: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FrameLocation {
    sequence: u64,
    frame_offset: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct DecodedStamp {
    state: SlotState,
    sequence: Option<u64>,
}

#[repr(align(64))]
struct PcmSlotMeta {
    stamp: AtomicU64,
    valid_frames: AtomicU32,
}

impl PcmSlotMeta {
    fn new() -> Self {
        Self {
            stamp: AtomicU64::new(VACANT_STAMP),
            valid_frames: AtomicU32::new(0),
        }
    }
}

impl fmt::Debug for PcmSlotMeta {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PcmSlotMeta")
            .field("stamp", &self.stamp.load(Ordering::Relaxed))
            .field("valid_frames", &self.valid_frames.load(Ordering::Relaxed))
            .finish()
    }
}

struct AlignedPcmStorage {
    ptr: NonNull<MaybeUninit<f64>>,
    len: usize,
    layout: Layout,
    _interior_mutability: PhantomData<UnsafeCell<MaybeUninit<f64>>>,
}

impl AlignedPcmStorage {
    fn new(len: usize) -> Result<Self, PcmWindowError> {
        let bytes = len
            .checked_mul(size_of::<f64>())
            .ok_or(PcmWindowError::ArithmeticOverflow("aligned payload bytes"))?;
        let layout = Layout::from_size_align(bytes, PCM_ALIGNMENT)
            .map_err(|_| PcmWindowError::ArithmeticOverflow("aligned payload layout"))?;

        // SAFETY: `layout` is non-zero and valid. The returned allocation is
        // owned by this value and deallocated with the same layout in `Drop`.
        let raw = unsafe { alloc(layout) };
        let ptr = NonNull::new(raw.cast::<MaybeUninit<f64>>())
            .ok_or(PcmWindowError::AllocationFailed { bytes })?;
        Ok(Self {
            ptr,
            len,
            layout,
            _interior_mutability: PhantomData,
        })
    }

    fn slot_ptr(&self, sample_offset: usize) -> *mut MaybeUninit<f64> {
        debug_assert!(sample_offset <= self.len);
        // SAFETY: callers derive offsets from checked window geometry. Access
        // to the pointed-to slot is still governed by the atomic stamp guard.
        unsafe { self.ptr.as_ptr().add(sample_offset) }
    }

    #[cfg(test)]
    fn address(&self) -> usize {
        self.ptr.as_ptr() as usize
    }
}

// SAFETY: the allocation is owned and never moved. Sending the owner is safe;
// actual sample access requires a writer or reader slot guard.
unsafe impl Send for AlignedPcmStorage {}

// SAFETY: shared references do not expose sample references directly. The only
// accessors are used after the mutually exclusive atomic slot claim protocol.
unsafe impl Sync for AlignedPcmStorage {}

impl Drop for AlignedPcmStorage {
    fn drop(&mut self) {
        // SAFETY: `ptr` was allocated with this exact layout and is still owned
        // by this value. `MaybeUninit<f64>` requires no element destruction.
        unsafe { dealloc(self.ptr.as_ptr().cast::<u8>(), self.layout) };
    }
}

pub struct PcmWindow {
    geometry: PcmWindowGeometry,
    storage: AlignedPcmStorage,
    slots: Box<[PcmSlotMeta]>,
    identity: AtomicU64,
    origin_frame: AtomicU64,
    _reservation: RwLock<DecodedMemoryReservation>,
}

impl Drop for PcmWindow {
    fn drop(&mut self) {
        log::debug!(
            "PcmWindow drop: origin={} cap_mib={}",
            self.origin_frame.load(Ordering::Acquire),
            self.geometry.reservation_bytes() / (1024 * 1024)
        );
    }
}

impl fmt::Debug for PcmWindow {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PcmWindow")
            .field("geometry", &self.geometry)
            .field("epoch", &self.epoch())
            .field("origin_frame", &self.origin_frame())
            .finish_non_exhaustive()
    }
}

pub struct PcmWindowParts {
    pub window: Arc<PcmWindow>,
    pub writer: PcmWindowWriter,
    pub reader: PcmWindowReader,
}

impl PcmWindow {
    pub(crate) fn create(
        geometry: PcmWindowGeometry,
        epoch: u64,
        origin_frame: u64,
        owner: DecodedMemoryOwner,
    ) -> Result<PcmWindowParts, PcmWindowError> {
        if epoch > MAX_EPOCH {
            return Err(PcmWindowError::EpochOverflow { epoch });
        }

        let reservation = process_decoded_memory_ledger()
            .try_reserve(owner, geometry.reservation_bytes())
            .map_err(|error| PcmWindowError::MemoryReservation(error.to_string()))?;

        let storage = AlignedPcmStorage::new(geometry.payload_samples)?;
        let mut slots = Vec::with_capacity(geometry.slot_count);
        slots.resize_with(geometry.slot_count, PcmSlotMeta::new);
        let window = Arc::new(Self {
            geometry,
            storage,
            slots: slots.into_boxed_slice(),
            identity: AtomicU64::new(encode_identity(epoch, false)),
            origin_frame: AtomicU64::new(origin_frame),
            _reservation: RwLock::new(reservation),
        });
        Ok(PcmWindowParts {
            window: Arc::clone(&window),
            writer: PcmWindowWriter {
                window: Arc::clone(&window),
            },
            reader: PcmWindowReader {
                window: Arc::clone(&window),
            },
        })
    }

    /// Move this window's ledger lease to a different owner. Used when a
    /// gapless-preload window (charged under `PendingPlayback`) is promoted to
    /// the active session: bytes then count as `ActiveWindow`, mirroring what
    /// is actually playing. If the new reservation fails, the old owner stays.
    pub(crate) fn reown(&self, new_owner: DecodedMemoryOwner) {
        let Ok(mut held) = self._reservation.write() else {
            return;
        };
        if let Ok(new_lease) = process_decoded_memory_ledger()
            .try_reserve(new_owner, self.geometry.reservation_bytes())
        {
            let old = std::mem::replace(&mut *held, new_lease);
            drop(old);
        }
    }

    pub fn geometry(&self) -> PcmWindowGeometry {
        self.geometry
    }

    pub fn epoch(&self) -> u64 {
        decode_identity(self.identity.load(Ordering::Acquire)).0
    }

    pub fn origin_frame(&self) -> u64 {
        self.origin_frame.load(Ordering::Acquire)
    }

    fn checked_identity(&self, expected_epoch: u64) -> Result<u64, PcmWindowAccessError> {
        let identity = self.identity.load(Ordering::Acquire);
        let (epoch, resetting) = decode_identity(identity);
        if resetting {
            return Err(PcmWindowAccessError::ResetInProgress { epoch });
        }
        if epoch != expected_epoch {
            return Err(PcmWindowAccessError::EpochMismatch {
                expected: expected_epoch,
                actual: epoch,
            });
        }
        Ok(identity)
    }

    fn ensure_identity_unchanged(
        &self,
        expected_identity: u64,
        expected_epoch: u64,
    ) -> Result<(), PcmWindowAccessError> {
        let actual_identity = self.identity.load(Ordering::Acquire);
        if actual_identity == expected_identity {
            return Ok(());
        }
        let (actual_epoch, resetting) = decode_identity(actual_identity);
        if resetting {
            Err(PcmWindowAccessError::ResetInProgress {
                epoch: actual_epoch,
            })
        } else {
            Err(PcmWindowAccessError::EpochMismatch {
                expected: expected_epoch,
                actual: actual_epoch,
            })
        }
    }

    fn slot_sample_offset(&self, slot_index: usize) -> usize {
        slot_index * self.geometry.slot_samples
    }
}

pub struct PcmWindowWriter {
    window: Arc<PcmWindow>,
}

impl fmt::Debug for PcmWindowWriter {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PcmWindowWriter")
            .field("window", &self.window)
            .finish()
    }
}

impl PcmWindowWriter {
    pub fn geometry(&self) -> PcmWindowGeometry {
        self.window.geometry
    }

    pub fn try_claim(
        &mut self,
        expected_epoch: u64,
        sequence: u64,
        reclaim_before_sequence: u64,
    ) -> Result<WriteSlot<'_>, PcmWindowAccessError> {
        let slot_index = claim_write_slot(
            &self.window,
            expected_epoch,
            sequence,
            reclaim_before_sequence,
        )?;
        Ok(WriteSlot {
            window: &self.window,
            slot_index,
            sequence,
            initialized_samples: 0,
            published: false,
        })
    }

    /// Claim a slot with an owned guard that may remain live across decoder or
    /// resampler calls. The guard is non-clonable and preserves the same stamp
    /// protocol as [`Self::try_claim`].
    pub fn try_claim_owned(
        &mut self,
        expected_epoch: u64,
        sequence: u64,
        reclaim_before_sequence: u64,
    ) -> Result<OwnedWriteSlot, PcmWindowAccessError> {
        let slot_index = claim_write_slot(
            &self.window,
            expected_epoch,
            sequence,
            reclaim_before_sequence,
        )?;
        Ok(OwnedWriteSlot {
            window: Arc::clone(&self.window),
            slot_index,
            sequence,
            initialized_samples: 0,
            published: false,
        })
    }

    pub fn try_reclaim(
        &mut self,
        expected_epoch: u64,
        sequence: u64,
        reclaim_before_sequence: u64,
    ) -> Result<(), PcmWindowAccessError> {
        ensure_sequence(sequence)?;
        if sequence >= reclaim_before_sequence {
            return Err(PcmWindowAccessError::SlotNotReclaimable {
                slot_index: self.window.geometry.slot_index(sequence),
                existing_sequence: sequence,
                reclaim_before_sequence,
            });
        }
        let expected_identity = self.window.checked_identity(expected_epoch)?;
        let slot_index = self.window.geometry.slot_index(sequence);
        let meta = &self.window.slots[slot_index];
        let ready_stamp = encode_stamp(sequence, READY_STATE)?;
        meta.stamp
            .compare_exchange(
                ready_stamp,
                VACANT_STAMP,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|actual_stamp| slot_transition_error(slot_index, sequence, actual_stamp))?;
        meta.valid_frames.store(0, Ordering::Relaxed);
        self.window
            .ensure_identity_unchanged(expected_identity, expected_epoch)
    }

    pub fn try_reset_epoch(
        &mut self,
        requested_epoch: u64,
        new_origin_frame: u64,
    ) -> Result<(), PcmWindowAccessError> {
        if requested_epoch > MAX_EPOCH {
            return Err(PcmWindowAccessError::EpochOverflow {
                epoch: requested_epoch,
            });
        }

        let current_identity = self.window.identity.load(Ordering::Acquire);
        let (current_epoch, resetting) = decode_identity(current_identity);
        if resetting {
            return Err(PcmWindowAccessError::ResetInProgress {
                epoch: current_epoch,
            });
        }
        if requested_epoch <= current_epoch {
            return Err(PcmWindowAccessError::NonMonotonicEpoch {
                current: current_epoch,
                requested: requested_epoch,
            });
        }

        self.window
            .identity
            .compare_exchange(
                current_identity,
                encode_identity(current_epoch, true),
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|actual_identity| {
                let (epoch, is_resetting) = decode_identity(actual_identity);
                if is_resetting {
                    PcmWindowAccessError::ResetInProgress { epoch }
                } else {
                    PcmWindowAccessError::EpochMismatch {
                        expected: current_epoch,
                        actual: epoch,
                    }
                }
            })?;
        let reset_guard = IdentityResetGuard::new(&self.window.identity, current_identity);

        for (slot_index, meta) in self.window.slots.iter().enumerate() {
            let decoded = decode_stamp(meta.stamp.load(Ordering::Acquire))?;
            if matches!(decoded.state, SlotState::Writing | SlotState::Reading) {
                return Err(PcmWindowAccessError::SlotBusy {
                    slot_index,
                    state: decoded.state,
                });
            }
        }

        for meta in self.window.slots.iter() {
            loop {
                let observed = meta.stamp.load(Ordering::Acquire);
                match decode_stamp(observed)?.state {
                    SlotState::Vacant => break,
                    SlotState::Ready => {
                        if meta
                            .stamp
                            .compare_exchange(
                                observed,
                                VACANT_STAMP,
                                Ordering::AcqRel,
                                Ordering::Acquire,
                            )
                            .is_ok()
                        {
                            break;
                        }
                    }
                    // A role that raced the reset gate must observe the changed
                    // identity, release immediately, and cannot reach caller code.
                    SlotState::Writing | SlotState::Reading => std::hint::spin_loop(),
                }
            }
            meta.valid_frames.store(0, Ordering::Relaxed);
        }

        self.window
            .origin_frame
            .store(new_origin_frame, Ordering::Relaxed);
        reset_guard.commit(encode_identity(requested_epoch, false));
        Ok(())
    }
}

pub struct WriteSlot<'a> {
    window: &'a PcmWindow,
    slot_index: usize,
    sequence: u64,
    initialized_samples: usize,
    published: bool,
}

impl WriteSlot<'_> {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn remaining_samples(&self) -> usize {
        self.window
            .geometry
            .slot_samples
            .saturating_sub(self.initialized_samples)
    }

    pub fn append_interleaved(&mut self, samples: &[f64]) -> Result<(), PcmWindowAccessError> {
        append_write_slot(
            self.window,
            self.slot_index,
            &mut self.initialized_samples,
            samples,
        )
    }

    pub fn publish(mut self) -> Result<PublishedSlot, PcmWindowAccessError> {
        let published = publish_write_slot(
            self.window,
            self.slot_index,
            self.sequence,
            self.initialized_samples,
        )?;
        self.published = true;
        Ok(published)
    }
}

impl Drop for WriteSlot<'_> {
    fn drop(&mut self) {
        if self.published {
            return;
        }
        abort_write_slot(self.window, self.slot_index);
    }
}

/// Owned producer claim for one physical PCM slot.
pub struct OwnedWriteSlot {
    window: Arc<PcmWindow>,
    slot_index: usize,
    sequence: u64,
    initialized_samples: usize,
    published: bool,
}

impl OwnedWriteSlot {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn remaining_samples(&self) -> usize {
        self.window
            .geometry
            .slot_samples
            .saturating_sub(self.initialized_samples)
    }

    pub fn append_interleaved(&mut self, samples: &[f64]) -> Result<(), PcmWindowAccessError> {
        append_write_slot(
            &self.window,
            self.slot_index,
            &mut self.initialized_samples,
            samples,
        )
    }

    pub fn publish(mut self) -> Result<PublishedSlot, PcmWindowAccessError> {
        let published = publish_write_slot(
            &self.window,
            self.slot_index,
            self.sequence,
            self.initialized_samples,
        )?;
        self.published = true;
        Ok(published)
    }
}

impl Drop for OwnedWriteSlot {
    fn drop(&mut self) {
        if !self.published {
            abort_write_slot(&self.window, self.slot_index);
        }
    }
}

fn claim_write_slot(
    window: &PcmWindow,
    expected_epoch: u64,
    sequence: u64,
    reclaim_before_sequence: u64,
) -> Result<usize, PcmWindowAccessError> {
    ensure_sequence(sequence)?;
    let expected_identity = window.checked_identity(expected_epoch)?;
    let slot_index = window.geometry.slot_index(sequence);
    let meta = &window.slots[slot_index];
    let writing_stamp = encode_stamp(sequence, WRITING_STATE)?;
    let observed_stamp = meta.stamp.load(Ordering::Acquire);
    let decoded = decode_stamp(observed_stamp)?;

    match decoded.state {
        SlotState::Vacant => {}
        SlotState::Ready => {
            let Some(existing_sequence) = decoded.sequence else {
                return Err(PcmWindowAccessError::InvalidStamp {
                    stamp: observed_stamp,
                });
            };
            if existing_sequence >= reclaim_before_sequence {
                return Err(PcmWindowAccessError::SlotNotReclaimable {
                    slot_index,
                    existing_sequence,
                    reclaim_before_sequence,
                });
            }
        }
        state @ (SlotState::Writing | SlotState::Reading) => {
            return Err(PcmWindowAccessError::SlotBusy { slot_index, state });
        }
    }

    meta.stamp
        .compare_exchange(
            observed_stamp,
            writing_stamp,
            Ordering::AcqRel,
            Ordering::Acquire,
        )
        .map_err(|actual_stamp| slot_transition_error(slot_index, sequence, actual_stamp))?;
    if let Err(error) = window.ensure_identity_unchanged(expected_identity, expected_epoch) {
        meta.stamp.store(observed_stamp, Ordering::Release);
        return Err(error);
    }
    meta.valid_frames.store(0, Ordering::Relaxed);
    Ok(slot_index)
}

fn append_write_slot(
    window: &PcmWindow,
    slot_index: usize,
    initialized_samples: &mut usize,
    samples: &[f64],
) -> Result<(), PcmWindowAccessError> {
    let channels = window.geometry.channels;
    if !samples.len().is_multiple_of(channels) {
        return Err(PcmWindowAccessError::IncompleteFrame {
            samples: samples.len(),
            channels,
        });
    }
    let remaining_samples = window
        .geometry
        .slot_samples
        .saturating_sub(*initialized_samples);
    if samples.len() > remaining_samples {
        return Err(PcmWindowAccessError::SlotCapacityExceeded {
            requested_samples: samples.len(),
            remaining_samples,
        });
    }
    if samples.is_empty() {
        return Ok(());
    }

    let slot_offset = window.slot_sample_offset(slot_index);
    let destination = window.storage.slot_ptr(slot_offset + *initialized_samples);
    // SAFETY: the Writing stamp gives the guard exclusive access to this
    // physical slot. Geometry and capacity checks keep the copy in bounds, and
    // safe callers cannot alias the hidden payload.
    unsafe {
        std::ptr::copy_nonoverlapping(samples.as_ptr(), destination.cast::<f64>(), samples.len())
    };
    *initialized_samples += samples.len();
    Ok(())
}

fn publish_write_slot(
    window: &PcmWindow,
    slot_index: usize,
    sequence: u64,
    initialized_samples: usize,
) -> Result<PublishedSlot, PcmWindowAccessError> {
    if initialized_samples == 0 {
        return Err(PcmWindowAccessError::EmptyPublication);
    }
    let valid_frames = initialized_samples / window.geometry.channels;
    let valid_frames_u32 = u32::try_from(valid_frames)
        .map_err(|_| PcmWindowAccessError::InvalidPublishedFrameCount { valid_frames })?;
    let meta = &window.slots[slot_index];
    meta.valid_frames.store(valid_frames_u32, Ordering::Relaxed);
    meta.stamp
        .store(encode_stamp(sequence, READY_STATE)?, Ordering::Release);
    Ok(PublishedSlot {
        sequence,
        valid_frames,
    })
}

fn abort_write_slot(window: &PcmWindow, slot_index: usize) {
    let meta = &window.slots[slot_index];
    meta.valid_frames.store(0, Ordering::Relaxed);
    // The old payload may already be overwritten. Aborting a claim must vacate
    // the slot instead of restoring an older Ready stamp.
    meta.stamp.store(VACANT_STAMP, Ordering::Release);
}

pub struct PcmWindowReader {
    window: Arc<PcmWindow>,
}

impl PcmWindowReader {
    pub(crate) fn from_window(window: Arc<PcmWindow>) -> Self {
        Self { window }
    }

    pub(crate) fn into_window(self) -> Arc<PcmWindow> {
        self.window
    }
}

impl fmt::Debug for PcmWindowReader {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PcmWindowReader")
            .field("window", &self.window)
            .finish()
    }
}

impl PcmWindowReader {
    pub fn geometry(&self) -> PcmWindowGeometry {
        self.window.geometry
    }

    pub fn try_claim_sequence(
        &mut self,
        expected_epoch: u64,
        sequence: u64,
    ) -> Result<ReadSlot<'_>, PcmWindowAccessError> {
        self.try_claim_location(
            expected_epoch,
            FrameLocation {
                sequence,
                frame_offset: 0,
            },
        )
    }

    pub fn try_claim_frame(
        &mut self,
        expected_epoch: u64,
        absolute_frame: u64,
    ) -> Result<ReadSlot<'_>, PcmWindowAccessError> {
        let expected_identity = self.window.checked_identity(expected_epoch)?;
        let origin_frame = self.window.origin_frame.load(Ordering::Acquire);
        let location = self
            .window
            .geometry
            .frame_location(origin_frame, absolute_frame)?;
        self.claim_location_after_identity(expected_epoch, expected_identity, location)
    }

    fn try_claim_location(
        &mut self,
        expected_epoch: u64,
        location: FrameLocation,
    ) -> Result<ReadSlot<'_>, PcmWindowAccessError> {
        let expected_identity = self.window.checked_identity(expected_epoch)?;
        self.claim_location_after_identity(expected_epoch, expected_identity, location)
    }

    fn claim_location_after_identity(
        &mut self,
        expected_epoch: u64,
        expected_identity: u64,
        location: FrameLocation,
    ) -> Result<ReadSlot<'_>, PcmWindowAccessError> {
        ensure_sequence(location.sequence)?;
        let slot_index = self.window.geometry.slot_index(location.sequence);
        let meta = &self.window.slots[slot_index];
        let ready_stamp = encode_stamp(location.sequence, READY_STATE)?;
        let reading_stamp = encode_stamp(location.sequence, READING_STATE)?;
        meta.stamp
            .compare_exchange(
                ready_stamp,
                reading_stamp,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .map_err(|actual_stamp| {
                slot_transition_error(slot_index, location.sequence, actual_stamp)
            })?;

        if let Err(error) = self
            .window
            .ensure_identity_unchanged(expected_identity, expected_epoch)
        {
            meta.stamp.store(ready_stamp, Ordering::Release);
            return Err(error);
        }

        let valid_frames = meta.valid_frames.load(Ordering::Relaxed) as usize;
        if valid_frames == 0 || valid_frames > self.window.geometry.slot_frames {
            meta.stamp.store(ready_stamp, Ordering::Release);
            return Err(PcmWindowAccessError::InvalidPublishedFrameCount { valid_frames });
        }
        if location.frame_offset >= valid_frames {
            meta.stamp.store(ready_stamp, Ordering::Release);
            return Err(PcmWindowAccessError::FrameUnavailable {
                frame_offset: location.frame_offset,
                valid_frames,
            });
        }

        Ok(ReadSlot {
            window: &self.window,
            slot_index,
            sequence: location.sequence,
            valid_frames,
            requested_frame_offset: location.frame_offset,
            released: false,
        })
    }
}

pub struct ReadSlot<'a> {
    window: &'a PcmWindow,
    slot_index: usize,
    sequence: u64,
    valid_frames: usize,
    requested_frame_offset: usize,
    released: bool,
}

impl ReadSlot<'_> {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    pub fn valid_frames(&self) -> usize {
        self.valid_frames
    }

    pub fn requested_frame_offset(&self) -> usize {
        self.requested_frame_offset
    }

    pub fn samples(&self) -> &[f64] {
        let sample_count = self.valid_frames * self.window.geometry.channels;
        let slot_offset = self.window.slot_sample_offset(self.slot_index);
        let ptr = self.window.storage.slot_ptr(slot_offset).cast::<f64>();
        // SAFETY: a successful acquire CAS to `Reading(sequence)` happens after
        // the producer's Release publication. The producer initialized exactly
        // `valid_frames * channels` samples and cannot reclaim this slot until
        // this guard releases it.
        unsafe { slice::from_raw_parts(ptr.cast_const(), sample_count) }
    }

    pub fn samples_from_requested_frame(&self) -> &[f64] {
        let sample_offset = self.requested_frame_offset * self.window.geometry.channels;
        &self.samples()[sample_offset..]
    }

    pub fn copy_frames(
        &self,
        frame_offset: usize,
        output: &mut [f64],
    ) -> Result<usize, PcmWindowAccessError> {
        let channels = self.window.geometry.channels;
        if !output.len().is_multiple_of(channels) {
            return Err(PcmWindowAccessError::IncompleteFrame {
                samples: output.len(),
                channels,
            });
        }
        if frame_offset >= self.valid_frames {
            return Err(PcmWindowAccessError::FrameUnavailable {
                frame_offset,
                valid_frames: self.valid_frames,
            });
        }
        let requested_frames = output.len() / channels;
        let copied_frames = requested_frames.min(self.valid_frames - frame_offset);
        let source_start = frame_offset * channels;
        let source_end = source_start + copied_frames * channels;
        output[..copied_frames * channels]
            .copy_from_slice(&self.samples()[source_start..source_end]);
        Ok(copied_frames)
    }

    pub fn release(mut self) {
        self.release_inner();
    }

    fn release_inner(&mut self) {
        if self.released {
            return;
        }
        let meta = &self.window.slots[self.slot_index];
        let ready_stamp = encode_stamp(self.sequence, READY_STATE)
            .expect("claimed read sequence was already validated");
        meta.stamp.store(ready_stamp, Ordering::Release);
        self.released = true;
    }
}

impl Drop for ReadSlot<'_> {
    fn drop(&mut self) {
        self.release_inner();
    }
}

fn floor_power_of_two(value: usize) -> usize {
    debug_assert!(value > 0);
    1usize << (usize::BITS - value.leading_zeros() - 1)
}

fn ensure_sequence(sequence: u64) -> Result<(), PcmWindowAccessError> {
    if sequence > MAX_SEQUENCE {
        Err(PcmWindowAccessError::SequenceOverflow { sequence })
    } else {
        Ok(())
    }
}

fn encode_stamp(sequence: u64, state: u64) -> Result<u64, PcmWindowAccessError> {
    ensure_sequence(sequence)?;
    Ok(((sequence + 1) << 2) | state)
}

fn decode_stamp(stamp: u64) -> Result<DecodedStamp, PcmWindowAccessError> {
    if stamp == VACANT_STAMP {
        return Ok(DecodedStamp {
            state: SlotState::Vacant,
            sequence: None,
        });
    }
    let state = match stamp & STAMP_STATE_MASK {
        WRITING_STATE => SlotState::Writing,
        READY_STATE => SlotState::Ready,
        READING_STATE => SlotState::Reading,
        _ => return Err(PcmWindowAccessError::InvalidStamp { stamp }),
    };
    let encoded_sequence = stamp >> 2;
    let sequence = encoded_sequence
        .checked_sub(1)
        .ok_or(PcmWindowAccessError::InvalidStamp { stamp })?;
    Ok(DecodedStamp {
        state,
        sequence: Some(sequence),
    })
}

fn slot_transition_error(
    slot_index: usize,
    expected_sequence: u64,
    actual_stamp: u64,
) -> PcmWindowAccessError {
    match decode_stamp(actual_stamp) {
        Ok(DecodedStamp {
            state: state @ (SlotState::Writing | SlotState::Reading),
            ..
        }) => PcmWindowAccessError::SlotBusy { slot_index, state },
        _ => PcmWindowAccessError::SequenceUnavailable {
            slot_index,
            expected_sequence,
        },
    }
}

fn encode_identity(epoch: u64, resetting: bool) -> u64 {
    (epoch << 1) | u64::from(resetting)
}

fn decode_identity(identity: u64) -> (u64, bool) {
    (identity >> 1, identity & RESETTING_BIT != 0)
}

struct IdentityResetGuard<'a> {
    identity: &'a AtomicU64,
    previous_identity: u64,
    committed: bool,
}

impl<'a> IdentityResetGuard<'a> {
    fn new(identity: &'a AtomicU64, previous_identity: u64) -> Self {
        Self {
            identity,
            previous_identity,
            committed: false,
        }
    }

    fn commit(mut self, new_identity: u64) {
        self.identity.store(new_identity, Ordering::Release);
        self.committed = true;
    }
}

impl Drop for IdentityResetGuard<'_> {
    fn drop(&mut self) {
        if !self.committed {
            self.identity
                .store(self.previous_identity, Ordering::Release);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(channels: usize, slots: usize) -> PcmWindowGeometry {
        PcmWindowGeometry::for_slot_count(channels, slots).expect("valid test geometry")
    }

    fn samples(frames: usize, channels: usize, base: f64) -> Vec<f64> {
        (0..frames * channels)
            .map(|sample| base + sample as f64)
            .collect()
    }

    #[test]
    fn slot_geometry_targets_cache_sized_payloads() {
        let cases = [
            (1, 4096, 32 * 1024),
            (2, 4096, 64 * 1024),
            (6, 1024, 48 * 1024),
            (8, 1024, 64 * 1024),
        ];
        for (channels, expected_frames, expected_bytes) in cases {
            let geometry = PcmWindowGeometry::for_capacity_bytes(channels, 256 * 1024 * 1024)
                .expect("valid geometry");
            assert_eq!(geometry.slot_frames(), expected_frames);
            assert_eq!(geometry.slot_payload_bytes(), expected_bytes);
            assert!(geometry.slot_count().is_power_of_two());
        }
    }

    #[test]
    fn payload_is_aligned_without_eager_initialization() {
        let parts = PcmWindow::create(geometry(2, 4), 7, 100, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        assert_eq!(parts.window.storage.address() % PCM_ALIGNMENT, 0);
        assert_eq!(std::mem::align_of::<PcmSlotMeta>(), PCM_ALIGNMENT);
        assert_eq!(size_of::<PcmSlotMeta>() % PCM_ALIGNMENT, 0);
    }

    #[test]
    fn publishes_and_reads_first_and_partial_final_slots() {
        let mut parts =
            PcmWindow::create(geometry(2, 4), 3, 1_000, DecodedMemoryOwner::ActiveWindow)
                .expect("window allocation");
        let slot_frames = parts.window.geometry.slot_frames();

        let first_samples = samples(slot_frames, 2, 10.0);
        let mut first = parts.writer.try_claim(3, 0, 0).expect("claim first slot");
        first
            .append_interleaved(&first_samples)
            .expect("write first slot");
        assert_eq!(
            first.publish().expect("publish first").valid_frames,
            slot_frames
        );

        let final_frames = 37;
        let final_samples = samples(final_frames, 2, 20_000.0);
        let mut final_slot = parts.writer.try_claim(3, 1, 0).expect("claim final slot");
        final_slot
            .append_interleaved(&final_samples)
            .expect("write final slot");
        assert_eq!(
            final_slot.publish().expect("publish final").valid_frames,
            final_frames
        );

        let first_read = parts
            .reader
            .try_claim_frame(3, 1_000 + 11)
            .expect("claim first frame");
        assert_eq!(first_read.requested_frame_offset(), 11);
        assert_eq!(
            first_read.samples_from_requested_frame()[..2],
            first_samples[22..24]
        );
        first_read.release();

        let final_start = 1_000 + slot_frames as u64;
        let final_read = parts
            .reader
            .try_claim_frame(3, final_start + 36)
            .expect("claim final frame");
        assert_eq!(final_read.valid_frames(), final_frames);
        assert_eq!(
            final_read.samples_from_requested_frame(),
            &final_samples[72..]
        );
    }

    #[test]
    fn owned_writer_can_span_calls_without_borrowing_writer_handle() {
        let mut parts = PcmWindow::create(geometry(2, 4), 6, 100, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        let slot_samples = parts.writer.geometry().slot_samples();
        let first_half = vec![1.0; slot_samples / 2];
        let second_half = vec![2.0; slot_samples / 2];

        let mut owned = parts.writer.try_claim_owned(6, 0, 0).expect("owned claim");
        assert!(matches!(
            parts.writer.try_claim(6, 4, 0),
            Err(PcmWindowAccessError::SlotBusy {
                state: SlotState::Writing,
                ..
            })
        ));
        owned
            .append_interleaved(&first_half)
            .expect("append first decoder span");
        owned
            .append_interleaved(&second_half)
            .expect("append second decoder span");
        let published = owned.publish().expect("publish owned slot");
        assert_eq!(
            published.valid_frames,
            parts.writer.geometry().slot_frames()
        );

        let slot = parts.reader.try_claim_sequence(6, 0).expect("reader claim");
        assert_eq!(&slot.samples()[..first_half.len()], &first_half);
        assert_eq!(&slot.samples()[first_half.len()..], &second_half);
    }

    #[test]
    fn dropping_unpublished_owned_writer_vacates_slot() {
        let mut parts = PcmWindow::create(geometry(2, 2), 1, 0, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        {
            let mut owned = parts.writer.try_claim_owned(1, 0, 0).expect("owned claim");
            owned
                .append_interleaved(&[1.0, 2.0])
                .expect("partial append");
        }

        assert!(parts.writer.try_claim_owned(1, 0, 0).is_ok());
    }

    #[test]
    fn wrap_rejects_unreclaimable_sequence_and_stale_reader() {
        let mut parts = PcmWindow::create(geometry(2, 4), 1, 0, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        let slot_frames = parts.window.geometry.slot_frames();
        let payload = samples(slot_frames, 2, 1.0);

        let mut slot = parts
            .writer
            .try_claim(1, 0, 0)
            .expect("claim sequence zero");
        slot.append_interleaved(&payload).expect("fill slot");
        slot.publish().expect("publish sequence zero");

        assert!(matches!(
            parts.writer.try_claim(1, 4, 0),
            Err(PcmWindowAccessError::SlotNotReclaimable { .. })
        ));

        let mut wrapped = parts.writer.try_claim(1, 4, 1).expect("reclaim old slot");
        wrapped
            .append_interleaved(&payload)
            .expect("fill wrapped slot");
        wrapped.publish().expect("publish wrapped slot");
        assert!(matches!(
            parts.reader.try_claim_sequence(1, 0),
            Err(PcmWindowAccessError::SequenceUnavailable { .. })
        ));
        assert_eq!(
            parts
                .reader
                .try_claim_sequence(1, 4)
                .expect("claim current sequence")
                .sequence(),
            4
        );
    }

    #[test]
    fn reading_slot_blocks_writer_overwrite() {
        let mut parts = PcmWindow::create(geometry(2, 2), 1, 0, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        let payload = samples(parts.window.geometry.slot_frames(), 2, 1.0);
        let mut slot = parts
            .writer
            .try_claim(1, 0, 0)
            .expect("claim sequence zero");
        slot.append_interleaved(&payload).expect("fill slot");
        slot.publish().expect("publish sequence zero");

        let reader = parts.reader.try_claim_sequence(1, 0).expect("reader claim");
        assert!(matches!(
            parts.writer.try_claim(1, 2, 1),
            Err(PcmWindowAccessError::SlotBusy {
                state: SlotState::Reading,
                ..
            })
        ));
        reader.release();
        assert!(parts.writer.try_claim(1, 2, 1).is_ok());
    }

    #[test]
    fn reader_never_exposes_uninitialized_tail() {
        let mut parts = PcmWindow::create(geometry(2, 2), 1, 50, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        let payload = samples(3, 2, 5.0);
        let mut slot = parts.writer.try_claim(1, 0, 0).expect("writer claim");
        slot.append_interleaved(&payload)
            .expect("write partial slot");
        slot.publish().expect("publish partial slot");

        let read = parts.reader.try_claim_sequence(1, 0).expect("reader claim");
        assert_eq!(read.samples(), payload);
        read.release();
        assert!(matches!(
            parts.reader.try_claim_frame(1, 53),
            Err(PcmWindowAccessError::FrameUnavailable {
                frame_offset: 3,
                valid_frames: 3
            })
        ));
    }

    #[test]
    fn reset_refuses_reader_then_invalidates_old_epoch() {
        let mut parts = PcmWindow::create(geometry(2, 2), 4, 100, DecodedMemoryOwner::ActiveWindow)
            .expect("window allocation");
        let payload = samples(8, 2, 2.0);
        let mut slot = parts.writer.try_claim(4, 0, 0).expect("writer claim");
        slot.append_interleaved(&payload).expect("write slot");
        slot.publish().expect("publish slot");

        let read = parts.reader.try_claim_sequence(4, 0).expect("reader claim");
        assert!(matches!(
            parts.writer.try_reset_epoch(5, 1_000),
            Err(PcmWindowAccessError::SlotBusy {
                state: SlotState::Reading,
                ..
            })
        ));
        assert_eq!(parts.window.epoch(), 4);
        assert_eq!(parts.window.origin_frame(), 100);

        read.release();
        parts
            .writer
            .try_reset_epoch(5, 1_000)
            .expect("reset after release");
        assert_eq!(parts.window.epoch(), 5);
        assert_eq!(parts.window.origin_frame(), 1_000);
        assert!(matches!(
            parts.reader.try_claim_sequence(4, 0),
            Err(PcmWindowAccessError::EpochMismatch {
                expected: 4,
                actual: 5
            })
        ));
        assert!(matches!(
            parts.reader.try_claim_sequence(5, 0),
            Err(PcmWindowAccessError::SequenceUnavailable { .. })
        ));
    }

    #[test]
    fn checked_arithmetic_rejects_overflow() {
        assert!(matches!(
            PcmWindowGeometry::for_slot_count(2, usize::MAX),
            Err(PcmWindowError::ArithmeticOverflow(_))
        ));
        assert!(matches!(
            encode_stamp(MAX_SEQUENCE + 1, READY_STATE),
            Err(PcmWindowAccessError::SequenceOverflow { .. })
        ));
    }
}

#[cfg(all(test, feature = "loom-tests"))]
mod loom_tests {
    use super::{
        encode_identity, encode_stamp, READING_STATE, READY_STATE, VACANT_STAMP, WRITING_STATE,
    };
    use loom::cell::UnsafeCell;
    use loom::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use loom::sync::Arc;
    use loom::thread;
    use std::mem::MaybeUninit;

    struct ModelSlot {
        stamp: AtomicU64,
        sample: UnsafeCell<MaybeUninit<u64>>,
    }

    #[test]
    fn release_publish_happens_before_acquire_claim() {
        loom::model(|| {
            let slot = Arc::new(ModelSlot {
                stamp: AtomicU64::new(VACANT_STAMP),
                sample: UnsafeCell::new(MaybeUninit::uninit()),
            });
            let writer_slot = Arc::clone(&slot);
            let writer = thread::spawn(move || {
                writer_slot.sample.with_mut(|sample| {
                    // SAFETY: this model has one writer and the stamp is not
                    // published as Ready until after this initialization.
                    unsafe { sample.write(MaybeUninit::new(0x5a5a)) };
                });
                writer_slot.stamp.store(
                    encode_stamp(0, READY_STATE).expect("model sequence"),
                    Ordering::Release,
                );
            });

            let reader_slot = Arc::clone(&slot);
            let reader = thread::spawn(move || {
                let ready = encode_stamp(0, READY_STATE).expect("model sequence");
                let reading = encode_stamp(0, READING_STATE).expect("model sequence");
                if reader_slot
                    .stamp
                    .compare_exchange(ready, reading, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    let sample = reader_slot.sample.with(|sample| {
                        // SAFETY: the successful acquire claim synchronizes
                        // with the writer's Release publication.
                        unsafe { (*sample).assume_init() }
                    });
                    assert_eq!(sample, 0x5a5a);
                    reader_slot.stamp.store(ready, Ordering::Release);
                }
            });

            writer.join().expect("model writer");
            reader.join().expect("model reader");
        });
    }

    #[test]
    fn reclaim_cannot_win_while_reader_owns_slot() {
        loom::model(|| {
            let ready = encode_stamp(0, READY_STATE).expect("model sequence");
            let reading = encode_stamp(0, READING_STATE).expect("model sequence");
            let stamp = Arc::new(AtomicU64::new(ready));
            let reader_active = Arc::new(AtomicBool::new(false));

            let reader_stamp = Arc::clone(&stamp);
            let reader_flag = Arc::clone(&reader_active);
            let reader = thread::spawn(move || {
                if reader_stamp
                    .compare_exchange(ready, reading, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    reader_flag.store(true, Ordering::Release);
                    thread::yield_now();
                    reader_flag.store(false, Ordering::Release);
                    reader_stamp.store(ready, Ordering::Release);
                }
            });

            let reclaim_stamp = Arc::clone(&stamp);
            let reclaim_flag = Arc::clone(&reader_active);
            let reclaimer = thread::spawn(move || {
                if reclaim_stamp
                    .compare_exchange(ready, VACANT_STAMP, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    assert!(!reclaim_flag.load(Ordering::Acquire));
                }
            });

            reader.join().expect("model reader");
            reclaimer.join().expect("model reclaimer");
            assert_ne!(stamp.load(Ordering::Acquire), reading);
        });
    }

    #[test]
    fn stale_sequence_cannot_claim_after_wrap_publication() {
        loom::model(|| {
            let sequence_zero_ready = encode_stamp(0, READY_STATE).expect("model sequence");
            let sequence_zero_reading = encode_stamp(0, READING_STATE).expect("model sequence");
            let sequence_one_writing = encode_stamp(1, WRITING_STATE).expect("model sequence");
            let sequence_one_ready = encode_stamp(1, READY_STATE).expect("model sequence");
            let stamp = Arc::new(AtomicU64::new(sequence_zero_ready));
            let wrapped_published = Arc::new(AtomicBool::new(false));

            let publisher_stamp = Arc::clone(&stamp);
            let publisher_flag = Arc::clone(&wrapped_published);
            let publisher = thread::spawn(move || {
                if publisher_stamp
                    .compare_exchange(
                        sequence_zero_ready,
                        sequence_one_writing,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .is_ok()
                {
                    publisher_stamp.store(sequence_one_ready, Ordering::Release);
                    publisher_flag.store(true, Ordering::Release);
                }
            });

            let stale_reader_stamp = Arc::clone(&stamp);
            let stale_reader_flag = Arc::clone(&wrapped_published);
            let stale_reader = thread::spawn(move || {
                if stale_reader_stamp
                    .compare_exchange(
                        sequence_zero_ready,
                        sequence_zero_reading,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .is_ok()
                {
                    assert!(!stale_reader_flag.load(Ordering::Acquire));
                    stale_reader_stamp.store(sequence_zero_ready, Ordering::Release);
                }
            });

            publisher.join().expect("model publisher");
            stale_reader.join().expect("model stale reader");
            if wrapped_published.load(Ordering::Acquire) {
                assert_eq!(stamp.load(Ordering::Acquire), sequence_one_ready);
            }
        });
    }

    #[test]
    fn reset_gate_prevents_new_claim_from_surviving_epoch_change() {
        loom::model(|| {
            let ready = encode_stamp(0, READY_STATE).expect("model sequence");
            let reading = encode_stamp(0, READING_STATE).expect("model sequence");
            let old_identity = encode_identity(1, false);
            let resetting_identity = encode_identity(1, true);
            let new_identity = encode_identity(2, false);
            let identity = Arc::new(AtomicU64::new(old_identity));
            let stamp = Arc::new(AtomicU64::new(ready));

            let reader_identity = Arc::clone(&identity);
            let reader_stamp = Arc::clone(&stamp);
            let reader = thread::spawn(move || {
                let observed_identity = reader_identity.load(Ordering::Acquire);
                if observed_identity != old_identity {
                    return;
                }
                if reader_stamp
                    .compare_exchange(ready, reading, Ordering::AcqRel, Ordering::Acquire)
                    .is_ok()
                {
                    if reader_identity.load(Ordering::Acquire) != observed_identity {
                        reader_stamp.store(ready, Ordering::Release);
                        return;
                    }
                    reader_stamp.store(ready, Ordering::Release);
                }
            });

            let reset_identity = Arc::clone(&identity);
            let reset_stamp = Arc::clone(&stamp);
            let resetter = thread::spawn(move || {
                if reset_identity
                    .compare_exchange(
                        old_identity,
                        resetting_identity,
                        Ordering::AcqRel,
                        Ordering::Acquire,
                    )
                    .is_ok()
                {
                    if reset_stamp
                        .compare_exchange(ready, VACANT_STAMP, Ordering::AcqRel, Ordering::Acquire)
                        .is_ok()
                    {
                        reset_identity.store(new_identity, Ordering::Release);
                    } else {
                        reset_identity.store(old_identity, Ordering::Release);
                    }
                }
            });

            reader.join().expect("model reader");
            resetter.join().expect("model resetter");
            assert_ne!(stamp.load(Ordering::Acquire), reading);
        });
    }
}
