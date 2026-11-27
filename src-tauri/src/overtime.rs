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

pub fn claim_and_show(
    app: &AppHandle,
    task_id: &str,
    task_name: &str,
    estimated_minutes: f64,
) -> bool {
    let claimed = app
        .try_state::<Mutex<OvertimeWatch>>()
        .and_then(|watch| watch.lock().ok().map(|mut guard| guard.claim(task_id)))
        .unwrap_or(true);
    if !claimed {
        return false;
    }
    show_overtime_notification(app, task_name, estimated_minutes);
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
    for event in due {
        show_overtime_notification(app, &event.name, event.estimated_minutes);
        let _ = app.emit(OVERTIME_EVENT, &event);
    }
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
}
