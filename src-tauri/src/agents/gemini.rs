//! Google Gemini CLI (`gemini`). Its hooks use their own event names (`BeforeAgent`,
//! `AfterAgent`, `BeforeTool`), mapped onto Quazar's below; payloads are otherwise Claude-like.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{clip, within, AgentDef, Flags, Hooks, LaunchOptions, PastSession, SessionArgs};
use crate::paths::home_dir;

pub static GEMINI: AgentDef = AgentDef {
    name: "gemini",
    label: "Gemini",
    color: "#8ab4f8",
    programs: &["gemini"],
    flags: Flags {
        value: &[
            "-m", "--model", "--approval-mode", "-o", "--output-format", "-i", "--prompt-interactive",
            "--delete-session",
        ],
        variadic: &["--allowed-mcp-server-names", "--allowed-tools", "-e", "--extensions", "--include-directories"],
        drop: &["-r", "--resume", "-i", "--prompt-interactive", "-w", "--worktree"],
        drop_optional_value: &["-r", "--resume", "-w", "--worktree"],
        non_interactive: &[
            "-p", "--prompt", "-h", "--help", "-v", "--version", "-l", "--list-extensions", "--list-sessions",
            "--delete-session",
        ],
        subcommands: &["update", "extensions", "extension", "mcp", "skills", "skill", "hooks", "hook"],
        session_subcommands: &[],
    },
    session: SessionArgs::Flag { resume: "--resume", fork: None },
    options: LaunchOptions {
        bypass: Some("--approval-mode yolo"),
        plan: Some("--approval-mode plan"),
        // Needs `experimental.worktrees: true` in Gemini's settings.
        worktree: Some("--worktree"),
    },
    hooks: Hooks {
        config_file: || home_dir().join(".gemini").join("settings.json"),
        events: &[
            ("SessionStart", "SessionStart"),
            ("BeforeAgent", "UserPromptSubmit"),
            ("BeforeTool", "PreToolUse"),
            ("Notification", "Notification"),
            ("AfterAgent", "Stop"),
            ("SessionEnd", "SessionEnd"),
        ],
        reply_field: "prompt_response",
        install_note: "Running Gemini sessions pick them up after a restart.",
    },
    child_env: &["GEMINI_CLI"],
    transcript_summary: None,
    sessions,
};

/// Chats live in `tmp/<project>/chats/session-*.json`, where `<project>` is the SHA-256 of the
/// project folder or (newer versions) a short name registered in `projects.json` and noted in
/// the folder's `.project_root`.
fn sessions(folder: &Path) -> Vec<PastSession> {
    let gemini = home_dir().join(".gemini");
    let hash = format!("{:x}", Sha256::digest(folder.display().to_string()));
    let mut roots: HashMap<String, PathBuf> = HashMap::new();
    if let Some(Value::Object(projects)) = fs::read_to_string(gemini.join("projects.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .map(|v| v["projects"].clone())
    {
        for (path, name) in projects {
            if let Some(name) = name.as_str() {
                roots.insert(name.to_string(), PathBuf::from(path));
            }
        }
    }
    let Ok(dirs) = fs::read_dir(gemini.join("tmp")) else { return Vec::new() };
    let mut out = Vec::new();
    for dir in dirs.flatten().map(|d| d.path()) {
        let name = dir.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let root = fs::read_to_string(dir.join(".project_root"))
            .ok()
            .map(|t| PathBuf::from(t.trim()))
            .or_else(|| roots.get(&name).cloned())
            .or_else(|| (name == hash).then(|| folder.to_path_buf()));
        let Some(root) = root.filter(|r| within(&r.display().to_string(), folder)) else { continue };
        let Ok(chats) = fs::read_dir(dir.join("chats")) else { continue };
        out.extend(chats.flatten().filter_map(|c| read_session(&c.path(), &root)));
    }
    out
}

fn read_session(path: &Path, root: &Path) -> Option<PastSession> {
    if path.extension().is_none_or(|e| e != "json") {
        return None;
    }
    let chat: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let mut s = PastSession::new("gemini", path);
    s.id = chat["sessionId"].as_str()?.to_string();
    s.cwd = root.display().to_string();
    s.started = chat["startTime"].as_str().map(str::to_string);
    s.title = chat["summary"].as_str().and_then(|t| clip(t, 120));
    let messages = chat["messages"].as_array()?;
    let prompts: Vec<String> = messages.iter().filter(|m| m["type"] == "user").filter_map(message_text).collect();
    s.first_prompt = prompts.first().cloned();
    s.last_prompt = prompts.last().cloned();
    s.last_reply = messages.iter().rev().filter(|m| m["type"] == "gemini").find_map(message_text);
    s.model = messages.iter().rev().find_map(|m| m["model"].as_str()).map(str::to_string);
    s.first_prompt.is_some().then_some(s)
}

fn message_text(message: &Value) -> Option<String> {
    let content = &message["content"];
    let text = match content.as_str() {
        Some(text) => text.to_string(),
        None => content.as_array()?.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("\n"),
    };
    clip(&text, 300)
}
