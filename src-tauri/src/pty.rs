//! One login shell per tab, streamed over a Tauri channel to the window showing the tab. A tab can
//! move to another window: its output is buffered while no window is attached.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::agents::AGENTS;
use crate::paths::{expand_home, home_dir, Paths};

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    sink: Arc<Mutex<Sink>>,
}

/// Most output kept for a tab while no window shows it; older output is dropped.
const PENDING_MAX: usize = 4 * 1024 * 1024;

/// Where a tab's output goes: the one window showing it, or a buffer while it moves between windows.
#[derive(Default)]
struct Sink {
    channel: Option<Channel<InvokeResponseBody>>,
    pending: Vec<u8>,
}

impl Sink {
    fn send(&mut self, data: &[u8]) {
        if let Some(channel) = &self.channel {
            if channel.send(InvokeResponseBody::Raw(data.to_vec())).is_ok() {
                return;
            }
            // The window is gone; keep the output for the next one.
            self.channel = None;
        }
        self.buffer(data);
    }

    fn buffer(&mut self, data: &[u8]) {
        self.pending.extend_from_slice(data);
        if self.pending.len() > PENDING_MAX {
            let excess = self.pending.len() - PENDING_MAX;
            self.pending.drain(..excess);
        }
    }

    /// Attaches a window, first giving it what was buffered. Replaces any previous window.
    fn attach(&mut self, channel: Channel<InvokeResponseBody>) {
        let pending = std::mem::take(&mut self.pending);
        if !pending.is_empty() && channel.send(InvokeResponseBody::Raw(pending.clone())).is_err() {
            self.pending = pending;
            return;
        }
        self.channel = Some(channel);
    }
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<String, Pty>>);

impl Ptys {
    /// Each running tab's shell pid.
    pub fn root_pids(&self) -> Vec<(String, u32)> {
        let map = self.0.lock().unwrap();
        map.iter().filter_map(|(id, pty)| Some((id.clone(), pty.child.process_id()?))).collect()
    }
}

#[cfg(unix)]
fn user_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|s| std::path::Path::new(s).exists())
        .unwrap_or_else(|| "/bin/zsh".into())
}

/// PowerShell 7 when installed, else the Windows PowerShell every Windows has.
#[cfg(windows)]
fn user_shell() -> String {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let pwsh = std::env::split_paths(&path).any(|dir| dir.join("pwsh.exe").is_file());
    if pwsh { "pwsh.exe" } else { "powershell.exe" }.into()
}

const PWSH_INTEGRATION: &str = include_str!("../integration/pwsh/quazar.ps1");

/// A script as PowerShell's `-EncodedCommand` wants it: base64 of its UTF-16LE text.
fn encoded_command(script: &str) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, b)| n | (*b as u32) << (16 - 8 * i));
        for i in 0..4 {
            out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn pty_spawn(
    app: AppHandle,
    ptys: State<'_, Ptys>,
    paths: State<'_, Paths>,
    tab_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    prefill: Option<String>,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    if let Some(old) = ptys.0.lock().unwrap().remove(&tab_id) {
        let mut child = old.child;
        let _ = child.kill();
    }

    let pair = native_pty_system().openpty(size(cols, rows)).map_err(|e| e.to_string())?;
    let shell = user_shell();
    let mut cmd = CommandBuilder::new(&shell);
    if cfg!(windows) {
        // The integration goes in as an encoded command, not a script file, so it runs whatever the
        // execution policy (Windows PowerShell blocks scripts by default). The user's profile loads first.
        cmd.args(["-NoLogo", "-NoExit", "-EncodedCommand", &encoded_command(PWSH_INTEGRATION)]);
    } else {
        cmd.arg("-l");
    }

    // Quazar may itself have been started from inside an agent (e.g. `npm run tauri dev` in Claude
    // Code). Its session variables would make agents in our tabs run as that agent's child sessions,
    // which don't save transcripts and so can't be resumed.
    for key in AGENTS.iter().flat_map(|agent| agent.child_env) {
        cmd.env_remove(key);
    }
    let dir = PathBuf::from(expand_home(&cwd));
    cmd.cwd(if dir.is_dir() { dir } else { home_dir() });
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "Quazar");
    if std::env::var_os("LANG").is_none() {
        // Apps started from Finder get no locale; without it zsh and agents mangle UTF-8.
        cmd.env("LANG", "en_US.UTF-8");
    }
    cmd.env("QUAZAR_TAB_ID", &tab_id);
    cmd.env("QUAZAR_SOCK", &paths.socket);
    if shell.ends_with("zsh") {
        let user_zdotdir = std::env::var("ZDOTDIR").unwrap_or_else(|_| home_dir().display().to_string());
        cmd.env("QUAZAR_USER_ZDOTDIR", user_zdotdir);
        cmd.env("ZDOTDIR", &paths.zsh_dir);
    }
    if shell.ends_with("zsh") || cfg!(windows) {
        if let Some(prefill) = prefill.filter(|p| !p.is_empty()) {
            cmd.env("QUAZAR_PREFILL", prefill);
        }
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let pid = child.process_id();
    let sink = Arc::new(Mutex::new(Sink { channel: Some(on_data), pending: Vec::new() }));
    ptys.0.lock().unwrap().insert(tab_id.clone(), Pty { master: pair.master, writer, child, sink: sink.clone() });

    std::thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => sink.lock().unwrap().send(&buf[..n]),
            }
        }
        // Only forget the PTY if it wasn't already replaced by a respawn.
        let ptys = app.state::<Ptys>();
        let mut map = ptys.0.lock().unwrap();
        if map.get(&tab_id).and_then(|p| p.child.process_id()) == pid {
            map.remove(&tab_id);
        }
        drop(map);
        let _ = app.emit("pty-exit", &tab_id);
    });
    Ok(())
}

#[tauri::command]
pub fn pty_write(ptys: State<'_, Ptys>, tab_id: String, data: String) -> Result<(), String> {
    let mut map = ptys.0.lock().unwrap();
    let pty = map.get_mut(&tab_id).ok_or("no such terminal")?;
    pty.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    pty.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(ptys: State<'_, Ptys>, tab_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = ptys.0.lock().unwrap();
    if let Some(pty) = map.get(&tab_id) {
        pty.master.resize(size(cols, rows)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn pty_kill(ptys: State<'_, Ptys>, tab_id: String) {
    if let Some(mut pty) = ptys.0.lock().unwrap().remove(&tab_id) {
        let _ = pty.child.kill();
    }
}

/// Stops the tab's shell and everything in it, letting agents exit cleanly so their sessions can
/// be resumed. The tab's `pty-exit` follows once the shell is gone.
#[tauri::command]
pub fn pty_terminate(ptys: State<'_, Ptys>, tab_id: String) {
    let pid = ptys.0.lock().unwrap().get(&tab_id).and_then(|pty| pty.child.process_id());
    if let Some(pid) = pid {
        crate::metrics::terminate_tree(pid);
    }
}

/// Shows the tab's running shell in the calling window (after a move between windows).
#[tauri::command]
pub fn pty_attach(ptys: State<'_, Ptys>, tab_id: String, on_data: Channel<InvokeResponseBody>) -> Result<(), String> {
    let sink = ptys.0.lock().unwrap().get(&tab_id).map(|pty| pty.sink.clone()).ok_or("no such terminal")?;
    sink.lock().unwrap().attach(on_data);
    Ok(())
}

/// Stops sending the tab's output to its window; it is buffered until a window attaches.
#[tauri::command]
pub fn pty_detach(ptys: State<'_, Ptys>, tab_id: String) {
    if let Some(pty) = ptys.0.lock().unwrap().get(&tab_id) {
        pty.sink.lock().unwrap().channel = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_powershell_commands() {
        // [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes("ls")) in PowerShell.
        assert_eq!(encoded_command("ls"), "bABzAA==");
        assert_eq!(encoded_command("dir"), "ZABpAHIA");
        assert_eq!(encoded_command("é"), "6QA=");
    }

    #[test]
    fn buffers_output_while_detached() {
        let mut sink = Sink::default();
        sink.send(b"hello ");
        sink.send(b"world");
        assert_eq!(sink.pending, b"hello world");
    }

    #[test]
    fn keeps_only_the_latest_output() {
        let mut sink = Sink::default();
        sink.buffer(&vec![b'a'; PENDING_MAX]);
        sink.buffer(b"end");
        assert_eq!(sink.pending.len(), PENDING_MAX);
        assert!(sink.pending.ends_with(b"end"));
    }
}
