use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

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

fn with_parent_dialog(app: &AppHandle) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let mut builder = app.dialog().file();
    if let Some(window) = app.get_webview_window("main") {
        builder = builder.set_parent(&window);
    }
    builder
}

fn dialog_path(file: tauri_plugin_dialog::FilePath) -> Result<std::path::PathBuf, String> {
    file.simplified()
        .into_path()
        .map_err(|err| format!("caminho inválido: {err}"))
}

/// Opens the native Save dialog and writes `contents` to the chosen path.
/// Returns `Ok(None)` when the user cancels, or `Ok(Some(path))` on success.
#[tauri::command]
pub async fn export_json(
    app: AppHandle,
    contents: String,
    default_file_name: String,
) -> Result<Option<String>, String> {
    let file_name = storage::sanitize_export_file_name(&default_file_name);
    let Some(file) = with_parent_dialog(&app)
        .set_title("Exportar JSON")
        .add_filter("JSON", &["json"])
        .set_file_name(&file_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = dialog_path(file)?;
    let written = storage::write_export_json(&path, &contents).map_err(|err| err.to_string())?;
    Ok(Some(written.to_string_lossy().into_owned()))
}

/// Opens the native Open dialog and reads the chosen JSON file.
/// Returns `Ok(None)` when the user cancels.
#[tauri::command]
pub async fn import_json(app: AppHandle) -> Result<Option<String>, String> {
    let Some(file) = with_parent_dialog(&app)
        .set_title("Importar JSON")
        .add_filter("JSON", &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = dialog_path(file)?;
    storage::read_import_json(&path)
        .map(Some)
        .map_err(|err| err.to_string())
}
