use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::overtime;
use crate::storage::{self, PersistedAppData};
use crate::tray;

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

#[tauri::command]
pub fn get_app_info(app: AppHandle) -> AppInfo {
    let name = app
        .config()
        .product_name
        .clone()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| app.package_info().name.clone());
    let version = app.package_info().version.to_string();
    AppInfo { name, version }
}

fn data_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("não foi possível resolver o diretório de dados: {err}"))?;
    Ok(dir.join(storage::DATA_FILE_NAME))
}

#[tauri::command]
pub fn load_app_data(app: AppHandle) -> Result<Option<PersistedAppData>, String> {
    let path = data_path(&app)?;
    let data = storage::load_from_path(&path).map_err(|err| err.to_string())?;
    if let Some(payload) = &data {
        overtime::sync_watch(&app, &payload.tasks);
    }
    Ok(data)
}

#[tauri::command]
pub fn save_app_data(app: AppHandle, mut payload: PersistedAppData) -> Result<(), String> {
    let path = data_path(&app)?;
    // Sync first so raising the estimate can forget a previous claim, then
    // merge flags still claimed (a stale payload from a frozen webview).
    // The file lock covers sync + merge + write so the watchdog's
    // read-modify-write cannot interleave.
    storage::with_data_file_lock(|| {
        overtime::sync_and_merge_for_save(&app, &mut payload.tasks);
        storage::save_to_path(&path, &payload)
    })
    .map_err(|err| err.to_string())?;
    // Future windows / tray can subscribe; the current UI already has the latest state.
    let _ = app.emit("app-data-changed", &payload);
    Ok(())
}

/// Shows a native overtime notification, at most once per crossing of the estimate.
/// The body is built from the Rust snapshot for `task_id`, not from webview-supplied
/// name or estimate. Returns `true` when a new notification was displayed, `false`
/// if this task was already notified, or if it is not in the snapshot.
#[tauri::command]
pub fn notify_overtime(app: AppHandle, task_id: String) -> bool {
    overtime::claim_and_show(&app, &task_id)
}

#[tauri::command]
pub fn minimize_to_tray(app: AppHandle) -> bool {
    tray::hide_main_window(&app);
    true
}
