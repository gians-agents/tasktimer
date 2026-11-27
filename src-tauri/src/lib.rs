mod commands;
mod overtime;
mod storage;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The single-instance plugin must be registered first so a second
    // process is detected before tray setup (or any later plugin) runs.
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window_from_second_instance(app);
        }));
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            tray::setup(app)?;
            overtime::setup(app)?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::load_app_data,
            commands::save_app_data,
            commands::minimize_to_tray,
            commands::notify_overtime,
            commands::export_json,
            commands::import_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
