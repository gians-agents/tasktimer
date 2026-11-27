use std::path::{Path, PathBuf};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Window, WindowEvent};

use crate::storage::{self, PersistedAppData};

const MAIN_WINDOW_LABEL: &str = "main";

/// Returns `true` when the main window should be shown after setup.
/// A missing, unreadable or incomplete data file defaults to showing the window.
pub fn should_show_main_window_at_startup(start_minimized: bool) -> bool {
    !start_minimized
}

/// Reads `settings.startMinimized` from the persisted data file.
/// Missing or unreadable files default to `false` so the window is shown.
pub fn read_start_minimized(path: &Path) -> bool {
    match storage::load_from_path(path) {
        Ok(Some(PersistedAppData { settings, .. })) => settings.start_minimized,
        Ok(None) | Err(_) => false,
    }
}

pub fn data_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join(storage::DATA_FILE_NAME))
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// A second process launch always reveals the existing window — even if
/// `start_minimized` is enabled or the window is hidden in the tray.
/// That preference only applies to the first process start.
pub fn should_show_main_window_on_second_instance(_start_minimized: bool) -> bool {
    true
}

/// Focus helper used by `tauri-plugin-single-instance`.
/// Always unminimizes, shows and focuses the main window, even when
/// `start_minimized` is set (that preference applies only at first start).
pub fn show_main_window_from_second_instance(app: &AppHandle) {
    let start_minimized = data_file_path(app)
        .map(|path| read_start_minimized(&path))
        .unwrap_or(false);
    if should_show_main_window_on_second_instance(start_minimized) {
        show_main_window(app);
    }
}

pub fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let visible = window.is_visible().unwrap_or(false);
        let minimized = window.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = window.hide();
        } else {
            show_main_window(app);
        }
    }
}

/// Closing the main window (the X button) hides it to the tray instead of quitting,
/// so the process — and a running timer — stay alive. Use "Sair" in the tray menu
/// to exit for real.
///
/// Elapsed time is wall-clock (`lastStartedAt`), so a frozen WebView is corrected
/// when the window is shown again. Overtime toasts/notifications still depend on
/// the JS interval in the webview and may be delayed while the window is hidden.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW_LABEL {
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    setup_tray(app)?;

    let start_minimized = data_file_path(app.handle())
        .map(|path| read_start_minimized(&path))
        .unwrap_or(false);
    if should_show_main_window_at_startup(start_minimized) {
        show_main_window(app.handle());
    }

    Ok(())
}

fn setup_tray(app: &App) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Mostrar/Restaurar", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Minimizar para bandeja", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &hide_item, &separator, &quit_item])?;

    let icon = app.default_window_icon().cloned().ok_or_else(|| {
        tauri::Error::AssetNotFound("ícone padrão do app não encontrado para a bandeja".into())
    })?;

    // On Linux (AppIndicator) a left-click often opens the menu and may not
    // emit TrayIconEvent::Click, so the menu has to be enough by itself.
    let show_menu_on_left_click = cfg!(target_os = "linux");

    let _tray = TrayIconBuilder::with_id("main")
        .icon(icon)
        .menu(&menu)
        .tooltip("TaskTimer")
        .show_menu_on_left_click(show_menu_on_left_click)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "hide" => hide_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // On Linux this event often never fires; the menu already opened on left-click.
            if cfg!(target_os = "linux") {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    use crate::storage::{
        save_to_path, AppSettings, PersistedAppData, Task, TaskStatus, DATA_FILE_NAME, DATA_VERSION,
    };

    fn unique_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tasktimer-tray-{label}-{nanos}"));
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn sample_data(start_minimized: bool) -> PersistedAppData {
        PersistedAppData {
            version: DATA_VERSION,
            tasks: vec![Task {
                id: "task-1".into(),
                name: "Revisar PR".into(),
                estimated_minutes: 45.0,
                elapsed_seconds: 0.0,
                status: TaskStatus::Active,
                is_running: false,
                last_started_at: None,
                overtime_notified: false,
                created_at: "2026-11-26T10:00:00.000Z".into(),
                finished_at: None,
            }],
            settings: AppSettings { start_minimized },
        }
    }

    #[test]
    fn shows_window_by_default_and_hides_when_preference_is_set() {
        assert!(should_show_main_window_at_startup(false));
        assert!(!should_show_main_window_at_startup(true));
    }

    #[test]
    fn second_instance_always_shows_window_even_if_start_minimized() {
        assert!(should_show_main_window_on_second_instance(false));
        assert!(should_show_main_window_on_second_instance(true));
    }

    #[test]
    fn missing_data_file_does_not_start_minimized() {
        let path = unique_dir("missing").join(DATA_FILE_NAME);
        assert!(!read_start_minimized(&path));
        assert!(should_show_main_window_at_startup(read_start_minimized(
            &path
        )));
    }

    #[test]
    fn reads_start_minimized_true_from_persisted_settings() {
        let path = unique_dir("enabled").join(DATA_FILE_NAME);
        save_to_path(&path, &sample_data(true)).unwrap();
        assert!(read_start_minimized(&path));
        assert!(!should_show_main_window_at_startup(read_start_minimized(
            &path
        )));
    }

    #[test]
    fn reads_start_minimized_false_from_persisted_settings() {
        let path = unique_dir("disabled").join(DATA_FILE_NAME);
        save_to_path(&path, &sample_data(false)).unwrap();
        assert!(!read_start_minimized(&path));
        assert!(should_show_main_window_at_startup(read_start_minimized(
            &path
        )));
    }

    #[test]
    fn corrupt_data_file_does_not_start_minimized() {
        let path = unique_dir("corrupt").join(DATA_FILE_NAME);
        fs::write(&path, "{not-valid-json").unwrap();
        assert!(!read_start_minimized(&path));
        assert!(should_show_main_window_at_startup(read_start_minimized(
            &path
        )));
    }
}
