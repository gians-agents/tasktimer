use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;

use crate::storage::{self, PersistedAppData};

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
    storage::load_from_path(&path).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn save_app_data(app: AppHandle, payload: PersistedAppData) -> Result<(), String> {
    let path = data_path(&app)?;
    storage::save_to_path(&path, &payload).map_err(|err| err.to_string())?;
    // Future windows / tray can subscribe; the current UI already has the latest state.
    let _ = app.emit("app-data-changed", &payload);
    Ok(())
}
