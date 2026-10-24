mod agents;
mod events;
mod hooks;
mod metrics;
mod notifications;
mod paths;
mod platform;
mod projects;
mod pty;
mod store;
mod update;
mod windows;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent, Wry};
use tauri_plugin_window_state::StateFlags;

use paths::Paths;
use pty::Ptys;

/// Set once the UI has confirmed quitting (it warns when agents are still working).
#[derive(Default)]
pub(crate) struct QuitAllowed(pub(crate) AtomicBool);

#[tauri::command]
fn quit_app(app: AppHandle, allowed: State<'_, QuitAllowed>) {
    allowed.0.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// Frontend errors/logs, printed to the terminal running the app.
#[tauri::command]
fn js_log(level: String, message: String) {
    eprintln!("[ui:{level}] {message}");
}

#[tauri::command]
fn build_resume_command(agent: String, argv: Vec<String>, session_id: String) -> Option<String> {
    Some(agents::build_resume(&agents::Launch::new(&agent, argv)?, &session_id))
}

#[tauri::command]
fn build_fork_command(agent: String, argv: Vec<String>, session_id: String) -> Option<String> {
    agents::build_fork(&agents::Launch::new(&agent, argv)?, &session_id)
}

#[tauri::command]
fn detect_launch(cmdline: String) -> Option<agents::Launch> {
    agents::detect_launch(&cmdline)
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accel: &str| {
        MenuItemBuilder::with_id(id, label).accelerator(accel).build(app)
    };

    let app_menu = SubmenuBuilder::new(app, "Quazar")
        .about(None)
        .separator()
        .item(&item("settings", "Settings…", "CmdOrCtrl+,")?)
        .item(&MenuItemBuilder::with_id("install-hooks", "Install Agent Hooks…").build(app)?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit Quazar", "CmdOrCtrl+Q")?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let mut tabs = SubmenuBuilder::new(app, "Tabs")
        .item(&item("new-tab", "New Tab…", "CmdOrCtrl+T")?)
        .item(&item("new-agent", "New Agent…", "CmdOrCtrl+N")?)
        .item(&item("close-tab", "Close Tab", "CmdOrCtrl+W")?)
        .item(&item("rename-tab", "Rename Tab…", "CmdOrCtrl+Shift+R")?)
        .separator()
        .item(&item("next-tab", "Next Tab", "CmdOrCtrl+Shift+]")?)
        .item(&item("prev-tab", "Previous Tab", "CmdOrCtrl+Shift+[")?)
        .item(&item("next-attention", "Next Agent Needing You", "CmdOrCtrl+J")?)
        .separator();
    for n in 1..=9 {
        tabs = tabs.item(&item(&format!("tab-{n}"), &format!("Tab {n}"), &format!("CmdOrCtrl+{n}"))?);
    }
    let tabs_menu = tabs.build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item("palette", "Command Palette…", "CmdOrCtrl+K")?)
        .item(&item("toggle-sidebar", "Toggle Sidebar", "CmdOrCtrl+B")?)
        .item(&item("sidebar-side", "Move Sidebar Left/Right", "CmdOrCtrl+Shift+B")?)
        .separator()
        .item(&item("zoom-in", "Bigger Text", "CmdOrCtrl+=")?)
        .item(&item("zoom-out", "Smaller Text", "CmdOrCtrl+-")?)
        .item(&item("zoom-reset", "Actual Size", "CmdOrCtrl+0")?)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window").minimize().maximize().build()?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &tabs_menu, &view_menu, &window_menu])
}

/// Runs `quazar hook <agent> <event>` (see [`events::forward_hook`]) and returns true; false when
/// Quazar wasn't started that way.
pub fn hook_mode() -> bool {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [mode, agent, event] = args.as_slice() else { return false };
    if mode != "hook" {
        return false;
    }
    events::forward_hook(agent, event);
    true
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Not visibility: the main window may have been hidden (closed while others were open).
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Ptys::default())
        .manage(QuitAllowed::default())
        .manage(windows::Handoffs::default())
        .setup(|app| {
            let paths = Paths::new(app.path().app_data_dir()?);
            paths.install_integration()?;
            events::listen(app.handle().clone(), &paths.socket)?;
            notifications::install(app.handle());
            app.manage(paths);
            // Windows gets no menu bar: its Ctrl shortcuts would take keys from the shell; the frontend
            // handles Ctrl+Shift shortcuts there instead.
            #[cfg(target_os = "macos")]
            app.set_menu(build_menu(app.handle())?)?;
            app.on_menu_event(|app, event| {
                // Only the window in front acts on menu commands (⌘T opens one tab, not one per window).
                let windows = app.webview_windows();
                let target = windows.values().find(|w| w.is_focused().unwrap_or(false)).or(windows.get("main"));
                if let Some(window) = target {
                    let _ = window.emit_to(window.label(), "menu", event.id().as_ref());
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                // Its tabs go back to the main window, even if it closed before saying so.
                if window.label() != "main" {
                    let _ = window.emit_to("main", "window-gone", window.label());
                }
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !window.state::<QuitAllowed>().0.load(Ordering::SeqCst) {
                    api.prevent_close();
                    // Closing the last window quits (the main window runs that); any other window first
                    // hands its tabs to one that stays (the main window then only hides, as it keeps the state).
                    let others = window
                        .app_handle()
                        .webview_windows()
                        .into_values()
                        .any(|w| w.label() != window.label() && w.is_visible().unwrap_or(false));
                    if others {
                        let _ = window.emit_to(window.label(), "window-close", ());
                    } else {
                        let _ = window.emit_to("main", "quit-requested", ());
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            agents::agent_list,
            agents::list_sessions,
            agents::list_skills,
            js_log,
            build_resume_command,
            build_fork_command,
            detect_launch,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_terminate,
            pty::pty_attach,
            pty::pty_detach,
            windows::open_window,
            windows::handoff_put,
            windows::handoff_take,
            metrics::process_metrics,
            update::update_status,
            notifications::notification_permission,
            notifications::notify,
            notifications::request_notification_permission,
            notifications::open_notification_settings,
            update::app_info,
            update::update_build,
            update::update_install,
            metrics::tab_processes,
            metrics::stop_process,
            store::load_state,
            store::save_state,
            store::load_config,
            store::save_config,
            store::config_path,
            hooks::hooks_status,
            hooks::install_hooks,
            projects::scan_projects,
            projects::git_root,
            projects::open_in_vscode,
            projects::worktree_root,
            projects::git_branch,
            projects::git_changes,
            projects::git_file_diff,
            projects::open_in_finder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Quazar");

    app.run(|app, event| {
        // Dock icon clicked with no window showing: bring back the main window.
        #[cfg(target_os = "macos")]
        if let RunEvent::Reopen { has_visible_windows: false, .. } = event {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.set_focus();
            }
            return;
        }
        if let RunEvent::ExitRequested { code: None, api, .. } = event {
            // Dock "Quit", logout, etc. — let the UI decide (it warns about working agents).
            if !app.state::<QuitAllowed>().0.load(Ordering::SeqCst) {
                api.prevent_exit();
                let _ = app.emit_to("main", "quit-requested", ());
            }
        }
    });
}
