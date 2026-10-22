//! What Quazar knows about each agent CLI.
//!
//! Every agent is one [`AgentDef`] in its own file (`claude.rs`, `codex.rs`, `gemini.rs`). To support a new
//! agent, add a file describing it and list it in [`AGENTS`]; nothing else needs to change.
//! The rest of this module is the shared machinery: recognising a typed launch and rebuilding it
//! as a resume/fork command that keeps the user's original flags (`--dangerously-skip-permissions`,
//! `--yolo`, …).

mod claude;
mod codex;
mod gemini;

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Every supported agent.
pub static AGENTS: &[&AgentDef] = &[&claude::CLAUDE, &codex::CODEX, &gemini::GEMINI];

pub struct AgentDef {
    /// Id used by hooks, saved tabs and the UI, e.g. "claude".
    pub name: &'static str,
    /// Display name, e.g. "Claude Code".
    pub label: &'static str,
    /// Colour of the agent's tag in the sidebar.
    pub color: &'static str,
    /// Executable names that start the agent.
    pub programs: &'static [&'static str],
    /// Its command-line grammar, so flags survive a resume.
    pub flags: Flags,
    /// How a session is resumed or forked.
    pub session: SessionArgs,
    /// Flags behind the launcher's checkboxes.
    pub options: LaunchOptions,
    /// Where Quazar's hook goes and which events it forwards.
    pub hooks: Hooks,
    /// Variables the agent sets for its own child processes. They're removed from tab shells, so
    /// an agent started in a tab isn't taken for a sub-process of whatever launched Quazar.
    pub child_env: &'static [&'static str],
    /// Reads the latest assistant reply from a session transcript, for `Stop` hooks that don't
    /// include it in [`Hooks::reply_field`].
    pub transcript_summary: Option<fn(&Path) -> Option<String>>,
    /// Lists the agent's own saved sessions whose working directory is in a folder.
    pub sessions: fn(&Path) -> Vec<PastSession>,
}

/// A session found in an agent's own history, for the resume list.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PastSession {
    pub agent: &'static str,
    pub id: String,
    /// Where the session started, which is where it resumes from.
    pub cwd: String,
    /// Where the agent last worked when that's elsewhere, e.g. a git worktree it created.
    pub last_cwd: Option<String>,
    /// Title the agent gave the session (or the user's rename).
    pub title: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub last_reply: Option<String>,
    pub branch: Option<String>,
    pub model: Option<String>,
    /// ISO 8601 timestamp of the first entry.
    pub started: Option<String>,
    /// Last write to the session file, in ms since the epoch.
    pub updated: u64,
    /// Last permission mode: skipping prompts / plan mode; None when unknown.
    pub bypass: Option<bool>,
    pub plan: Option<bool>,
}

impl PastSession {
    fn new(agent: &'static str, file: &Path) -> PastSession {
        let updated = std::fs::metadata(file)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        PastSession { agent, updated, ..Default::default() }
    }
}

/// `path` is `folder` or inside it.
pub fn within(path: &str, folder: &Path) -> bool {
    Path::new(path).starts_with(folder)
}

/// A prompt or reply cut to `max` characters on one line.
pub fn clip(text: &str, max: usize) -> Option<String> {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return None;
    }
    Some(match text.char_indices().nth(max) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text,
    })
}

/// Sessions of every agent run in `folder` (or below it), most recent first.
#[tauri::command]
pub async fn list_sessions(folder: String) -> Vec<PastSession> {
    let folder = PathBuf::from(crate::paths::expand_home(&folder));
    let mut all: Vec<PastSession> = AGENTS.iter().flat_map(|a| (a.sessions)(&folder)).collect();
    all.sort_by(|a, b| b.updated.cmp(&a.updated));
    all
}

pub struct Flags {
    /// Flags that take exactly one value.
    pub value: &'static [&'static str],
    /// Flags that take one or more values (consume until the next flag).
    pub variadic: &'static [&'static str],
    /// Flags (and their values) that must not be repeated on resume.
    pub drop: &'static [&'static str],
    /// Of the dropped flags, those whose value is optional (`--resume [id]`).
    pub drop_optional_value: &'static [&'static str],
    /// Flags meaning the run is not an interactive session.
    pub non_interactive: &'static [&'static str],
    /// First positionals that are management subcommands, not a session.
    pub subcommands: &'static [&'static str],
    /// First positionals that are session subcommands and get replaced on resume.
    pub session_subcommands: &'static [&'static str],
}

pub enum SessionArgs {
    /// `<program> <flags> <resume> <id> [<fork>]`, e.g. `claude … --resume <id> --fork-session`.
    /// `fork` is `None` when the agent can't fork a session.
    Flag { resume: &'static str, fork: Option<&'static str> },
    /// `<program> <resume|fork> <id> <flags>`, e.g. `codex resume <id> --yolo`.
    Subcommand { resume: &'static str, fork: &'static str },
}

impl SessionArgs {
    fn can_fork(&self) -> bool {
        !matches!(self, SessionArgs::Flag { fork: None, .. })
    }
}

/// Extra flags for the launcher's checkboxes; `None` hides the checkbox for this agent.
pub struct LaunchOptions {
    /// Skip permission prompts, e.g. `--dangerously-skip-permissions`.
    pub bypass: Option<&'static str>,
    /// Start in plan mode.
    pub plan: Option<&'static str>,
    /// Start in a new git worktree.
    pub worktree: Option<&'static str>,
}

pub struct Hooks {
    /// JSON settings file with a `hooks` section in Claude Code's layout.
    pub config_file: fn() -> PathBuf,
    /// Hook events to forward, as (event name in the agent's settings, event Quazar receives).
    /// The UI understands `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification`,
    /// `PermissionRequest`, `Stop` and `SessionEnd`, with Claude Code-style payloads
    /// (`session_id`, `cwd`, `prompt`, `tool_name`/`tool_input`, `message`, …).
    pub events: &'static [(&'static str, &'static str)],
    /// Payload field of the `Stop` event that holds the final reply.
    pub reply_field: &'static str,
    /// Shown after installing, e.g. how to approve new hooks.
    pub install_note: &'static str,
}

pub fn by_name(name: &str) -> Option<&'static AgentDef> {
    AGENTS.iter().copied().find(|a| a.name == name)
}

fn by_program(program: &str) -> Option<&'static AgentDef> {
    AGENTS.iter().copied().find(|a| a.programs.contains(&program))
}

/// What the UI needs to know about an agent.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    name: &'static str,
    label: &'static str,
    color: &'static str,
    programs: &'static [&'static str],
    install_note: &'static str,
    can_fork: bool,
    options: Options,
}

#[derive(Serialize)]
struct Options {
    bypass: Option<&'static str>,
    plan: Option<&'static str>,
    worktree: Option<&'static str>,
}

#[tauri::command]
pub fn agent_list() -> Vec<AgentInfo> {
    AGENTS
        .iter()
        .map(|a| AgentInfo {
            name: a.name,
            label: a.label,
            color: a.color,
            programs: a.programs,
            install_note: a.hooks.install_note,
            can_fork: a.session.can_fork(),
            options: Options { bypass: a.options.bypass, plan: a.options.plan, worktree: a.options.worktree },
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Launch {
    /// The agent's [`AgentDef::name`].
    pub agent: &'static str,
    /// Full argv as typed, including leading `VAR=value` assignments.
    pub argv: Vec<String>,
}

impl Launch {
    pub fn new(agent: &str, argv: Vec<String>) -> Option<Launch> {
        Some(Launch { agent: by_name(agent)?.name, argv })
    }

    fn def(&self) -> &'static AgentDef {
        by_name(self.agent).expect("launch of a known agent")
    }
}

/// The text of the first `max` bytes of a file.
pub fn read_head(path: &Path, max: u64) -> Option<String> {
    let mut bytes = Vec::new();
    File::open(path).ok()?.take(max).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

/// The text of the last `max` bytes of a (possibly large) file.
pub fn read_tail(path: &Path, max: u64) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(max))).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn is_assignment(word: &str) -> bool {
    match word.split_once('=') {
        Some((name, _)) => {
            !name.is_empty()
                && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
                && !name.starts_with(|c: char| c.is_ascii_digit())
        }
        None => false,
    }
}

fn is_flag(word: &str) -> bool {
    word.len() > 1 && word.starts_with('-')
}

/// Splits `--flag=value` into its name.
fn flag_name(word: &str) -> &str {
    word.split_once('=').map_or(word, |(name, _)| name)
}

/// One parsed command-line element of an agent invocation.
enum Item {
    /// A flag with its values, as they appeared (`--model opus` → ["--model", "opus"]).
    Flag(Vec<String>),
    Positional(String),
}

fn parse(args: &[String], spec: &Flags) -> Vec<Item> {
    let mut items = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let word = &args[i];
        i += 1;
        if word == "--" {
            items.extend(args[i..].iter().cloned().map(Item::Positional));
            break;
        }
        if !is_flag(word) {
            items.push(Item::Positional(word.clone()));
            continue;
        }
        let name = flag_name(word);
        let mut group = vec![word.clone()];
        let inline_value = word.contains('=');
        if !inline_value {
            if spec.value.contains(&name) {
                if let Some(v) = args.get(i) {
                    group.push(v.clone());
                    i += 1;
                }
            } else if spec.variadic.contains(&name) {
                while let Some(v) = args.get(i).filter(|v| !is_flag(v)) {
                    group.push(v.clone());
                    i += 1;
                }
            } else if spec.drop_optional_value.contains(&name) {
                if let Some(v) = args.get(i).filter(|v| !is_flag(v)) {
                    group.push(v.clone());
                    i += 1;
                }
            }
        }
        items.push(Item::Flag(group));
    }
    items
}

/// Recognises an interactive agent launch in a shell command line, e.g.
/// `claude --dangerously-skip-permissions` or `FOO=1 codex --yolo "fix it"`.
pub fn detect_launch(cmdline: &str) -> Option<Launch> {
    let words = shell_words::split(cmdline).ok()?;
    // The first simple command of the list that runs an agent, so `usa && claude …` is found too.
    let (words, cmd_at, agent) = words
        .split(|w| matches!(w.as_str(), ";" | "&&" | "||" | "|" | "&"))
        .find_map(|words| {
            let cmd_at = words.iter().position(|w| !is_assignment(w))?;
            let agent = by_program(words[cmd_at].rsplit('/').next()?)?;
            Some((words, cmd_at, agent))
        })?;
    let spec = &agent.flags;
    let items = parse(&words[cmd_at + 1..], spec);

    for item in &items {
        if let Item::Flag(group) = item {
            if spec.non_interactive.contains(&flag_name(&group[0])) {
                return None;
            }
        }
    }
    let first_positional = items.iter().find_map(|item| match item {
        Item::Positional(p) => Some(p.as_str()),
        Item::Flag(_) => None,
    });
    if first_positional.is_some_and(|p| spec.subcommands.contains(&p)) {
        return None;
    }
    Some(Launch { agent: agent.name, argv: words.to_vec() })
}

/// Builds the command that resumes `session_id` with the same flags as the original launch.
/// Prompts, print mode and earlier resume/continue arguments are not carried over.
pub fn build_resume(launch: &Launch, session_id: &str) -> String {
    build_session_command(launch, session_id, false)
}

/// Like [`build_resume`], but continues `session_id` as a new, independent session. `None` when
/// the agent can't fork.
pub fn build_fork(launch: &Launch, session_id: &str) -> Option<String> {
    launch.def().session.can_fork().then(|| build_session_command(launch, session_id, true))
}

fn build_session_command(launch: &Launch, session_id: &str, fork: bool) -> String {
    let agent = launch.def();
    let spec = &agent.flags;
    let cmd_at = launch
        .argv
        .iter()
        .position(|w| !is_assignment(w))
        .unwrap_or(launch.argv.len());
    let (prefix, rest) = launch.argv.split_at(cmd_at);
    let program = rest.first().cloned().unwrap_or_else(|| agent.programs[0].to_string());
    let args = rest.get(1..).unwrap_or_default();

    let mut items = parse(args, spec);
    // Codex: `codex resume <id> …` / `codex fork <id> …` — the subcommand and its id go.
    if let Some(pos) = items.iter().position(|item| matches!(item, Item::Positional(_))) {
        if let Item::Positional(p) = &items[pos] {
            if spec.session_subcommands.contains(&p.as_str()) {
                items.remove(pos);
            }
        }
    }
    let flags: Vec<String> = items
        .into_iter()
        .filter_map(|item| match item {
            Item::Flag(group) if !spec.drop.contains(&flag_name(&group[0])) => Some(group),
            _ => None,
        })
        .flatten()
        .collect();

    let mut out: Vec<String> = Vec::new();
    out.push(program);
    match agent.session {
        SessionArgs::Flag { resume, fork: fork_flag } => {
            out.extend(flags);
            out.push(resume.into());
            out.push(session_id.into());
            if let Some(fork_flag) = fork_flag.filter(|_| fork) {
                out.push(fork_flag.into());
            }
        }
        SessionArgs::Subcommand { resume, fork: fork_subcommand } => {
            out.push(if fork { fork_subcommand } else { resume }.into());
            out.push(session_id.into());
            out.extend(flags);
        }
    }
    // Quote only the value of `VAR=value`: a quoted `'VAR=value'` would run as a command.
    let assignments = prefix.iter().map(|a| {
        let (name, value) = a.split_once('=').unwrap();
        format!("{name}={}", shell_words::quote(value))
    });
    assignments.chain([shell_words::join(out)]).collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resume(cmdline: &str, id: &str) -> String {
        build_resume(&detect_launch(cmdline).expect("launch detected"), id)
    }

    #[test]
    fn detects_plain_and_flagged_launches() {
        let l = detect_launch("claude --dangerously-skip-permissions").unwrap();
        assert_eq!(l.agent, "claude");
        assert_eq!(l.argv, vec!["claude", "--dangerously-skip-permissions"]);
        assert_eq!(detect_launch("codex --yolo").unwrap().agent, "codex");
        assert_eq!(detect_launch("~/.local/bin/claude").unwrap().agent, "claude");
    }

    #[test]
    fn keeps_env_assignments_and_ignores_rest_of_list() {
        let l = detect_launch("FOO=1 claude --model opus && echo done").unwrap();
        assert_eq!(l.argv, vec!["FOO=1", "claude", "--model", "opus"]);
    }

    #[test]
    fn ignores_non_agent_and_non_interactive_commands() {
        assert!(detect_launch("ls -la").is_none());
        assert!(detect_launch("claude -p 'summarize'").is_none());
        assert!(detect_launch("claude --version").is_none());
        assert!(detect_launch("claude mcp list").is_none());
        assert!(detect_launch("codex exec 'do it'").is_none());
        assert!(detect_launch("codex login").is_none());
        assert!(detect_launch("echo claude").is_none());
    }

    #[test]
    fn detects_launch_after_a_pre_command() {
        let l = detect_launch("usa && claude --dangerously-skip-permissions").unwrap();
        assert_eq!(l.argv, ["claude", "--dangerously-skip-permissions"]);
        assert_eq!(detect_launch("source env.sh ; codex --yolo").unwrap().agent, "codex");
    }

    #[test]
    fn claude_resume_keeps_bypass_and_model_flags() {
        assert_eq!(
            resume("claude --dangerously-skip-permissions --model opus", "abc"),
            "claude --dangerously-skip-permissions --model opus --resume abc"
        );
    }

    #[test]
    fn claude_resume_drops_prompt_and_old_session_args() {
        assert_eq!(
            resume("claude --dangerously-skip-permissions 'fix the login bug'", "new"),
            "claude --dangerously-skip-permissions --resume new"
        );
        assert_eq!(resume("claude -c --model sonnet", "new"), "claude --model sonnet --resume new");
        assert_eq!(resume("claude --resume old-id --verbose", "new"), "claude --verbose --resume new");
        assert_eq!(resume("claude -r", "new"), "claude --resume new");
    }

    #[test]
    fn claude_resume_keeps_variadic_flag_values() {
        assert_eq!(
            resume("claude --add-dir ../a ../b --permission-mode plan", "x"),
            "claude --add-dir ../a ../b --permission-mode plan --resume x"
        );
    }

    #[test]
    fn claude_resume_preserves_env_prefix_and_quotes() {
        assert_eq!(
            resume("ANTHROPIC_MODEL=opus claude --append-system-prompt 'be brief'", "x"),
            "ANTHROPIC_MODEL=opus claude --append-system-prompt 'be brief' --resume x"
        );
    }

    #[test]
    fn fork_keeps_flags_and_forks() {
        let fork = |cmdline: &str| build_fork(&detect_launch(cmdline).unwrap(), "s1").unwrap();
        assert_eq!(
            fork("claude --dangerously-skip-permissions"),
            "claude --dangerously-skip-permissions --resume s1 --fork-session"
        );
        assert_eq!(fork("codex --yolo"), "codex fork s1 --yolo");
        // A forked tab's own launch line resumes normally later, without forking again.
        assert_eq!(
            resume("claude --dangerously-skip-permissions --resume s0 --fork-session", "s2"),
            "claude --dangerously-skip-permissions --resume s2"
        );
        assert_eq!(resume("codex fork s0 --yolo", "s2"), "codex resume s2 --yolo");
    }

    #[test]
    fn codex_resume_puts_subcommand_first_and_keeps_yolo() {
        assert_eq!(resume("codex --yolo", "s1"), "codex resume s1 --yolo");
        assert_eq!(
            resume("codex --yolo -m gpt-5 'write tests'", "s1"),
            "codex resume s1 --yolo -m gpt-5"
        );
    }

    #[test]
    fn codex_resume_replaces_previous_resume() {
        assert_eq!(resume("codex resume old --yolo", "s2"), "codex resume s2 --yolo");
        assert_eq!(resume("codex --yolo --worktree", "s2"), "codex resume s2 --yolo");
        assert_eq!(resume("codex resume --last --all -s workspace-write", "s2"), "codex resume s2 -s workspace-write");
        assert_eq!(resume("codex --image a.png b.png --yolo", "s2"), "codex resume s2 --yolo");
    }

    #[test]
    fn worktree_flags_are_not_repeated_on_resume() {
        assert_eq!(
            resume("claude --dangerously-skip-permissions --worktree", "s1"),
            "claude --dangerously-skip-permissions --resume s1"
        );
        assert_eq!(resume("claude -w feature --model opus", "s1"), "claude --model opus --resume s1");
    }

    #[test]
    fn gemini_resumes_by_flag_and_cannot_fork() {
        assert_eq!(
            resume("gemini --approval-mode=yolo --worktree -m pro 'fix it'", "u1"),
            "gemini '--approval-mode=yolo' -m pro --resume u1"
        );
        assert_eq!(resume("gemini --resume latest --yolo", "u2"), "gemini --yolo --resume u2");
        assert!(detect_launch("gemini -p 'summarize'").is_none());
        assert!(detect_launch("gemini mcp list").is_none());
        assert!(build_fork(&detect_launch("gemini").unwrap(), "u1").is_none());
    }
}

