use std::hint::black_box;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::{json, Value as JsonValue};
use tokio::sync::broadcast;

#[derive(Clone, Copy)]
struct Scenario {
    name: &'static str,
    subscribers: usize,
    events: usize,
    capacity: usize,
    expect_lag: bool,
}

#[derive(Debug)]
struct SubscriberReport {
    received: usize,
    lagged: u64,
    elapsed: Duration,
}

#[derive(Debug)]
struct Report {
    sent: usize,
    received: usize,
    lagged: u64,
    side_effect_invocations: usize,
    ns_per_event: f64,
    ns_per_delivery: f64,
    subscriber_p50_ms: f64,
    subscriber_p95_ms: f64,
    subscriber_max_ms: f64,
    elapsed: Duration,
}

fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let quick = args.iter().any(|arg| arg == "--quick");
    let heavy = args.iter().any(|arg| arg == "--heavy");
    let enforce = args.iter().any(|arg| arg == "--enforce");

    let event_count = if heavy { 20_000 } else { 1_000 };
    let subscribers = if heavy {
        vec![1, 5, 20, 100]
    } else {
        vec![1, 5, 20]
    };

    println!(
        "backend_ws_event_fanout_perf mode={} events={} coverage=single_coordinator_broadcast_fanout",
        mode_name(quick, heavy),
        event_count
    );
    println!(
        "backend_ws_event_fanout_note includes=json_event_build,broadcast_send,broadcast_receive,side_effect_counter excludes=network_socket_write,actix_session_mailbox"
    );

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("benchmark runtime");

    for subscriber_count in subscribers {
        let scenario = Scenario {
            name: "normal_fanout",
            subscribers: subscriber_count,
            events: event_count,
            capacity: event_count.next_power_of_two().max(16),
            expect_lag: false,
        };
        let report = runtime.block_on(measure_scenario(scenario));
        print_report(scenario, &report);

        if enforce {
            assert_eq!(report.sent, scenario.events);
            assert_eq!(report.received, scenario.events * scenario.subscribers);
            assert_eq!(report.lagged, 0);
            assert_eq!(report.side_effect_invocations, scenario.events);
        }
    }

    let lag_scenario = Scenario {
        name: "slow_subscriber_lag_probe",
        subscribers: 5,
        events: 1_000.min(event_count),
        capacity: 32,
        expect_lag: true,
    };
    let lag_report = runtime.block_on(measure_scenario(lag_scenario));
    print_report(lag_scenario, &lag_report);
    if enforce {
        assert_eq!(lag_report.sent, lag_scenario.events);
        assert_eq!(lag_report.side_effect_invocations, lag_scenario.events);
        assert!(
            lag_report.lagged > 0,
            "small-capacity lag probe should observe lag"
        );
    }
}

fn mode_name(quick: bool, heavy: bool) -> &'static str {
    if quick {
        "quick"
    } else if heavy {
        "heavy"
    } else {
        "full"
    }
}

fn print_report(scenario: Scenario, report: &Report) {
    println!(
        "ws_event_fanout scenario={} subscribers={} events={} capacity={} expected_lag={} sent={} received={} lagged={} side_effect_invocations={} ns_per_event={:.3} ns_per_delivery={:.3} subscriber_p50_ms={:.3} subscriber_p95_ms={:.3} subscriber_max_ms={:.3} elapsed_ms={:.3}",
        scenario.name,
        scenario.subscribers,
        scenario.events,
        scenario.capacity,
        scenario.expect_lag,
        report.sent,
        report.received,
        report.lagged,
        report.side_effect_invocations,
        report.ns_per_event,
        report.ns_per_delivery,
        report.subscriber_p50_ms,
        report.subscriber_p95_ms,
        report.subscriber_max_ms,
        report.elapsed.as_secs_f64() * 1_000.0
    );
}

async fn measure_scenario(scenario: Scenario) -> Report {
    let (tx, _) = broadcast::channel::<JsonValue>(scenario.capacity);
    let side_effects = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::with_capacity(scenario.subscribers);

    for _ in 0..scenario.subscribers {
        let mut rx = tx.subscribe();
        handles.push(tokio::spawn(async move {
            let started = Instant::now();
            let mut received = 0usize;
            let mut lagged = 0u64;
            loop {
                match rx.recv().await {
                    Ok(value) => {
                        black_box(value);
                        received += 1;
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        lagged += skipped;
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            SubscriberReport {
                received,
                lagged,
                elapsed: started.elapsed(),
            }
        }));
    }

    let started = Instant::now();
    for index in 0..scenario.events {
        side_effects.fetch_add(1, Ordering::Relaxed);
        let event = build_event(index);
        let _ = tx.send(black_box(event));
    }
    drop(tx);

    let mut subscriber_reports = Vec::with_capacity(handles.len());
    for handle in handles {
        subscriber_reports.push(handle.await.expect("subscriber task should complete"));
    }
    let elapsed = started.elapsed();

    let received: usize = subscriber_reports
        .iter()
        .map(|report| report.received)
        .sum();
    let lagged: u64 = subscriber_reports.iter().map(|report| report.lagged).sum();
    let mut subscriber_ms = subscriber_reports
        .iter()
        .map(|report| report.elapsed.as_secs_f64() * 1_000.0)
        .collect::<Vec<_>>();
    subscriber_ms.sort_by(|left, right| left.total_cmp(right));
    let p50 = percentile(&subscriber_ms, 0.50);
    let p95 = percentile(&subscriber_ms, 0.95);
    let max = subscriber_ms.last().copied().unwrap_or(0.0);
    let deliveries = received.max(1);

    Report {
        sent: scenario.events,
        received,
        lagged,
        side_effect_invocations: side_effects.load(Ordering::Relaxed),
        ns_per_event: elapsed.as_nanos() as f64 / scenario.events.max(1) as f64,
        ns_per_delivery: elapsed.as_nanos() as f64 / deliveries as f64,
        subscriber_p50_ms: p50,
        subscriber_p95_ms: p95,
        subscriber_max_ms: max,
        elapsed,
    }
}

fn build_event(index: usize) -> JsonValue {
    match index % 4 {
        0 => json!({ "type": "play", "position": index as f64 * 0.01, "timestamp": index as u64 }),
        1 => json!({ "type": "pause", "position": index as f64 * 0.01, "timestamp": index as u64 }),
        2 => json!({ "type": "queue_updated" }),
        _ => {
            json!({ "type": "position", "position": index as f64 * 0.01, "timestamp": index as u64 })
        }
    }
}

fn percentile(values: &[f64], percentile: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let index = ((values.len() - 1) as f64 * percentile).round() as usize;
    values[index.min(values.len() - 1)]
}
