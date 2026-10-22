//! Where Quazar keeps its files, and installing the shell-integration/hook scripts there.

use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub struct Paths {
    pub state_file: PathBuf,
    pub config_file: PathBuf,
    pub socket: PathBuf,
    pub zsh_dir: PathBuf,
    pub hook_bin: PathBuf,
}

const ZSH_FILES: [(&str, &str); 4] = [
    (".zshenv", include_str!("../integration/zsh/.zshenv")),
    (".zprofile", include_str!("../integration/zsh/.zprofile")),
    (".zshrc", include_str!("../integration/zsh/.zshrc")),
    (".zlogin", include_str!("../integration/zsh/.zlogin")),
];
const HOOK_SCRIPT: &str = include_str!("../integration/quazar-hook");

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

pub fn expand_home(path: &str) -> String {
    match path.strip_prefix('~') {
        Some(rest) if rest.is_empty() || rest.starts_with('/') => {
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
            socket: data_dir.join("quazar.sock"),
            zsh_dir: data_dir.join("shell").join("zsh"),
            hook_bin: data_dir.join("bin").join("quazar-hook"),
        }
    }

    /// (Re)writes the integration scripts on every start so they match this app version.
    pub fn install_integration(&self) -> std::io::Result<()> {
        fs::create_dir_all(&self.zsh_dir)?;
        for (name, contents) in ZSH_FILES {
            write_atomic(&self.zsh_dir.join(name), contents.as_bytes())?;
        }
        fs::create_dir_all(self.hook_bin.parent().unwrap())?;
        write_atomic(&self.hook_bin, HOOK_SCRIPT.as_bytes())?;
        fs::set_permissions(&self.hook_bin, fs::Permissions::from_mode(0o755))
    }
}
