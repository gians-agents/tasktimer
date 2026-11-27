mod commands;
mod storage;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            tray::setup(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::load_app_data,
            commands::save_app_data,
            commands::minimize_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
