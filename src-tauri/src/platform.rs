//! Starting other programs the same way on macOS and Windows.

use std::ffi::OsStr;
use std::process::Command;

/// A command for a helper program (git, ps, …). On Windows it gets no console window: Quazar is a
/// GUI app, so each one would otherwise flash a window.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Shows a folder in Finder or Explorer.
pub fn reveal(path: &str) -> Result<(), String> {
    if cfg!(windows) {
        // Explorer's exit code says nothing about success.
        Command::new("explorer").arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
    } else {
        let status = Command::new("open").arg(path).status().map_err(|e| e.to_string())?;
        status.success().then_some(()).ok_or_else(|| format!("Couldn't open {path} in Finder."))
    }
}

/// Opens a folder in VS Code; false when it doesn't seem to be installed.
pub fn open_in_vscode(dir: &str) -> std::io::Result<bool> {
    let status = if cfg!(windows) {
        // `code` is a .cmd script, so it needs cmd to run.
        command("cmd").args(["/C", "code"]).arg(dir).status()?
    } else {
        Command::new("open").args(["-b", "com.microsoft.VSCode", dir]).status()?
    };
    Ok(status.success())
}
