//! Unix-socket server for events from the zsh integration (`preexec`/`precmd`) and from
//! agent hooks (`quazar-hook`). Each line is one JSON event; they are forwarded to the UI.

use std::fs;
use std::io::Read;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agents::{by_name, detect_launch};

pub fn listen(app: AppHandle, socket: &Path) -> std::io::Result<()> {
    let _ = fs::remove_file(socket);
    let listener = UnixListener::bind(socket)?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || {
                let mut stream = stream;
                let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                let mut text = String::new();
                let _ = stream.read_to_string(&mut text);
                for line in text.lines().filter(|l| !l.trim().is_empty()) {
                    if let Ok(event) = serde_json::from_str::<Value>(line) {
                        handle(&app, event);
                    }
                }
            });
        }
    });
    Ok(())
}

fn handle(app: &AppHandle, event: Value) {
    let Some(tab) = event["tab"].as_str() else { return };
    match event["kind"].as_str() {
        Some("preexec") => {
            let launch = event["cmd"].as_str().and_then(detect_launch);
            let _ = app.emit(
                "shell-event",
                json!({ "tab": tab, "kind": "preexec", "cwd": event["cwd"], "launch": launch }),
            );
        }
        Some("precmd") => {
            let _ = app.emit("shell-event", json!({ "tab": tab, "kind": "precmd", "cwd": event["cwd"] }));
        }
        _ => {
            let mut event = event;
            if event["event"] == "Stop" {
                event["summary"] = stop_summary(&event).map_or(Value::Null, Value::from);
            }
            let _ = app.emit("agent-event", event);
        }
    }
}

/// The agent's final reply for a `Stop` hook: from the payload, else from its transcript.
fn stop_summary(event: &Value) -> Option<String> {
    let payload = &event["payload"];
    let agent = by_name(event["agent"].as_str()?)?;
    if let Some(message) = payload[agent.hooks.reply_field].as_str() {
        return Some(message.to_string());
    }
    let read = agent.transcript_summary?;
    let path = payload["transcript_path"].as_str()?;
    // The transcript is written just before Stop fires; give it a moment.
    std::thread::sleep(Duration::from_millis(250));
    read(Path::new(path))
}
