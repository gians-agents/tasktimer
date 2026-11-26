use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const DATA_FILE_NAME: &str = "tasktimer-data.json";
pub const DATA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub start_minimized: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            start_minimized: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Active,
    Completed,
    Canceled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    pub estimated_minutes: f64,
    pub elapsed_seconds: f64,
    pub status: TaskStatus,
    #[serde(default)]
    pub is_running: bool,
    #[serde(default)]
    pub last_started_at: Option<i64>,
    #[serde(default)]
    pub overtime_notified: bool,
    pub created_at: String,
    #[serde(default)]
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedAppData {
    pub version: u32,
    pub tasks: Vec<Task>,
    #[serde(default)]
    pub settings: AppSettings,
}

#[derive(Debug)]
pub enum StorageError {
    Io(io::Error),
    Json(serde_json::Error),
    Invalid(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StorageError::Io(err) => write!(f, "falha de arquivo: {err}"),
            StorageError::Json(err) => write!(f, "JSON inválido: {err}"),
            StorageError::Invalid(err) => write!(f, "{err}"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<io::Error> for StorageError {
    fn from(value: io::Error) -> Self {
        StorageError::Io(value)
    }
}

impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        StorageError::Json(value)
    }
}

pub fn validate_app_data(data: &PersistedAppData) -> Result<(), StorageError> {
    if data.version != DATA_VERSION {
        return Err(StorageError::Invalid(format!(
            "versão de dados não suportada: {} (esperado {DATA_VERSION})",
            data.version
        )));
    }

    for task in &data.tasks {
        if task.id.trim().is_empty() {
            return Err(StorageError::Invalid(
                "tarefa com id vazio".to_string(),
            ));
        }
        if task.name.trim().is_empty() {
            return Err(StorageError::Invalid(format!(
                "tarefa {} sem nome",
                task.id
            )));
        }
        if !task.estimated_minutes.is_finite() || task.estimated_minutes <= 0.0 {
            return Err(StorageError::Invalid(format!(
                "tarefa {} com tempo estimado inválido",
                task.id
            )));
        }
        if !task.elapsed_seconds.is_finite() || task.elapsed_seconds < 0.0 {
            return Err(StorageError::Invalid(format!(
                "tarefa {} com tempo decorrido inválido",
                task.id
            )));
        }
    }

    Ok(())
}

pub fn parse_app_data(json: &str) -> Result<PersistedAppData, StorageError> {
    let data: PersistedAppData = serde_json::from_str(json)?;
    validate_app_data(&data)?;
    Ok(data)
}

pub fn serialize_app_data(data: &PersistedAppData) -> Result<String, StorageError> {
    validate_app_data(data)?;
    Ok(serde_json::to_string_pretty(data)?)
}

pub fn load_from_path(path: &Path) -> Result<Option<PersistedAppData>, StorageError> {
    match fs::read_to_string(path) {
        Ok(raw) => parse_app_data(&raw).map(Some),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(StorageError::Io(err)),
    }
}

pub fn save_to_path(path: &Path, data: &PersistedAppData) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let json = serialize_app_data(data)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json)?;

    if path.exists() {
        fs::remove_file(path)?;
    }
    fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn sample_task() -> Task {
        Task {
            id: "task-1".into(),
            name: "Revisar PR".into(),
            estimated_minutes: 45.0,
            elapsed_seconds: 120.0,
            status: TaskStatus::Active,
            is_running: false,
            last_started_at: None,
            overtime_notified: false,
            created_at: "2026-11-26T10:00:00.000Z".into(),
            finished_at: None,
        }
    }

    fn sample_data() -> PersistedAppData {
        PersistedAppData {
            version: DATA_VERSION,
            tasks: vec![sample_task()],
            settings: AppSettings {
                start_minimized: false,
            },
        }
    }

    fn temp_path(label: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("tasktimer-{label}-{nanos}.json"))
    }

    #[test]
    fn parse_roundtrip_preserves_camel_case_fields() {
        let original = sample_data();
        let json = serialize_app_data(&original).unwrap();
        assert!(json.contains("\"estimatedMinutes\""));
        assert!(json.contains("\"startMinimized\""));
        let parsed = parse_app_data(&json).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn parse_defaults_missing_settings() {
        let json = r#"{
            "version": 1,
            "tasks": [{
                "id": "t-1",
                "name": "Importada",
                "estimatedMinutes": 30,
                "elapsedSeconds": 0,
                "status": "active",
                "createdAt": "2026-11-26T10:00:00.000Z"
            }]
        }"#;
        let parsed = parse_app_data(json).unwrap();
        assert_eq!(parsed.settings, AppSettings::default());
        assert!(!parsed.tasks[0].is_running);
        assert_eq!(parsed.tasks[0].last_started_at, None);
    }

    #[test]
    fn parse_rejects_invalid_payloads() {
        assert!(parse_app_data("not-json").is_err());
        assert!(parse_app_data(r#"{"version":2,"tasks":[]}"#).is_err());
        assert!(parse_app_data(r#"{"version":1,"tasks":[{"id":"","name":"X","estimatedMinutes":10,"elapsedSeconds":0,"status":"active","createdAt":"t"}]}"#).is_err());
        assert!(parse_app_data(r#"{"version":1,"tasks":[{"id":"t","name":"X","estimatedMinutes":0,"elapsedSeconds":0,"status":"active","createdAt":"t"}]}"#).is_err());
        assert!(parse_app_data(r#"{"version":1,"tasks":[{"id":"t","name":"X","estimatedMinutes":10,"elapsedSeconds":-1,"status":"active","createdAt":"t"}]}"#).is_err());
    }

    #[test]
    fn load_missing_file_returns_none() {
        let path = std::env::temp_dir().join("tasktimer-definitely-missing-xyz.json");
        let _ = fs::remove_file(&path);
        let loaded = load_from_path(&path).unwrap();
        assert_eq!(loaded, None);
    }

    #[test]
    fn save_and_load_from_temp_dir() {
        let dir = std::env::temp_dir().join(format!(
            "tasktimer-store-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let path = dir.join(DATA_FILE_NAME);
        let data = sample_data();
        save_to_path(&path, &data).unwrap();
        let loaded = load_from_path(&path).unwrap().expect("file should exist");
        assert_eq!(loaded, data);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_overwrites_existing_file() {
        let path = temp_path("overwrite");
        let mut data = sample_data();
        save_to_path(&path, &data).unwrap();
        data.settings.start_minimized = true;
        data.tasks[0].elapsed_seconds = 999.0;
        save_to_path(&path, &data).unwrap();
        let loaded = load_from_path(&path).unwrap().unwrap();
        assert!(loaded.settings.start_minimized);
        assert_eq!(loaded.tasks[0].elapsed_seconds, 999.0);
        let _ = fs::remove_file(&path);
    }
}
