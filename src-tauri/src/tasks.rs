use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

pub const TASK_SCHEMA_VERSION: &str = "1.0.0";
const LEGACY_MIGRATION_KEY: &str = "tideplan.tasks.v1";
const BACKUP_SCHEMA_VERSION: &str = "1.0.0";
const APP_STATE_KEYS: [&str; 10] = [
    "tideplan.reminders.v1",
    "tideplan.purchase-list.v1",
    "tideplan.meal-plan.v1",
    "tideplan.shopping-checked.v1",
    "tideplan.countdowns.v1",
    "tideplan.meal-preferences.v1",
    "tideplan.bead-pattern.v1",
    "tideplan.life.v1",
    "tideplan.assistant.v1",
    "tideplan.goals.v1",
];
const MAX_APP_STATE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct TaskOrigin {
    pub kind: String,
    pub label: Option<String>,
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub struct TaskRecord {
    pub schema_version: String,
    pub id: String,
    pub title: String,
    pub notes: String,
    pub horizon: String,
    pub priority: String,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub origin: Option<TaskOrigin>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMutation {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub horizon: String,
    pub priority: String,
    pub start_date: Option<String>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub origin: Option<TaskOrigin>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum LegacyMigrationResult {
    Migrated {
        imported_count: usize,
        backup_path: Option<String>,
    },
    AlreadyMigrated {
        imported_count: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataBackup {
    pub schema_version: String,
    pub created_at: String,
    pub tasks: Vec<TaskRecord>,
    pub app_state: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyTask {
    id: String,
    title: String,
    #[serde(default)]
    notes: String,
    horizon: String,
    priority: String,
    #[serde(default)]
    start_date: Option<String>,
    #[serde(default)]
    due_date: Option<String>,
    created_at: String,
    #[serde(default)]
    completed_at: Option<String>,
}

pub struct TaskStore {
    connection: Mutex<Connection>,
    backup_dir: PathBuf,
}

impl TaskStore {
    pub fn goal_state(&self) -> Result<Option<serde_json::Value>, String> {
        let connection = self.connection.lock().map_err(|_| "database_lock_failed")?;
        let raw: Option<String> = connection
            .query_row(
                "SELECT value_json FROM app_state WHERE key=?1",
                [crate::goals::KEY],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "目标数据读取失败")?;
        raw.map(|r| {
            serde_json::from_str(&r).map_err(|_| "目标数据格式异常，请恢复有效备份".to_string())
        })
        .transpose()
    }

    pub fn commit_goals(
        &self,
        request: crate::goals::GoalCommit,
    ) -> Result<crate::goals::GoalReply, String> {
        use serde_json::json;
        let mut connection = self.connection.lock().map_err(|_| "database_lock_failed")?;
        let tx = connection.transaction().map_err(|_| "目标事务无法启动")?;
        let raw: Option<String> = tx
            .query_row(
                "SELECT value_json FROM app_state WHERE key=?1",
                [crate::goals::KEY],
                |r| r.get(0),
            )
            .optional()
            .map_err(|_| "目标数据读取失败")?;
        let current: serde_json::Value = raw
            .map(|s| serde_json::from_str(&s))
            .transpose()
            .map_err(|_| "目标数据格式异常")?
            .unwrap_or(serde_json::Value::Null);
        if !current.is_null() && !crate::goals::valid_state(&current) {
            return Err("目标数据格式异常，请恢复有效备份".into());
        }
        if current["operations"]
            .as_array()
            .is_some_and(|a| a.contains(&json!(request.operation_id)))
        {
            return Ok(crate::goals::GoalReply {
                state: current,
                tasks: list_tasks_from_connection(&tx)?,
            });
        }
        if current["revision"].as_u64().unwrap_or(0) != request.expected_revision {
            return Err("目标数据已变化，请重新载入后重试".into());
        }
        let next = request.next;
        if !crate::goals::valid_state(&next) {
            return Err("目标关系或字段无效，未保存任何更改".into());
        }
        validate_app_state(crate::goals::KEY, &next)?;
        let previous_ops = current["operations"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let mut expected_ops = previous_ops
            .into_iter()
            .rev()
            .take(1999)
            .collect::<Vec<_>>();
        expected_ops.reverse();
        expected_ops.push(json!(request.operation_id));
        if next["operations"] != json!(expected_ops) {
            return Err("操作历史不一致，请重新载入".into());
        }
        if next["revision"].as_u64() != Some(request.expected_revision + 1)
            || next["operations"].as_array().and_then(|a| a.last())
                != Some(&json!(request.operation_id))
        {
            return Err("目标版本或操作编号无效".into());
        }
        let existing = list_tasks_from_connection(&tx)?;
        if request.checks.iter().any(|check| {
            !existing
                .iter()
                .any(|t| t.id == check.id && t.updated_at == check.updated_at)
        }) {
            return Err("关联任务已变化，请重新整理".into());
        }
        if request.create_tasks.len() > 100 {
            return Err("一次最多创建 100 项行动".into());
        }
        if request.undo {
            let undo = &current["undo"];
            if undo.is_null()
                || undo["revision"] != current["revision"]
                || !request.create_tasks.is_empty()
                || next["goals"] != undo["goals"]
                || next["actions"] != undo["actions"]
            {
                return Err("方案之后的目标已修改，无法整批撤销；请逐项调整".into());
            }
            for snapshot in undo["createdTasks"].as_array().ok_or("撤销记录无效")? {
                let task = existing
                    .iter()
                    .find(|t| snapshot["id"] == t.id)
                    .ok_or("方案任务已删除，无法整批撤销")?;
                if task_ui(task) != *snapshot {
                    return Err("方案任务已编辑或完成，无法整批撤销；请逐项调整".into());
                }
                tx.execute("DELETE FROM tasks WHERE id=?1", [&task.id])
                    .map_err(|_| "撤销失败")?;
            }
        }
        for task in &request.create_tasks {
            validate_task(task).map_err(|e| format!("行动无效：{e}"))?;
            if !next["actions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["taskId"] == task.id)
            {
                return Err("新任务缺少目标关联".into());
            }
            insert_task(&tx, task).map_err(|_| "创建行动失败，整批方案未写入")?;
        }
        let tasks = list_tasks_from_connection(&tx)?;
        for a in next["actions"].as_array().unwrap() {
            let was_linked = current["actions"].as_array().is_some_and(|old| {
                old.iter()
                    .any(|o| o["id"] == a["id"] && o["taskId"] == a["taskId"])
            });
            if !was_linked && !tasks.iter().any(|t| a["taskId"] == t.id) {
                return Err("关联任务不存在，方案未写入".into());
            }
        }
        tx.execute("INSERT INTO app_state(key,value_json,updated_at) VALUES (?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",params![crate::goals::KEY,serialize_app_state(&next)?,now_timestamp()]).map_err(|_|"目标保存失败")?;
        tx.commit().map_err(|_| "目标事务未完成，请重试")?;
        Ok(crate::goals::GoalReply { state: next, tasks })
    }

    pub fn open(database_path: &Path) -> Result<Self, String> {
        let parent = database_path
            .parent()
            .ok_or_else(|| "database_path_invalid".to_string())?;
        fs::create_dir_all(parent).map_err(|_| "database_directory_unavailable".to_string())?;
        let connection =
            Connection::open(database_path).map_err(|_| "database_open_failed".to_string())?;
        Self::from_connection(connection, parent.join("migration-backups"))
    }

    #[cfg(test)]
    fn open_for_test(database_path: &Path, backup_dir: PathBuf) -> Result<Self, String> {
        let connection =
            Connection::open(database_path).map_err(|_| "database_open_failed".to_string())?;
        Self::from_connection(connection, backup_dir)
    }

    fn from_connection(connection: Connection, backup_dir: PathBuf) -> Result<Self, String> {
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|_| "database_config_failed".to_string())?;
        connection
            .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(|_| "database_config_failed".to_string())?;

        let store = Self {
            connection: Mutex::new(connection),
            backup_dir,
        };
        store.apply_migrations()?;
        Ok(store)
    }

    fn apply_migrations(&self) -> Result<(), String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        connection
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS schema_migrations (
                    version INTEGER PRIMARY KEY,
                    applied_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS tasks (
                    schema_version TEXT NOT NULL CHECK (schema_version = '1.0.0'),
                    id TEXT PRIMARY KEY NOT NULL,
                    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
                    notes TEXT NOT NULL CHECK (length(notes) <= 4000),
                    horizon TEXT NOT NULL CHECK (horizon IN ('short', 'mid', 'long')),
                    priority TEXT NOT NULL CHECK (priority IN ('normal', 'important')),
                    start_date TEXT NULL CHECK (
                        start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    ),
                    due_date TEXT NULL CHECK (
                        due_date IS NULL OR due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    ),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    completed_at TEXT NULL,
                    origin_kind TEXT NULL CHECK (origin_kind IS NULL OR origin_kind IN ('local', 'migration', 'deep_link')),
                    origin_label TEXT NULL CHECK (origin_label IS NULL OR length(origin_label) <= 80),
                    origin_reference TEXT NULL CHECK (
                        origin_reference IS NULL OR (
                            length(origin_reference) <= 128 AND
                            origin_reference NOT GLOB '*[^A-Za-z0-9._:-]*'
                        )
                    ),
                    CHECK (origin_kind IS NOT NULL OR (origin_label IS NULL AND origin_reference IS NULL))
                );

                CREATE INDEX IF NOT EXISTS idx_tasks_active_due
                    ON tasks(completed_at, due_date, priority, created_at);
                CREATE INDEX IF NOT EXISTS idx_tasks_horizon_order
                    ON tasks(horizon, priority, due_date, created_at);
                CREATE INDEX IF NOT EXISTS idx_tasks_updated
                    ON tasks(updated_at, id);

                CREATE TABLE IF NOT EXISTS legacy_migrations (
                    migration_key TEXT PRIMARY KEY,
                    payload_sha256 TEXT NULL,
                    imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
                    backup_path TEXT NULL,
                    migrated_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                    VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

                CREATE TABLE IF NOT EXISTS app_state (
                    key TEXT PRIMARY KEY NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_state_bootstrap (
                    singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
                    completed_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                    VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                INSERT OR IGNORE INTO schema_migrations(version, applied_at)
                    VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
                "#,
            )
            .map_err(|_| "database_migration_failed".to_string())
    }

    pub fn list(&self) -> Result<Vec<TaskRecord>, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let mut statement = connection
            .prepare(
                r#"
                SELECT schema_version, id, title, notes, horizon, priority,
                       start_date, due_date, created_at, updated_at, completed_at,
                       origin_kind, origin_label, origin_reference
                FROM tasks
                ORDER BY
                    CASE priority WHEN 'important' THEN 0 ELSE 1 END,
                    CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                    due_date ASC,
                    created_at DESC,
                    id ASC
                "#,
            )
            .map_err(|_| "task_list_failed".to_string())?;
        let rows = statement
            .query_map([], task_from_row)
            .map_err(|_| "task_list_failed".to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| "task_list_failed".to_string())
    }

    pub fn get(&self, id: &str) -> Result<TaskRecord, String> {
        validate_uuid(id).map_err(|_| "task_id_invalid".to_string())?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        connection
            .query_row(
                r#"
                SELECT schema_version, id, title, notes, horizon, priority,
                       start_date, due_date, created_at, updated_at, completed_at,
                       origin_kind, origin_label, origin_reference
                FROM tasks WHERE id = ?1
                "#,
                [id],
                task_from_row,
            )
            .optional()
            .map_err(|_| "task_read_failed".to_string())?
            .ok_or_else(|| "task_not_found".to_string())
    }

    pub fn create(&self, mutation: TaskMutation) -> Result<TaskRecord, String> {
        let now = now_timestamp();
        let record = TaskRecord {
            schema_version: TASK_SCHEMA_VERSION.to_string(),
            id: Uuid::new_v4().to_string(),
            title: mutation.title,
            notes: mutation.notes,
            horizon: mutation.horizon,
            priority: mutation.priority,
            start_date: normalize_optional_date(mutation.start_date),
            due_date: normalize_optional_date(mutation.due_date),
            created_at: now.clone(),
            updated_at: now,
            completed_at: None,
            origin: mutation.origin.or_else(|| {
                Some(TaskOrigin {
                    kind: "local".to_string(),
                    label: None,
                    reference: None,
                })
            }),
        };
        validate_task(&record).map_err(|code| format!("task_invalid:{code}"))?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        insert_task(&connection, &record).map_err(|_| "task_create_failed".to_string())?;
        Ok(record)
    }

    pub fn update(&self, id: &str, mutation: TaskMutation) -> Result<TaskRecord, String> {
        let current = self.get(id)?;
        let record = TaskRecord {
            schema_version: current.schema_version,
            id: current.id,
            title: mutation.title,
            notes: mutation.notes,
            horizon: mutation.horizon,
            priority: mutation.priority,
            start_date: normalize_optional_date(mutation.start_date),
            due_date: normalize_optional_date(mutation.due_date),
            created_at: current.created_at,
            updated_at: now_timestamp(),
            completed_at: current.completed_at,
            origin: current.origin,
        };
        validate_task(&record).map_err(|code| format!("task_invalid:{code}"))?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let changed =
            update_task_row(&connection, &record).map_err(|_| "task_update_failed".to_string())?;
        if changed != 1 {
            return Err("task_not_found".to_string());
        }
        Ok(record)
    }

    pub fn set_completed(&self, id: &str, completed: bool) -> Result<TaskRecord, String> {
        validate_uuid(id).map_err(|_| "task_id_invalid".to_string())?;
        let timestamp = now_timestamp();
        let completed_at = completed.then_some(timestamp.clone());
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let changed = connection
            .execute(
                "UPDATE tasks SET completed_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![completed_at, timestamp, id],
            )
            .map_err(|_| "task_completion_failed".to_string())?;
        if changed != 1 {
            return Err("task_not_found".to_string());
        }
        drop(connection);
        self.get(id)
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        validate_uuid(id).map_err(|_| "task_id_invalid".to_string())?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let changed = connection
            .execute("DELETE FROM tasks WHERE id = ?1", [id])
            .map_err(|_| "task_delete_failed".to_string())?;
        if changed != 1 {
            return Err("task_not_found".to_string());
        }
        Ok(())
    }

    pub fn migrate_legacy(
        &self,
        raw_payload: Option<&str>,
    ) -> Result<LegacyMigrationResult, String> {
        {
            let connection = self
                .connection
                .lock()
                .map_err(|_| "database_lock_failed".to_string())?;
            if let Some(count) = connection
                .query_row(
                    "SELECT imported_count FROM legacy_migrations WHERE migration_key = ?1",
                    [LEGACY_MIGRATION_KEY],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|_| "legacy_migration_status_failed".to_string())?
            {
                return Ok(LegacyMigrationResult::AlreadyMigrated {
                    imported_count: count as usize,
                });
            }
        }

        let (payload_hash, backup_path) = match raw_payload {
            Some(payload) => {
                let hash = format!("{:x}", Sha256::digest(payload.as_bytes()));
                fs::create_dir_all(&self.backup_dir)
                    .map_err(|_| "legacy_backup_directory_failed".to_string())?;
                let path = self
                    .backup_dir
                    .join(format!("tideplan.tasks.v1.{hash}.json"));
                if !path.exists() {
                    fs::write(&path, payload.as_bytes())
                        .map_err(|_| "legacy_backup_write_failed".to_string())?;
                }
                (Some(hash), Some(path))
            }
            None => (None, None),
        };

        let records = match raw_payload {
            Some(payload) => parse_legacy_payload(payload)?,
            None => Vec::new(),
        };

        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|_| "legacy_migration_transaction_failed".to_string())?;
        if let Some(count) = transaction
            .query_row(
                "SELECT imported_count FROM legacy_migrations WHERE migration_key = ?1",
                [LEGACY_MIGRATION_KEY],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(|_| "legacy_migration_status_failed".to_string())?
        {
            return Ok(LegacyMigrationResult::AlreadyMigrated {
                imported_count: count as usize,
            });
        }
        import_legacy_records(&transaction, &records)?;
        let backup_string = backup_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        transaction
            .execute(
                r#"
                INSERT INTO legacy_migrations(
                    migration_key, payload_sha256, imported_count, backup_path, migrated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                params![
                    LEGACY_MIGRATION_KEY,
                    payload_hash,
                    records.len() as i64,
                    backup_string,
                    now_timestamp()
                ],
            )
            .map_err(|_| "legacy_migration_record_failed".to_string())?;
        transaction
            .commit()
            .map_err(|_| "legacy_migration_commit_failed".to_string())?;

        Ok(LegacyMigrationResult::Migrated {
            imported_count: records.len(),
            backup_path: backup_path.map(|path| path.to_string_lossy().to_string()),
        })
    }

    pub fn bootstrap_app_state(
        &self,
        legacy: HashMap<String, serde_json::Value>,
    ) -> Result<HashMap<String, serde_json::Value>, String> {
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|_| "app_state_transaction_failed".to_string())?;

        let migration_completed = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM app_state_bootstrap WHERE singleton = 1)",
                [],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| "app_state_migration_read_failed".to_string())?;

        if !migration_completed {
            for (key, value) in legacy {
                validate_app_state(&key, &value)?;
                transaction
                    .execute(
                        r#"
                        INSERT OR IGNORE INTO app_state(key, value_json, updated_at)
                        VALUES (?1, ?2, ?3)
                        "#,
                        params![key, serialize_app_state(&value)?, now_timestamp()],
                    )
                    .map_err(|_| "app_state_migration_failed".to_string())?;
            }
            transaction
                .execute(
                    "INSERT INTO app_state_bootstrap(singleton, completed_at) VALUES (1, ?1)",
                    params![now_timestamp()],
                )
                .map_err(|_| "app_state_migration_record_failed".to_string())?;
        }

        let state = read_app_state(&transaction)?;
        transaction
            .commit()
            .map_err(|_| "app_state_commit_failed".to_string())?;
        Ok(state)
    }

    pub fn set_app_state(&self, key: &str, value: serde_json::Value) -> Result<(), String> {
        validate_app_state(key, &value)?;
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        connection
            .execute(
                r#"
                INSERT INTO app_state(key, value_json, updated_at)
                VALUES (?1, ?2, ?3)
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at = excluded.updated_at
                "#,
                params![key, serialize_app_state(&value)?, now_timestamp()],
            )
            .map_err(|_| "app_state_write_failed".to_string())?;
        Ok(())
    }

    pub fn export_backup(&self) -> Result<DataBackup, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        let tasks = list_tasks_from_connection(&connection)?;
        let app_state = read_app_state(&connection)?;
        Ok(DataBackup {
            schema_version: BACKUP_SCHEMA_VERSION.to_string(),
            created_at: now_timestamp(),
            tasks,
            app_state,
        })
    }

    pub fn restore_backup(&self, backup: DataBackup) -> Result<String, String> {
        validate_backup(&backup)?;
        let mut connection = self
            .connection
            .lock()
            .map_err(|_| "database_lock_failed".to_string())?;
        // Hold the same database lock across snapshot and restore so the recovery
        // copy represents precisely the data about to be replaced.
        let previous = DataBackup {
            schema_version: BACKUP_SCHEMA_VERSION.to_string(),
            created_at: now_timestamp(),
            tasks: list_tasks_from_connection(&connection)?,
            app_state: read_app_state(&connection)?,
        };
        fs::create_dir_all(&self.backup_dir).map_err(|_| "backup_snapshot_failed")?;
        let snapshot = self
            .backup_dir
            .join(format!("before-restore-{}.json", Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&snapshot)
            .map_err(|_| "backup_snapshot_failed")?;
        use std::io::Write;
        file.write_all(
            &serde_json::to_vec_pretty(&previous).map_err(|_| "backup_snapshot_failed")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "backup_snapshot_failed")?;
        fs::File::open(&self.backup_dir)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| "backup_snapshot_failed")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "backup_restore_transaction_failed".to_string())?;
        transaction
            .execute("DELETE FROM tasks", [])
            .map_err(|_| "backup_restore_failed".to_string())?;
        transaction
            .execute("DELETE FROM app_state", [])
            .map_err(|_| "backup_restore_failed".to_string())?;

        for task in &backup.tasks {
            insert_task(&transaction, task)
                .map_err(|_| "backup_task_restore_failed".to_string())?;
        }
        for (key, value) in &backup.app_state {
            transaction
                .execute(
                    "INSERT INTO app_state(key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                    params![key, serialize_app_state(value)?, now_timestamp()],
                )
                .map_err(|_| "backup_state_restore_failed".to_string())?;
        }
        transaction
            .execute(
                "INSERT OR REPLACE INTO app_state_bootstrap(singleton, completed_at) VALUES (1, ?1)",
                params![now_timestamp()],
            )
            .map_err(|_| "backup_state_restore_failed".to_string())?;
        transaction
            .commit()
            .map_err(|_| "backup_restore_commit_failed".to_string())?;
        Ok(snapshot.to_string_lossy().into_owned())
    }
}

fn list_tasks_from_connection(connection: &Connection) -> Result<Vec<TaskRecord>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT schema_version, id, title, notes, horizon, priority,
                   start_date, due_date, created_at, updated_at, completed_at,
                   origin_kind, origin_label, origin_reference
            FROM tasks
            ORDER BY created_at ASC, id ASC
            "#,
        )
        .map_err(|_| "task_list_failed".to_string())?;
    let rows = statement
        .query_map([], task_from_row)
        .map_err(|_| "task_list_failed".to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "task_list_failed".to_string())
}

fn validate_app_state(key: &str, value: &serde_json::Value) -> Result<(), String> {
    if !APP_STATE_KEYS.contains(&key) {
        return Err("app_state_key_invalid".to_string());
    }
    if serialize_app_state(value)?.len() > MAX_APP_STATE_BYTES {
        return Err("app_state_value_too_large".to_string());
    }
    Ok(())
}

fn serialize_app_state(value: &serde_json::Value) -> Result<String, String> {
    serde_json::to_string(value).map_err(|_| "app_state_value_invalid".to_string())
}

fn read_app_state(connection: &Connection) -> Result<HashMap<String, serde_json::Value>, String> {
    let mut statement = connection
        .prepare("SELECT key, value_json FROM app_state ORDER BY key")
        .map_err(|_| "app_state_read_failed".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "app_state_read_failed".to_string())?;
    let mut state = HashMap::new();
    for row in rows {
        let (key, raw_value) = row.map_err(|_| "app_state_read_failed".to_string())?;
        let value =
            serde_json::from_str(&raw_value).map_err(|_| "app_state_value_corrupt".to_string())?;
        state.insert(key, value);
    }
    Ok(state)
}

fn validate_backup(backup: &DataBackup) -> Result<(), String> {
    if backup.schema_version != BACKUP_SCHEMA_VERSION {
        return Err("backup_schema_unsupported".to_string());
    }
    validate_timestamp(&backup.created_at).map_err(|_| "backup_timestamp_invalid".to_string())?;
    if backup.tasks.len() > 10_000 {
        return Err("backup_task_limit".to_string());
    }
    let mut ids = HashSet::new();
    for task in &backup.tasks {
        validate_task(task).map_err(|code| format!("backup_task_invalid:{code}"))?;
        if !ids.insert(task.id.as_str()) {
            return Err("backup_task_duplicate".to_string());
        }
    }
    for (key, value) in &backup.app_state {
        validate_app_state(key, value)?;
        if !crate::backup_validation::valid(key, value) {
            return Err(format!("backup_document_invalid:{key}"));
        }
    }
    Ok(())
}

fn parse_legacy_payload(payload: &str) -> Result<Vec<TaskRecord>, String> {
    let values: Vec<serde_json::Value> =
        serde_json::from_str(payload).map_err(|_| "legacy_payload_invalid_json".to_string())?;
    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| {
            let legacy: LegacyTask = serde_json::from_value(value)
                .map_err(|_| format!("legacy_record_invalid:{index}:shape"))?;
            let updated_at = later_timestamp(&legacy.created_at, legacy.completed_at.as_deref())
                .map_err(|code| format!("legacy_record_invalid:{index}:{code}"))?;
            let record = TaskRecord {
                schema_version: TASK_SCHEMA_VERSION.to_string(),
                id: legacy.id,
                title: legacy.title,
                notes: legacy.notes,
                horizon: legacy.horizon,
                priority: legacy.priority,
                start_date: normalize_optional_date(legacy.start_date),
                due_date: normalize_optional_date(legacy.due_date),
                created_at: legacy.created_at,
                updated_at,
                completed_at: legacy.completed_at,
                origin: Some(TaskOrigin {
                    kind: "migration".to_string(),
                    label: Some("Legacy task import".to_string()),
                    reference: None,
                }),
            };
            validate_task(&record)
                .map_err(|code| format!("legacy_record_invalid:{index}:{code}"))?;
            Ok(record)
        })
        .collect()
}

fn import_legacy_records(
    transaction: &Transaction<'_>,
    records: &[TaskRecord],
) -> Result<(), String> {
    for (index, record) in records.iter().enumerate() {
        let exists = transaction
            .query_row(
                "SELECT 1 FROM tasks WHERE id = ?1",
                [&record.id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "legacy_migration_read_failed".to_string())?
            .is_some();
        if exists {
            return Err(format!("legacy_record_conflict:{index}"));
        }
        insert_task(transaction, record)
            .map_err(|_| format!("legacy_record_insert_failed:{index}"))?;
    }
    Ok(())
}

fn insert_task(connection: &Connection, task: &TaskRecord) -> rusqlite::Result<usize> {
    let (kind, label, reference) = origin_columns(task.origin.as_ref());
    connection.execute(
        r#"
        INSERT INTO tasks(
            schema_version, id, title, notes, horizon, priority, start_date, due_date,
            created_at, updated_at, completed_at, origin_kind, origin_label, origin_reference
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
        "#,
        params![
            task.schema_version,
            task.id,
            task.title,
            task.notes,
            task.horizon,
            task.priority,
            task.start_date,
            task.due_date,
            task.created_at,
            task.updated_at,
            task.completed_at,
            kind,
            label,
            reference
        ],
    )
}

fn task_ui(t: &TaskRecord) -> serde_json::Value {
    serde_json::json!({"schemaVersion":t.schema_version,"id":t.id,"title":t.title,"notes":t.notes,"horizon":t.horizon,"priority":t.priority,"startDate":t.start_date.as_deref().unwrap_or(""),"dueDate":t.due_date.as_deref().unwrap_or(""),"createdAt":t.created_at,"updatedAt":t.updated_at,"completedAt":t.completed_at,"origin":t.origin})
}

fn update_task_row(connection: &Connection, task: &TaskRecord) -> rusqlite::Result<usize> {
    let (kind, label, reference) = origin_columns(task.origin.as_ref());
    connection.execute(
        r#"
        UPDATE tasks SET
            title = ?1, notes = ?2, horizon = ?3, priority = ?4,
            start_date = ?5, due_date = ?6, updated_at = ?7, completed_at = ?8,
            origin_kind = ?9, origin_label = ?10, origin_reference = ?11
        WHERE id = ?12
        "#,
        params![
            task.title,
            task.notes,
            task.horizon,
            task.priority,
            task.start_date,
            task.due_date,
            task.updated_at,
            task.completed_at,
            kind,
            label,
            reference,
            task.id
        ],
    )
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<TaskRecord> {
    let origin_kind: Option<String> = row.get(11)?;
    let origin = match origin_kind {
        Some(kind) => Some(TaskOrigin {
            kind,
            label: row.get(12)?,
            reference: row.get(13)?,
        }),
        None => None,
    };
    Ok(TaskRecord {
        schema_version: row.get(0)?,
        id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        horizon: row.get(4)?,
        priority: row.get(5)?,
        start_date: row.get(6)?,
        due_date: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        completed_at: row.get(10)?,
        origin,
    })
}

fn origin_columns(origin: Option<&TaskOrigin>) -> (Option<&str>, Option<&str>, Option<&str>) {
    match origin {
        Some(origin) => (
            Some(origin.kind.as_str()),
            origin.label.as_deref(),
            origin.reference.as_deref(),
        ),
        None => (None, None, None),
    }
}

fn normalize_optional_date(value: Option<String>) -> Option<String> {
    value.and_then(|date| if date.is_empty() { None } else { Some(date) })
}

fn validate_task(task: &TaskRecord) -> Result<(), &'static str> {
    if task.schema_version != TASK_SCHEMA_VERSION {
        return Err("unsupported_schema_version");
    }
    validate_uuid(&task.id)?;
    let title_length = task.title.chars().count();
    if title_length == 0 || title_length > 200 {
        return Err("title_length");
    }
    if task.notes.chars().count() > 4000 {
        return Err("notes_length");
    }
    if !matches!(task.horizon.as_str(), "short" | "mid" | "long") {
        return Err("horizon");
    }
    if !matches!(task.priority.as_str(), "normal" | "important") {
        return Err("priority");
    }
    if let Some(value) = task.start_date.as_deref() {
        validate_date(value)?;
    }
    if let Some(value) = task.due_date.as_deref() {
        validate_date(value)?;
    }
    let created = validate_timestamp(&task.created_at)?;
    let updated = validate_timestamp(&task.updated_at)?;
    if updated < created {
        return Err("updated_before_created");
    }
    if let Some(value) = task.completed_at.as_deref() {
        let completed = validate_timestamp(value)?;
        if completed < created {
            return Err("completed_before_created");
        }
    }
    if let Some(origin) = &task.origin {
        if !matches!(origin.kind.as_str(), "local" | "migration" | "deep_link") {
            return Err("origin_kind");
        }
        if origin
            .label
            .as_ref()
            .is_some_and(|value| value.chars().count() > 80)
        {
            return Err("origin_label_length");
        }
        if let Some(reference) = &origin.reference {
            if reference.len() > 128
                || !reference
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
            {
                return Err("origin_reference");
            }
        }
    }
    Ok(())
}

fn validate_uuid(value: &str) -> Result<(), &'static str> {
    Uuid::parse_str(value).map(|_| ()).map_err(|_| "id")
}

fn validate_date(value: &str) -> Result<(), &'static str> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map(|_| ())
        .map_err(|_| "date")
}

fn validate_timestamp(value: &str) -> Result<DateTime<chrono::FixedOffset>, &'static str> {
    DateTime::parse_from_rfc3339(value).map_err(|_| "timestamp")
}

fn later_timestamp(created: &str, completed: Option<&str>) -> Result<String, &'static str> {
    let created_value = validate_timestamp(created)?;
    match completed {
        Some(value) => {
            let completed_value = validate_timestamp(value)?;
            Ok(if completed_value > created_value {
                value.to_string()
            } else {
                created.to_string()
            })
        }
        None => Ok(created.to_string()),
    }
}

fn now_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[tauri::command]
pub fn list_tasks(store: tauri::State<'_, TaskStore>) -> Result<Vec<TaskRecord>, String> {
    store.list()
}

#[tauri::command]
pub fn get_task(id: String, store: tauri::State<'_, TaskStore>) -> Result<TaskRecord, String> {
    store.get(&id)
}

#[tauri::command]
pub fn create_task(
    mutation: TaskMutation,
    store: tauri::State<'_, TaskStore>,
) -> Result<TaskRecord, String> {
    store.create(mutation)
}

#[tauri::command]
pub fn update_task(
    id: String,
    mutation: TaskMutation,
    store: tauri::State<'_, TaskStore>,
) -> Result<TaskRecord, String> {
    store.update(&id, mutation)
}

#[tauri::command]
pub fn set_task_completed(
    id: String,
    completed: bool,
    store: tauri::State<'_, TaskStore>,
) -> Result<TaskRecord, String> {
    store.set_completed(&id, completed)
}

#[tauri::command]
pub fn delete_task(id: String, store: tauri::State<'_, TaskStore>) -> Result<(), String> {
    store.delete(&id)
}

#[tauri::command]
pub fn migrate_legacy_tasks(
    raw_payload: Option<String>,
    store: tauri::State<'_, TaskStore>,
) -> Result<LegacyMigrationResult, String> {
    store.migrate_legacy(raw_payload.as_deref())
}

#[tauri::command]
pub fn bootstrap_app_state(
    legacy: HashMap<String, serde_json::Value>,
    store: tauri::State<'_, TaskStore>,
) -> Result<HashMap<String, serde_json::Value>, String> {
    store.bootstrap_app_state(legacy)
}

#[tauri::command]
pub fn set_app_state(
    key: String,
    value: serde_json::Value,
    store: tauri::State<'_, TaskStore>,
) -> Result<(), String> {
    store.set_app_state(&key, value)
}

#[tauri::command]
pub fn export_data_backup(store: tauri::State<'_, TaskStore>) -> Result<DataBackup, String> {
    store.export_backup()
}

#[tauri::command]
pub fn restore_data_backup(
    backup: DataBackup,
    store: tauri::State<'_, TaskStore>,
) -> Result<String, String> {
    store.restore_backup(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use tempfile::TempDir;

    fn test_store(temp: &TempDir) -> TaskStore {
        TaskStore::open_for_test(
            &temp.path().join("tasks.sqlite3"),
            temp.path().join("backups"),
        )
        .unwrap()
    }

    fn mutation(title: &str, due_date: Option<&str>) -> TaskMutation {
        TaskMutation {
            title: title.to_string(),
            notes: String::new(),
            horizon: "short".to_string(),
            priority: "normal".to_string(),
            start_date: None,
            due_date: due_date.map(str::to_string),
            origin: None,
        }
    }

    fn goal_fixture() -> serde_json::Value {
        serde_json::from_str(include_str!("../../tests/fixtures/goals-empty.json")).unwrap()
    }
    fn goal_task(id: &str) -> TaskRecord {
        TaskRecord {
            schema_version: "1.0.0".into(),
            id: id.into(),
            title: "验证升级".into(),
            notes: "".into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: None,
            created_at: "2026-09-20T12:00:00.000Z".into(),
            updated_at: "2026-09-20T12:00:00.000Z".into(),
            completed_at: None,
            origin: None,
        }
    }
    fn goal_commit(task: TaskRecord) -> crate::goals::GoalCommit {
        let mut s = goal_fixture();
        s["revision"] = serde_json::json!(1);
        s["operations"] = serde_json::json!(["op1"]);
        s["goals"] = serde_json::json!([{"id":"g1","parentId":"","title":"发布","criterion":"升级验证通过","status":"active","reviewDate":""}]);
        s["actions"] = serde_json::json!([{"id":"a1","goalId":"g1","taskId":task.id,"dependsOn":[],"minutes":25,"energy":"normal","blocker":"","deferredUntil":"","destination":"task","targetId":"","targetDate":""}]);
        crate::goals::GoalCommit {
            expected_revision: 0,
            operation_id: "op1".into(),
            next: s,
            create_tasks: vec![task],
            checks: vec![],
            undo: false,
        }
    }
    #[test]
    fn goal_adoption_is_atomic_idempotent_and_survives_backup_restart() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let task = goal_task("11111111-1111-4111-8111-111111111111");
        let reply = store.commit_goals(goal_commit(task.clone())).unwrap();
        assert_eq!(reply.tasks.len(), 1);
        let retry = store.commit_goals(goal_commit(task)).unwrap();
        assert_eq!(retry.tasks.len(), 1);
        assert_eq!(reply.state, retry.state);
        let backup = store.export_backup().unwrap();
        store.restore_backup(backup).unwrap();
        drop(store);
        let reopened = test_store(&temp);
        assert_eq!(reopened.goal_state().unwrap().unwrap(), reply.state);
        assert_eq!(reopened.list().unwrap().len(), 1);
        let mut conflict = goal_commit(goal_task("22222222-2222-4222-8222-222222222222"));
        conflict.operation_id = "different".into();
        assert!(reopened
            .commit_goals(conflict)
            .unwrap_err()
            .contains("已变化"));
    }
    #[test]
    fn goal_failure_rolls_back_tasks_and_rejects_cycle() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let mut request = goal_commit(goal_task("11111111-1111-4111-8111-111111111111"));
        let mut invalid = goal_task("22222222-2222-4222-8222-222222222222");
        invalid.notes = "x".repeat(4001);
        request.create_tasks.push(invalid);
        assert!(store.commit_goals(request).is_err());
        assert!(store.list().unwrap().is_empty());
        assert!(store.goal_state().unwrap().is_none());
        let mut request = goal_commit(goal_task("11111111-1111-4111-8111-111111111111"));
        request.next["actions"][0]["dependsOn"] = serde_json::json!(["a1"]);
        assert!(store.commit_goals(request).is_err());
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn goal_undo_refuses_to_remove_edited_tasks_and_preserves_user_work() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let task = goal_task("11111111-1111-4111-8111-111111111111");
        let mut request = goal_commit(task.clone());
        request.next["undo"] = serde_json::json!({"operationId":"op1","revision":1,"goals":[],"actions":[],"thoughts":[],"createdTasks":[task_ui(&task)],"proposalId":"p1"});
        store.commit_goals(request).unwrap();
        store
            .update(&task.id, mutation("用户修改过", None))
            .unwrap();
        let mut next = goal_fixture();
        next["revision"] = serde_json::json!(2);
        next["operations"] = serde_json::json!(["op1", "undo1"]);
        let undo = crate::goals::GoalCommit {
            expected_revision: 1,
            operation_id: "undo1".into(),
            next,
            create_tasks: vec![],
            checks: vec![],
            undo: true,
        };
        assert!(store.commit_goals(undo).unwrap_err().contains("已编辑"));
        assert_eq!(store.get(&task.id).unwrap().title, "用户修改过");
        assert_eq!(store.goal_state().unwrap().unwrap()["revision"], 1);
    }

    #[test]
    fn goal_undo_after_restart_removes_only_untouched_batch_tasks() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let original = store.create(mutation("已有任务", None)).unwrap();
        let task = goal_task("11111111-1111-4111-8111-111111111111");
        let mut request = goal_commit(task.clone());
        request.next["undo"] = serde_json::json!({"operationId":"op1","revision":1,"goals":[],"actions":[],"thoughts":[],"createdTasks":[task_ui(&task)],"proposalId":"p1"});
        store.commit_goals(request).unwrap();
        drop(store);
        let reopened = test_store(&temp);
        let mut next = goal_fixture();
        next["revision"] = serde_json::json!(2);
        next["operations"] = serde_json::json!(["op1", "undo1"]);
        let undo = crate::goals::GoalCommit {
            expected_revision: 1,
            operation_id: "undo1".into(),
            next,
            create_tasks: vec![],
            checks: vec![],
            undo: true,
        };
        let result = reopened.commit_goals(undo).unwrap();
        assert_eq!(result.tasks, vec![original]);
        assert!(result.state["goals"].as_array().unwrap().is_empty());
    }

    #[test]
    fn crud_complete_reopen_and_deterministic_ordering() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let late = store.create(mutation("Late", Some("2026-10-02"))).unwrap();
        let early = store.create(mutation("Early", Some("2026-09-01"))).unwrap();
        let mut important_input = mutation("Important", None);
        important_input.priority = "important".to_string();
        let important = store.create(important_input).unwrap();

        assert_eq!(
            store
                .list()
                .unwrap()
                .iter()
                .map(|task| task.id.as_str())
                .collect::<Vec<_>>(),
            vec![important.id.as_str(), early.id.as_str(), late.id.as_str()]
        );

        let completed = store.set_completed(&early.id, true).unwrap();
        assert!(completed.completed_at.is_some());
        assert!(store
            .set_completed(&early.id, false)
            .unwrap()
            .completed_at
            .is_none());

        let mut changed = mutation("Early updated", Some("2026-09-02"));
        changed.notes = "Updated notes".to_string();
        let updated = store.update(&early.id, changed).unwrap();
        assert_eq!(updated.title, "Early updated");
        assert_eq!(updated.created_at, early.created_at);

        store.delete(&late.id).unwrap();
        assert_eq!(store.list().unwrap().len(), 2);
        assert_eq!(store.get(&late.id), Err("task_not_found".to_string()));
    }

    #[test]
    fn persists_after_restart() {
        let temp = TempDir::new().unwrap();
        let database = temp.path().join("tasks.sqlite3");
        let id = {
            let store = TaskStore::open_for_test(&database, temp.path().join("backups")).unwrap();
            store.create(mutation("Persistent", None)).unwrap().id
        };
        let reopened = TaskStore::open_for_test(&database, temp.path().join("backups")).unwrap();
        assert_eq!(reopened.get(&id).unwrap().title, "Persistent");
    }

    #[test]
    fn rejects_unsupported_major_and_invalid_dates() {
        let mut task = TaskRecord {
            schema_version: "2.0.0".to_string(),
            id: Uuid::new_v4().to_string(),
            title: "Version".to_string(),
            notes: String::new(),
            horizon: "short".to_string(),
            priority: "normal".to_string(),
            start_date: None,
            due_date: None,
            created_at: "2026-08-31T12:00:00Z".to_string(),
            updated_at: "2026-08-31T12:00:00Z".to_string(),
            completed_at: None,
            origin: None,
        };
        assert_eq!(validate_task(&task), Err("unsupported_schema_version"));
        task.schema_version = TASK_SCHEMA_VERSION.to_string();
        task.start_date = Some("2026-02-30".to_string());
        assert_eq!(validate_task(&task), Err("date"));
    }

    #[test]
    fn migrates_valid_payload_exactly_once_and_preserves_identity() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let payload = r#"[{
            "id":"22222222-2222-4222-8222-222222222222",
            "title":"Legacy completed",
            "notes":"kept",
            "horizon":"mid",
            "priority":"important",
            "startDate":"",
            "dueDate":"2026-09-03",
            "createdAt":"2026-08-01T09:00:00Z",
            "completedAt":"2026-08-31T15:30:00Z"
        }]"#;

        let first = store.migrate_legacy(Some(payload)).unwrap();
        assert!(matches!(
            first,
            LegacyMigrationResult::Migrated {
                imported_count: 1,
                ..
            }
        ));
        let task = store.get("22222222-2222-4222-8222-222222222222").unwrap();
        assert_eq!(task.id, "22222222-2222-4222-8222-222222222222");
        assert_eq!(task.completed_at.as_deref(), Some("2026-08-31T15:30:00Z"));
        assert_eq!(task.start_date, None);
        assert_eq!(task.origin.unwrap().kind, "migration");
        assert!(matches!(
            store.migrate_legacy(Some("[]")).unwrap(),
            LegacyMigrationResult::AlreadyMigrated { imported_count: 1 }
        ));
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn malformed_migration_keeps_database_unchanged_and_is_retryable() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let existing = store.create(mutation("Existing", None)).unwrap();
        let malformed = r#"[{
            "id":"not-a-uuid","title":"Broken","notes":"","horizon":"short",
            "priority":"normal","startDate":"","dueDate":"","createdAt":"bad",
            "completedAt":null
        }]"#;
        assert_eq!(
            store.migrate_legacy(Some(malformed)),
            Err("legacy_record_invalid:0:timestamp".to_string())
        );
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(temp
            .path()
            .join("backups")
            .read_dir()
            .unwrap()
            .next()
            .is_some());

        let valid = format!(
            r#"[{{"id":"{}","title":"Retried","notes":"","horizon":"long","priority":"normal","startDate":null,"dueDate":null,"createdAt":"2026-08-31T12:00:00Z","completedAt":null}}]"#,
            Uuid::new_v4()
        );
        assert!(matches!(
            store.migrate_legacy(Some(&valid)).unwrap(),
            LegacyMigrationResult::Migrated {
                imported_count: 1,
                ..
            }
        ));
        assert_eq!(store.list().unwrap().len(), 2);
        assert_eq!(store.get(&existing.id).unwrap().title, "Existing");
    }

    #[test]
    fn concurrent_bootstrap_migrates_exactly_once() {
        let temp = TempDir::new().unwrap();
        let store = Arc::new(test_store(&temp));
        let barrier = Arc::new(Barrier::new(2));
        let payload = r#"[{"id":"77777777-7777-4777-8777-777777777777","title":"Concurrent","notes":"","horizon":"short","priority":"normal","startDate":null,"dueDate":null,"createdAt":"2026-08-31T12:00:00Z","completedAt":null}]"#;

        let handles: Vec<_> = (0..2)
            .map(|_| {
                let store = Arc::clone(&store);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    store.migrate_legacy(Some(payload)).unwrap()
                })
            })
            .collect();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();

        assert_eq!(
            results
                .iter()
                .filter(|result| matches!(result, LegacyMigrationResult::Migrated { .. }))
                .count(),
            1
        );
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn app_state_migrates_once_and_rejects_unknown_keys() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let mut legacy = HashMap::new();
        legacy.insert(
            "tideplan.countdowns.v1".to_string(),
            serde_json::json!([{"id": "first"}]),
        );

        let migrated = store.bootstrap_app_state(legacy.clone()).unwrap();
        assert_eq!(
            migrated.get("tideplan.countdowns.v1"),
            legacy.get("tideplan.countdowns.v1")
        );

        let mut later_legacy = HashMap::new();
        later_legacy.insert(
            "tideplan.countdowns.v1".to_string(),
            serde_json::json!([{"id": "should-not-overwrite"}]),
        );
        let unchanged = store.bootstrap_app_state(later_legacy).unwrap();
        assert_eq!(
            unchanged.get("tideplan.countdowns.v1"),
            legacy.get("tideplan.countdowns.v1")
        );
        assert_eq!(
            store.set_app_state("unknown", serde_json::json!({})),
            Err("app_state_key_invalid".to_string())
        );
    }

    #[test]
    fn backup_restore_is_atomic_and_preserves_app_state() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let original = store
            .create(mutation("Before backup", Some("2026-09-20")))
            .unwrap();
        store
            .set_app_state(
                "tideplan.reminders.v1",
                serde_json::json!({"enabled": true, "times": ["09:00", "19:00"]}),
            )
            .unwrap();
        let backup = store.export_backup().unwrap();

        store.delete(&original.id).unwrap();
        store
            .set_app_state(
                "tideplan.reminders.v1",
                serde_json::json!({"enabled": false}),
            )
            .unwrap();
        store.restore_backup(backup).unwrap();

        assert_eq!(store.get(&original.id).unwrap().title, "Before backup");
        assert_eq!(
            store
                .export_backup()
                .unwrap()
                .app_state
                .get("tideplan.reminders.v1"),
            Some(&serde_json::json!({"enabled": true, "times": ["09:00", "19:00"]}))
        );

        let invalid = DataBackup {
            schema_version: "2.0.0".to_string(),
            created_at: now_timestamp(),
            tasks: Vec::new(),
            app_state: HashMap::new(),
        };
        assert_eq!(
            store.restore_backup(invalid),
            Err("backup_schema_unsupported".to_string())
        );
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn restoring_empty_state_does_not_reimport_legacy_storage() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let mut legacy = HashMap::new();
        legacy.insert(
            "tideplan.countdowns.v1".to_string(),
            serde_json::json!([{"id": "legacy"}]),
        );
        store.bootstrap_app_state(legacy.clone()).unwrap();

        store
            .restore_backup(DataBackup {
                schema_version: BACKUP_SCHEMA_VERSION.to_string(),
                created_at: now_timestamp(),
                tasks: Vec::new(),
                app_state: HashMap::new(),
            })
            .unwrap();

        let state = store.bootstrap_app_state(legacy).unwrap();
        assert!(state.is_empty());
    }

    #[test]
    fn assistant_conversation_survives_backup_restore_and_restart() {
        let temp = TempDir::new().unwrap();
        let document = serde_json::json!({"version":1,"persona":{"name":"小汐","tone":"gentle","color":"sea","preferences":"周日复盘"},"scopes":["tasks"],"draft":"一个尚未发送的想法","messages":[]});
        {
            let store = test_store(&temp);
            store
                .set_app_state("tideplan.assistant.v1", document.clone())
                .unwrap();
            let backup = store.export_backup().unwrap();
            store
                .set_app_state("tideplan.assistant.v1", serde_json::Value::Null)
                .unwrap();
            store.restore_backup(backup).unwrap();
        }
        let restored = test_store(&temp)
            .bootstrap_app_state(HashMap::new())
            .unwrap();
        assert_eq!(restored.get("tideplan.assistant.v1"), Some(&document));
    }

    #[test]
    fn bead_document_survives_backup_restore_and_restart() {
        let temp = TempDir::new().unwrap();
        let document = serde_json::json!({"version": 1, "title": "Beads", "width": 2, "height": 1,
            "palette": [{"hex": "#ed8467", "name": "Coral"}], "cells": [0, -1]});
        {
            let store = test_store(&temp);
            store
                .set_app_state("tideplan.bead-pattern.v1", document.clone())
                .unwrap();
            let backup = store.export_backup().unwrap();
            store
                .set_app_state("tideplan.bead-pattern.v1", serde_json::Value::Null)
                .unwrap();
            store.restore_backup(backup).unwrap();
        }
        let store = test_store(&temp);
        let restored = store.bootstrap_app_state(HashMap::new()).unwrap();
        assert_eq!(restored.get("tideplan.bead-pattern.v1"), Some(&document));
    }

    #[test]
    fn people_training_and_travel_survive_backup_and_restart() {
        let temp = TempDir::new().unwrap();
        let document = serde_json::json!({"version":1,
            "people":[{"id":"p","name":"Test","birthday":"","relationship":"自己","dietary":"","preferences":"","hobbies":"","strengths":"","healthNotes":"","notes":"","archived":false}],
            "training":[{"id":"f","personId":"p","title":"训练","startDate":"2026-09-16","intervalDays":2,"cycles":12,"goal":"","advice":"","archived":false,"exercises":[{"id":"e","name":"深蹲","unit":"次","sets":3,"reps":12}]}],
            "workouts":[{"id":"w","planId":"f","date":"2026-09-16","notes":"","updatedAt":"2026-09-16T09:00:00Z","completed":true,"actual":{"e":[12,10,8]}}],
            "trips":[{"id":"t","title":"旅行","origin":"上海","destination":"杭州","startDate":"2026-09-16","endDate":"2026-09-17","budget":3000,"purpose":"","preferences":"","transport":"","accommodation":"","summary":"","participantIds":["p"],"stops":[],"routes":[]}]});
        {
            let store = test_store(&temp);
            store
                .set_app_state("tideplan.life.v1", document.clone())
                .unwrap();
            let backup = store.export_backup().unwrap();
            assert!(!backup.app_state.contains_key("map-settings"));
            store
                .set_app_state("tideplan.life.v1", serde_json::Value::Null)
                .unwrap();
            store.restore_backup(backup).unwrap();
        }
        let store = test_store(&temp);
        assert_eq!(
            store
                .bootstrap_app_state(HashMap::new())
                .unwrap()
                .get("tideplan.life.v1"),
            Some(&document)
        );
    }

    #[test]
    fn restore_saves_previous_data_and_rejects_corrupt_nested_documents() {
        let temp = TempDir::new().unwrap();
        let store = test_store(&temp);
        let task = store
            .create(mutation("Keep until validated", None))
            .unwrap();
        let mut backup = store.export_backup().unwrap();
        let examples = [
            (
                "tideplan.life.v1",
                serde_json::json!({"version":1,"people":[{"id":"p","name":"incomplete"}],"training":[],"trips":[],"workouts":[]}),
            ),
            (
                "tideplan.meal-plan.v1",
                serde_json::json!({"planTitle":"bad","weekSummary":"","days":[null],"shoppingList":[]}),
            ),
            (
                "tideplan.bead-pattern.v1",
                serde_json::json!({"version":1,"title":"bad","width":2,"height":1,"palette":[{"hex":"#ffffff","name":"white"}],"cells":[0,9]}),
            ),
            (
                "tideplan.reminders.v1",
                serde_json::json!({"enabled":true,"times":["99:00","19:00"]}),
            ),
        ];
        for (key, value) in examples {
            backup.app_state.clear();
            backup.app_state.insert(key.into(), value);
            assert!(store
                .restore_backup(backup.clone())
                .unwrap_err()
                .starts_with("backup_document_invalid:"));
            assert_eq!(store.list().unwrap().len(), 1);
        }
        backup.app_state.clear();
        backup.tasks.clear();
        let path = store.restore_backup(backup).unwrap();
        assert!(store.list().unwrap().is_empty());
        let previous: DataBackup =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(previous.tasks[0].id, task.id);
        store.restore_backup(previous).unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn failed_safety_snapshot_prevents_restore() {
        let temp = TempDir::new().unwrap();
        let blocked = temp.path().join("not-a-directory");
        fs::write(&blocked, "test").unwrap();
        let store = TaskStore::open_for_test(&temp.path().join("tasks.db"), blocked).unwrap();
        store.create(mutation("Keep me", None)).unwrap();
        let mut backup = store.export_backup().unwrap();
        backup.tasks.clear();
        assert_eq!(
            store.restore_backup(backup).unwrap_err(),
            "backup_snapshot_failed"
        );
        assert_eq!(store.list().unwrap().len(), 1);
    }
}
