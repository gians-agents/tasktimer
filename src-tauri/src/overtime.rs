use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{App, AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

use crate::storage::{self, PersistedAppData, Task};
use crate::tray;

pub const OVERTIME_TITLE: &str = "Tempo estimado ultrapassado";
pub const OVERTIME_EVENT: &str = "overtime-detected";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertimeEvent {
    pub id: String,
    pub name: String,
    pub estimated_minutes: f64,
}

#[derive(Debug, Default)]
pub struct OvertimeWatch {
    tasks: Vec<Task>,
    notified_ids: HashSet<String>,
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Wall-clock elapsed time, matching `getLiveElapsedSeconds` in the frontend.
pub fn live_elapsed_seconds(task: &Task, now_ms: i64) -> f64 {
    if !task.is_running {
        return task.elapsed_seconds;
    }
    match task.last_started_at {
        Some(started) => {
            let delta = (now_ms.saturating_sub(started).max(0) / 1000) as f64;
            task.elapsed_seconds + delta
        }
        None => task.elapsed_seconds,
    }
}

pub fn is_currently_overtime(task: &Task, now_ms: i64) -> bool {
    task.is_running && live_elapsed_seconds(task, now_ms) >= task.estimated_minutes * 60.0
}

impl OvertimeWatch {
    /// Refresh the snapshot from persisted/UI state.
    ///
    /// Already-flagged tasks are recorded as notified. A flag that was cleared
    /// (for example after raising the estimate) is forgotten only when the task
    /// is no longer running or is no longer past the estimate — so a persist
    /// that still has the old `overtime_notified: false` while the watchdog
    /// already fired does not cause a second notification.
    pub fn sync_from_data(&mut self, tasks: &[Task], now_ms: i64) {
        self.tasks = tasks.to_vec();
        let current_ids: HashSet<&str> = self.tasks.iter().map(|task| task.id.as_str()).collect();
        self.notified_ids
            .retain(|id| current_ids.contains(id.as_str()));

        for task in &self.tasks {
            if task.overtime_notified {
                self.notified_ids.insert(task.id.clone());
            } else if self.notified_ids.contains(&task.id)
                && (!task.is_running || !is_currently_overtime(task, now_ms))
            {
                self.notified_ids.remove(&task.id);
            }
        }
    }

    /// Returns `true` when this id has not been notified yet for the current crossing.
    pub fn claim(&mut self, task_id: &str) -> bool {
        self.notified_ids.insert(task_id.to_string())
    }

    /// Tasks that have just crossed the estimate and have not been notified.
    pub fn take_due(&mut self, now_ms: i64) -> Vec<OvertimeEvent> {
        let mut due = Vec::new();
        for task in &self.tasks {
            if task.overtime_notified || self.notified_ids.contains(&task.id) {
                continue;
            }
            if is_currently_overtime(task, now_ms) {
                due.push(OvertimeEvent {
                    id: task.id.clone(),
                    name: task.name.clone(),
                    estimated_minutes: task.estimated_minutes,
                });
            }
        }
        for event in &due {
            self.notified_ids.insert(event.id.clone());
            if let Some(task) = self.tasks.iter_mut().find(|task| task.id == event.id) {
                task.overtime_notified = true;
            }
        }
        due
    }
}

pub fn overtime_body(task_name: &str, estimated_minutes: f64) -> String {
    let minutes = if estimated_minutes.fract() == 0.0 {
        format!("{:.0}", estimated_minutes)
    } else {
        estimated_minutes.to_string()
    };
    format!("\"{task_name}\" passou de {minutes} min estimados.")
}

pub fn sync_watch(app: &AppHandle, tasks: &[Task]) {
    if let Some(watch) = app.try_state::<Mutex<OvertimeWatch>>() {
        if let Ok(mut guard) = watch.lock() {
            guard.sync_from_data(tasks, now_ms());
        }
    }
}

/// Sets `overtime_notified` on tasks already claimed in `notified_ids`.
/// Returns whether any flag was newly set.
pub fn apply_notified_flags(tasks: &mut [Task], notified_ids: &HashSet<String>) -> bool {
    let mut changed = false;
    for task in tasks {
        if notified_ids.contains(&task.id) && !task.overtime_notified {
            task.overtime_notified = true;
            changed = true;
        }
    }
    changed
}

/// Same order as `save_app_data`: sync the watch from the payload first
/// (so raising the estimate can forget a previous claim), then apply
/// remaining claims onto a stale payload.
pub fn sync_then_merge_flags(watch: &mut OvertimeWatch, tasks: &mut [Task], now_ms: i64) {
    watch.sync_from_data(tasks, now_ms);
    if apply_notified_flags(tasks, &watch.notified_ids) {
        watch.sync_from_data(tasks, now_ms);
    }
}

/// Syncs then merges claimed flags onto a frontend payload. Must be called
/// while holding the data-file lock, before writing the file.
pub fn sync_and_merge_for_save(app: &AppHandle, tasks: &mut [Task]) {
    if let Some(watch) = app.try_state::<Mutex<OvertimeWatch>>() {
        if let Ok(mut guard) = watch.lock() {
            sync_then_merge_flags(&mut guard, tasks, now_ms());
        }
    }
}

/// Loads the data file, sets claimed overtime flags, and writes it back.
/// Holds the shared data-file lock for the whole read-modify-write.
/// Returns `true` when the file was updated.
pub fn persist_flags_to_path(path: &std::path::Path, notified_ids: &HashSet<String>) -> bool {
    storage::with_data_file_lock(|| persist_flags_to_path_locked(path, notified_ids))
}

fn persist_flags_to_path_locked(path: &std::path::Path, notified_ids: &HashSet<String>) -> bool {
    let mut data = match storage::load_from_path(path) {
        Ok(Some(data)) => data,
        Ok(None) => {
            eprintln!(
                "[TaskTimer] Falha ao persistir flag de overtime: arquivo de dados ausente ({})",
                path.display()
            );
            return false;
        }
        Err(error) => {
            eprintln!("[TaskTimer] Falha ao ler dados para persistir flag de overtime: {error}");
            return false;
        }
    };
    if !apply_notified_flags(&mut data.tasks, notified_ids) {
        return false;
    }
    if let Err(error) = storage::save_to_path(path, &data) {
        eprintln!("[TaskTimer] Falha ao gravar flag de overtime: {error}");
        return false;
    }
    true
}

/// Persists claimed overtime flags so a tray-quit (or crash after the tick)
/// does not lose the "already notified" state and fire again on the next launch.
///
/// Ids are read *after* taking the file lock so a concurrent `save_app_data`
/// (for example after raising the estimate) is already visible.
pub fn persist_notified_flags(app: &AppHandle) {
    let Some(path) = tray::data_file_path(app) else {
        return;
    };
    let updated = storage::with_data_file_lock(|| {
        let Some(ids) = app
            .try_state::<Mutex<OvertimeWatch>>()
            .and_then(|watch| watch.lock().ok().map(|guard| guard.notified_ids.clone()))
        else {
            return false;
        };
        if ids.is_empty() {
            return false;
        }
        persist_flags_to_path(&path, &ids)
    });
    if updated {
        if let Ok(Some(data)) = storage::load_from_path(&path) {
            sync_watch(app, &data.tasks);
        }
    }
}

/// Looks up `task_id` in the watchdog snapshot and shows a native notification
/// at most once per crossing. Name and estimate come from the snapshot, not
/// from the webview.
pub fn claim_and_show(app: &AppHandle, task_id: &str) -> bool {
    let Some(watch) = app.try_state::<Mutex<OvertimeWatch>>() else {
        return false;
    };
    let Ok(mut guard) = watch.lock() else {
        return false;
    };
    let Some(event) = guard
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .map(|task| OvertimeEvent {
            id: task.id.clone(),
            name: task.name.clone(),
            estimated_minutes: task.estimated_minutes,
        })
    else {
        return false;
    };
    if !guard.claim(&event.id) {
        return false;
    }
    if let Some(task) = guard.tasks.iter_mut().find(|task| task.id == event.id) {
        task.overtime_notified = true;
    }
    drop(guard);
    show_overtime_notification(app, &event.name, event.estimated_minutes);
    persist_notified_flags(app);
    true
}

pub fn show_overtime_notification(app: &AppHandle, task_name: &str, estimated_minutes: f64) {
    let body = overtime_body(task_name, estimated_minutes);
    if let Err(error) = app
        .notification()
        .builder()
        .title(OVERTIME_TITLE)
        .body(&body)
        .show()
    {
        eprintln!("[TaskTimer] Falha ao exibir notificação nativa: {error}");
    }
}

fn tick(app: &AppHandle) {
    let due = match app.try_state::<Mutex<OvertimeWatch>>() {
        Some(watch) => match watch.lock() {
            Ok(mut guard) => guard.take_due(now_ms()),
            Err(_) => return,
        },
        None => return,
    };
    if due.is_empty() {
        return;
    }
    for event in &due {
        show_overtime_notification(app, &event.name, event.estimated_minutes);
        let _ = app.emit(OVERTIME_EVENT, event);
    }
    persist_notified_flags(app);
}

pub fn setup(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    let mut watch = OvertimeWatch::default();
    if let Some(path) = tray::data_file_path(app.handle()) {
        if let Ok(Some(PersistedAppData { tasks, .. })) = storage::load_from_path(&path) {
            watch.sync_from_data(&tasks, now_ms());
        }
    }
    app.manage(Mutex::new(watch));

    let handle = app.handle().clone();
    app.notification().on_action({
        let handle = handle.clone();
        move |_action| {
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                tray::show_main_window(&app);
            });
        }
    })?;

    std::thread::Builder::new()
        .name("tasktimer-overtime-watch".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(1));
            tick(&handle);
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::TaskStatus;

    fn running(elapsed: f64, started_at: i64, estimated: f64, notified: bool) -> Task {
        Task {
            id: "t-1".into(),
            name: "Revisar PR".into(),
            estimated_minutes: estimated,
            elapsed_seconds: elapsed,
            status: TaskStatus::Active,
            is_running: true,
            last_started_at: Some(started_at),
            overtime_notified: notified,
            created_at: "2026-11-26T10:00:00.000Z".into(),
            finished_at: None,
        }
    }

    #[test]
    fn live_elapsed_uses_wall_clock_like_the_frontend() {
        let task = running(10.0, 1_000_000, 1.0, false);
        // 10s stored + 80s wall-clock = 90s.
        assert_eq!(live_elapsed_seconds(&task, 1_000_000 + 80_000), 90.0);
        assert!(is_currently_overtime(&task, 1_000_000 + 80_000));
        assert!(!is_currently_overtime(&task, 1_000_000 + 40_000));
    }

    #[test]
    fn take_due_notifies_once_per_crossing() {
        let mut watch = OvertimeWatch::default();
        let task = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(std::slice::from_ref(&task), 1_000_000);
        assert!(watch.take_due(1_000_000 + 40_000).is_empty());

        let due = watch.take_due(1_000_000 + 80_000);
        assert_eq!(due.len(), 1);
        assert_eq!(due[0].id, "t-1");
        assert!(watch.take_due(1_000_000 + 90_000).is_empty());
        assert!(!watch.claim("t-1"));
    }

    #[test]
    fn already_flagged_task_is_not_notified_again() {
        let mut watch = OvertimeWatch::default();
        watch.sync_from_data(&[running(10.0, 1_000_000, 1.0, true)], 1_000_000 + 80_000);
        assert!(watch.take_due(1_000_000 + 80_000).is_empty());
    }

    #[test]
    fn raising_the_estimate_allows_a_new_notification() {
        let mut watch = OvertimeWatch::default();
        let over = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(&[over], 1_000_000);
        assert_eq!(watch.take_due(1_000_000 + 80_000).len(), 1);

        // Frontend raised the estimate and cleared the flag (90s < 5 min).
        let raised = running(10.0, 1_000_000, 5.0, false);
        watch.sync_from_data(std::slice::from_ref(&raised), 1_000_000 + 80_000);
        assert!(watch.take_due(1_000_000 + 80_000).is_empty());

        // Later the new estimate is crossed.
        assert_eq!(watch.take_due(1_000_000 + 5 * 60_000).len(), 1);
    }

    #[test]
    fn stale_persist_after_watchdog_does_not_duplicate() {
        let mut watch = OvertimeWatch::default();
        let task = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(std::slice::from_ref(&task), 1_000_000);
        assert_eq!(watch.take_due(1_000_000 + 80_000).len(), 1);
        // A late save still has overtime_notified = false (webview was frozen).
        watch.sync_from_data(&[task], 1_000_000 + 81_000);
        assert!(watch.take_due(1_000_000 + 82_000).is_empty());
    }

    #[test]
    fn overtime_body_matches_frontend_copy() {
        assert_eq!(
            overtime_body("Revisar PR", 45.0),
            "\"Revisar PR\" passou de 45 min estimados."
        );
    }

    #[test]
    fn take_due_sets_the_snapshot_flag() {
        let mut watch = OvertimeWatch::default();
        let task = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(std::slice::from_ref(&task), 1_000_000);
        assert_eq!(watch.take_due(1_000_000 + 80_000).len(), 1);
        assert!(watch.tasks[0].overtime_notified);
    }

    #[test]
    fn apply_notified_flags_sets_only_claimed_ids() {
        let claimed = running(10.0, 1_000_000, 1.0, false);
        let mut other = running(10.0, 1_000_000, 1.0, false);
        other.id = "t-2".into();
        let ids: HashSet<String> = ["t-1".into()].into_iter().collect();
        let mut tasks = vec![claimed, other];
        assert!(apply_notified_flags(&mut tasks, &ids));
        assert!(tasks[0].overtime_notified);
        assert!(!tasks[1].overtime_notified);
        assert!(!apply_notified_flags(&mut tasks, &ids));
    }

    #[test]
    fn save_after_raising_estimate_does_not_restore_the_flag() {
        let mut watch = OvertimeWatch::default();
        let task = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(std::slice::from_ref(&task), 1_000_000);
        assert_eq!(watch.take_due(1_000_000 + 80_000).len(), 1);

        // Frontend raised the estimate and cleared the flag (90s < 5 min).
        // This is the save_app_data path: sync first, then merge.
        let mut raised = running(10.0, 1_000_000, 5.0, false);
        sync_then_merge_flags(
            &mut watch,
            std::slice::from_mut(&mut raised),
            1_000_000 + 80_000,
        );
        assert!(!raised.overtime_notified);
        assert!(watch.take_due(1_000_000 + 80_000).is_empty());

        // Later the new estimate is crossed.
        assert_eq!(watch.take_due(1_000_000 + 5 * 60_000).len(), 1);
    }

    #[test]
    fn stale_save_after_notify_still_sets_the_flag() {
        let mut watch = OvertimeWatch::default();
        let task = running(10.0, 1_000_000, 1.0, false);
        watch.sync_from_data(std::slice::from_ref(&task), 1_000_000);
        assert_eq!(watch.take_due(1_000_000 + 80_000).len(), 1);

        // A late save still has overtime_notified = false (webview was frozen).
        let mut stale = running(10.0, 1_000_000, 1.0, false);
        sync_then_merge_flags(
            &mut watch,
            std::slice::from_mut(&mut stale),
            1_000_000 + 81_000,
        );
        assert!(stale.overtime_notified);
        assert!(watch.take_due(1_000_000 + 82_000).is_empty());
    }

    #[test]
    fn persist_flags_to_path_writes_the_flag_without_clobbering_other_fields() {
        use crate::storage::{AppSettings, DATA_FILE_NAME, DATA_VERSION};
        use std::time::{SystemTime, UNIX_EPOCH};

        let dir = std::env::temp_dir().join(format!(
            "tasktimer-overtime-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join(DATA_FILE_NAME);
        let task = running(42.0, 1_000_000, 1.0, false);
        let data = PersistedAppData {
            version: DATA_VERSION,
            tasks: vec![task],
            settings: AppSettings {
                start_minimized: true,
            },
        };
        storage::save_to_path(&path, &data).unwrap();

        let ids: HashSet<String> = ["t-1".into()].into_iter().collect();
        assert!(persist_flags_to_path(&path, &ids));
        let loaded = storage::load_from_path(&path).unwrap().unwrap();
        assert!(loaded.tasks[0].overtime_notified);
        assert_eq!(loaded.tasks[0].elapsed_seconds, 42.0);
        assert!(loaded.settings.start_minimized);
        assert!(!persist_flags_to_path(&path, &ids));

        let _ = std::fs::remove_dir_all(dir);
    }
}
