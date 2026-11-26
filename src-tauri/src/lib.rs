mod commands;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::load_app_data,
            commands::save_app_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
