//! Installs `quazar-hook` into each agent's hook settings (see [`crate::agents::Hooks`]). All
//! agents so far use Claude Code's `hooks` layout, with their own event names. Existing user hooks are kept; earlier Quazar
//! entries are replaced, so installing twice is harmless.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::State;

use crate::agents::{by_name, AGENTS};
use crate::paths::{write_atomic, Paths};

const MARKER: &str = "quazar-hook";

fn is_ours(group: &Value) -> bool {
    group["hooks"]
        .as_array()
        .is_some_and(|hooks| hooks.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains(MARKER))))
}

/// Returns `settings` with Quazar's hook entries (re)added for `events`: each of the agent's
/// events calls `quazar-hook <agent> <Quazar event>`.
pub fn merge_hooks(mut settings: Value, hook_bin: &Path, agent: &str, events: &[(&str, &str)]) -> Value {
    if !settings.is_object() {
        settings = json!({});
    }
    if !settings["hooks"].is_object() {
        settings["hooks"] = json!({});
    }
    let hooks = settings["hooks"].as_object_mut().unwrap();
    for (event, quazar_event) in events {
        let groups = hooks.entry(*event).or_insert_with(|| json!([]));
        if !groups.is_array() {
            *groups = json!([]);
        }
        let groups = groups.as_array_mut().unwrap();
        groups.retain(|g| !is_ours(g));
        let command = format!("'{}' {} {}", hook_bin.display(), agent, quazar_event);
        let mut group = Map::new();
        if *event == "PreToolUse" {
            group.insert("matcher".into(), json!("*"));
        }
        group.insert("hooks".into(), json!([{ "type": "command", "command": command }]));
        groups.push(Value::Object(group));
    }
    settings
}

fn installed_in(settings: &Value, events: &[(&str, &str)]) -> bool {
    events.iter().all(|(e, _)| settings["hooks"][*e].as_array().is_some_and(|gs| gs.iter().any(is_ours)))
}

#[derive(Serialize)]
pub struct HookStatus {
    agent: String,
    path: String,
    installed: bool,
}

#[tauri::command]
pub fn hooks_status() -> Vec<HookStatus> {
    AGENTS
        .iter()
        .map(|agent| {
            let (path, events) = ((agent.hooks.config_file)(), agent.hooks.events);
            let settings = fs::read_to_string(&path)
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or(Value::Null);
            HookStatus {
                agent: agent.name.to_string(),
                path: path.display().to_string(),
                installed: installed_in(&settings, events),
            }
        })
        .collect()
}

#[tauri::command]
pub fn install_hooks(paths: State<'_, Paths>, agent: String) -> Result<String, String> {
    let def = by_name(&agent).ok_or("unknown agent")?;
    let (path, events) = ((def.hooks.config_file)(), def.hooks.events);
    let existing = match fs::read_to_string(&path) {
        Ok(text) => {
            let parsed: Value = serde_json::from_str(&text)
                .map_err(|e| format!("{} is not valid JSON ({e}); not touching it", path.display()))?;
            let backup = path.with_extension("json.quazar-backup");
            if !backup.exists() {
                fs::write(&backup, &text).map_err(|e| e.to_string())?;
            }
            parsed
        }
        Err(_) => json!({}),
    };
    let merged = merge_hooks(existing, &paths.hook_bin, &agent, events);
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let text = serde_json::to_vec_pretty(&merged).map_err(|e| e.to_string())?;
    write_atomic(&path, &text).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_keeps_user_hooks_and_is_idempotent() {
        let user = json!({
            "model": "opus",
            "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "say done" } ] } ] }
        });
        let bin = Path::new("/data/bin/quazar-hook");
        let events = by_name("claude").unwrap().hooks.events;
        let once = merge_hooks(user, bin, "claude", events);
        let twice = merge_hooks(once.clone(), bin, "claude", events);
        assert_eq!(once, twice);
        assert_eq!(twice["model"], "opus");
        let stop = twice["hooks"]["Stop"].as_array().unwrap();
        assert_eq!(stop.len(), 2);
        assert_eq!(stop[0]["hooks"][0]["command"], "say done");
        assert_eq!(stop[1]["hooks"][0]["command"], "'/data/bin/quazar-hook' claude Stop");
        assert_eq!(twice["hooks"]["PreToolUse"][0]["matcher"], "*");
        assert!(installed_in(&twice, events));
    }

    #[test]
    fn merge_into_empty_codex_file() {
        let merged = merge_hooks(Value::Null, Path::new("/h"), "codex", by_name("codex").unwrap().hooks.events);
        assert_eq!(merged["hooks"]["PermissionRequest"][0]["hooks"][0]["command"], "'/h' codex PermissionRequest");
    }

    #[test]
    fn gemini_events_forward_under_quazar_names() {
        let merged = merge_hooks(Value::Null, Path::new("/h"), "gemini", by_name("gemini").unwrap().hooks.events);
        assert_eq!(merged["hooks"]["AfterAgent"][0]["hooks"][0]["command"], "'/h' gemini Stop");
        assert_eq!(merged["hooks"]["BeforeAgent"][0]["hooks"][0]["command"], "'/h' gemini UserPromptSubmit");
        // Gemini matchers are regexes; no matcher means every tool.
        assert!(merged["hooks"]["BeforeTool"][0].get("matcher").is_none());
    }
}
