//! File paths printed in a terminal: which exist, showing them in Finder/Explorer, opening them, and
//! dragging them out to other apps as real files.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::WebviewWindow;

use crate::paths::expand_home;

#[derive(Serialize)]
pub struct FoundPath {
    path: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
}

/// For each candidate, the existing file or folder it names: absolute, `~/…`, or relative to the first
/// of `bases` (the agent's folder, the tab's folder, …) where it exists. Only stats the disk.
#[tauri::command]
pub fn resolve_paths(bases: Vec<String>, candidates: Vec<String>) -> Vec<Option<FoundPath>> {
    candidates.iter().map(|c| resolve(&bases, c)).collect()
}

fn resolve(bases: &[String], candidate: &str) -> Option<FoundPath> {
    let expanded = PathBuf::from(expand_home(candidate));
    let tries: Vec<PathBuf> = if expanded.is_absolute() {
        vec![expanded]
    } else {
        bases.iter().map(|b| Path::new(&expand_home(b)).join(&expanded)).collect()
    };
    tries.into_iter().find_map(|p| {
        let meta = std::fs::metadata(&p).ok()?;
        // Windows canonical paths start with `\\?\`, which Explorer's `/select,` doesn't take.
        let path = if cfg!(windows) { p } else { p.canonicalize().unwrap_or(p) };
        Some(FoundPath { path: path.to_string_lossy().into_owned(), is_dir: meta.is_dir() })
    })
}

/// Shows a file selected in its folder in Finder/Explorer; a folder opens as itself.
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return crate::platform::reveal(&path);
    }
    let result = if cfg!(windows) {
        // `/select,` must be one argument with the path; Explorer's exit code says nothing about success.
        crate::platform::command("explorer").arg(format!("/select,{path}")).spawn().map(|_| ())
    } else {
        std::process::Command::new("open").arg("-R").arg(p).status().map(|_| ())
    };
    result.map_err(|e| e.to_string())
}

/// Opens a file with its default app. Programs, scripts and app bundles are only shown in their
/// folder: a click on text an agent printed must never run something.
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    if runs_code(Path::new(&path)) {
        return reveal_path(path);
    }
    let result = if cfg!(windows) {
        crate::platform::command("explorer").arg(&path).spawn().map(|_| ())
    } else {
        std::process::Command::new("open").arg(&path).status().map(|_| ())
    };
    result.map_err(|e| e.to_string())
}

fn runs_code(path: &Path) -> bool {
    const RUNNABLE: &[&str] = &[
        "app", "command", "tool", "sh", "zsh", "bash", "workflow", "scpt", "applescript", "pkg", "mpkg", "terminal",
        "exe", "bat", "cmd", "com", "msi", "ps1", "vbs", "js", "jse", "wsf", "lnk", "scr", "reg", "hta",
    ];
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if RUNNABLE.contains(&ext.as_str()) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(path) {
            return meta.is_file() && meta.permissions().mode() & 0o111 != 0;
        }
    }
    false
}

const DRAG_ICON: &[u8] = include_bytes!("../icons/32x32.png");

/// Starts dragging `path` out of the window as a file, e.g. into a browser upload or a chat app.
/// Called while the mouse button is held after it moved off a path.
#[tauri::command]
pub fn drag_path(window: WebviewWindow, path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err(format!("{path} doesn't exist"));
    }
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = drag::start_drag(
                &target,
                drag::DragItem::Files(vec![PathBuf::from(path)]),
                drag::Image::Raw(DRAG_ICON.to_vec()),
                |_, _| {},
                drag::Options::default(),
            );
        })
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_to_the_first_base_where_it_exists() {
        let dir = std::env::temp_dir().join(format!("quazar-files-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(dir.join("src/a.ts"), "").unwrap();
        let bases = vec!["/nonexistent-quazar".to_string(), dir.to_string_lossy().into_owned()];
        let found = resolve(&bases, "src/a.ts").unwrap();
        assert!(Path::new(&found.path).ends_with(Path::new("src").join("a.ts")) && !found.is_dir);
        assert!(resolve(&bases, "src").unwrap().is_dir);
        assert!(resolve(&bases, "missing.md").is_none());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn never_opens_programs() {
        assert!(runs_code(Path::new("/tmp/x.command")));
        assert!(runs_code(Path::new("C:/x/setup.EXE")));
        assert!(!runs_code(Path::new("/tmp/notes-that-do-not-exist.md")));
    }
}
