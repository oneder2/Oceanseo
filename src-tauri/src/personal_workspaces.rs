//! Personal Linux scenes are inside a profile, not account workspaces.
//! This database is additive; the existing task/schema and backup paths stay intact.
use crate::tasks::TaskStore;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
#[path = "personal_shared.rs"]
mod shared;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PersonalBackup {
    #[serde(default)]
    pub shared_tools: bool,
    pub personal_workspace_version: u8,
    pub created_at: String,
    pub document: Document,
    pub backup: crate::tasks::DataBackup,
    pub states: HashMap<String, HashMap<String, serde_json::Value>>,
    pub work_archives: HashMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tool {
    pub id: String,
    pub module: String,
    pub archived: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub main: bool,
    pub style: String,
    pub deleted: bool,
    pub tools: Vec<Tool>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    pub version: u8,
    pub revision: u64,
    pub active_id: String,
    pub workspaces: Vec<Workspace>,
    pub task_owners: HashMap<String, String>,
}
impl Default for Document {
    fn default() -> Self {
        Self {
            version: 1,
            revision: 0,
            active_id: "main".into(),
            task_owners: HashMap::new(),
            workspaces: vec![Workspace {
                id: "main".into(),
                name: "主工作区".into(),
                main: true,
                style: "neutral".into(),
                deleted: false,
                tools: vec![],
            }],
        }
    }
}
impl Document {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.workspaces.len() > 100
            || self.workspaces.iter().filter(|w| w.main).count() != 1
            || !self
                .workspaces
                .iter()
                .any(|w| w.id == "main" && w.main && !w.deleted)
            || !self
                .workspaces
                .iter()
                .any(|w| w.id == self.active_id && !w.deleted)
        {
            return Err("主工作区必须唯一且不可删除".into());
        }
        let mut ids = HashSet::new();
        let mut tools = HashSet::new();
        for w in &self.workspaces {
            if (w.id != "main"
                && uuid::Uuid::parse_str(&w.id)
                    .map(|v| v.to_string())
                    .ok()
                    .as_deref()
                    != Some(w.id.as_str()))
                || !ids.insert(&w.id)
                || w.name.trim().is_empty()
                || w.name.chars().count() > 40
                || !["neutral", "executive", "technical", "living", "study"]
                    .contains(&w.style.as_str())
            {
                return Err("工作区名称或风格无效".into());
            }
            let mut enabled = HashSet::new();
            for t in &w.tools {
                if uuid::Uuid::parse_str(&t.id)
                    .map(|v| v.to_string())
                    .ok()
                    .as_deref()
                    != Some(t.id.as_str())
                    || !tools.insert(&t.id)
                    || !crate::capabilities::MODULES.contains(&t.module.as_str())
                    || ["overview", "tasks"].contains(&t.module.as_str())
                    || (!t.archived && !enabled.insert(&t.module))
                {
                    return Err("工具实例无效或重复".into());
                }
            }
        }
        if self
            .task_owners
            .values()
            .any(|id| id != "pending" && !self.workspaces.iter().any(|w| w.id == *id && !w.deleted))
        {
            return Err("任务所属工作区不存在".into());
        }
        Ok(())
    }
    pub fn require_workspace(&self, id: &str) -> Result<&Workspace, String> {
        self.workspaces
            .iter()
            .find(|w| w.id == id && !w.deleted)
            .ok_or_else(|| "工作区不存在或已删除".into())
    }
}

pub struct PersonalRuntime {
    pub(crate) root: PathBuf,
    pub(crate) operation_gate: Mutex<()>,
    #[cfg(desktop)]
    work_stores: Mutex<HashMap<String, Arc<crate::work_monitor::WorkMonitorStore>>>,
    maps: Mutex<HashMap<String, Arc<crate::maps::MapStore>>>,
    hosts: Mutex<HashMap<String, Arc<crate::infrastructure::HostRuntime>>>,
    registry: Mutex<Connection>,
    stores: Mutex<HashMap<String, Arc<TaskStore>>>,
}
impl PersonalRuntime {
    pub fn backup(&self, base: &TaskStore) -> Result<PersonalBackup, String> {
        let document = self.document()?;
        let mut states = HashMap::new();
        let mut work_archives = HashMap::new();
        for w in &document.workspaces {
            let directory = self.root.join("personal-workspaces").join(&w.id);
            if directory.join("state.sqlite3").exists() {
                let store = TaskStore::open_personal(
                    &self.root.join("oceanseo-tasks.sqlite3"),
                    &directory,
                    &self.root.join("personal-workspaces/registry.sqlite3"),
                )?;
                states.insert(w.id.clone(), store.export_backup()?.app_state);
            } else {
                states.insert(w.id.clone(), HashMap::new());
            }
            #[cfg(desktop)]
            if directory.join("work-monitor.sqlite3").exists() {
                let store = crate::work_monitor::WorkMonitorStore::open(
                    &directory.join("work-monitor.sqlite3"),
                    directory.join("work-monitor-exports"),
                )?;
                work_archives.insert(w.id.clone(), store.archive()?);
            }
        }
        Ok(PersonalBackup {
            shared_tools: self.shared_marker().exists(),
            personal_workspace_version: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
            document,
            backup: base.export_backup()?,
            states,
            work_archives,
        })
    }
    fn apply_backup(&self, base: &TaskStore, backup: PersonalBackup) -> Result<(), String> {
        // These writes are protected by a durable rollback journal. Restoration
        // is not advertised as a cross-database SQLite transaction.
        self.restore_sharing_marker(&backup)?;
        base.restore_backup(backup.backup)?;
        for w in &backup.document.workspaces {
            let directory = self.root.join("personal-workspaces").join(&w.id);
            crate::profiles::private_dir(&directory)?;
            let store = TaskStore::open_personal(
                &self.root.join("oceanseo-tasks.sqlite3"),
                &directory,
                &self.root.join("personal-workspaces/registry.sqlite3"),
            )?;
            store.replace_personal_state(backup.states.get(&w.id).cloned().unwrap_or_default())?;
            #[cfg(desktop)]
            if let Some(archive) = backup.work_archives.get(&w.id) {
                crate::work_monitor::WorkMonitorStore::open(
                    &directory.join("work-monitor.sqlite3"),
                    directory.join("work-monitor-exports"),
                )?
                .restore_personal_archive(archive)?;
            } else if directory.join("work-monitor.sqlite3").exists() {
                crate::work_monitor::WorkMonitorStore::open(
                    &directory.join("work-monitor.sqlite3"),
                    directory.join("work-monitor-exports"),
                )?
                .clear_personal_history()?;
            }
        }
        let connection = self.registry.lock().map_err(|_| "工作区存储忙碌")?;
        connection
            .execute(
                "INSERT OR REPLACE INTO document(id,value) VALUES(1,?1)",
                [serde_json::to_string(&backup.document).map_err(|e| e.to_string())?],
            )
            .map_err(|e| e.to_string())?;
        self.stores.lock().map_err(|_| "工作区存储忙碌")?.clear();
        #[cfg(desktop)]
        self.work_stores
            .lock()
            .map_err(|_| "工作区存储忙碌")?
            .clear();
        Ok(())
    }
    pub fn recover_assignments(&self, base: &TaskStore) -> Result<(), String> {
        let directory = self
            .root
            .join("personal-workspaces/task-assignment-journal");
        if !directory.exists() {
            return Ok(());
        }
        for entry in std::fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|v| v.to_str()) != Some("json") {
                continue;
            }
            let value: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|_| "任务归属恢复记录损坏")?;
            let task: crate::tasks::TaskRecord = serde_json::from_value(value["task"].clone())
                .map_err(|_| "任务归属恢复记录无效")?;
            let owner = value["owner"].as_str().ok_or("任务归属恢复记录无效")?;
            if base.get(&task.id).ok().as_ref() == Some(&task) {
                let mut connection = self.registry.lock().map_err(|_| "工作区资料忙碌")?;
                let tx = connection.transaction().map_err(|e| e.to_string())?;
                let raw: String = tx
                    .query_row("SELECT value FROM document WHERE id=1", [], |r| r.get(0))
                    .map_err(|e| e.to_string())?;
                let mut doc: Document = serde_json::from_str(&raw).map_err(|_| "工作区资料损坏")?;
                let valid = owner == "pending"
                    || doc.workspaces.iter().any(|w| w.id == owner && !w.deleted);
                doc.task_owners.insert(
                    task.id,
                    if valid {
                        owner.into()
                    } else {
                        "pending".into()
                    },
                );
                doc.revision += 1;
                tx.execute(
                    "UPDATE document SET value=?1 WHERE id=1",
                    [serde_json::to_string(&doc).map_err(|e| e.to_string())?],
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            std::fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn recover_restore(&self, base: &TaskStore) -> Result<(), String> {
        let journal = self.root.join("personal-workspaces/restore-rollback.json");
        if journal.exists() {
            let bytes = std::fs::read(&journal).map_err(|e| e.to_string())?;
            let backup: PersonalBackup =
                serde_json::from_slice(&bytes).map_err(|_| "恢复日志损坏，请保留原资料")?;
            self.apply_backup(base, backup)?;
            std::fs::remove_file(journal).map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn restore(&self, base: &TaskStore, backup: PersonalBackup) -> Result<String, String> {
        if backup.personal_workspace_version != 1 {
            return Err("工作区备份版本不兼容".into());
        }
        backup.document.validate()?;
        if backup.shared_tools && !backup.states.contains_key("main") {
            return Err("共享工具备份缺少主资料".into());
        }
        if backup
            .states
            .keys()
            .chain(backup.work_archives.keys())
            .any(|id| !backup.document.workspaces.iter().any(|w| &w.id == id))
        {
            return Err("工作区备份存在未知作用域".into());
        }
        // Validate against throwaway databases before replacing any user data.
        let stage = self
            .root
            .join("personal-workspaces")
            .join(format!("restore-validation-{}", uuid::Uuid::new_v4()));
        crate::profiles::private_dir(&stage)?;
        let validation = (|| {
            let temporary = TaskStore::open(&stage.join("tasks.sqlite3"))?;
            temporary.restore_backup(backup.backup.clone())?;
            for (id, state) in &backup.states {
                crate::profiles::private_dir(&stage.join(id))?;
                let store = TaskStore::open_personal(
                    &stage.join("tasks.sqlite3"),
                    &stage.join(id),
                    &self.root.join("personal-workspaces/registry.sqlite3"),
                )?;
                store.replace_personal_state(state.clone())?;
            }
            #[cfg(desktop)]
            for (id, archive) in &backup.work_archives {
                crate::profiles::private_dir(&stage.join(id))?;
                crate::work_monitor::WorkMonitorStore::open(
                    &stage.join(id).join("work.sqlite3"),
                    stage.join(id).join("exports"),
                )?
                .restore_personal_archive(archive)?;
            }
            Ok::<(), String>(())
        })();
        std::fs::remove_dir_all(&stage).map_err(|e| e.to_string())?;
        validation?;
        let old = self.backup(base)?;
        let recovery = self
            .root
            .join("personal-workspaces")
            .join(format!("before-restore-{}.json", uuid::Uuid::new_v4()));
        let bytes = serde_json::to_vec_pretty(&old).map_err(|e| e.to_string())?;
        crate::profiles::write_private(&recovery, &bytes)?;
        let journal = self.root.join("personal-workspaces/restore-rollback.json");
        crate::profiles::write_private(&journal, &bytes)?;
        if let Err(error) = self.apply_backup(base, backup) {
            if self.apply_backup(base, old).is_err() {
                return Err(format!(
                    "恢复中断，已保留回滚日志；重启后恢复原资料：{error}"
                ));
            }
            std::fs::remove_file(journal).map_err(|e| e.to_string())?;
            return Err(error);
        }
        std::fs::remove_file(journal).map_err(|e| e.to_string())?;
        let assignments = self
            .root
            .join("personal-workspaces/task-assignment-journal");
        if assignments.exists() {
            for entry in std::fs::read_dir(assignments).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(recovery.to_string_lossy().into())
    }
    pub fn open(root: PathBuf) -> Result<Self, String> {
        crate::profiles::private_dir(&root.join("personal-workspaces"))?;
        let connection = Connection::open(root.join("personal-workspaces/registry.sqlite3"))
            .map_err(|e| e.to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("CREATE TABLE IF NOT EXISTS document (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);").map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            operation_gate: Mutex::new(()),
            #[cfg(desktop)]
            work_stores: Mutex::new(HashMap::new()),
            maps: Mutex::new(HashMap::new()),
            hosts: Mutex::new(HashMap::new()),
            registry: Mutex::new(connection),
            stores: Mutex::new(HashMap::new()),
        })
    }
    pub fn document(&self) -> Result<Document, String> {
        let connection = self.registry.lock().map_err(|_| "工作区资料忙碌")?;
        let raw: Option<String> = connection
            .query_row("SELECT value FROM document WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        let doc = raw
            .map(|raw| serde_json::from_str::<Document>(&raw))
            .transpose()
            .map_err(|_| "工作区资料损坏，原数据保留")?
            .unwrap_or_default();
        doc.validate()?;
        Ok(doc)
    }
    pub fn initialize(&self, backup: &crate::tasks::DataBackup) -> Result<Document, String> {
        let mut connection = self.registry.lock().map_err(|_| "工作区资料忙碌")?;
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        let existing: Option<String> = tx
            .query_row("SELECT value FROM document WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(raw) = existing {
            let mut doc: Document = serde_json::from_str(&raw).map_err(|_| "工作区资料损坏")?;
            doc.validate()?;
            let original = doc.task_owners.clone();
            let tasks: HashSet<_> = backup.tasks.iter().map(|task| task.id.as_str()).collect();
            doc.task_owners.retain(|id, _| tasks.contains(id.as_str()));
            for task in &backup.tasks {
                doc.task_owners
                    .entry(task.id.clone())
                    .or_insert_with(|| "pending".into());
            }
            if doc.task_owners != original {
                doc.revision += 1;
                tx.execute(
                    "UPDATE document SET value=?1 WHERE id=1",
                    [serde_json::to_string(&doc).map_err(|e| e.to_string())?],
                )
                .map_err(|e| e.to_string())?;
                tx.commit().map_err(|e| e.to_string())?;
            }
            return Ok(doc);
        }
        // A scene store attaches this registry. Its immediate bootstrap
        // transaction also reserves attached databases, so no registry read
        // transaction may remain open while preparing the migration copy.
        drop(tx);
        drop(connection);
        let mut doc = Document::default();
        for task in &backup.tasks {
            doc.task_owners.insert(task.id.clone(), "pending".into());
        }
        let old_work_path = self.root.join("oceanseo-work-monitor.sqlite3");
        let work_meaningful = if old_work_path.exists() {
            let work = Connection::open(&old_work_path).map_err(|e| e.to_string())?;
            work.query_row("SELECT (SELECT count(*) FROM work_projects)>0 OR (SELECT workspace_root!='' OR gworkspace_root!='' OR enabled!=0 FROM work_monitor_config WHERE id=1)", [], |r| r.get::<_,bool>(0)).map_err(|e| e.to_string())?
        } else {
            false
        };
        let meaningful = work_meaningful
            || backup.app_state.iter().any(|(key, value)| {
                key != "tideplan.reminders.v1"
                    && !value.is_null()
                    && value != &serde_json::json!([])
            });
        if meaningful {
            let id = uuid::Uuid::new_v4().to_string();
            let directory = self.root.join("personal-workspaces").join(&id);
            crate::profiles::private_dir(&directory)?;
            crate::profiles::write_private(
                &directory.join("before-workspaces.json"),
                &serde_json::to_vec_pretty(backup).map_err(|e| e.to_string())?,
            )?;
            let store = TaskStore::open_personal(
                &self.root.join("oceanseo-tasks.sqlite3"),
                &directory,
                &self.root.join("personal-workspaces/registry.sqlite3"),
            )?;
            store.bootstrap_app_state(backup.app_state.clone())?;
            let mut modules = HashSet::new();
            if work_meaningful {
                Connection::open(&old_work_path)
                    .map_err(|e| e.to_string())?
                    .execute(
                        "VACUUM INTO ?1",
                        [directory
                            .join("work-monitor.sqlite3")
                            .to_string_lossy()
                            .as_ref()],
                    )
                    .map_err(|e| e.to_string())?;
                modules.insert("work-monitor".to_string());
            }
            let old_map = self.root.join("map-settings.json");
            if old_map.exists() {
                crate::profiles::write_private(
                    &directory.join("map-settings.json"),
                    &std::fs::read(old_map).map_err(|e| e.to_string())?,
                )?;
            }
            let old_host = self.root.join("host-credentials.json");
            if old_host.exists() {
                crate::profiles::write_private(
                    &directory.join("host-credentials.json"),
                    &std::fs::read(old_host).map_err(|e| e.to_string())?,
                )?;
            }

            for (key, value) in &backup.app_state {
                if value.is_null() || value == &serde_json::json!([]) {
                    continue;
                }
                for module in crate::capabilities::changed_modules(key, None, Some(value))? {
                    modules.insert(module.to_string());
                }
            }
            doc.workspaces.push(Workspace {
                id,
                name: "旧版资料".into(),
                main: false,
                style: "neutral".into(),
                deleted: false,
                tools: modules
                    .into_iter()
                    .filter(|m| !["tasks", "overview"].contains(&m.as_str()))
                    .map(|module| Tool {
                        id: uuid::Uuid::new_v4().to_string(),
                        module,
                        archived: false,
                    })
                    .collect(),
            });
        }
        let mut connection = self.registry.lock().map_err(|_| "工作区资料忙碌")?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let existing: Option<String> = tx
            .query_row("SELECT value FROM document WHERE id=1", [], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(raw) = existing {
            let doc: Document = serde_json::from_str(&raw).map_err(|_| "工作区资料损坏")?;
            doc.validate()?;
            return Ok(doc);
        }
        tx.execute(
            "INSERT INTO document(id,value) VALUES(1,?1)",
            [serde_json::to_string(&doc).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(doc)
    }
    pub fn save(&self, mut next: Document, expected: u64) -> Result<Document, String> {
        let mut connection = self.registry.lock().map_err(|_| "工作区资料忙碌")?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let raw: String = tx
            .query_row("SELECT value FROM document WHERE id=1", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let old: Document = serde_json::from_str(&raw).map_err(|_| "工作区资料损坏")?;
        if old.revision != expected {
            return Err("工作区已更新，请重新载入后重试".into());
        }
        // A scene edit must not overwrite an assignment committed by a task editor.
        next.task_owners = old.task_owners;
        for owner in next.task_owners.values_mut() {
            if owner != "pending" && !next.workspaces.iter().any(|w| w.id == *owner && !w.deleted) {
                *owner = "pending".into();
            }
        }
        next.revision = expected + 1;
        next.validate()?;
        if next
            .workspaces
            .iter()
            .any(|w| !old.workspaces.iter().any(|o| o.id == w.id) && w.main)
        {
            return Err("不能增加第二个主工作区".into());
        }
        tx.execute(
            "UPDATE document SET value=?1 WHERE id=1",
            [serde_json::to_string(&next).map_err(|e| e.to_string())?],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }
    pub fn require_module(&self, scope: &str, module: &str) -> Result<(), String> {
        let doc = self.document()?;
        let w = doc.require_workspace(scope)?;
        if !["tasks", "overview"].contains(&module)
            && !w.tools.iter().any(|t| t.module == module && !t.archived)
        {
            return Err("当前工作区尚未添加这个工具".into());
        }
        Ok(())
    }
    #[cfg(desktop)]
    pub fn work_store(
        &self,
        scope: &str,
        app: &tauri::AppHandle,
    ) -> Result<Arc<crate::work_monitor::WorkMonitorStore>, String> {
        self.require_module(scope, "work-monitor")?;
        let scope = "main";
        let mut stores = self.work_stores.lock().map_err(|_| "工作观察存储忙碌")?;
        if let Some(store) = stores.get(scope) {
            return Ok(store.clone());
        }
        let directory = self.root.join("personal-workspaces").join(scope);
        crate::profiles::private_dir(&directory)?;
        let store = Arc::new(crate::work_monitor::WorkMonitorStore::open(
            &directory.join("work-monitor.sqlite3"),
            directory.join("work-monitor-exports"),
        )?);
        store.bind_authorization(
            app.state::<crate::capabilities::CapabilityRuntime>()
                .inner()
                .clone(),
            app.state::<crate::profiles::ProfileRuntime>()
                .inner()
                .clone(),
        )?;
        stores.insert(scope.into(), store.clone());
        Ok(store)
    }
    pub fn map(
        &self,
        scope: &str,
        app: &tauri::AppHandle,
    ) -> Result<Arc<crate::maps::MapStore>, String> {
        self.document()?.require_workspace(scope)?;
        let scope = "main";
        let mut stores = self.maps.lock().map_err(|_| "地图配置忙碌")?;
        if let Some(store) = stores.get(scope) {
            return Ok(store.clone());
        }
        let directory = self.root.join("personal-workspaces").join(scope);
        crate::profiles::private_dir(&directory)?;
        let store = Arc::new(crate::maps::MapStore::open_with_cipher(
            &directory.join("map-settings.json"),
            app.state::<crate::infrastructure::HostRuntime>()
                .cipher
                .clone(),
        )?);
        stores.insert(scope.into(), store.clone());
        Ok(store)
    }
    pub fn host(
        &self,
        scope: &str,
        app: &tauri::AppHandle,
    ) -> Result<Arc<crate::infrastructure::HostRuntime>, String> {
        self.require_module(scope, "infrastructure")?;
        let scope = "main";
        let mut hosts = self.hosts.lock().map_err(|_| "主机凭据忙碌")?;
        if let Some(runtime) = hosts.get(scope) {
            return Ok(runtime.clone());
        }
        let directory = self.root.join("personal-workspaces").join(scope);
        crate::profiles::private_dir(&directory)?;
        let runtime = Arc::new(crate::infrastructure::HostRuntime {
            path: directory.join("host-credentials.json"),
            cipher: app
                .state::<crate::infrastructure::HostRuntime>()
                .cipher
                .clone(),
            gate: tokio::sync::Mutex::new(()),
        });
        hosts.insert(scope.into(), runtime.clone());
        Ok(runtime)
    }
    pub fn store(&self, scope: &str, app: &tauri::AppHandle) -> Result<Arc<TaskStore>, String> {
        self.document()?.require_workspace(scope)?;
        let scope = "main";
        let mut stores = self.stores.lock().map_err(|_| "工作区存储忙碌")?;
        if let Some(store) = stores.get(scope) {
            return Ok(store.clone());
        }
        let directory = self.root.join("personal-workspaces").join(scope);
        crate::profiles::private_dir(&directory)?;
        let store = Arc::new(TaskStore::open_personal(
            &self.root.join("oceanseo-tasks.sqlite3"),
            &directory,
            &self.root.join("personal-workspaces/registry.sqlite3"),
        )?);
        store.bind_authorization(
            app.state::<crate::capabilities::CapabilityRuntime>()
                .inner()
                .clone(),
            app.state::<crate::profiles::ProfileRuntime>()
                .inner()
                .clone(),
        )?;
        stores.insert(scope.into(), store.clone());
        Ok(store)
    }
}

pub fn require_personal(app: &tauri::AppHandle) -> Result<(), String> {
    if std::env::consts::OS != "linux" {
        return Err("仅适用于 Linux 个人版".into());
    }
    app.state::<crate::profiles::ProfileRuntime>()
        .while_current(|| Ok(()))?;
    Ok(())
}
#[tauri::command]
pub async fn personal_workspaces(
    app: tauri::AppHandle,
    legacy: Option<HashMap<String, serde_json::Value>>,
    raw_payload: Option<String>,
) -> Result<Document, String> {
    require_personal(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = scene_operation(&app, &Some("main".into()))?;
        if let Some(legacy) = legacy {
            app.state::<TaskStore>().bootstrap_app_state(legacy)?;
        }
        if raw_payload.is_some() {
            app.state::<TaskStore>()
                .migrate_legacy(raw_payload.as_deref())?;
        }
        let backup = app.state::<TaskStore>().export_backup()?;
        let runtime = app.state::<PersonalRuntime>();
        let document = runtime.initialize(&backup)?;
        runtime.ensure_shared_data(&app.state::<TaskStore>())?;
        Ok(document)
    })
    .await
    .map_err(|_| "工作区初始化中断".to_string())?
}
#[tauri::command]
pub async fn save_personal_workspaces(
    app: tauri::AppHandle,
    document: Document,
    expected_revision: u64,
) -> Result<Document, String> {
    require_personal(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = scene_operation(&app, &Some(document.active_id.clone()))?;
        app.state::<PersonalRuntime>()
            .save(document, expected_revision)
    })
    .await
    .map_err(|_| "工作区保存中断".to_string())?
}
pub(crate) async fn scoped_store<T: Send + 'static>(
    app: tauri::AppHandle,
    scope: Option<String>,
    operation: impl FnOnce(&TaskStore) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = scene_operation(&app, &scope)?;
        if let Some(scope) = scope {
            require_personal(&app)?;
            let store = app.state::<PersonalRuntime>().store(&scope, &app)?;
            operation(&store)
        } else {
            operation(app.state::<TaskStore>().inner())
        }
    })
    .await
    .map_err(|_| "工作区操作中断".to_string())?
}

pub fn check_scope(
    app: &tauri::AppHandle,
    scope: &Option<String>,
    module: &str,
) -> Result<(), String> {
    if let Some(scope) = scope {
        require_personal(app)?;
        app.state::<PersonalRuntime>()
            .require_module(scope, module)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn export_personal_backup(app: tauri::AppHandle) -> Result<PersonalBackup, String> {
    require_personal(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = scene_operation(&app, &Some("main".into()))?;
        app.state::<PersonalRuntime>()
            .backup(&app.state::<TaskStore>())
    })
    .await
    .map_err(|_| "备份中断".to_string())?
}
#[tauri::command]
pub async fn restore_personal_backup(
    app: tauri::AppHandle,
    backup: PersonalBackup,
) -> Result<String, String> {
    require_personal(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = scene_operation(&app, &Some("main".into()))?;
        app.state::<PersonalRuntime>()
            .restore(&app.state::<TaskStore>(), backup)
    })
    .await
    .map_err(|_| "恢复中断".to_string())?
}

pub(crate) fn scene_operation<'a>(
    app: &'a tauri::AppHandle,
    scope: &Option<String>,
) -> Result<Option<std::sync::MutexGuard<'a, ()>>, String> {
    if scope.is_none() {
        return Ok(None);
    }
    require_personal(app)?;
    Ok(Some(
        app.state::<PersonalRuntime>()
            .inner()
            .operation_gate
            .lock()
            .map_err(|_| "工作区操作忙碌")?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn workspace(name: &str) -> Workspace {
        Workspace {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            main: false,
            style: "neutral".into(),
            deleted: false,
            tools: vec![Tool {
                id: uuid::Uuid::new_v4().to_string(),
                module: "shopping-list".into(),
                archived: false,
            }],
        }
    }
    fn mutation(title: &str) -> crate::tasks::TaskMutation {
        serde_json::from_value(json!({"title":title,"notes":"","horizon":"short","priority":"normal","startDate":null,"dueDate":null})).unwrap()
    }
    #[test]
    fn main_is_indestructible_and_scene_deletion_preserves_shared_tasks() {
        let root = tempfile::tempdir().unwrap();
        let base = TaskStore::open(&root.path().join("oceanseo-tasks.sqlite3")).unwrap();
        let runtime = PersonalRuntime::open(root.path().into()).unwrap();
        let mut doc = runtime.initialize(&base.export_backup().unwrap()).unwrap();
        assert_eq!(doc.workspaces.len(), 1);
        assert!(doc.workspaces[0].tools.is_empty());
        let mut invalid = doc.clone();
        invalid.workspaces[0].deleted = true;
        assert!(runtime.save(invalid, doc.revision).is_err());
        let scene = workspace("自定义生活场景");
        doc.workspaces.push(scene.clone());
        runtime.save(doc.clone(), doc.revision).unwrap();
        let directory = root.path().join("personal-workspaces").join(&scene.id);
        crate::profiles::private_dir(&directory).unwrap();
        let store = TaskStore::open_personal(
            &root.path().join("oceanseo-tasks.sqlite3"),
            &directory,
            &root.path().join("personal-workspaces/registry.sqlite3"),
        )
        .unwrap();
        let task = store
            .create_assigned(mutation("采购"), Some(scene.id.clone()))
            .unwrap();
        assert_eq!(base.list().unwrap().len(), 1);
        let before = base.list().unwrap();
        let mut doc = runtime.document().unwrap();
        doc.workspaces[1].deleted = true;
        let next = runtime.save(doc.clone(), doc.revision).unwrap();
        assert_eq!(next.task_owners[&task.id], "pending");
        assert_eq!(base.list().unwrap(), before);
        assert!(runtime.require_module(&scene.id, "shopping-list").is_err());
    }
    #[test]
    fn independent_scene_data_and_task_assignment_commit_atomically() {
        let root = tempfile::tempdir().unwrap();
        let base = TaskStore::open(&root.path().join("oceanseo-tasks.sqlite3")).unwrap();
        let runtime = PersonalRuntime::open(root.path().into()).unwrap();
        let mut doc = runtime.initialize(&base.export_backup().unwrap()).unwrap();
        let a = workspace("CEO");
        let b = workspace("CLO");
        doc.workspaces.extend([a.clone(), b.clone()]);
        runtime.save(doc.clone(), doc.revision).unwrap();
        let scoped = |w: &Workspace| {
            let directory = root.path().join("personal-workspaces").join(&w.id);
            crate::profiles::private_dir(&directory).unwrap();
            TaskStore::open_personal(
                &root.path().join("oceanseo-tasks.sqlite3"),
                &directory,
                &root.path().join("personal-workspaces/registry.sqlite3"),
            )
            .unwrap()
        };
        let first = scoped(&a);
        let second = scoped(&b);
        first
            .set_app_state("tideplan.purchase-list.v1", json!([{"name":"CEO资料"}]))
            .unwrap();
        second.bootstrap_app_state(HashMap::new()).unwrap();
        assert!(!second
            .export_backup()
            .unwrap()
            .app_state
            .contains_key("tideplan.purchase-list.v1"));
        assert_eq!(
            first.export_backup().unwrap().app_state["tideplan.purchase-list.v1"][0]["name"],
            "CEO资料"
        );
        let task = first
            .create_assigned(mutation("全局任务"), Some(a.id.clone()))
            .unwrap();
        assert_eq!(second.list().unwrap(), base.list().unwrap());
        assert!(second
            .update_assigned(&task.id, mutation("不得保存"), Some("missing".into()))
            .is_err());
        assert_eq!(base.get(&task.id).unwrap().title, "全局任务");
        assert_eq!(runtime.document().unwrap().task_owners[&task.id], a.id);
    }
    #[test]
    fn personal_backup_restores_assignments_tools_and_data_and_rejects_invalid_main() {
        let root = tempfile::tempdir().unwrap();
        let base = TaskStore::open(&root.path().join("oceanseo-tasks.sqlite3")).unwrap();
        let runtime = PersonalRuntime::open(root.path().into()).unwrap();
        let mut doc = runtime.initialize(&base.export_backup().unwrap()).unwrap();
        let scene = workspace("学习");
        doc.workspaces.push(scene.clone());
        runtime.save(doc.clone(), 0).unwrap();
        let directory = root.path().join("personal-workspaces").join(&scene.id);
        crate::profiles::private_dir(&directory).unwrap();
        let store = TaskStore::open_personal(
            &root.path().join("oceanseo-tasks.sqlite3"),
            &directory,
            &root.path().join("personal-workspaces/registry.sqlite3"),
        )
        .unwrap();
        let task = store
            .create_assigned(mutation("保留任务"), Some(scene.id.clone()))
            .unwrap();
        store
            .set_app_state("tideplan.purchase-list.v1", json!([]))
            .unwrap();
        let backup = runtime.backup(&base).unwrap();
        let mut invalid = backup.clone();
        invalid.document.workspaces[0].deleted = true;
        assert!(runtime.restore(&base, invalid).is_err());
        assert_eq!(base.list().unwrap().len(), 1);
        base.delete(&task.id).unwrap();
        runtime.restore(&base, backup.clone()).unwrap();
        assert_eq!(base.get(&task.id).unwrap().title, "保留任务");
        assert_eq!(runtime.document().unwrap().task_owners[&task.id], scene.id);
        assert_eq!(runtime.backup(&base).unwrap().states, backup.states);
        assert!(!root
            .path()
            .join("personal-workspaces/restore-rollback.json")
            .exists());
    }
    #[test]
    fn nonempty_legacy_upgrade_preserves_originals_and_is_idempotent() {
        let root = tempfile::tempdir().unwrap();
        let base = TaskStore::open(&root.path().join("oceanseo-tasks.sqlite3")).unwrap();
        let task = base.create(mutation("旧任务及笔记")).unwrap();
        let items = json!([{"id":uuid::Uuid::new_v4().to_string(),"name":"旧采购","amount":"2","category":"其他","checked":true,"source":"manual","sourceLabel":null,"sourceId":null}]);
        base.set_app_state("tideplan.purchase-list.v1", items.clone())
            .unwrap();
        let original = base.export_backup().unwrap();
        let runtime = PersonalRuntime::open(root.path().into()).unwrap();
        let doc = runtime.initialize(&original).unwrap();
        assert_eq!(doc.workspaces.len(), 2);
        assert!(doc.workspaces[0].tools.is_empty());
        assert_eq!(doc.task_owners[&task.id], "pending");
        let legacy = doc
            .workspaces
            .iter()
            .find(|w| w.name == "旧版资料")
            .unwrap();
        assert!(legacy.tools.iter().any(|t| t.module == "shopping-list"));
        let directory = root.path().join("personal-workspaces").join(&legacy.id);
        let migrated = TaskStore::open_personal(
            &root.path().join("oceanseo-tasks.sqlite3"),
            &directory,
            &root.path().join("personal-workspaces/registry.sqlite3"),
        )
        .unwrap();
        assert_eq!(
            migrated.export_backup().unwrap().app_state["tideplan.purchase-list.v1"],
            items
        );
        assert_eq!(base.export_backup().unwrap().app_state, original.app_state);
        assert_eq!(base.list().unwrap(), original.tasks);
        assert!(directory.join("before-workspaces.json").exists());
        assert_eq!(runtime.initialize(&original).unwrap().workspaces.len(), 2);
    }
}
