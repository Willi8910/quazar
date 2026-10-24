//! Where Quazar keeps its files, and installing the shell-integration/hook scripts there.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct Paths {
    pub state_file: PathBuf,
    pub config_file: PathBuf,
    /// Where shells and agent hooks send events: a Unix socket, or a named pipe on Windows.
    pub socket: PathBuf,
    pub zsh_dir: PathBuf,
    /// What agent hooks run: the `quazar-hook` script, or Quazar itself (`quazar hook …`) on Windows.
    pub hook_bin: PathBuf,
}

#[cfg(unix)]
const ZSH_FILES: [(&str, &str); 4] = [
    (".zshenv", include_str!("../integration/zsh/.zshenv")),
    (".zprofile", include_str!("../integration/zsh/.zprofile")),
    (".zshrc", include_str!("../integration/zsh/.zshrc")),
    (".zlogin", include_str!("../integration/zsh/.zlogin")),
];
#[cfg(unix)]
const HOOK_SCRIPT: &str = include_str!("../integration/quazar-hook");

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/"))
}

pub fn expand_home(path: &str) -> String {
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with(['/', '\\']) => {
            format!("{}{}", home_dir().display(), rest)
        }
        _ => path.to_string(),
    }
}

/// Writes `contents` to `path` via a temp file + rename, so a crash never leaves a torn file.
pub fn write_atomic(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("tmp");
    let mut file = fs::File::create(&tmp)?;
    file.write_all(contents)?;
    file.sync_all()?;
    fs::rename(tmp, path)
}

impl Paths {
    pub fn new(data_dir: PathBuf) -> Paths {
        Paths {
            state_file: data_dir.join("state.json"),
            config_file: data_dir.join("config.json"),
            socket: if cfg!(windows) { PathBuf::from(pipe_name()) } else { data_dir.join("quazar.sock") },
            zsh_dir: data_dir.join("shell").join("zsh"),
            hook_bin: if cfg!(windows) {
                std::env::current_exe().unwrap_or_default()
            } else {
                data_dir.join("bin").join("quazar-hook")
            },
        }
    }

    /// (Re)writes the integration scripts on every start so they match this app version.
    #[cfg(unix)]
    pub fn install_integration(&self) -> std::io::Result<()> {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(&self.zsh_dir)?;
        for (name, contents) in ZSH_FILES {
            write_atomic(&self.zsh_dir.join(name), contents.as_bytes())?;
        }
        fs::create_dir_all(self.hook_bin.parent().unwrap())?;
        write_atomic(&self.hook_bin, HOOK_SCRIPT.as_bytes())?;
        fs::set_permissions(&self.hook_bin, fs::Permissions::from_mode(0o755))
    }

    #[cfg(windows)]
    pub fn install_integration(&self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The per-user named pipe Quazar listens on (Windows).
fn pipe_name() -> String {
    let user: String = std::env::var("USERNAME")
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    format!(r"\\.\pipe\quazar-{user}")
}
