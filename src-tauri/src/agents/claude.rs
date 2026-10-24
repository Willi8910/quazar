//! Claude Code (`claude`).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::{
    clip, read_head, read_tail, skills, within, AgentDef, Flags, Hooks, LaunchOptions, PastSession, SessionArgs, Skill,
};
use crate::paths::home_dir;

pub static CLAUDE: AgentDef = AgentDef {
    name: "claude",
    label: "Claude Code",
    color: "#e8a87c",
    programs: &["claude"],
    flags: Flags {
        value: &[
            "--model", "--permission-mode", "--append-system-prompt", "--system-prompt",
            "--system-prompt-file", "--append-system-prompt-file", "--settings", "--agents",
            "--agent", "--fallback-model", "--session-id", "--output-format", "--input-format",
            "--setting-sources", "--permission-prompt-tool", "--max-turns", "--name", "-n",
        ],
        variadic: &[
            "--add-dir", "--allowedTools", "--allowed-tools", "--disallowedTools",
            "--disallowed-tools", "--mcp-config", "--betas", "--plugin-dir", "--tools",
        ],
        // A resume continues in the session's own worktree; `--worktree` would start another.
        drop: &[
            "-c", "--continue", "-r", "--resume", "--session-id", "--fork-session", "-w", "--worktree", "--tmux",
        ],
        drop_optional_value: &["-r", "--resume", "-w", "--worktree"],
        non_interactive: &["-p", "--print", "-h", "--help", "-v", "--version"],
        subcommands: &[
            "mcp", "config", "doctor", "update", "upgrade", "install", "migrate-installer",
            "setup-token", "plugin", "plugins", "auth", "login", "logout", "agents", "api-key",
        ],
        session_subcommands: &[],
    },
    session: SessionArgs::Flag { resume: "--resume", fork: Some("--fork-session") },
    options: LaunchOptions {
        bypass: Some("--dangerously-skip-permissions"),
        plan: Some("--permission-mode plan"),
        worktree: Some("--worktree"),
    },
    hooks: Hooks {
        config_file: || home_dir().join(".claude").join("settings.json"),
        events: &[
            ("SessionStart", "SessionStart"),
            ("UserPromptSubmit", "UserPromptSubmit"),
            ("PreToolUse", "PreToolUse"),
            ("Notification", "Notification"),
            ("Stop", "Stop"),
            ("SessionEnd", "SessionEnd"),
        ],
        reply_field: "last_assistant_message",
        install_note: "Already-running Claude sessions pick them up after a restart.",
    },
    child_env: &[
        "CLAUDECODE",
        "CLAUDE_PID",
        "CLAUDE_EFFORT",
        "AI_AGENT",
        "CLAUDE_CODE_ENTRYPOINT",
        "CLAUDE_CODE_EXECPATH",
        "CLAUDE_CODE_SESSION_ID",
        "CLAUDE_CODE_CHILD_SESSION",
        "CLAUDE_CODE_SESSION_ATTENDED",
        "CLAUDE_CODE_MESSAGING_SOCKET",
        "CLAUDE_CODE_MESSAGING_TOKEN",
    ],
    transcript_summary: Some(last_assistant_text),
    sessions,
    skills,
};

/// Skills (`skills/<name>/SKILL.md`) and commands (`commands/**/*.md`), the project's and the user's.
fn skills(cwd: &Path) -> Vec<Skill> {
    let mut out = Vec::new();
    for dir in skills::project_dirs(cwd) {
        out.extend(skills::skill_folders(&dir.join(".claude").join("skills"), "project"));
        out.extend(skills::command_files(&dir.join(".claude").join("commands"), "md", "", "project"));
    }
    out.extend(skills::skill_folders(&config_dir().join("skills"), "user"));
    out.extend(skills::command_files(&config_dir().join("commands"), "md", "", "user"));
    skills::dedupe(out)
}

fn config_dir() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or_else(|| home_dir().join(".claude"))
}

/// Transcripts live in `projects/<cwd with every non-alphanumeric char as '-'>/<session id>.jsonl`.
fn sessions(folder: &Path) -> Vec<PastSession> {
    let encoded: String =
        folder.display().to_string().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let Ok(dirs) = fs::read_dir(config_dir().join("projects")) else { return Vec::new() };
    dirs.flatten()
        .filter(|d| {
            let name = d.file_name().to_string_lossy().into_owned();
            name == encoded || name.starts_with(&format!("{encoded}-"))
        })
        .filter_map(|d| fs::read_dir(d.path()).ok())
        .flat_map(|files| files.flatten())
        .map(|f| f.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|p| read_session(&p))
        .filter(|s| within(&s.cwd, folder))
        .collect()
}

fn read_session(path: &Path) -> Option<PastSession> {
    let mut s = PastSession::new("claude", path);
    s.id = path.file_stem()?.to_string_lossy().into_owned();
    let head = read_head(path, 256 * 1024)?;
    for entry in head.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if s.cwd.is_empty() {
            s.cwd = entry["cwd"].as_str().unwrap_or_default().to_string();
        }
        if s.started.is_none() {
            s.started = entry["timestamp"].as_str().map(str::to_string);
        }
        if s.first_prompt.is_none() {
            s.first_prompt = user_prompt(&entry);
        }
    }
    // Read newest first: the latest title, mode, branch and reply win.
    let tail = read_tail(path, 512 * 1024)?;
    let mut custom_title = None;
    for entry in tail.lines().rev().filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        let text = |key: &str| entry[key].as_str().map(str::to_string);
        match entry["type"].as_str() {
            Some("custom-title") if custom_title.is_none() => custom_title = text("customTitle"),
            Some("ai-title") if s.title.is_none() => s.title = text("aiTitle"),
            Some("permission-mode") if s.bypass.is_none() => {
                let mode = entry["permissionMode"].as_str().unwrap_or_default();
                s.bypass = Some(mode == "bypassPermissions");
                s.plan = Some(mode == "plan");
            }
            Some("assistant") => {
                if s.model.is_none() {
                    s.model = entry["message"]["model"].as_str().filter(|m| !m.starts_with('<')).map(str::to_string);
                }
                if s.last_reply.is_none() {
                    s.last_reply = assistant_text_of(&entry).and_then(|t| clip(&t, 300));
                }
            }
            Some("user") if s.last_prompt.is_none() => s.last_prompt = user_prompt(&entry),
            _ => {}
        }
        if s.branch.is_none() {
            s.branch = text("gitBranch").filter(|b| !b.is_empty() && b != "HEAD");
        }
        if s.last_cwd.is_none() {
            s.last_cwd = entry["cwd"].as_str().map(str::to_string);
        }
    }
    s.title = custom_title.or(s.title);
    s.last_cwd = s.last_cwd.filter(|c| *c != s.cwd);
    // A session that never got a prompt (opened and quit) isn't worth resuming.
    (s.first_prompt.is_some() || s.last_prompt.is_some()).then_some(s)
}

/// The text the user typed, skipping tool results, slash-command wrappers and injected context.
fn user_prompt(entry: &Value) -> Option<String> {
    if entry["type"] != "user" || entry["isMeta"] == true || entry["isCompactSummary"] == true {
        return None;
    }
    let content = &entry["message"]["content"];
    let text = match content.as_str() {
        Some(text) => text.to_string(),
        None => content
            .as_array()?
            .iter()
            .filter(|b| b["type"] == "text")
            .filter_map(|b| b["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n"),
    };
    let text = text.trim();
    if text.starts_with('<') {
        return None;
    }
    clip(text, 300)
}

/// Last assistant text in a Claude Code JSONL transcript (reads only the file's tail).
fn last_assistant_text(path: &Path) -> Option<String> {
    let text = read_tail(path, 512 * 1024)?;
    text.lines().rev().find_map(assistant_text)
}

fn assistant_text(line: &str) -> Option<String> {
    assistant_text_of(&serde_json::from_str(line).ok()?)
}

fn assistant_text_of(entry: &Value) -> Option<String> {
    if entry["type"] != "assistant" {
        return None;
    }
    let text: Vec<&str> = entry["message"]["content"]
        .as_array()?
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .collect();
    let text = text.join("\n").trim().to_string();
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn finds_last_assistant_text_skipping_tool_only_turns() {
        let dir = std::env::temp_dir().join(format!("quazar-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        let lines = [
            r#"{"type":"user","message":{"content":"hi"}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"First answer"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"All tests pass."}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash"}]}}"#,
            r#"{"type":"system","subtype":"stop_hook"}"#,
        ];
        fs::write(&path, lines.join("\n")).unwrap();
        assert_eq!(last_assistant_text(&path).as_deref(), Some("All tests pass."));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn reads_a_session_for_the_resume_list() {
        let dir = std::env::temp_dir().join(format!("quazar-session-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("abc.jsonl");
        let lines = [
            r#"{"type":"permission-mode","permissionMode":"default"}"#,
            r#"{"type":"user","isMeta":true,"cwd":"/r/api","timestamp":"2026-10-01T00:00:00Z","message":{"content":"<local-command-caveat>"}}"#,
            r#"{"type":"user","cwd":"/r/api","gitBranch":"main","message":{"content":"<command-name>/model</command-name>"}}"#,
            r#"{"type":"user","cwd":"/r/api","gitBranch":"main","message":{"content":"Fix   the\nlogin bug"}}"#,
            r#"{"type":"ai-title","aiTitle":"Login bug"}"#,
            r#"{"type":"assistant","cwd":"/r/api/.claude/worktrees/x","gitBranch":"fix","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"Fixed."}]}}"#,
            r#"{"type":"user","cwd":"/r/api/.claude/worktrees/x","message":{"content":[{"type":"tool_result"}]}}"#,
            r#"{"type":"permission-mode","permissionMode":"bypassPermissions"}"#,
            r#"{"type":"custom-title","customTitle":"My login fix"}"#,
        ];
        fs::write(&path, lines.join("\n")).unwrap();
        let s = read_session(&path).unwrap();
        assert_eq!(s.id, "abc");
        assert_eq!(s.cwd, "/r/api");
        assert_eq!(s.last_cwd.as_deref(), Some("/r/api/.claude/worktrees/x"));
        assert_eq!(s.title.as_deref(), Some("My login fix"));
        assert_eq!(s.first_prompt.as_deref(), Some("Fix the login bug"));
        assert_eq!(s.last_prompt.as_deref(), Some("Fix the login bug"));
        assert_eq!(s.last_reply.as_deref(), Some("Fixed."));
        assert_eq!(s.branch.as_deref(), Some("fix"));
        assert_eq!(s.model.as_deref(), Some("claude-opus-5-5"));
        assert_eq!(s.started.as_deref(), Some("2026-10-01T00:00:00Z"));
        assert_eq!((s.bypass, s.plan), (Some(true), Some(false)));
        fs::remove_dir_all(dir).unwrap();
    }
}
