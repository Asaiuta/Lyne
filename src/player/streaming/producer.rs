//! Persistent streaming producer lifecycle and latest-wins control.

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle, Thread};
use std::time::Duration;

use crossbeam::channel::{bounded, Receiver, RecvTimeoutError, Sender, TrySendError};

#[cfg(test)]
use super::memory::DecodedMemoryOwner;
use super::pcm_window::{OwnedWriteSlot, PcmWindowAccessError, PcmWindowWriter, PublishedSlot};

const REAPER_QUEUE_CAPACITY: usize = 8;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) struct WindowPublishProgress {
    pub consumed_samples: usize,
    pub published_slots: u64,
    pub produced_end_frame: u64,
}

#[derive(Debug)]
pub(crate) struct WindowPublishError {
    pub progress: WindowPublishProgress,
    pub source: PcmWindowAccessError,
}

/// Producer-owned final-storage publisher. It keeps an owned Writing claim
/// across decoder calls, so packet tails do not require a staging Vec.
pub(crate) struct WindowSlotPublisher {
    writer: PcmWindowWriter,
    epoch: u64,
    origin_frame: u64,
    next_sequence: u64,
    reclaim_before_sequence: u64,
    current: Option<OwnedWriteSlot>,
    produced_end_frame: u64,
}

impl WindowSlotPublisher {
    pub(crate) fn new(writer: PcmWindowWriter, epoch: u64, origin_frame: u64) -> Self {
        Self {
            writer,
            epoch,
            origin_frame,
            next_sequence: 0,
            reclaim_before_sequence: 0,
            current: None,
            produced_end_frame: origin_frame,
        }
    }

    pub(crate) fn set_reclaim_before_sequence(&mut self, sequence: u64) {
        self.reclaim_before_sequence = sequence;
    }

    pub(crate) fn geometry(&self) -> super::pcm_window::PcmWindowGeometry {
        self.writer.geometry()
    }

    pub(crate) fn reset_epoch(
        &mut self,
        epoch: u64,
        origin_frame: u64,
    ) -> Result<(), PcmWindowAccessError> {
        self.current.take();
        self.writer.try_reset_epoch(epoch, origin_frame)?;
        self.epoch = epoch;
        self.origin_frame = origin_frame;
        self.next_sequence = 0;
        self.reclaim_before_sequence = 0;
        self.produced_end_frame = origin_frame;
        Ok(())
    }

    pub(crate) fn append_borrowed(
        &mut self,
        samples: &[f64],
    ) -> Result<WindowPublishProgress, WindowPublishError> {
        let channels = self.writer.geometry().channels();
        if !samples.len().is_multiple_of(channels) {
            return Err(WindowPublishError {
                progress: self.progress(0, 0),
                source: PcmWindowAccessError::IncompleteFrame {
                    samples: samples.len(),
                    channels,
                },
            });
        }

        let mut consumed_samples = 0;
        let mut published_slots = 0;
        while consumed_samples < samples.len() {
            if self.current.is_none() {
                match self.writer.try_claim_owned(
                    self.epoch,
                    self.next_sequence,
                    self.reclaim_before_sequence,
                ) {
                    Ok(slot) => self.current = Some(slot),
                    Err(source) => {
                        return Err(WindowPublishError {
                            progress: self.progress(consumed_samples, published_slots),
                            source,
                        });
                    }
                }
            }

            let Some(slot) = self.current.as_mut() else {
                continue;
            };
            let copy_samples = slot
                .remaining_samples()
                .min(samples.len() - consumed_samples);
            if let Err(source) =
                slot.append_interleaved(&samples[consumed_samples..consumed_samples + copy_samples])
            {
                return Err(WindowPublishError {
                    progress: self.progress(consumed_samples, published_slots),
                    source,
                });
            }
            consumed_samples += copy_samples;

            if slot.remaining_samples() == 0 {
                let published = self
                    .publish_current()
                    .map_err(|source| WindowPublishError {
                        progress: self.progress(consumed_samples, published_slots),
                        source,
                    })?;
                published_slots += 1;
                self.update_produced_end(published);
            }
        }

        Ok(self.progress(consumed_samples, published_slots))
    }

    pub(crate) fn finish_partial(&mut self) -> Result<WindowPublishProgress, WindowPublishError> {
        let Some(_) = self.current else {
            return Ok(self.progress(0, 0));
        };
        let published = self
            .publish_current()
            .map_err(|source| WindowPublishError {
                progress: self.progress(0, 0),
                source,
            })?;
        self.update_produced_end(published);
        Ok(self.progress(0, 1))
    }

    fn publish_current(&mut self) -> Result<PublishedSlot, PcmWindowAccessError> {
        let slot = self
            .current
            .take()
            .ok_or(PcmWindowAccessError::EmptyPublication)?;
        let published = slot.publish()?;
        self.next_sequence = self.next_sequence.wrapping_add(1);
        Ok(published)
    }

    fn update_produced_end(&mut self, published: PublishedSlot) {
        let slot_frames = self.writer.geometry().slot_frames() as u64;
        self.produced_end_frame = self
            .origin_frame
            .saturating_add(published.sequence.saturating_mul(slot_frames))
            .saturating_add(published.valid_frames as u64);
    }

    fn progress(&self, consumed_samples: usize, published_slots: u64) -> WindowPublishProgress {
        WindowPublishProgress {
            consumed_samples,
            published_slots,
            produced_end_frame: self.produced_end_frame,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub(crate) enum ProducerCommandKind {
    Wake = 0,
    SourceSeek = 1,
}

impl ProducerCommandKind {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::SourceSeek,
            _ => Self::Wake,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProducerCommand {
    pub serial: u64,
    pub generation: u64,
    pub target_frame: u64,
    pub kind: ProducerCommandKind,
}

#[repr(C, align(64))]
struct ProducerCommandMailbox {
    generation: AtomicU64,
    target_frame: AtomicU64,
    kind: AtomicU8,
    serial: AtomicU64,
}

struct ProducerControl {
    mailbox: ProducerCommandMailbox,
    applied_source_seek_serial: AtomicU64,
    cancelled: AtomicBool,
    worker_thread: std::sync::OnceLock<Thread>,
}

impl ProducerControl {
    fn new() -> Self {
        Self {
            mailbox: ProducerCommandMailbox {
                generation: AtomicU64::new(0),
                target_frame: AtomicU64::new(0),
                kind: AtomicU8::new(ProducerCommandKind::Wake as u8),
                serial: AtomicU64::new(0),
            },
            applied_source_seek_serial: AtomicU64::new(0),
            cancelled: AtomicBool::new(false),
            worker_thread: std::sync::OnceLock::new(),
        }
    }

    fn bind_current_thread(&self) {
        let _ = self.worker_thread.set(thread::current());
    }

    fn publish(&self, generation: u64, target_frame: u64, kind: ProducerCommandKind) -> u64 {
        self.mailbox.generation.store(generation, Ordering::Relaxed);
        self.mailbox
            .target_frame
            .store(target_frame, Ordering::Relaxed);
        self.mailbox.kind.store(kind as u8, Ordering::Relaxed);
        let serial = self
            .mailbox
            .serial
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        self.unpark();
        serial
    }

    fn latest_after(&self, consumed_serial: u64) -> Option<ProducerCommand> {
        let serial = self.mailbox.serial.load(Ordering::Acquire);
        if serial == 0 || serial == consumed_serial {
            return None;
        }
        let command = ProducerCommand {
            serial,
            generation: self.mailbox.generation.load(Ordering::Relaxed),
            target_frame: self.mailbox.target_frame.load(Ordering::Relaxed),
            kind: ProducerCommandKind::from_raw(self.mailbox.kind.load(Ordering::Relaxed)),
        };
        (self.mailbox.serial.load(Ordering::Acquire) == serial).then_some(command)
    }

    fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
        self.unpark();
    }

    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    fn unpark(&self) {
        if let Some(worker) = self.worker_thread.get() {
            worker.unpark();
        }
    }
}

/// Producer-thread view of the control plane.
pub(crate) struct ProducerWorkerControl {
    control: Arc<ProducerControl>,
    consumed_serial: u64,
}

impl ProducerWorkerControl {
    pub(crate) fn is_cancelled(&self) -> bool {
        self.control.is_cancelled()
    }

    /// Observe the latest command once. A raced publication is deferred to the
    /// next producer phase boundary rather than returning mixed payload fields.
    pub(crate) fn take_latest(&mut self) -> Option<ProducerCommand> {
        let command = self.control.latest_after(self.consumed_serial)?;
        self.consumed_serial = command.serial;
        Some(command)
    }

    pub(crate) fn park_timeout(&self, timeout: Duration) {
        if !self.is_cancelled() {
            thread::park_timeout(timeout);
        }
    }

    pub(crate) fn publish_source_seek_applied(&self, serial: u64) {
        self.control
            .applied_source_seek_serial
            .store(serial, Ordering::Release);
    }
}

pub(crate) struct PersistentProducerHandle {
    generation: u64,
    control: Arc<ProducerControl>,
    join: Option<JoinHandle<()>>,
}

impl PersistentProducerHandle {
    pub(crate) fn spawn(
        generation: u64,
        worker: impl FnOnce(ProducerWorkerControl) + Send + 'static,
    ) -> std::io::Result<Self> {
        let control = Arc::new(ProducerControl::new());
        let worker_control = Arc::clone(&control);
        let join = thread::Builder::new()
            .name(format!("lyne-stream-producer-{generation}"))
            .spawn(move || {
                worker_control.bind_current_thread();
                worker(ProducerWorkerControl {
                    control: worker_control,
                    consumed_serial: 0,
                });
            })?;
        Ok(Self {
            generation,
            control,
            join: Some(join),
        })
    }

    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    pub(crate) fn request_source_seek(&self, target_frame: u64) -> u64 {
        let serial = self.control.publish(
            self.generation,
            target_frame,
            ProducerCommandKind::SourceSeek,
        );
        log::info!(
            "v2 src-seek: published serial={serial} gen={} target={target_frame}",
            self.generation
        );
        serial
    }

    pub(crate) fn applied_source_seek_serial(&self) -> u64 {
        self.control
            .applied_source_seek_serial
            .load(Ordering::Acquire)
    }

    pub(crate) fn wake(&self) -> u64 {
        self.control
            .publish(self.generation, 0, ProducerCommandKind::Wake)
    }

    pub(crate) fn cancel(&self) {
        self.control.cancel();
    }

    pub(crate) fn retire(mut self, reaper: &ProducerReaperHandle) -> Result<(), Self> {
        self.cancel();
        let Some(join) = self.join.take() else {
            return Ok(());
        };
        match reaper.try_submit(join) {
            Ok(()) => Ok(()),
            Err(join) => {
                self.join = Some(join);
                Err(self)
            }
        }
    }
}

impl Drop for PersistentProducerHandle {
    fn drop(&mut self) {
        self.control.cancel();
        // The JoinHandle detaches here. Session integration must call `retire`
        // and keep a rejected handle for a later bounded reaper retry.
    }
}

#[derive(Clone)]
pub(crate) struct ProducerReaperHandle {
    sender: Sender<JoinHandle<()>>,
    shutdown: Arc<AtomicBool>,
    submitted: Arc<AtomicU64>,
    reaped: Arc<AtomicU64>,
}

impl ProducerReaperHandle {
    fn try_submit(&self, join: JoinHandle<()>) -> Result<(), JoinHandle<()>> {
        if self.shutdown.load(Ordering::Acquire) {
            return Err(join);
        }
        match self.sender.try_send(join) {
            Ok(()) => {
                self.submitted.fetch_add(1, Ordering::Relaxed);
                Ok(())
            }
            Err(TrySendError::Full(join) | TrySendError::Disconnected(join)) => Err(join),
        }
    }

    pub(crate) fn submitted_count(&self) -> u64 {
        self.submitted.load(Ordering::Acquire)
    }

    pub(crate) fn reaped_count(&self) -> u64 {
        self.reaped.load(Ordering::Acquire)
    }
}

pub(crate) struct ProducerReaper {
    handle: Option<ProducerReaperHandle>,
    worker: Option<JoinHandle<()>>,
}

impl ProducerReaper {
    pub(crate) fn new() -> std::io::Result<Self> {
        let (sender, receiver) = bounded(REAPER_QUEUE_CAPACITY);
        let submitted = Arc::new(AtomicU64::new(0));
        let reaped = Arc::new(AtomicU64::new(0));
        let shutdown = Arc::new(AtomicBool::new(false));
        let worker_reaped = Arc::clone(&reaped);
        let worker_shutdown = Arc::clone(&shutdown);
        let worker = thread::Builder::new()
            .name("lyne-stream-producer-reaper".to_string())
            .spawn(move || reaper_loop(receiver, worker_reaped, worker_shutdown))?;
        Ok(Self {
            handle: Some(ProducerReaperHandle {
                sender,
                shutdown,
                submitted,
                reaped,
            }),
            worker: Some(worker),
        })
    }

    pub(crate) fn handle(&self) -> Option<ProducerReaperHandle> {
        self.handle.clone()
    }
}

impl Drop for ProducerReaper {
    fn drop(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.shutdown.store(true, Ordering::Release);
        }
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

fn reaper_loop(
    receiver: Receiver<JoinHandle<()>>,
    reaped: Arc<AtomicU64>,
    shutdown: Arc<AtomicBool>,
) {
    loop {
        match receiver.recv_timeout(Duration::from_millis(10)) {
            Ok(join) => {
                let _ = join.join();
                reaped.fetch_add(1, Ordering::Release);
            }
            Err(RecvTimeoutError::Timeout) if !shutdown.load(Ordering::Acquire) => {}
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;
    use std::time::Instant;

    use super::*;
    use crate::player::streaming::pcm_window::{PcmWindow, PcmWindowGeometry};

    fn wait_until(timeout: Duration, predicate: impl Fn() -> bool) {
        let deadline = Instant::now() + timeout;
        while !predicate() {
            assert!(Instant::now() < deadline, "condition timed out");
            thread::yield_now();
        }
    }

    #[test]
    fn producer_mailbox_is_latest_wins_without_worker_replacement() {
        let observed = Arc::new(std::sync::Mutex::new(None));
        let worker_observed = Arc::clone(&observed);
        let producer = PersistentProducerHandle::spawn(9, move |mut control| {
            while !control.is_cancelled() {
                if let Some(command) = control.take_latest() {
                    *worker_observed.lock().expect("observed lock") = Some(command);
                }
                control.park_timeout(Duration::from_millis(1));
            }
        })
        .expect("spawn producer");

        for target in 1..=100 {
            producer.request_source_seek(target);
        }
        wait_until(Duration::from_secs(1), || {
            observed
                .lock()
                .expect("observed lock")
                .is_some_and(|command| command.target_frame == 100)
        });
        assert_eq!(producer.generation(), 9);
        producer.cancel();
    }

    #[test]
    fn producer_cancel_wakes_a_parked_worker() {
        let exited = Arc::new(AtomicBool::new(false));
        let worker_exited = Arc::clone(&exited);
        let producer = PersistentProducerHandle::spawn(1, move |control| {
            while !control.is_cancelled() {
                control.park_timeout(Duration::from_secs(30));
            }
            worker_exited.store(true, Ordering::Release);
        })
        .expect("spawn producer");

        producer.cancel();
        wait_until(Duration::from_secs(1), || exited.load(Ordering::Acquire));
    }

    #[test]
    fn retired_producer_is_joined_by_bounded_reaper() {
        let reaper = ProducerReaper::new().expect("start reaper");
        let reaper_handle = reaper.handle().expect("reaper handle");
        let exited = Arc::new(AtomicUsize::new(0));
        let worker_exited = Arc::clone(&exited);
        let producer = PersistentProducerHandle::spawn(4, move |control| {
            while !control.is_cancelled() {
                control.park_timeout(Duration::from_secs(30));
            }
            worker_exited.fetch_add(1, Ordering::Release);
        })
        .expect("spawn producer");

        assert!(producer.retire(&reaper_handle).is_ok());
        wait_until(Duration::from_secs(1), || reaper_handle.reaped_count() == 1);
        assert_eq!(reaper_handle.submitted_count(), 1);
        assert_eq!(exited.load(Ordering::Acquire), 1);
    }

    #[test]
    fn producer_mailbox_and_cancel_are_cache_line_separated_from_handle_state() {
        assert_eq!(std::mem::align_of::<ProducerCommandMailbox>(), 64);
        assert_eq!(std::mem::size_of::<ProducerCommandMailbox>() % 64, 0);
        let control = ProducerControl::new();
        let base = &control as *const ProducerControl as usize;
        let mailbox = &control.mailbox as *const ProducerCommandMailbox as usize - base;
        let cancelled = &control.cancelled as *const AtomicBool as usize - base;
        assert_eq!(mailbox % 64, 0);
        assert!(cancelled >= mailbox + 64);
    }

    #[test]
    fn reaper_shutdown_does_not_wait_for_external_sender_clone() {
        let reaper = ProducerReaper::new().expect("start reaper");
        let external = reaper.handle().expect("reaper handle");
        drop(reaper);

        let producer = PersistentProducerHandle::spawn(8, |_| {}).expect("spawn producer");
        assert!(producer.retire(&external).is_err());
    }

    #[test]
    fn borrowed_spans_publish_directly_across_owned_slot_boundaries() {
        let geometry = PcmWindowGeometry::for_slot_count(2, 4).expect("geometry");
        let mut parts = PcmWindow::create(geometry, 3, 1_000, DecodedMemoryOwner::ActiveWindow)
            .expect("window");
        let mut publisher = WindowSlotPublisher::new(parts.writer, 3, 1_000);
        let half_slot = geometry.slot_samples() / 2;
        let first = vec![1.0; half_slot];
        let second = vec![2.0; half_slot + 4];

        let first_progress = publisher.append_borrowed(&first).expect("first span");
        assert_eq!(first_progress.published_slots, 0);
        let second_progress = publisher.append_borrowed(&second).expect("second span");
        assert_eq!(second_progress.published_slots, 1);
        assert_eq!(
            second_progress.produced_end_frame,
            1_000 + geometry.slot_frames() as u64
        );
        let final_progress = publisher.finish_partial().expect("partial EOF");
        assert_eq!(final_progress.published_slots, 1);
        assert_eq!(
            final_progress.produced_end_frame,
            1_002 + geometry.slot_frames() as u64
        );

        let first_slot = parts
            .reader
            .try_claim_sequence(3, 0)
            .expect("first published slot");
        assert_eq!(&first_slot.samples()[..half_slot], &first);
        assert_eq!(&first_slot.samples()[half_slot..], &second[..half_slot]);
        drop(first_slot);
        let final_slot = parts
            .reader
            .try_claim_sequence(3, 1)
            .expect("partial final slot");
        assert_eq!(final_slot.samples(), &second[half_slot..]);
    }

    #[test]
    fn publisher_epoch_reset_reuses_window_and_restarts_absolute_coordinates() {
        let geometry = PcmWindowGeometry::for_slot_count(2, 4).expect("geometry");
        let parts =
            PcmWindow::create(geometry, 3, 100, DecodedMemoryOwner::ActiveWindow).expect("window");
        let window = Arc::clone(&parts.window);
        let mut reader = parts.reader;
        let mut publisher = WindowSlotPublisher::new(parts.writer, 3, 100);
        publisher
            .append_borrowed(&vec![0.25; geometry.slot_samples()])
            .expect("publish old epoch");

        publisher.reset_epoch(4, 10_000).expect("reset epoch");
        assert_eq!(window.epoch(), 4);
        assert_eq!(window.origin_frame(), 10_000);
        let progress = publisher
            .append_borrowed(&vec![0.5; geometry.slot_samples()])
            .expect("publish new epoch");
        assert_eq!(
            progress.produced_end_frame,
            10_000 + geometry.slot_frames() as u64
        );

        assert!(reader.try_claim_frame(3, 100).is_err());
        let slot = reader
            .try_claim_frame(4, 10_000)
            .expect("claim new epoch origin");
        assert_eq!(slot.samples()[0], 0.5);
        slot.release();
    }

    #[test]
    fn window_backpressure_reports_exact_unconsumed_progress() {
        let geometry = PcmWindowGeometry::for_slot_count(2, 2).expect("geometry");
        let parts =
            PcmWindow::create(geometry, 1, 0, DecodedMemoryOwner::ActiveWindow).expect("window");
        let mut publisher = WindowSlotPublisher::new(parts.writer, 1, 0);
        let two_slots = vec![0.5; geometry.slot_samples() * 2];
        let progress = publisher.append_borrowed(&two_slots).expect("fill window");
        assert_eq!(progress.published_slots, 2);

        let next = vec![1.0; geometry.slot_samples()];
        let blocked = publisher.append_borrowed(&next).expect_err("window full");
        assert_eq!(blocked.progress.consumed_samples, 0);
        assert_eq!(blocked.progress.published_slots, 0);
        assert!(matches!(
            blocked.source,
            PcmWindowAccessError::SlotNotReclaimable { .. }
        ));
    }
}
