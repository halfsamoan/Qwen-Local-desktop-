use base64::{engine::general_purpose::STANDARD, Engine};
use ignore::WalkBuilder;
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::{params, Connection};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State};

struct BackendProcess {
    child: Child,
    kind: String,
    context_size: u32,
    gpu_mode: String,
    api_key: String,
}

struct Backend(Mutex<Option<BackendProcess>>);

struct ProjectWatcher(Mutex<Option<RecommendedWatcher>>);

#[derive(Serialize)]
struct BackendStatus {
    running: bool,
    error: String,
    backend_kind: String,
    context_size: u32,
    gpu_mode: String,
    detail: String,
    api_key: String,
}

fn local_api_key() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|error| error.to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn backend_address() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], 18080))
}

fn backend_port_in_use(address: SocketAddr) -> bool {
    TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok()
}

fn backend_log_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("backend.log"))
}

fn backend_log_tail(app: &AppHandle) -> String {
    backend_log_path(app)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|log| {
            log.lines()
                .rev()
                .find(|line| !line.trim().is_empty())
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

fn backend_log_detail(app: &AppHandle) -> String {
    let Some(log) = backend_log_path(app).and_then(|path| fs::read_to_string(path).ok()) else {
        return String::new();
    };
    [
        "no usable GPU",
        "out of memory",
        "offloaded",
        "llama_context: n_ctx ",
    ]
    .iter()
    .filter_map(|needle| log.lines().rev().find(|line| line.contains(needle)))
    .map(str::trim)
    .collect::<Vec<_>>()
    .join(" | ")
}

fn stop_backend_process(backend: &Backend) -> Result<(), String> {
    let mut slot = backend.0.lock().map_err(|_| "backend lock poisoned")?;
    if let Some(mut process) = slot.take() {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn terminate_backend_with_parent(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    unsafe extern "C" {
        fn prctl(option: i32, arg2: usize, arg3: usize, arg4: usize, arg5: usize) -> i32;
    }

    unsafe {
        command.pre_exec(|| {
            if prctl(1, 9, 0, 0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(target_os = "linux"))]
fn terminate_backend_with_parent(_command: &mut Command) {}

fn bundled_inference_paths(resources: &Path, gpu_mode: &str) -> (PathBuf, PathBuf) {
    let backend = if gpu_mode == "Low GPU Usage" {
        "cpu"
    } else {
        "cuda"
    };
    (
        resources.join(format!("inference/{backend}/llama-server")),
        resources.join("inference/model.gguf"),
    )
}

fn inference_paths(app: &AppHandle, gpu_mode: &str) -> Result<(PathBuf, PathBuf), String> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let (bundled_server, bundled_model) = bundled_inference_paths(&resources, gpu_mode);

    #[cfg(debug_assertions)]
    {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
        let server = std::env::var_os("QWEN_LLAMA_SERVER")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if bundled_server.exists() {
                    bundled_server
                } else {
                    root.join(".phase0/llama-build/bin/llama-server")
                }
            });
        let model = std::env::var_os("QWEN_MODEL")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                if bundled_model.exists() {
                    bundled_model
                } else {
                    root.join("models/Qwen3-4B-Instruct-2507-abliterated.Q4_K_M.gguf")
                }
            });
        return Ok((server, model));
    }

    #[cfg(not(debug_assertions))]
    Ok((bundled_server, bundled_model))
}

#[derive(Serialize)]
struct Conversation {
    id: i64,
    title: String,
    updated_at: String,
    project_id: Option<i64>,
}

#[derive(Serialize)]
struct StoredMessage {
    id: i64,
    role: String,
    content: String,
    context_files: Vec<String>,
}

#[derive(Serialize)]
struct Project {
    id: i64,
    name: String,
    root_path: String,
    instructions: String,
}

#[derive(Clone, Serialize)]
struct FileEntry {
    path: String,
    name: String,
    is_dir: bool,
}

#[derive(Serialize)]
struct SearchHit {
    path: String,
    line: usize,
    snippet: String,
}

#[derive(Serialize, Clone)]
struct Attachment {
    id: i64,
    message_id: Option<i64>,
    name: String,
    mime: String,
    data_base64: String,
    text: String,
    ocr_error: String,
}

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, instructions TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY, title TEXT NOT NULL, project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS attachments (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, name TEXT NOT NULL, mime TEXT NOT NULL, data_base64 TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '', stored_path TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, ocr_error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE TABLE IF NOT EXISTS message_context (message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE, path TEXT NOT NULL, PRIMARY KEY(message_id, path)); CREATE TABLE IF NOT EXISTS project_index_state (root_path TEXT PRIMARY KEY, file_count INTEGER NOT NULL, indexed_at TEXT NOT NULL DEFAULT (datetime('now'))); CREATE VIRTUAL TABLE IF NOT EXISTS project_search USING fts5(root_path UNINDEXED, path, content, tokenize='trigram');";

static PROJECT_INDEX_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn project_index_lock() -> &'static Mutex<()> {
    PROJECT_INDEX_LOCK.get_or_init(|| Mutex::new(()))
}

fn db(app: &AppHandle) -> Result<Connection, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let connection = Connection::open(dir.join("app.db")).map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch(SCHEMA)
        .map_err(|error| error.to_string())?;
    for statement in [
        "ALTER TABLE conversations ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL",
        "ALTER TABLE attachments ADD COLUMN sha256 TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE attachments ADD COLUMN stored_path TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE attachments ADD COLUMN size INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE attachments ADD COLUMN message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE",
        "ALTER TABLE projects ADD COLUMN instructions TEXT NOT NULL DEFAULT ''",
    ] {
        let _ = connection.execute(statement, []);
    }
    let version: i64 = connection
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version < 2 {
        connection
            .execute(
                "UPDATE attachments SET message_id = (SELECT id FROM messages WHERE messages.conversation_id = attachments.conversation_id AND role = 'user' ORDER BY id DESC LIMIT 1) WHERE message_id IS NULL",
                [],
            )
            .map_err(|error| error.to_string())?;
        connection
            .execute_batch("PRAGMA user_version = 2")
            .map_err(|error| error.to_string())?;
    }
    if version < 3 {
        connection
            .execute_batch("PRAGMA user_version = 3")
            .map_err(|error| error.to_string())?;
    }
    if version < 4 {
        connection
            .execute_batch("PRAGMA user_version = 4")
            .map_err(|error| error.to_string())?;
    }
    let sqlite_version: String = connection
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    let sqlite_parts = sqlite_version
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or(0))
        .collect::<Vec<_>>();
    let meets_wal_floor = (
        sqlite_parts.first().copied().unwrap_or(0),
        sqlite_parts.get(1).copied().unwrap_or(0),
        sqlite_parts.get(2).copied().unwrap_or(0),
    ) >= (3, 51, 3);
    if meets_wal_floor {
        let _ = connection.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    }
    Ok(connection)
}

#[tauri::command]
fn list_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let connection = db(&app)?;
    let mut statement = connection
        .prepare(
            "SELECT id, title, updated_at, project_id FROM conversations ORDER BY updated_at DESC, id DESC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                project_id: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

#[tauri::command]
fn search_conversations(app: AppHandle, query: String) -> Result<Vec<Conversation>, String> {
    if query.trim().is_empty() {
        return list_conversations(app);
    }
    let connection = db(&app)?;
    let like = format!("%{}%", query.trim());
    let mut statement = connection.prepare("SELECT DISTINCT c.id, c.title, c.updated_at, c.project_id FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id LEFT JOIN projects p ON p.id = c.project_id WHERE c.title LIKE ?1 OR m.content LIKE ?1 OR p.name LIKE ?1 ORDER BY c.updated_at DESC, c.id DESC").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![like], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
                project_id: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

#[tauri::command]
fn create_conversation(
    app: AppHandle,
    title: String,
    project_id: Option<i64>,
) -> Result<i64, String> {
    let connection = db(&app)?;
    connection
        .execute(
            "INSERT INTO conversations (title, project_id) VALUES (?1, ?2)",
            params![title, project_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(connection.last_insert_rowid())
}

#[tauri::command]
fn rename_conversation(app: AppHandle, conversation_id: i64, title: String) -> Result<(), String> {
    let connection = db(&app)?;
    connection
        .execute(
            "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
            params![title, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_messages(app: AppHandle, conversation_id: i64) -> Result<Vec<StoredMessage>, String> {
    let connection = db(&app)?;
    let mut statement = connection
        .prepare("SELECT id, role, content, COALESCE((SELECT group_concat(path, char(10)) FROM message_context WHERE message_id = messages.id), '') FROM messages WHERE conversation_id = ?1 ORDER BY id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![conversation_id], |row| {
            Ok(StoredMessage {
                id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                context_files: row
                    .get::<_, String>(3)?
                    .lines()
                    .map(str::to_owned)
                    .collect(),
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

#[tauri::command]
fn append_message(
    app: AppHandle,
    conversation_id: i64,
    role: String,
    content: String,
) -> Result<i64, String> {
    let connection = db(&app)?;
    connection
        .execute(
            "INSERT INTO messages (conversation_id, role, content) VALUES (?1, ?2, ?3)",
            params![conversation_id, role, content],
        )
        .map_err(|error| error.to_string())?;
    let message_id = connection.last_insert_rowid();
    connection
        .execute(
            "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(message_id)
}

#[tauri::command]
fn assign_pending_attachments(
    app: AppHandle,
    conversation_id: i64,
    message_id: i64,
) -> Result<(), String> {
    let connection = db(&app)?;
    connection
        .execute(
            "UPDATE attachments SET message_id = ?1 WHERE conversation_id = ?2 AND message_id IS NULL",
            params![message_id, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn revise_user_message(
    app: AppHandle,
    conversation_id: i64,
    message_id: i64,
    content: String,
) -> Result<(), String> {
    let mut connection = db(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "UPDATE messages SET content = ?1 WHERE id = ?2 AND conversation_id = ?3 AND role = 'user'",
            params![content, message_id, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err("user message was not found".into());
    }
    transaction
        .execute(
            "DELETE FROM messages WHERE conversation_id = ?1 AND id > ?2",
            params![conversation_id, message_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_message_context(app: AppHandle, message_id: i64, paths: Vec<String>) -> Result<(), String> {
    let mut connection = db(&app)?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM message_context WHERE message_id = ?1",
            params![message_id],
        )
        .map_err(|error| error.to_string())?;
    for path in paths {
        transaction
            .execute(
                "INSERT OR IGNORE INTO message_context (message_id, path) VALUES (?1, ?2)",
                params![message_id, path],
            )
            .map_err(|error| error.to_string())?;
    }
    transaction.commit().map_err(|error| error.to_string())
}

fn excluded(name: &str) -> bool {
    matches!(
        name,
        ".git" | "node_modules" | "target" | "dist" | "build" | ".venv" | "venv" | "__pycache__"
    )
}

fn list_directory(root_path: &str, relative_path: Option<&str>) -> Result<Vec<FileEntry>, String> {
    let root = fs::canonicalize(root_path).map_err(|error| error.to_string())?;
    let directory = match relative_path.filter(|path| !path.is_empty()) {
        Some(path) => fs::canonicalize(root.join(path)).map_err(|error| error.to_string())?,
        None => root.clone(),
    };
    if !directory.starts_with(&root) || !directory.is_dir() {
        return Err("directory is outside the project".into());
    }
    let mut entries: Vec<_> = fs::read_dir(&directory)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .collect();
    entries.sort_by_key(|entry| entry.file_name());
    Ok(entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if excluded(&name) {
                return None;
            }
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).ok()?;
            if metadata.file_type().is_symlink() {
                return None;
            }
            Some(FileEntry {
                path: path.strip_prefix(&root).ok()?.to_string_lossy().to_string(),
                name,
                is_dir: metadata.is_dir(),
            })
        })
        .collect())
}

#[tauri::command]
fn list_projects(app: AppHandle) -> Result<Vec<Project>, String> {
    let connection = db(&app)?;
    let mut statement = connection
        .prepare("SELECT id, name, root_path, instructions FROM projects ORDER BY name")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                instructions: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| row.map_err(|error| error.to_string()))
        .collect()
}

fn invalidate_project_index_sync(app: &AppHandle, root_path: &str) -> Result<(), String> {
    let root = fs::canonicalize(root_path).map_err(|error| error.to_string())?;
    let root_key = root.to_string_lossy().to_string();
    let connection = db(app)?;
    connection
        .execute(
            "DELETE FROM project_search WHERE root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM project_index_state WHERE root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn invalidate_project_index(app: AppHandle, root_path: String) -> Result<(), String> {
    invalidate_project_index_sync(&app, &root_path)
}

#[tauri::command]
fn register_project(app: AppHandle, root_path: String) -> Result<Project, String> {
    let root = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("project path is not a directory".into());
    }
    let path = root.to_string_lossy().to_string();
    let name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Project")
        .to_string();
    let connection = db(&app)?;
    connection.execute("INSERT INTO projects (name, root_path) VALUES (?1, ?2) ON CONFLICT(root_path) DO UPDATE SET name = excluded.name", params![name, path]).map_err(|error| error.to_string())?;
    let (id, instructions) = connection
        .query_row(
            "SELECT id, instructions FROM projects WHERE root_path = ?1",
            params![path],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM project_search WHERE root_path = ?1",
            params![path],
        )
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "DELETE FROM project_index_state WHERE root_path = ?1",
            params![path],
        )
        .map_err(|error| error.to_string())?;
    Ok(Project {
        id,
        name,
        root_path: path,
        instructions,
    })
}

#[tauri::command]
fn rename_project(app: AppHandle, project_id: i64, name: String) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 120 || trimmed.contains(['/', '\\']) {
        return Err("project name must be 1-120 characters without path separators".into());
    }
    let connection = db(&app)?;
    let changed = connection
        .execute(
            "UPDATE projects SET name = ?1 WHERE id = ?2",
            params![trimmed, project_id],
        )
        .map_err(|error| error.to_string())?;
    if changed != 1 {
        return Err("project was not found".into());
    }
    Ok(())
}

#[tauri::command]
fn update_project_instructions(
    app: AppHandle,
    project_id: i64,
    instructions: String,
) -> Result<(), String> {
    let connection = db(&app)?;
    connection
        .execute(
            "UPDATE projects SET instructions = ?1 WHERE id = ?2",
            params![instructions, project_id],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
async fn project_tree(
    root_path: String,
    relative_path: Option<String>,
) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_directory(&root_path, relative_path.as_deref())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn read_project_file(root_path: String, relative_path: String) -> Result<String, String> {
    let root = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
    let path = fs::canonicalize(root.join(&relative_path)).map_err(|error| error.to_string())?;
    if !path.starts_with(&root) {
        return Err("file is outside the project".into());
    }
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 2_000_000 {
        return Err("file is larger than 2 MB".into());
    }
    let mut content = String::new();
    fs::File::open(path)
        .map_err(|error| error.to_string())?
        .read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    Ok(content)
}

fn write_project_file_sync(
    root_path: &str,
    relative_path: &str,
    expected_content: &str,
    content: &str,
) -> Result<(), String> {
    let root = fs::canonicalize(root_path).map_err(|error| error.to_string())?;
    let raw_path = root.join(relative_path);
    let link_metadata = fs::symlink_metadata(&raw_path).map_err(|error| error.to_string())?;
    if link_metadata.file_type().is_symlink() || !link_metadata.is_file() {
        return Err("only regular project files can be edited".into());
    }
    let path = fs::canonicalize(&raw_path).map_err(|error| error.to_string())?;
    if !path.starts_with(&root) {
        return Err("file is outside the project".into());
    }
    if content.len() > 2_000_000 {
        return Err("file is larger than 2 MB".into());
    }
    let current = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    if current != expected_content {
        return Err("file changed since preview; reload before applying".into());
    }
    let parent = path.parent().ok_or("file has no parent directory")?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temp_path = parent.join(format!(".qwen-local-{}.tmp", stamp));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| error.to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp_path, &path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

#[tauri::command]
fn write_project_file(
    app: AppHandle,
    root_path: String,
    relative_path: String,
    expected_content: String,
    content: String,
) -> Result<(), String> {
    write_project_file_sync(&root_path, &relative_path, &expected_content, &content)?;
    invalidate_project_index_sync(&app, &root_path)
}

fn watcher_path_allowed(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
        && !path
            .strip_prefix(root)
            .unwrap_or(path)
            .components()
            .any(|component| excluded(component.as_os_str().to_string_lossy().as_ref()))
}

#[tauri::command]
fn watch_project(
    app: AppHandle,
    state: State<'_, ProjectWatcher>,
    root_path: String,
) -> Result<(), String> {
    let root = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("project path is not a directory".into());
    }
    let event_root = root.to_string_lossy().to_string();
    let filter_root = root.clone();
    let event_app = app.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: Result<Event, notify::Error>| {
            if let Ok(event) = result {
                let changed = matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                );
                if changed
                    && event
                        .paths
                        .iter()
                        .any(|path| watcher_path_allowed(path, &filter_root))
                {
                    let _ = event_app.emit("project-changed", &event_root);
                }
            }
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "project watcher lock poisoned")?;
    *slot = Some(watcher);
    Ok(())
}

#[tauri::command]
fn unwatch_project(state: State<'_, ProjectWatcher>) -> Result<(), String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "project watcher lock poisoned")?;
    *slot = None;
    Ok(())
}

fn supported_project_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "py" | "cpp"
            | "c"
            | "h"
            | "hpp"
            | "rs"
            | "js"
            | "ts"
            | "tsx"
            | "jsx"
            | "java"
            | "md"
            | "txt"
            | "json"
            | "yaml"
            | "yml"
            | "toml"
            | "xml"
            | "csv"
            | "html"
            | "css"
            | "sql"
            | "sh"
            | "ini"
            | "cfg"
    )
}

fn search_terms(query: &str) -> Vec<String> {
    query
        .split(|character: char| !character.is_alphanumeric() && character != '_')
        .map(str::to_lowercase)
        .filter(|term| term.chars().count() >= 3)
        .take(12)
        .collect()
}

fn ensure_project_index(app: &AppHandle, root_path: &str) -> Result<usize, String> {
    // ponytail: one global index lock is enough for this single-user desktop app.
    let _guard = project_index_lock()
        .lock()
        .map_err(|_| "project index lock poisoned")?;
    let root = fs::canonicalize(root_path).map_err(|error| error.to_string())?;
    let root_key = root.to_string_lossy().to_string();
    let mut connection = db(app)?;
    // ponytail: a short TTL keeps external editor changes visible without a file-watcher subsystem.
    if let Ok(count) = connection.query_row(
        "SELECT file_count FROM project_index_state WHERE root_path = ?1 AND indexed_at >= datetime('now', '-1 minute')",
        params![root_key],
        |row| row.get::<_, i64>(0),
    ) {
        return Ok(count as usize);
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM project_search WHERE root_path = ?1",
            params![root_key],
        )
        .map_err(|error| error.to_string())?;
    let mut insert = transaction
        .prepare("INSERT INTO project_search (root_path, path, content) VALUES (?1, ?2, ?3)")
        .map_err(|error| error.to_string())?;
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    let walker = WalkBuilder::new(&root)
        .hidden(false)
        .follow_links(false)
        .filter_entry(|entry| !excluded(entry.file_name().to_string_lossy().as_ref()))
        .build();
    for entry in walker.filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || !supported_project_file(path) {
            continue;
        }
        let Ok(metadata) = path.metadata() else {
            continue;
        };
        if metadata.len() > 1_000_000
            || file_count >= 20_000
            || total_bytes.saturating_add(metadata.len()) > 200_000_000
        {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        let relative = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        insert
            .execute(params![root_key, relative, content])
            .map_err(|error| error.to_string())?;
        file_count += 1;
        total_bytes += metadata.len();
    }
    drop(insert);
    transaction
        .execute(
            "INSERT OR REPLACE INTO project_index_state (root_path, file_count, indexed_at) VALUES (?1, ?2, datetime('now'))",
            params![root_key, file_count as i64],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(file_count)
}

fn search_project_sync(
    app: &AppHandle,
    root_path: String,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    ensure_project_index(app, &root_path)?;
    let root = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
    let root_key = root.to_string_lossy().to_string();
    let terms = search_terms(&query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let fts_query = terms
        .iter()
        .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    let connection = db(app)?;
    let mut statement = connection
        .prepare("SELECT path, content FROM project_search WHERE root_path = ?1 AND project_search MATCH ?2 ORDER BY bm25(project_search, 0.0, 5.0, 1.0) LIMIT 50")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![root_key, fts_query], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let (path, content) = row.map_err(|error| error.to_string())?;
        let (line, snippet) = content
            .lines()
            .enumerate()
            .find(|(_, line)| {
                let lower = line.to_lowercase();
                terms.iter().any(|term| lower.contains(term))
            })
            .map(|(index, line)| (index + 1, line.trim().chars().take(240).collect()))
            .unwrap_or((1, path.clone()));
        Ok(SearchHit {
            path,
            line,
            snippet,
        })
    })
    .collect()
}

#[tauri::command]
async fn search_project(
    app: AppHandle,
    root_path: String,
    query: String,
) -> Result<Vec<SearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || search_project_sync(&app, root_path, query))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn search_project_files(
    app: AppHandle,
    root_path: String,
    query: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_project_index(&app, &root_path)?;
        let root = fs::canonicalize(&root_path).map_err(|error| error.to_string())?;
        let root_key = root.to_string_lossy().to_string();
        let connection = db(&app)?;
        let like = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        let mut statement = connection
            .prepare("SELECT path FROM project_search WHERE root_path = ?1 AND path LIKE ?2 ESCAPE '\\' ORDER BY length(path), path LIMIT 12")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![root_key, like], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

fn mime_for(path: &PathBuf) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "text/plain",
    }
    .into()
}

fn store_attachment(app: &AppHandle, bytes: &[u8]) -> Result<(String, String), String> {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let sha256 = format!("{:x}", hasher.finalize());
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("attachments");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let stored_path = directory.join(&sha256);
    if !stored_path.exists() {
        fs::write(&stored_path, bytes).map_err(|error| error.to_string())?;
    }
    Ok((sha256, stored_path.to_string_lossy().to_string()))
}

fn attachment_from_bytes(
    app: &AppHandle,
    conversation_id: i64,
    name: String,
    mime: String,
    bytes: Vec<u8>,
) -> Result<Attachment, String> {
    if bytes.len() > 10_000_000 {
        return Err("attachment is larger than 10 MB".into());
    }
    let data_base64 = if mime.starts_with("image/") {
        STANDARD.encode(&bytes)
    } else {
        String::new()
    };
    let (sha256, stored_path) = store_attachment(app, &bytes)?;
    let mut text = String::new();
    let mut ocr_error = String::new();
    if mime == "application/pdf" {
        let temp =
            std::env::temp_dir().join(format!("qwen-attachment-{}-{}", std::process::id(), name));
        fs::write(&temp, &bytes).map_err(|error| error.to_string())?;
        let result = Command::new("pdftotext")
            .arg("-layout")
            .arg(&temp)
            .arg("-")
            .output();
        let _ = fs::remove_file(&temp);
        match result {
            Ok(output) if output.status.success() => {
                text = String::from_utf8_lossy(&output.stdout)
                    .chars()
                    .take(2_000_000)
                    .collect()
            }
            Ok(_) => ocr_error = "PDF text extraction failed".into(),
            Err(_) => ocr_error = "pdftotext is not installed".into(),
        }
    } else if mime.starts_with("image/") {
        let temp = std::env::temp_dir().join(format!("qwen-image-{}-{}", std::process::id(), name));
        fs::write(&temp, &bytes).map_err(|error| error.to_string())?;
        match Command::new("tesseract")
            .arg(&temp)
            .arg("stdout")
            .arg("-l")
            .arg("eng+kor")
            .output()
        {
            Ok(output) if output.status.success() => {
                text = String::from_utf8_lossy(&output.stdout)
                    .chars()
                    .take(500_000)
                    .collect()
            }
            Ok(_) => ocr_error = "OCR failed".into(),
            Err(_) => ocr_error = "Tesseract is not installed".into(),
        }
        let _ = fs::remove_file(&temp);
    } else {
        text = String::from_utf8_lossy(&bytes)
            .chars()
            .take(2_000_000)
            .collect();
    }
    let connection = db(app)?;
    connection.execute("INSERT INTO attachments (conversation_id, name, mime, data_base64, sha256, stored_path, size, text, ocr_error) VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, ?7, ?8)", params![conversation_id, name, mime, sha256, stored_path, bytes.len() as i64, text, ocr_error]).map_err(|error| error.to_string())?;
    let id = connection.last_insert_rowid();
    Ok(Attachment {
        id,
        message_id: None,
        name,
        mime,
        data_base64,
        text,
        ocr_error,
    })
}

#[tauri::command]
async fn inspect_attachment(
    app: AppHandle,
    conversation_id: i64,
    path: String,
) -> Result<Attachment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = fs::canonicalize(path).map_err(|error| error.to_string())?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("attachment")
            .to_string();
        attachment_from_bytes(
            &app,
            conversation_id,
            name,
            mime_for(&path),
            fs::read(path).map_err(|error| error.to_string())?,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn save_pasted_image(
    app: AppHandle,
    conversation_id: i64,
    name: String,
    bytes: Vec<u8>,
    mime: String,
) -> Result<Attachment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        attachment_from_bytes(&app, conversation_id, name, mime, bytes)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_attachments(app: AppHandle, conversation_id: i64) -> Result<Vec<Attachment>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = db(&app)?;
        let mut statement = connection.prepare("SELECT id, message_id, name, mime, data_base64, text, ocr_error FROM attachments WHERE conversation_id = ?1 ORDER BY id").map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(params![conversation_id], |row| {
                Ok(Attachment {
                    id: row.get(0)?,
                    message_id: row.get(1)?,
                    name: row.get(2)?,
                    mime: row.get(3)?,
                    data_base64: row.get(4)?,
                    text: row.get(5)?,
                    ocr_error: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;
        rows.map(|row| row.map_err(|error| error.to_string()))
            .collect()
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn load_attachment_data(app: AppHandle, attachment_id: i64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let connection = db(&app)?;
        let (legacy, stored_path): (String, String) = connection
            .query_row(
                "SELECT data_base64, stored_path FROM attachments WHERE id = ?1",
                params![attachment_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| error.to_string())?;
        if stored_path.is_empty() {
            Ok(legacy)
        } else {
            fs::read(stored_path)
                .map(|bytes| STANDARD.encode(bytes))
                .map_err(|error| error.to_string())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn remove_attachment(app: AppHandle, attachment_id: i64) -> Result<(), String> {
    let mut connection = db(&app)?;
    let (sha256, stored_path): (String, String) = connection
        .query_row(
            "SELECT sha256, stored_path FROM attachments WHERE id = ?1",
            params![attachment_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|error| error.to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![attachment_id],
        )
        .map_err(|error| error.to_string())?;
    let references: i64 = transaction
        .query_row(
            "SELECT count(*) FROM attachments WHERE sha256 = ?1",
            params![sha256],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    if references == 0 && !stored_path.is_empty() {
        let _ = fs::remove_file(stored_path);
    }
    Ok(())
}

#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<'_, Backend>,
    context_size: u32,
    gpu_mode: String,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|_| "backend lock poisoned")?;
    if let Some(process) = slot.as_mut() {
        match process.child.try_wait() {
            Ok(None) => return Ok(()),
            Ok(Some(_)) | Err(_) => *slot = None,
        }
    }
    let (server, model) = inference_paths(&app, &gpu_mode)?;
    if !server.exists() {
        return Err(format!("llama-server not found: {}", server.display()));
    }
    if !model.exists() {
        return Err(format!("model not found: {}", model.display()));
    }
    if backend_port_in_use(backend_address()) {
        return Err("port 18080 is already in use by another process".into());
    }
    let mut command = Command::new(&server);
    terminate_backend_with_parent(&mut command);
    if let Some(parent) = server.parent() {
        command.env("LD_LIBRARY_PATH", parent);
    }
    let ngl = match gpu_mode.as_str() {
        "Maximum Performance" => "all",
        "Low GPU Usage" => "0",
        _ => "auto",
    };
    let context_arg = context_size.to_string();
    let api_key = local_api_key()?;
    let log_path = backend_log_path(&app);
    let log_file = log_path.as_ref().and_then(|path| {
        path.parent()
            .and_then(|parent| fs::create_dir_all(parent).ok())?;
        fs::File::create(path).ok()
    });
    let stdout = log_file
        .as_ref()
        .and_then(|file| file.try_clone().ok())
        .map(Stdio::from)
        .unwrap_or_else(Stdio::null);
    let stderr = log_file.map(Stdio::from).unwrap_or_else(Stdio::null);
    let child = command
        .args([
            "-m",
            model.to_str().ok_or("invalid model path")?,
            "-c",
            &context_arg,
            "--host",
            "127.0.0.1",
            "--port",
            "18080",
            "--no-webui",
            "--cors-origins",
            "*",
            "--api-key",
            &api_key,
            "-ngl",
            ngl,
            "--parallel",
            "1",
            "--cache-prompt",
            "--cache-reuse",
            "256",
            "--cache-ram",
            "0",
            "--no-cache-idle-slots",
            "--cache-type-k",
            "f16",
            "--cache-type-v",
            "f16",
            "--flash-attn",
            "auto",
            "-lv",
            "3",
        ])
        .stdin(Stdio::null())
        .stdout(stdout)
        .stderr(stderr)
        .spawn()
        .map_err(|error| error.to_string())?;
    *slot = Some(BackendProcess {
        child,
        kind: if gpu_mode == "Low GPU Usage" {
            "CPU".into()
        } else {
            "CUDA".into()
        },
        context_size,
        gpu_mode,
        api_key,
    });
    Ok(())
}

#[tauri::command]
fn backend_status(app: AppHandle, state: State<'_, Backend>) -> Result<BackendStatus, String> {
    let mut slot = state.0.lock().map_err(|_| "backend lock poisoned")?;
    let (child_status, backend_kind, context_size, gpu_mode, api_key) = match slot.as_mut() {
        Some(process) => (
            process.child.try_wait(),
            process.kind.clone(),
            process.context_size,
            process.gpu_mode.clone(),
            process.api_key.clone(),
        ),
        None => {
            return Ok(BackendStatus {
                running: false,
                error: "Qwen backend is not running.".into(),
                backend_kind: String::new(),
                context_size: 0,
                gpu_mode: String::new(),
                detail: String::new(),
                api_key: String::new(),
            })
        }
    };
    match child_status {
        Ok(None) => Ok(BackendStatus {
            running: true,
            error: String::new(),
            backend_kind,
            context_size,
            gpu_mode,
            detail: backend_log_detail(&app),
            api_key,
        }),
        Ok(Some(status)) => {
            *slot = None;
            let detail = backend_log_tail(&app);
            Ok(BackendStatus {
                running: false,
                error: if detail.is_empty() {
                    format!("Qwen backend exited with {status}.")
                } else {
                    format!("Qwen backend exited with {status}: {detail}")
                },
                backend_kind,
                context_size,
                gpu_mode,
                detail: backend_log_detail(&app),
                api_key,
            })
        }
        Err(error) => {
            *slot = None;
            Ok(BackendStatus {
                running: false,
                error: format!("Could not inspect Qwen backend: {error}"),
                backend_kind,
                context_size,
                gpu_mode,
                detail: backend_log_detail(&app),
                api_key,
            })
        }
    }
}

#[tauri::command]
fn restart_backend(
    app: AppHandle,
    state: State<'_, Backend>,
    context_size: u32,
    gpu_mode: String,
) -> Result<(), String> {
    stop_backend_process(state.inner())?;
    start_backend(app, state, context_size, gpu_mode)
}

#[tauri::command]
fn stop_backend(state: State<'_, Backend>) -> Result<(), String> {
    stop_backend_process(state.inner())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Backend(Mutex::new(None)))
        .manage(ProjectWatcher(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            start_backend,
            restart_backend,
            stop_backend,
            backend_status,
            list_conversations,
            search_conversations,
            create_conversation,
            rename_conversation,
            list_messages,
            append_message,
            assign_pending_attachments,
            revise_user_message,
            save_message_context,
            list_projects,
            register_project,
            rename_project,
            update_project_instructions,
            project_tree,
            read_project_file,
            write_project_file,
            watch_project,
            unwatch_project,
            invalidate_project_index,
            search_project,
            search_project_files,
            inspect_attachment,
            save_pasted_image,
            list_attachments,
            load_attachment_data,
            remove_attachment
        ])
        .build(tauri::generate_context!())
        .expect("error while building Qwen Local");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let backend = handle.state::<Backend>();
            let _ = stop_backend_process(backend.inner());
            let watcher = handle.state::<ProjectWatcher>();
            let _ = unwatch_project(watcher);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_inference_paths_are_stable() {
        let resources = PathBuf::from("/app/resources");
        let (server, model) = bundled_inference_paths(&resources, "Balanced");
        assert_eq!(server, resources.join("inference/cuda/llama-server"));
        assert_eq!(model, resources.join("inference/model.gguf"));
        assert_eq!(
            bundled_inference_paths(&resources, "Low GPU Usage").0,
            resources.join("inference/cpu/llama-server")
        );
    }

    #[test]
    fn occupied_backend_port_is_detected() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        assert!(backend_port_in_use(listener.local_addr().unwrap()));
    }

    #[cfg(unix)]
    #[test]
    fn stop_backend_process_reaps_child() {
        let child = Command::new("sleep").arg("30").spawn().unwrap();
        let backend = Backend(Mutex::new(Some(BackendProcess {
            child,
            kind: "CPU".into(),
            context_size: 8192,
            gpu_mode: "Low GPU Usage".into(),
            api_key: "test".into(),
        })));
        stop_backend_process(&backend).unwrap();
        assert!(backend.0.lock().unwrap().is_none());
    }

    #[test]
    fn backend_api_key_is_random_and_fixed_length() {
        let first = local_api_key().unwrap();
        let second = local_api_key().unwrap();
        assert_eq!(first.len(), 64);
        assert_ne!(first, second);
    }

    #[test]
    fn sqlite_message_round_trip() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection
            .execute("INSERT INTO conversations (title) VALUES ('Test')", [])
            .unwrap();
        let conversation_id = connection.last_insert_rowid();
        connection.execute("INSERT INTO messages (conversation_id, role, content) VALUES (?1, 'user', 'hello')", [conversation_id]).unwrap();
        let content: String = connection
            .query_row(
                "SELECT content FROM messages WHERE conversation_id = ?1",
                [conversation_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(content, "hello");
    }

    #[test]
    fn project_tree_skips_generated_directories() {
        let root = std::env::temp_dir().join(format!("qwen-project-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("target")).unwrap();
        fs::write(root.join("src/main.py"), "print('ok')").unwrap();
        fs::write(root.join("target/ignored"), "no").unwrap();
        let entries = list_directory(root.to_str().unwrap(), None).unwrap();
        assert!(entries
            .iter()
            .any(|entry| entry.path == "src" && entry.is_dir));
        assert!(!entries.iter().any(|entry| entry.path.starts_with("target")));
        let src_entries = list_directory(root.to_str().unwrap(), Some("src")).unwrap();
        assert!(src_entries.iter().any(|entry| entry.path == "src/main.py"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn project_search_terms_are_fts_safe() {
        assert_eq!(
            search_terms("Explain @src/radar.py + Kalman"),
            vec!["explain", "src", "radar", "kalman"]
        );
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch("CREATE VIRTUAL TABLE search_test USING fts5(path, content, tokenize='trigram'); INSERT INTO search_test VALUES ('radar.py', 'Kalman filter');")
            .unwrap();
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM search_test WHERE search_test MATCH '\"kalman\"'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[cfg(unix)]
    #[test]
    fn project_tree_skips_symlink_directories() {
        use std::os::unix::fs::symlink;
        let root = std::env::temp_dir().join(format!("qwen-symlink-test-{}", std::process::id()));
        let outside =
            std::env::temp_dir().join(format!("qwen-symlink-outside-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        symlink(&outside, root.join("linked")).unwrap();
        let entries = list_directory(root.to_str().unwrap(), None).unwrap();
        assert!(!entries.iter().any(|entry| entry.path.starts_with("linked")));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn project_file_write_requires_preview_content() {
        let root = std::env::temp_dir().join(format!("qwen-write-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("main.py"), "old\n").unwrap();
        let stale =
            write_project_file_sync(root.to_str().unwrap(), "main.py", "different\n", "new\n");
        assert!(stale.is_err());
        write_project_file_sync(root.to_str().unwrap(), "main.py", "old\n", "new\n").unwrap();
        assert_eq!(fs::read_to_string(root.join("main.py")).unwrap(), "new\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn watcher_filter_excludes_generated_paths() {
        let root = PathBuf::from("/tmp/qwen-project");
        assert!(watcher_path_allowed(&root.join("src/main.py"), &root));
        assert!(!watcher_path_allowed(&root.join("target/main.o"), &root));
        assert!(!watcher_path_allowed(
            &PathBuf::from("/tmp/other/file"),
            &root
        ));
    }
}
