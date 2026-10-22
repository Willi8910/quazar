//! Extra windows. Each shows its own tabs; their screens move between windows through handoffs.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, State, WebviewWindowBuilder};

/// Serialized terminal screens of tabs on their way to another window, by tab id.
#[derive(Default)]
pub struct Handoffs(Mutex<HashMap<String, String>>);

#[tauri::command]
pub fn handoff_put(handoffs: State<'_, Handoffs>, tab_id: String, data: String) {
    handoffs.0.lock().unwrap().insert(tab_id, data);
}

#[tauri::command]
pub fn handoff_take(handoffs: State<'_, Handoffs>, tab_id: String) -> Option<String> {
    handoffs.0.lock().unwrap().remove(&tab_id)
}

/// Opens (or focuses) the window `label`, set up like the main window.
#[tauri::command]
pub fn open_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut config = app.config().app.windows.first().cloned().ok_or("no window config")?;
    config.label = label;
    let mut builder = WebviewWindowBuilder::from_config(&app, &config).map_err(|e| e.to_string())?;
    // Cascade from the focused window so the new one doesn't hide it exactly.
    let from = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false));
    if let Some((pos, scale)) = from.and_then(|w| Some((w.outer_position().ok()?, w.scale_factor().ok()?))) {
        let pos = pos.to_logical::<f64>(scale);
        builder = builder.position(pos.x + 40.0, pos.y + 40.0);
    }
    builder
        .build()
        .map(|_| ())
        .map_err(|e| e.to_string())
}
