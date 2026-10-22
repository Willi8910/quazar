//! OpenAI Codex CLI (`codex`). Its `Stop` hook carries `last_assistant_message`, so no transcript
//! reader is needed.

use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{clip, read_head, read_tail, within, AgentDef, Flags, Hooks, LaunchOptions, PastSession, SessionArgs};
use crate::paths::home_dir;

pub static CODEX: AgentDef = AgentDef {
    name: "codex",
    label: "Codex",
    color: "#7fd1b9",
    programs: &["codex"],
    flags: Flags {
        value: &[
            "-m", "--model", "-c", "--config", "-p", "--profile", "-s", "--sandbox", "-a",
            "--ask-for-approval", "-C", "--cd", "--local-provider", "--enable", "--disable",
            "--remote",
        ],
        variadic: &["--add-dir", "-i", "--image"],
        drop: &["--last", "--all", "--include-non-interactive", "-i", "--image", "--worktree"],
        drop_optional_value: &[],
        non_interactive: &["-h", "--help", "-V", "--version"],
        subcommands: &[
            "exec", "e", "login", "logout", "mcp", "mcp-server", "app-server", "completion",
            "sandbox", "debug", "apply", "a", "cloud", "features", "help", "generate-ts",
            "responses-api-proxy", "stdio-to-uds",
        ],
        session_subcommands: &["resume", "fork"],
    },
    // `--yolo` and other root flags are accepted after both subcommands.
    session: SessionArgs::Subcommand { resume: "resume", fork: "fork" },
    // Plan mode is only reachable inside a session (`/plan`).
    options: LaunchOptions { bypass: Some("--yolo"), plan: None, worktree: Some("--worktree") },
    hooks: Hooks {
        config_file: || codex_home().join("hooks.json"),
        events: &[
            ("SessionStart", "SessionStart"),
            ("UserPromptSubmit", "UserPromptSubmit"),
            ("PreToolUse", "PreToolUse"),
            ("PermissionRequest", "PermissionRequest"),
            ("Stop", "Stop"),
            ("SessionEnd", "SessionEnd"),
        ],
        reply_field: "last_assistant_message",
        install_note: "Codex asks you to trust new hooks: run codex and approve the Quazar hooks when prompted \
                       (or via /hooks).",
    },
    child_env: &["CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED"],
    transcript_summary: None,
    sessions,
};

/// Rollouts live in `sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl`; the first line holds the cwd.
fn sessions(folder: &Path) -> Vec<PastSession> {
    let mut files = Vec::new();
    collect_rollouts(&codex_home().join("sessions"), 4, &mut files);
    files.iter().filter_map(|p| read_session(p, folder)).collect()
}

fn collect_rollouts(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for path in entries.flatten().map(|e| e.path()) {
        if path.is_dir() && depth > 0 {
            collect_rollouts(&path, depth - 1, out);
        } else if path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
}

fn read_session(path: &Path, folder: &Path) -> Option<PastSession> {
    // Only the first line until the folder matches: there can be thousands of rollouts.
    let mut first = String::new();
    BufReader::new(fs::File::open(path).ok()?).read_line(&mut first).ok()?;
    let meta: Value = serde_json::from_str(&first).ok()?;
    let meta = &meta["payload"];
    let cwd = meta["cwd"].as_str()?;
    if !within(cwd, folder) {
        return None;
    }
    let head = read_head(path, 256 * 1024)?;
    let mut s = PastSession::new("codex", path);
    s.id = meta["id"].as_str()?.to_string();
    s.cwd = cwd.to_string();
    s.started = meta["timestamp"].as_str().map(str::to_string);
    s.branch = meta["git"]["branch"].as_str().map(str::to_string);
    s.first_prompt = head.lines().filter_map(|l| serde_json::from_str(l).ok()).find_map(|e| event_text(&e, "user_message"));
    let tail = read_tail(path, 512 * 1024)?;
    for entry in tail.lines().rev().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if s.last_prompt.is_none() {
            s.last_prompt = event_text(&entry, "user_message");
        }
        if s.last_reply.is_none() {
            s.last_reply = event_text(&entry, "agent_message");
        }
        if entry["type"] == "turn_context" && s.model.is_none() {
            let p = &entry["payload"];
            s.model = p["model"].as_str().map(str::to_string);
            s.last_cwd = p["cwd"].as_str().filter(|c| *c != cwd).map(str::to_string);
            let sandbox = p["sandbox_policy"]["type"].as_str().or(p["sandbox_policy"]["mode"].as_str());
            s.bypass = Some(p["approval_policy"] == "never" && sandbox == Some("danger-full-access"));
        }
    }
    (s.first_prompt.is_some() || s.last_prompt.is_some()).then_some(s)
}

/// The message of an `event_msg` line of type `kind` (`user_message`, `agent_message`).
fn event_text(entry: &Value, kind: &str) -> Option<String> {
    let p = &entry["payload"];
    (entry["type"] == "event_msg" && p["type"] == kind).then(|| clip(p["message"].as_str()?, 300)).flatten()
}

fn codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home_dir().join(".codex"))
}
