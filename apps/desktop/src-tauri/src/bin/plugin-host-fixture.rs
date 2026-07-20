use std::io::{self, BufRead, Write};

use serde_json::{json, Value};

fn write_frame(stdout: &mut io::Stdout, frame: Value) {
    let mut bytes = serde_json::to_vec(&frame).expect("encode fixture frame");
    bytes.push(b'\n');
    stdout.write_all(&bytes).expect("write fixture frame");
    stdout.flush().expect("flush fixture frame");
}

fn main() {
    let stdin = io::stdin();
    let mut reader = stdin.lock();
    let mut line = String::new();
    let mut stdout = io::stdout();

    reader.read_line(&mut line).expect("read hello");
    let hello: Value = serde_json::from_str(&line).expect("parse hello");
    assert_eq!(hello.get("type").and_then(Value::as_str), Some("hello"));
    let plugin_id = hello
        .get("pluginId")
        .and_then(Value::as_str)
        .unwrap_or("test-plugin");
    write_frame(
        &mut stdout,
        json!({"protocol": 1, "type": "hello_ack", "pluginId": plugin_id}),
    );

    line.clear();
    reader.read_line(&mut line).expect("read ready event");
    let ready: Value = serde_json::from_str(&line).expect("parse ready event");
    if ready.get("event").and_then(Value::as_str) == Some("ready") {
        write_frame(
            &mut stdout,
            json!({"protocol": 1, "type": "event", "event": "fixture_seen_ready"}),
        );
        write_frame(
            &mut stdout,
            json!({
                "protocol": 1,
                "type": "call",
                "requestId": "fixture-call-1",
                "method": "plugin.config.read",
                "params": {"fieldId": "key"}
            }),
        );
    }

    line.clear();
    reader.read_line(&mut line).expect("read broker result");
    let result: Value = serde_json::from_str(&line).expect("parse broker result");
    assert_eq!(
        result.get("ok").and_then(Value::as_bool),
        Some(true),
        "broker result: {result}"
    );
    write_frame(
        &mut stdout,
        json!({"protocol": 1, "type": "event", "event": "fixture_received_result"}),
    );

    line.clear();
    reader.read_line(&mut line).expect("read shutdown");
    let shutdown: Value = serde_json::from_str(&line).expect("parse shutdown");
    assert_eq!(
        shutdown.get("type").and_then(Value::as_str),
        Some("shutdown")
    );
    write_frame(&mut stdout, json!({"protocol": 1, "type": "shutdown_ack"}));
}
