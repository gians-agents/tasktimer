use std::cell::Cell;
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const DATA_FILE_NAME: &str = "tasktimer-data.json";
pub const DATA_VERSION: u32 = 1;
pub const MAX_TASKS: usize = 10_000;
pub const MAX_TASK_NAME_CHARS: usize = 500;
pub const MAX_DATA_BYTES: usize = 5 * 1024 * 1024;

static DATA_FILE_LOCK: Mutex<()> = Mutex::new(());

thread_local! {
    static HOLDING_DATA_FILE_LOCK: Cell<bool> = const { Cell::new(false) };
}

struct DataFileLockGuard;

impl Drop for DataFileLockGuard {
    fn drop(&mut self) {
        HOLDING_DATA_FILE_LOCK.with(|holding| holding.set(false));
    }
}

/// Serializes every writer of the data file (frontend `save_app_data` and the
/// overtime watchdog) so a read-modify-write cannot clobber a newer snapshot.
/// Re-entrant on the same thread so a caller can compose load + [`save_to_path`].
pub fn with_data_file_lock<T>(f: impl FnOnce() -> T) -> T {
    HOLDING_DATA_FILE_LOCK.with(|holding| {
        if holding.get() {
            return f();
        }
        let _mutex = DATA_FILE_LOCK.lock().unwrap_or_else(|err| err.into_inner());
        holding.set(true);
        let _reset = DataFileLockGuard;
        f()
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub start_minimized: bool,
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

    if data.tasks.len() > MAX_TASKS {
        return Err(StorageError::Invalid(format!(
            "quantidade de tarefas excede o limite de {MAX_TASKS}"
        )));
    }

    let mut seen_ids = HashSet::with_capacity(data.tasks.len());
    for task in &data.tasks {
        if task.id.trim().is_empty() {
            return Err(StorageError::Invalid("tarefa com id vazio".to_string()));
        }
        if !seen_ids.insert(task.id.as_str()) {
            return Err(StorageError::Invalid(format!(
                "id de tarefa duplicado: {}",
                task.id
            )));
        }
        if task.name.trim().is_empty() {
            return Err(StorageError::Invalid(format!(
                "tarefa {} sem nome",
                task.id
            )));
        }
        if task.name.chars().count() > MAX_TASK_NAME_CHARS {
            return Err(StorageError::Invalid(format!(
                "tarefa {} com nome longo demais",
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
    let json = serde_json::to_string_pretty(data)?;
    if json.len() > MAX_DATA_BYTES {
        return Err(StorageError::Invalid(format!(
            "arquivo de dados excede o limite de {MAX_DATA_BYTES} bytes"
        )));
    }
    Ok(json)
}

fn tmp_path(path: &Path) -> PathBuf {
    path.with_extension("json.tmp")
}

fn bak_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn read_file(path: &Path) -> Result<Option<PersistedAppData>, StorageError> {
    match fs::read_to_string(path) {
        Ok(raw) => parse_app_data(&raw).map(Some),
        Err(err) if err.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(StorageError::Io(err)),
    }
}

/// Atomically promote `from` into `dest`. On Unix, `rename` replaces the destination.
/// On Windows, the current file is moved to `.bak` first, then restored if the promote fails.
fn replace_file(from: &Path, dest: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        let bak = bak_path(dest);
        if dest.exists() {
            if bak.exists() {
                fs::remove_file(&bak)?;
            }
            fs::rename(dest, &bak)?;
        }
        if let Err(err) = fs::rename(from, dest) {
            if bak.exists() && !dest.exists() {
                let _ = fs::rename(&bak, dest);
            }
            return Err(err);
        }
        if bak.exists() {
            let _ = fs::remove_file(&bak);
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        fs::rename(from, dest)
    }
}

pub fn load_from_path(path: &Path) -> Result<Option<PersistedAppData>, StorageError> {
    match read_file(path) {
        Ok(Some(data)) => return Ok(Some(data)),
        Ok(None) => {}
        // A corrupt/unreadable main file must surface as an error so the
        // frontend does not treat it as "no data" and overwrite it.
        Err(err) => return Err(err),
    }

    let tmp = tmp_path(path);
    if let Ok(Some(data)) = read_file(&tmp) {
        let _ = replace_file(&tmp, path);
        return Ok(Some(data));
    }

    let bak = bak_path(path);
    if let Ok(Some(data)) = read_file(&bak) {
        let _ = replace_file(&bak, path);
        return Ok(Some(data));
    }

    Ok(None)
}

pub fn save_to_path(path: &Path, data: &PersistedAppData) -> Result<(), StorageError> {
    with_data_file_lock(|| write_to_path(path, data))
}

fn write_to_path(path: &Path, data: &PersistedAppData) -> Result<(), StorageError> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let json = serialize_app_data(data)?;
    let tmp = tmp_path(path);
    fs::write(&tmp, json.as_bytes())?;
    replace_file(&tmp, path)?;
    Ok(())
}

/// Keeps a simple basename (no directories) and ensures a `.json` suffix.
pub fn sanitize_export_file_name(suggested: &str) -> String {
    const FALLBACK: &str = "tasktimer-export.json";
    let name = Path::new(suggested)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::trim)
        .filter(|n| !n.is_empty() && *n != "." && *n != ".." && !n.contains(['/', '\\']))
        .unwrap_or(FALLBACK);
    match Path::new(name).extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("json") => name.to_string(),
        _ => format!("{name}.json"),
    }
}

pub fn with_json_extension(path: PathBuf) -> PathBuf {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("json") => path,
        _ => path.with_extension("json"),
    }
}

/// Atomically writes a user-chosen JSON export (size-limited, must be valid JSON).
/// Returns the final path (a `.json` extension is added when missing).
pub fn write_export_json(path: &Path, contents: &str) -> Result<PathBuf, StorageError> {
    if contents.len() > MAX_DATA_BYTES {
        return Err(StorageError::Invalid(format!(
            "arquivo de exportação excede o limite de {MAX_DATA_BYTES} bytes"
        )));
    }
    serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|err| StorageError::Invalid(format!("JSON de exportação inválido: {err}")))?;

    let path = with_json_extension(path.to_path_buf());
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let tmp = tmp_path(&path);
    fs::write(&tmp, contents.as_bytes())?;
    if let Err(err) = replace_file(&tmp, &path) {
        let _ = fs::remove_file(&tmp);
        return Err(StorageError::Io(err));
    }
    Ok(path)
}

/// Reads a user-chosen import file with the same size cap as persisted data.
pub fn read_import_json(path: &Path) -> Result<String, StorageError> {
    let meta = fs::metadata(path)?;
    if !meta.is_file() {
        return Err(StorageError::Invalid(
            "o caminho selecionado não é um arquivo".into(),
        ));
    }
    if meta.len() > MAX_DATA_BYTES as u64 {
        return Err(StorageError::Invalid(format!(
            "arquivo de importação excede o limite de {MAX_DATA_BYTES} bytes"
        )));
    }
    Ok(fs::read_to_string(path)?)
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
        assert!(
            !tmp_path(&path).exists(),
            "temporary file should be gone after save"
        );
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn parse_rejects_duplicate_ids() {
        let mut data = sample_data();
        data.tasks.push(sample_task());
        assert!(validate_app_data(&data).is_err());
    }

    #[test]
    fn load_recovers_leftover_tmp_when_main_file_is_missing() {
        let path = temp_path("recover-tmp");
        let data = sample_data();
        fs::write(tmp_path(&path), serialize_app_data(&data).unwrap()).unwrap();
        let loaded = load_from_path(&path).unwrap().expect("should recover tmp");
        assert_eq!(loaded, data);
        assert!(
            path.exists(),
            "recovered file should be promoted to the main path"
        );
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(tmp_path(&path));
    }

    #[test]
    fn load_prefers_main_file_over_leftover_tmp() {
        let path = temp_path("prefer-main");
        let mut main = sample_data();
        let mut leftover = sample_data();
        leftover.tasks[0].name = "Órfão".into();
        leftover.tasks[0].id = "task-tmp".into();
        save_to_path(&path, &main).unwrap();
        main.tasks[0].elapsed_seconds = 1.0;
        // rewrite main and leave an older tmp behind
        fs::write(&path, serialize_app_data(&main).unwrap()).unwrap();
        fs::write(tmp_path(&path), serialize_app_data(&leftover).unwrap()).unwrap();
        let loaded = load_from_path(&path).unwrap().unwrap();
        assert_eq!(loaded.tasks[0].elapsed_seconds, 1.0);
        assert_eq!(loaded.tasks[0].name, "Revisar PR");
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(tmp_path(&path));
    }

    #[test]
    fn load_recovers_bak_when_main_and_tmp_are_missing() {
        let path = temp_path("recover-bak");
        let data = sample_data();
        fs::write(bak_path(&path), serialize_app_data(&data).unwrap()).unwrap();
        let loaded = load_from_path(&path).unwrap().expect("should recover bak");
        assert_eq!(loaded, data);
        assert!(path.exists());
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(bak_path(&path));
    }

    #[test]
    fn load_corrupt_main_file_returns_error_not_empty() {
        let path = temp_path("corrupt");
        fs::write(&path, "{not-json").unwrap();
        assert!(load_from_path(&path).is_err());
        assert!(path.exists(), "corrupt file must be left untouched");
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn sanitize_export_file_name_keeps_a_safe_basename() {
        assert_eq!(
            sanitize_export_file_name("tasktimer-2026-11-27.json"),
            "tasktimer-2026-11-27.json"
        );
        assert_eq!(
            sanitize_export_file_name("/tmp/evil/../../tasktimer-2026-11-27.json"),
            "tasktimer-2026-11-27.json"
        );
        assert_eq!(sanitize_export_file_name("backup"), "backup.json");
        assert_eq!(sanitize_export_file_name(""), "tasktimer-export.json");
        assert_eq!(sanitize_export_file_name(".."), "tasktimer-export.json");
    }

    #[test]
    fn write_export_json_is_atomic_and_adds_json_extension() {
        let path = temp_path("native-export").with_extension("");
        let contents = "{\n  \"ok\": true\n}";
        let written = write_export_json(&path, contents).unwrap();
        assert_eq!(written.extension().unwrap(), "json");
        assert_eq!(fs::read_to_string(&written).unwrap(), contents);
        assert!(
            !tmp_path(&written).exists(),
            "temporary file should be gone"
        );
        // Overwrite the same path atomically.
        let updated = "{\"ok\":false}";
        write_export_json(&written, updated).unwrap();
        assert_eq!(fs::read_to_string(&written).unwrap(), updated);
        let _ = fs::remove_file(&written);
    }

    #[test]
    fn write_export_json_rejects_invalid_or_oversized_payloads() {
        let path = temp_path("native-export-invalid");
        assert!(write_export_json(&path, "{not-json").is_err());
        assert!(!path.exists());
        let oversized = format!(r#""{}""#, "a".repeat(MAX_DATA_BYTES));
        assert!(oversized.len() > MAX_DATA_BYTES);
        assert!(write_export_json(&path, &oversized).is_err());
        assert!(!path.exists());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn read_import_json_enforces_size_limit() {
        let path = temp_path("native-import");
        fs::write(&path, r#"{"tasks":[]}"#).unwrap();
        assert_eq!(read_import_json(&path).unwrap(), r#"{"tasks":[]}"#);

        let huge = path.with_file_name("native-import-huge.json");
        fs::write(&huge, "a".repeat(MAX_DATA_BYTES + 1)).unwrap();
        let err = read_import_json(&huge).unwrap_err().to_string();
        assert!(err.contains("excede o limite"));
        let _ = fs::remove_file(&path);
        let _ = fs::remove_file(&huge);
    }
}
