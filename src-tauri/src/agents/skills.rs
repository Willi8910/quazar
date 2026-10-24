//! Finding the skills and custom slash commands an agent offers in a folder: the user's own and the
//! project's. Read from disk only when asked (the console's skills menu opens).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::paths::home_dir;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    /// What follows the slash, e.g. "create-jira-ticket" or "prompts:review".
    pub name: String,
    pub description: String,
    /// "project" (the repo's own) or "user" (the user's folder).
    pub scope: &'static str,
    /// Last change, ms since the epoch.
    pub modified: u64,
}

/// Longest description kept.
const DESCRIPTION_MAX: usize = 240;

fn modified(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

fn clip(text: &str) -> String {
    let text = text.trim().trim_matches(['"', '\'']);
    match text.char_indices().nth(DESCRIPTION_MAX) {
        Some((i, _)) => format!("{}…", &text[..i]),
        None => text.to_string(),
    }
}

/// `key: value` pairs of a Markdown file's YAML front matter, and the text after it.
fn front_matter(text: &str) -> (Vec<(&str, &str)>, &str) {
    let Some(rest) = text.strip_prefix("---") else { return (Vec::new(), text) };
    let Some(end) = rest.find("\n---") else { return (Vec::new(), text) };
    let pairs = rest[..end]
        .lines()
        .filter_map(|line| line.split_once(':'))
        .map(|(k, v)| (k.trim(), v.trim()))
        .collect();
    let body = rest[end + 4..].split_once('\n').map_or("", |(_, body)| body);
    (pairs, body)
}

/// A Markdown skill or command's name (front matter) and description (front matter, else its first line).
fn describe_markdown(text: &str) -> (Option<String>, String) {
    let (pairs, body) = front_matter(text);
    let field = |key: &str| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| clip(v)).filter(|v| !v.is_empty());
    let first_line = body.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('#')).map(clip);
    (field("name"), field("description").or(first_line).unwrap_or_default())
}

/// Skills as folders with a `SKILL.md` (Claude Code's `skills/`).
pub fn skill_folders(dir: &Path, scope: &'static str) -> Vec<Skill> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let file = entry.path().join("SKILL.md");
        let Ok(text) = fs::read_to_string(&file) else { continue };
        let (name, description) = describe_markdown(&text);
        let name = name.unwrap_or_else(|| entry.file_name().to_string_lossy().into_owned());
        out.push(Skill { name, description, scope, modified: modified(&file) });
    }
    out
}

/// Command files under `dir` with extension `ext`, named by their path (`a/b.md` is `prefix` + "a:b").
pub fn command_files(dir: &Path, ext: &str, prefix: &str, scope: &'static str) -> Vec<Skill> {
    let mut out = Vec::new();
    let mut dirs = vec![dir.to_path_buf()];
    while let Some(current) = dirs.pop() {
        for entry in fs::read_dir(&current).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
                continue;
            }
            if path.extension().is_none_or(|e| e != ext) {
                continue;
            }
            let Ok(rel) = path.with_extension("").strip_prefix(dir).map(Path::to_path_buf) else { continue };
            let name = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join(":");
            let text = fs::read_to_string(&path).unwrap_or_default();
            let description = if ext == "toml" { toml_description(&text) } else { describe_markdown(&text).1 };
            out.push(Skill { name: format!("{prefix}{name}"), description, scope, modified: modified(&path) });
        }
    }
    out
}

/// The `description = "…"` of a Gemini command file.
fn toml_description(text: &str) -> String {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(k, _)| k.trim() == "description")
        .map(|(_, v)| clip(v))
        .unwrap_or_default()
}

/// `cwd` and its parents up to the repository root (or just `cwd` outside a repository), where
/// project skills live. Never the home folder, whose skills are the user's.
pub fn project_dirs(cwd: &Path) -> Vec<PathBuf> {
    let home = home_dir();
    let mut out = Vec::new();
    for dir in cwd.ancestors() {
        if dir == home {
            break;
        }
        out.push(dir.to_path_buf());
        if dir.join(".git").exists() {
            return out;
        }
    }
    out.truncate(1);
    out
}

/// Drops later skills with a name seen before (a project's skill wins over the user's of the same name).
pub fn dedupe(skills: Vec<Skill>) -> Vec<Skill> {
    let mut seen = std::collections::HashSet::new();
    skills.into_iter().filter(|s| seen.insert(s.name.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_front_matter() {
        let text = "---\nname: ship-it\ndescription: \"Ships it\"\n---\n\n# Ship\nBody";
        assert_eq!(describe_markdown(text), (Some("ship-it".into()), "Ships it".into()));
    }

    #[test]
    fn falls_back_to_the_first_line() {
        assert_eq!(describe_markdown("# Title\n\nReview the diff.\n"), (None, "Review the diff.".into()));
    }

    #[test]
    fn names_nested_commands_with_colons() {
        let dir = std::env::temp_dir().join(format!("quazar-skills-{}", std::process::id()));
        fs::create_dir_all(dir.join("git")).unwrap();
        fs::write(dir.join("git/sync.md"), "Sync with main").unwrap();
        fs::write(dir.join("review.toml"), "description = \"Review code\"\nprompt = \"…\"").unwrap();
        fs::write(dir.join("notes.txt"), "not a command").unwrap();
        let md = command_files(&dir, "md", "", "user");
        assert_eq!((md[0].name.as_str(), md[0].description.as_str()), ("git:sync", "Sync with main"));
        let toml = command_files(&dir, "toml", "", "user");
        assert_eq!((toml[0].name.as_str(), toml[0].description.as_str()), ("review", "Review code"));
        fs::remove_dir_all(dir).unwrap();
    }
}
