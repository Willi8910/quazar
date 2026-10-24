//! Server for events from the shell integration (`preexec`/`precmd`) and from agent hooks: a Unix
//! socket, or a named pipe on Windows. Each line is one JSON event; they are forwarded to the UI.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::agents::{by_name, detect_launch};

#[cfg(unix)]
pub fn listen(app: AppHandle, socket: &Path) -> std::io::Result<()> {
    use std::os::unix::net::UnixListener;
    let _ = std::fs::remove_file(socket);
    let listener = UnixListener::bind(socket)?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
            serve(app.clone(), stream);
        }
    });
    Ok(())
}

#[cfg(windows)]
pub fn listen(app: AppHandle, pipe: &Path) -> std::io::Result<()> {
    use interprocess::local_socket::{prelude::*, GenericFilePath, ListenerOptions};
    let listener = ListenerOptions::new().name(pipe.to_fs_name::<GenericFilePath>()?).create_sync()?;
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            serve(app.clone(), stream);
        }
    });
    Ok(())
}

/// Reads one connection's events on a thread of its own.
fn serve(app: AppHandle, stream: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                handle(&app, event);
            }
        }
    });
}

/// `quazar hook <agent> <event>`, which agent hooks run on Windows: sends the hook's JSON input to
/// the Quazar running the tab, as `integration/quazar-hook` does elsewhere. Silent outside Quazar.
pub fn forward_hook(agent: &str, event: &str) {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    let (Ok(tab), Ok(pipe)) = (std::env::var("QUAZAR_TAB_ID"), std::env::var("QUAZAR_SOCK")) else { return };
    let payload = serde_json::from_str::<Value>(&input).unwrap_or(Value::Null);
    let line = json!({ "tab": tab, "agent": agent, "event": event, "payload": payload });
    // Every pipe instance may be busy for a moment.
    for _ in 0..20 {
        if let Ok(mut pipe) = std::fs::OpenOptions::new().write(true).open(&pipe) {
            let _ = writeln!(pipe, "{line}");
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
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
