// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Agent hooks run Quazar itself on Windows (no `sh`/`nc` there); it forwards the hook and exits.
    if cfg!(windows) && quazar_lib::hook_mode() {
        return;
    }
    quazar_lib::run()
}
