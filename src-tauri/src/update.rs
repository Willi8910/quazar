//! Updating an installed Quazar from its own source folder (for building it yourself): notice that
//! the source changed since this build, rebuild it in the background, then swap the app and relaunch.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::QuitAllowed;

/// The source folder this app was built from.
fn source_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf).unwrap_or_default()
}

/// Where `npm run tauri build` puts the new app.
fn built_app() -> PathBuf {
    source_dir().join("src-tauri/target/release/bundle/macos/Quazar.app")
}

/// The `.app` bundle this process runs from (…/Quazar.app/Contents/MacOS/quazar).
fn running_app() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let app = exe.ancestors().nth(3)?.to_path_buf();
    (app.extension()? == "app").then_some(app)
}

/// Newest modification time of the source files that go into the app.
fn newest_source() -> Option<SystemTime> {
    let root = source_dir();
    let mut newest = None;
    let mut visit = |path: &Path| {
        if let Ok(time) = fs::metadata(path).and_then(|m| m.modified()) {
            newest = newest.max(Some(time));
        }
    };
    let mut dirs = vec![root.join("src"), root.join("src-tauri/src"), root.join("src-tauri/capabilities")];
    for file in ["index.html", "package.json", "src-tauri/Cargo.toml", "src-tauri/tauri.conf.json"] {
        visit(&root.join(file));
    }
    while let Some(dir) = dirs.pop() {
        for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() { dirs.push(path) } else { visit(&path) }
        }
    }
    newest
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    /// When this build was made (ms since the epoch): local rebuilds keep the version number.
    built: Option<u64>,
}

/// The app's version and build time (the executable's modification time, which installs keep).
#[tauri::command]
pub fn app_info() -> AppInfo {
    let built = std::env::current_exe()
        .and_then(fs::metadata)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64);
    AppInfo { version: env!("CARGO_PKG_VERSION"), built }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    /// Rebuilding is possible: a release build whose source folder is still here.
    supported: bool,
    /// The source changed since this app was built.
    available: bool,
    source: String,
}

#[tauri::command]
pub async fn update_status() -> UpdateStatus {
    let source = source_dir();
    let supported = !cfg!(debug_assertions) && running_app().is_some() && source.join("package.json").exists();
    let built = std::env::current_exe().and_then(fs::metadata).and_then(|m| m.modified()).ok();
    // A little slack: the build itself writes files around the same time.
    let available = supported
        && matches!((newest_source(), built), (Some(src), Some(exe))
            if src.duration_since(exe).is_ok_and(|d| d.as_secs() > 5));
    UpdateStatus { supported, available, source: source.display().to_string() }
}

static BUILDING: AtomicBool = AtomicBool::new(false);

/// Rebuilds the app in the background. Sends `update-progress` (a line of build output) while it runs
/// and `update-built` (`{ ok, log }`) when done.
#[tauri::command]
pub fn update_build(app: AppHandle) -> Result<(), String> {
    if BUILDING.swap(true, Ordering::SeqCst) {
        return Err("already building".into());
    }
    let log_path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("update.log");
    std::thread::spawn(move || {
        let ok = build(&app, &log_path);
        BUILDING.store(false, Ordering::SeqCst);
        let _ = app.emit("update-built", serde_json::json!({ "ok": ok, "log": log_path.display().to_string() }));
    });
    Ok(())
}

fn build(app: &AppHandle, log_path: &Path) -> bool {
    // Through a login, interactive shell: an app opened from Finder doesn't have the user's PATH
    // (npm from nvm/homebrew, cargo).
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let child = Command::new(shell)
        // Only the .app: making the .dmg installer opens it in Finder ("drag to Applications").
        .args(["-lic", "npm run tauri build -- --bundles app 2>&1"])
        .current_dir(source_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return false };
    let mut log = Vec::new();
    if let Some(out) = child.stdout.take() {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
            let _ = app.emit("update-progress", line.trim());
            log.push(line);
        }
    }
    let _ = fs::write(log_path, log.join("\n"));
    child.wait().is_ok_and(|s| s.success()) && built_app().exists()
}

/// Replaces the running app with the new build and relaunches it: a small script waits for this
/// process to exit, swaps the bundle and opens it again. Then Quazar quits.
#[tauri::command]
pub fn update_install(app: AppHandle, allowed: State<'_, QuitAllowed>) -> Result<(), String> {
    let target = running_app().ok_or("not running from an app bundle")?;
    let new = built_app();
    if !new.exists() {
        return Err("no new build found".into());
    }
    let quote = |p: &Path| format!("'{}'", p.display().to_string().replace('\'', "'\\''"));
    let swap = if fs::canonicalize(&target).ok() == fs::canonicalize(&new).ok() {
        String::new() // running the build itself: it's already in place
    } else {
        // `ditto` keeps file times, so the build time stays the build's.
        format!("rm -rf {t} && ditto {n} {t} && ", t = quote(&target), n = quote(&new))
    };
    let script = format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.2; done; {swap}open {t}",
        pid = std::process::id(),
        t = quote(&target),
    );
    Command::new("/bin/sh")
        .args(["-c", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    allowed.0.store(true, Ordering::SeqCst);
    app.exit(0);
    Ok(())
}
