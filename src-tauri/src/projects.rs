//! Finding git repositories under the configured project roots.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::paths::expand_home;

const SKIP: &[&str] = &["node_modules", "target", "vendor", "dist", "build", "Pods", "venv"];

fn scan(dir: &Path, depth: usize, out: &mut Vec<String>) {
    if dir.join(".git").exists() {
        out.push(dir.display().to_string());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            !name.starts_with('.') && !SKIP.contains(&name.as_ref())
        })
        .map(|e| e.path())
        .collect();
    children.sort();
    for child in children {
        scan(&child, depth - 1, out);
    }
}

/// Git repositories under `roots`, searching at most `depth` levels down.
#[tauri::command]
pub async fn scan_projects(roots: Vec<String>, depth: usize) -> Vec<String> {
    let mut out = Vec::new();
    for root in roots {
        scan(Path::new(&expand_home(&root)), depth, &mut out);
    }
    out
}

/// The enclosing git repository of `path`, if any.
#[tauri::command]
pub fn git_root(path: String) -> Option<String> {
    let path = PathBuf::from(expand_home(&path));
    path.ancestors()
        .find(|dir| dir.join(".git").exists())
        .map(|dir| dir.display().to_string())
}

fn git_lines(path: &str, args: &[&str]) -> Option<Vec<String>> {
    let out = Command::new("git").arg("-C").arg(path).args(args).output().ok()?;
    out.status.success()
        .then(|| String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect())
}

/// The root of the linked git worktree containing `path` (a file or folder, possibly not created
/// yet), or None for a main checkout / non-repo.
#[tauri::command]
pub fn worktree_root(path: String) -> Option<String> {
    let path = PathBuf::from(expand_home(&path));
    let dir = path.ancestors().find(|p| p.is_dir())?;
    let lines = git_lines(
        &dir.display().to_string(),
        &["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"],
    )?;
    let [top, git_dir, common_dir] = lines.as_slice() else { return None };
    (git_dir != common_dir).then(|| top.clone())
}

/// Opens `path` in Finder.
#[tauri::command]
pub fn open_in_finder(path: String) -> Result<(), String> {
    let status = Command::new("open").arg(expand_home(&path)).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| format!("Couldn't open {path} in Finder."))
}

/// The branch checked out at `path`, or the short commit when HEAD is detached.
#[tauri::command]
pub fn git_branch(path: String) -> Option<String> {
    let path = expand_home(&path);
    let branch = git_lines(&path, &["branch", "--show-current"])?.into_iter().next().unwrap_or_default();
    if !branch.is_empty() {
        return Some(branch);
    }
    git_lines(&path, &["rev-parse", "--short", "HEAD"])?.into_iter().next()
}

/// Opens the first existing folder of `paths` in VS Code, as its git worktree/repo root when it
/// is in one. Returns the folder that was opened.
#[tauri::command]
pub fn open_in_vscode(paths: Vec<String>) -> Result<String, String> {
    let path = paths
        .iter()
        .map(|p| expand_home(p))
        .find(|p| Path::new(p).is_dir())
        .ok_or("None of the tab's folders exist any more.")?;
    // `--show-toplevel` gives the worktree's own root, not the main checkout's.
    let dir = git_lines(&path, &["rev-parse", "--show-toplevel"])
        .and_then(|lines| lines.into_iter().next())
        .filter(|dir| !dir.is_empty())
        .unwrap_or(path);
    let status = Command::new("open")
        .args(["-b", "com.microsoft.VSCode", &dir])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Visual Studio Code doesn't seem to be installed.".into());
    }
    Ok(dir)
}

/// A file changed in a checkout since its last commit (untracked files included).
#[derive(Serialize, Debug, PartialEq)]
pub struct FileChange {
    /// Relative to the checkout root.
    path: String,
    /// "M", "A", "D" or "?" (untracked).
    status: String,
    added: u32,
    removed: u32,
}

/// Biggest diff sent to the UI.
const DIFF_MAX: usize = 300 * 1024;

fn git_output(dir: &str, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git").arg("-C").arg(dir).args(args).output().ok().map(|out| out.stdout)
}

fn checkout_root(path: &str) -> Option<String> {
    git_lines(&expand_home(path), &["rev-parse", "--show-toplevel"])?.into_iter().next()
}

/// What changed in the checkout containing `path`: `git status` with line counts.
#[tauri::command]
pub async fn git_changes(path: String) -> Result<Vec<FileChange>, String> {
    let root = checkout_root(&path).ok_or("not a git repository")?;
    let status = git_output(&root, &["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])
        .ok_or("git status failed")?;
    let numstat = git_output(&root, &["diff", "--numstat", "-z", "--no-renames", "HEAD"]).unwrap_or_default();
    let mut counts = std::collections::HashMap::new();
    for entry in String::from_utf8_lossy(&numstat).split('\0') {
        let mut parts = entry.splitn(3, '\t');
        if let (Some(added), Some(removed), Some(file)) = (parts.next(), parts.next(), parts.next()) {
            // "-" for binary files.
            counts.insert(file.to_string(), (added.parse().unwrap_or(0), removed.parse().unwrap_or(0)));
        }
    }
    // Other worktrees of the repo can sit inside this checkout (e.g. `.claude/worktrees/…`); their
    // files are theirs, not changes here.
    let others: Vec<String> = git_lines(&root, &["worktree", "list", "--porcelain"])
        .unwrap_or_default()
        .into_iter()
        .filter_map(|l| l.strip_prefix("worktree ").map(str::to_string))
        .filter_map(|wt| wt.strip_prefix(&format!("{root}/")).map(|rel| format!("{rel}/")))
        .collect();
    let mut out = Vec::new();
    for entry in String::from_utf8_lossy(&status).split('\0').filter(|e| e.len() > 3) {
        let (code, file) = entry.split_at(3);
        // Nested repositories show up as a folder ("dir/"), and other worktrees' files are left out.
        if file.ends_with('/') || others.iter().any(|wt| file.starts_with(wt.as_str())) {
            continue;
        }
        let code = code.trim();
        let (added, removed) = match code {
            "??" => (line_count(&Path::new(&root).join(file)), 0),
            _ => counts.get(file).copied().unwrap_or((0, 0)),
        };
        let status = match code {
            "??" => "?",
            c if c.contains('D') => "D",
            c if c.contains('A') => "A",
            _ => "M",
        };
        out.push(FileChange { path: file.to_string(), status: status.into(), added, removed });
    }
    Ok(out)
}

/// Lines in a new text file (0 for binary or very large files).
fn line_count(file: &Path) -> u32 {
    match fs::read(file) {
        Ok(bytes) if bytes.len() <= 2 * 1024 * 1024 && !bytes.contains(&0) => {
            bytes.iter().filter(|&&b| b == b'\n').count() as u32 + u32::from(!bytes.ends_with(b"\n") && !bytes.is_empty())
        }
        _ => 0,
    }
}

/// The diff of one changed file (`file` as listed by `git_changes`), trimmed to a readable size.
#[tauri::command]
pub async fn git_file_diff(path: String, file: String, untracked: bool) -> Result<String, String> {
    let root = checkout_root(&path).ok_or("not a git repository")?;
    let args: &[&str] = if untracked {
        &["diff", "--no-color", "--no-index", "--", "/dev/null", &file]
    } else {
        &["diff", "--no-color", "HEAD", "--", &file]
    };
    let bytes = git_output(&root, args).ok_or("git diff failed")?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.len() > DIFF_MAX {
        let cut = (0..=DIFF_MAX).rev().find(|&i| text.is_char_boundary(i)).unwrap_or(0);
        text.truncate(cut);
        text.push_str("\n… diff truncated (too large to show here)\n");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        assert!(Command::new("git").arg("-C").arg(dir).args(args).status().unwrap().success());
    }

    #[test]
    fn finds_linked_worktree_root_only() {
        let base = std::env::temp_dir().join(format!("quazar-wt-{}", std::process::id()));
        let repo = base.join("repo");
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-q"]);
        git(&repo, &["-c", "user.name=q", "-c", "user.email=q@q", "commit", "-q", "--allow-empty", "-m", "x"]);
        git(&repo, &["worktree", "add", "-q", ".claude/worktrees/feat", "-b", "feat"]);
        let sub = repo.join(".claude/worktrees/feat/sub");
        fs::create_dir_all(&sub).unwrap();

        let root = worktree_root(sub.display().to_string()).map(|p| fs::canonicalize(p).unwrap());
        assert_eq!(root, Some(fs::canonicalize(repo.join(".claude/worktrees/feat")).unwrap()));
        let file = repo.join(".claude/worktrees/feat/sub/new.rs").display().to_string();
        assert_eq!(worktree_root(file).map(|p| fs::canonicalize(p).unwrap()), root);
        assert_eq!(git_branch(sub.display().to_string()).as_deref(), Some("feat"));
        assert_eq!(worktree_root(repo.display().to_string()), None);
        assert_eq!(worktree_root(repo.join("missing/file.rs").display().to_string()), None);
        assert_eq!(worktree_root(base.display().to_string()), None);
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn git_changes_lists_edits_and_new_files() {
        let repo = std::env::temp_dir().join(format!("quazar-changes-{}", std::process::id()));
        fs::create_dir_all(repo.join("src")).unwrap();
        git(&repo, &["init", "-q"]);
        fs::write(repo.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["-c", "user.name=q", "-c", "user.email=q@q", "commit", "-q", "-m", "x"]);
        fs::write(repo.join("a.txt"), "one\n2\nthree\nfour\n").unwrap();
        fs::write(repo.join("src/new file.rs"), "fn main() {}\nlet x = 1;").unwrap();
        // A worktree inside the checkout, with a change of its own: not a change here.
        git(&repo, &["worktree", "add", "-q", ".claude/worktrees/feat", "-b", "feat"]);
        fs::write(repo.join(".claude/worktrees/feat/a.txt"), "other\n").unwrap();
        let path = repo.display().to_string();

        let mut changes = tauri::async_runtime::block_on(git_changes(path.clone())).unwrap();
        changes.sort_by(|a, b| a.path.cmp(&b.path));
        let summary: Vec<_> = changes.iter().map(|c| (c.path.as_str(), c.status.as_str(), c.added, c.removed)).collect();
        assert_eq!(summary, [("a.txt", "M", 2, 1), ("src/new file.rs", "?", 2, 0)]);

        let diff = tauri::async_runtime::block_on(git_file_diff(path.clone(), "src/new file.rs".into(), true)).unwrap();
        assert!(diff.contains("+let x = 1;"));
        let diff = tauri::async_runtime::block_on(git_file_diff(path, "a.txt".into(), false)).unwrap();
        assert!(diff.contains("-two") && diff.contains("+four"));
        fs::remove_dir_all(&repo).unwrap();
    }
}
