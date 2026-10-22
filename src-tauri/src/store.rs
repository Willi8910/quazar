//! Persisted app state (tabs, groups) and user config, both plain JSON in the data dir.
//! The UI owns their shape; Rust only loads and saves them.

use std::fs;

use serde_json::{json, Value};
use tauri::State;

use crate::paths::{write_atomic, Paths};

fn default_config() -> Value {
    json!({
        "sidebarSide": "left",
        "sidebarWidth": 280,
        "sidebarZoom": 1.0,
        "autoGroup": true,
        "fontSize": 13,
        "fontFamily": "Menlo, 'SF Mono', monospace",
        "projectRoots": ["~/Development"],
        "scanDepth": 3,
        "preLaunch": [],
        "profiles": [
            { "id": "shell", "name": "Shell", "command": "" },
            { "id": "claude", "name": "Claude", "command": "claude" },
            { "id": "codex", "name": "Codex", "command": "codex" },
            { "id": "gemini", "name": "Gemini", "command": "gemini" }
        ],
        "launchOptions": { "bypass": false, "plan": false, "worktree": false }
    })
}

fn read_json(path: &std::path::Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

#[tauri::command]
pub fn load_state(paths: State<'_, Paths>) -> Option<Value> {
    read_json(&paths.state_file)
}

#[tauri::command]
pub fn save_state(paths: State<'_, Paths>, state: Value) -> Result<(), String> {
    let text = serde_json::to_vec_pretty(&state).map_err(|e| e.to_string())?;
    write_atomic(&paths.state_file, &text).map_err(|e| e.to_string())
}

/// Loads config.json, filling in any keys the user hasn't set. Creates the file on first run
/// so it can be edited by hand.
#[tauri::command]
pub fn load_config(paths: State<'_, Paths>) -> Value {
    let mut config = default_config();
    match read_json(&paths.config_file) {
        Some(Value::Object(user)) => {
            for (key, value) in user {
                config[key.as_str()] = value;
            }
        }
        _ if !paths.config_file.exists() => {
            let _ = save_config(paths, config.clone());
        }
        _ => {}
    }
    config
}

#[tauri::command]
pub fn save_config(paths: State<'_, Paths>, config: Value) -> Result<(), String> {
    let text = serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?;
    write_atomic(&paths.config_file, &text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn config_path(paths: State<'_, Paths>) -> String {
    paths.config_file.display().to_string()
}
