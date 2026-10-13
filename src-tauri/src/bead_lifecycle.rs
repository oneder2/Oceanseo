//! Explicit work lifecycle; purge backs up the whole bound database first.
use super::*;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WorkAction {
    Trash,
    Restore,
    Purge,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkPreview {
    pub works_hash: String,
    pub work: Value,
    pub action: WorkAction,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkReceipt {
    pub already_done: bool,
    pub snapshot_path: Option<String>,
}

fn document(state: &HashMap<String, Value>) -> Result<Value, String> {
    let value = state
        .get(WORKS)
        .filter(|value| !value.is_null())
        .ok_or("请先保存作品，再管理删除与恢复")?;
    validate_app_state(WORKS, value)?;
    Ok(value.clone())
}
fn work_id(id: &str) -> Result<(), String> {
    if Uuid::parse_str(id).map(|id| id.to_string()).ok().as_deref() != Some(id) {
        return Err("作品标识无效".into());
    }
    Ok(())
}
fn private_snapshot(path: &std::path::Path, backup: &DataBackup) -> Result<(), String> {
    let parent = path.parent().ok_or("安全备份路径无效")?;
    crate::profiles::private_dir(parent)?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "删除安全备份无法建立，作品仍在最近删除中")?;
    file.write_all(&serde_json::to_vec_pretty(backup).map_err(|_| "删除安全备份无法编码")?)
        .and_then(|_| file.sync_all())
        .map_err(|_| "删除安全备份未落盘，作品仍在最近删除中")?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| "删除安全备份目录未落盘，作品仍在最近删除中")?;
    Ok(())
}

impl TaskStore {
    pub fn preview_bead_lifecycle(
        &self,
        id: &str,
        action: WorkAction,
    ) -> Result<WorkPreview, String> {
        work_id(id)?;
        let connection = self.connection.lock().map_err(|_| "作品数据库繁忙")?;
        let doc = document(&read_app_state(&connection)?)?;
        let work = doc["works"]
            .as_array()
            .unwrap()
            .iter()
            .find(|work| work["id"] == id)
            .ok_or("作品已变化，请重新打开作品页面")?;
        if action != WorkAction::Trash && work.get("deletedAt").is_none() {
            return Err("请先将作品移到最近删除，再进行恢复或彻底删除".into());
        }
        Ok(WorkPreview {
            works_hash: hash(&doc)?,
            work: work.clone(),
            action,
        })
    }

    pub fn commit_bead_lifecycle(
        &self,
        id: &str,
        action: WorkAction,
        expected_hash: &str,
    ) -> Result<WorkReceipt, String> {
        work_id(id)?;
        let mut connection = self.connection.lock().map_err(|_| "作品数据库繁忙")?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| "作品管理事务无法启动")?;
        let state = read_app_state(&tx)?;
        let mut doc = document(&state)?;
        let index = doc["works"]
            .as_array()
            .unwrap()
            .iter()
            .position(|work| work["id"] == id);
        if index.is_none()
            && action == WorkAction::Purge
            && doc["purgedWorkIds"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|value| value == id))
        {
            return Ok(WorkReceipt {
                already_done: true,
                snapshot_path: None,
            });
        }
        let index = index.ok_or("作品已变化，请重新打开作品页面")?;
        let deleted = doc["works"][index].get("deletedAt").is_some();
        if (action == WorkAction::Trash && deleted) || (action == WorkAction::Restore && !deleted) {
            return Ok(WorkReceipt {
                already_done: true,
                snapshot_path: None,
            });
        }
        if action == WorkAction::Purge && !deleted {
            return Err("进行中的作品不能直接彻底删除，请先移到最近删除".into());
        }
        if hash(&doc)? != expected_hash {
            return Err("作品在预览后发生变化，请重新核对；原记录未修改".into());
        }
        let timestamp = now_timestamp();
        match action {
            WorkAction::Trash => {
                let work = &mut doc["works"][index];
                work["deletedFromArchive"] = work["archived"].clone();
                work["archived"] = json!(true);
                work["deletedAt"] = json!(timestamp);
                work["updatedAt"] = json!(timestamp);
            }
            WorkAction::Restore => {
                let work = &mut doc["works"][index];
                work["archived"] = work["deletedFromArchive"].clone();
                work.as_object_mut().unwrap().remove("deletedAt");
                work.as_object_mut().unwrap().remove("deletedFromArchive");
                work["updatedAt"] = json!(timestamp);
                if work["archived"] == false {
                    doc["activeId"] = json!(id);
                }
            }
            WorkAction::Purge => {
                let mut purged = doc
                    .get("purgedWorkIds")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                if purged.len() >= 10000 {
                    return Err("删除记录已达到上限，已停止清理；作品仍可恢复".into());
                }
                purged.push(json!(id));
                doc["purgedWorkIds"] = json!(purged);
                doc["works"].as_array_mut().unwrap().remove(index);
            }
        }
        let works = doc["works"].as_array().unwrap();
        if !works.iter().any(|work| {
            work["id"] == doc["activeId"]
                && work["archived"] == false
                && work.get("deletedAt").is_none()
        }) {
            doc["activeId"] = works
                .iter()
                .find(|work| work["archived"] == false && work.get("deletedAt").is_none())
                .map(|work| work["id"].clone())
                .unwrap_or_else(|| json!(""));
        }
        validate_app_state(WORKS, &doc)?;
        let backup = if action == WorkAction::Purge {
            let backup = DataBackup {
                schema_version: BACKUP_SCHEMA_VERSION.into(),
                created_at: timestamp.clone(),
                tasks: list_tasks_from_connection(&tx)?,
                app_state: state,
            };
            validate_backup(&backup)?;
            Some(backup)
        } else {
            None
        };
        let snapshot = backup.as_ref().map(|_| {
            self.backup_dir
                .join(format!("before-bead-purge-{}.json", Uuid::new_v4()))
        });
        tx.execute(
            &self.state_sql("UPDATE app_state SET value_json=?1,updated_at=?2 WHERE key=?3"),
            params![serialize_app_state(&doc)?, timestamp, WORKS],
        )
        .map_err(|_| "作品管理未完成，原记录保留")?;
        self.with_writes(&["bead-studio"], || {
            if let (Some(path), Some(backup)) = (&snapshot, &backup) {
                private_snapshot(path, backup)?;
            }
            tx.commit()
                .map_err(|_| "作品管理事务未完成，原记录保留".into())
        })?;
        Ok(WorkReceipt {
            already_done: false,
            snapshot_path: snapshot.map(|path| path.to_string_lossy().into()),
        })
    }
}

#[tauri::command]
pub async fn preview_bead_lifecycle(
    app: tauri::AppHandle,
    personal_scope: Option<String>,
    store: tauri::State<'_, TaskStore>,
    work_id: String,
    action: WorkAction,
) -> Result<WorkPreview, String> {
    use tauri::Manager;
    let _permit = crate::personal_workspaces::scene_operation(&app, &personal_scope)?;
    crate::personal_workspaces::check_scope(&app, &personal_scope, "bead-studio")?;
    let personal = if let Some(scope) = personal_scope {
        Some(
            app.state::<crate::personal_workspaces::PersonalRuntime>()
                .store(&scope, &app)?,
        )
    } else {
        None
    };
    let store = personal.as_deref().unwrap_or(store.inner());

    store.preview_bead_lifecycle(&work_id, action)
}
#[tauri::command]
pub async fn commit_bead_lifecycle(
    app: tauri::AppHandle,
    personal_scope: Option<String>,
    store: tauri::State<'_, TaskStore>,
    work_id: String,
    action: WorkAction,
    expected_works_hash: String,
) -> Result<WorkReceipt, String> {
    use tauri::Manager;
    let _permit = crate::personal_workspaces::scene_operation(&app, &personal_scope)?;
    crate::personal_workspaces::check_scope(&app, &personal_scope, "bead-studio")?;
    let personal = if let Some(scope) = personal_scope {
        Some(
            app.state::<crate::personal_workspaces::PersonalRuntime>()
                .store(&scope, &app)?,
        )
    } else {
        None
    };
    let store = personal.as_deref().unwrap_or(store.inner());

    store.commit_bead_lifecycle(&work_id, action, &expected_works_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    fn setup() -> (TempDir, TaskStore, String, Value) {
        let root = TempDir::new().unwrap();
        let store = TaskStore::open(&root.path().join("db.sqlite3")).unwrap();
        let id = Uuid::new_v4().to_string();
        let version = Uuid::new_v4().to_string();
        let pattern = json!({"version":1,"title":"保留的作品","width":2,"height":1,"palette":[{"hex":"#ffffff","name":"白色"}],"cells":[0,-1]});
        let doc = json!({"version":1,"activeId":id,"works":[{"id":id,"title":"保留的作品","createdAt":now_timestamp(),"updatedAt":now_timestamp(),"archived":false,
            "currentVersionId":version,"progressVersionId":version,"completedCells":[0],"versions":[{"id":version,"label":"初始","createdAt":now_timestamp(),"pattern":pattern,"completedCells":[0]}]}]});
        store.set_app_state(WORKS, doc.clone()).unwrap();
        store
            .set_app_state("tideplan.purchase-list.v1", json!([]))
            .unwrap();
        (root, store, id, doc)
    }
    fn commit(store: &TaskStore, id: &str, action: WorkAction) -> WorkReceipt {
        let preview = store.preview_bead_lifecycle(id, action).unwrap();
        store
            .commit_bead_lifecycle(id, action, &preview.works_hash)
            .unwrap()
    }
    #[test]
    fn last_work_trash_restart_restore_preserves_every_version_and_progress() {
        let (root, store, id, doc) = setup();
        let preview = store
            .preview_bead_lifecycle(&id, WorkAction::Trash)
            .unwrap();
        assert_eq!(store.app_state_value(WORKS).unwrap().unwrap(), doc);
        commit(&store, &id, WorkAction::Trash);
        let deleted = store.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(deleted["activeId"], "");
        assert!(deleted["works"][0]["deletedAt"].is_string());
        assert_eq!(deleted["works"][0]["versions"], doc["works"][0]["versions"]);
        assert_eq!(
            deleted["works"][0]["completedCells"],
            doc["works"][0]["completedCells"]
        );
        assert!(
            store
                .commit_bead_lifecycle(&id, WorkAction::Trash, &preview.works_hash)
                .unwrap()
                .already_done
        );
        drop(store);
        let store = TaskStore::open(&root.path().join("db.sqlite3")).unwrap();
        commit(&store, &id, WorkAction::Restore);
        let restored = store.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(restored["activeId"], id);
        assert_eq!(restored["works"][0]["archived"], false);
        assert!(restored["works"][0].get("deletedAt").is_none());
        assert_eq!(
            restored["works"][0]["versions"],
            doc["works"][0]["versions"]
        );
        assert_eq!(
            store.app_state_value("tideplan.purchase-list.v1").unwrap(),
            Some(json!([]))
        );
    }
    #[test]
    fn archived_restore_does_not_unarchive_and_empty_library_accepts_new_copies() {
        let (_root, store, id, mut doc) = setup();
        let bundle = store
            .export_bead_transfer(std::slice::from_ref(&id), "来源".into())
            .unwrap();
        doc["works"][0]["archived"] = json!(true);
        doc["activeId"] = json!("");
        store.set_app_state(WORKS, doc).unwrap();
        commit(&store, &id, WorkAction::Trash);
        commit(&store, &id, WorkAction::Restore);
        assert_eq!(
            store.app_state_value(WORKS).unwrap().unwrap()["works"][0]["archived"],
            true
        );
        commit(&store, &id, WorkAction::Trash);
        commit(&store, &id, WorkAction::Purge);
        let empty = store.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(empty["works"], json!([]));
        assert_eq!(empty["activeId"], "");
        let preview = store.preview_bead_transfer(&bundle).unwrap();
        store
            .commit_bead_transfer(&bundle, &preview.target_hash, &preview.bundle_hash)
            .unwrap();
        let copied = store.app_state_value(WORKS).unwrap().unwrap();
        assert_ne!(copied["activeId"], "");
        assert_eq!(copied["purgedWorkIds"], empty["purgedWorkIds"]);
    }
    #[test]
    fn purge_requires_trash_and_durable_private_backup_with_idempotent_replay() {
        let (_root, store, id, _) = setup();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Purge, "")
            .is_err());
        commit(&store, &id, WorkAction::Trash);
        let deleted = store.export_backup().unwrap();
        let preview = store
            .preview_bead_lifecycle(&id, WorkAction::Purge)
            .unwrap();
        let receipt = commit(&store, &id, WorkAction::Purge);
        let path = receipt.snapshot_path.unwrap();
        let safety: DataBackup = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(safety.app_state, deleted.app_state);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let after = store.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(after["purgedWorkIds"], json!([id]));
        assert_eq!(after["works"], json!([]));
        assert!(
            store
                .commit_bead_lifecycle(&id, WorkAction::Purge, &preview.works_hash)
                .unwrap()
                .already_done
        );
        assert_eq!(store.app_state_value(WORKS).unwrap().unwrap(), after);
        store.restore_backup(safety).unwrap();
        assert_eq!(
            store.app_state_value(WORKS).unwrap(),
            deleted.app_state.get(WORKS).cloned()
        );
    }
    #[test]
    fn stale_preview_backup_failure_and_sql_failure_leave_work_and_ledger_unchanged() {
        let (_root, store, id, mut doc) = setup();
        let stale = store
            .preview_bead_lifecycle(&id, WorkAction::Trash)
            .unwrap();
        doc["works"][0]["title"] = json!("预览后的新名字");
        store.set_app_state(WORKS, doc.clone()).unwrap();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Trash, &stale.works_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), Some(doc));
        commit(&store, &id, WorkAction::Trash);
        let deleted = store.app_state_value(WORKS).unwrap();
        fs::write(&store.backup_dir, "blocked").unwrap();
        let preview = store
            .preview_bead_lifecycle(&id, WorkAction::Purge)
            .unwrap();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Purge, &preview.works_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), deleted);
        fs::remove_file(&store.backup_dir).unwrap();
        store.connection.lock().unwrap().execute_batch("CREATE TRIGGER reject_lifecycle BEFORE UPDATE ON app_state BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END;").unwrap();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Purge, &preview.works_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), deleted);
    }
    #[test]
    fn permissions_and_profile_selection_are_rechecked_at_the_final_transaction() {
        use crate::capabilities::tests::{account, profile};
        let (root, store, id, _) = setup();
        commit(&store, &id, WorkAction::Trash);
        let deleted = store.app_state_value(WORKS).unwrap();
        let preview = store
            .preview_bead_lifecycle(&id, WorkAction::Purge)
            .unwrap();
        let bound = profile(
            &root.path().join("profile"),
            &account("https://example.com"),
        );
        let capability = crate::capabilities::CapabilityRuntime::open(&bound).unwrap();
        store.bind_authorization(capability, bound.clone()).unwrap();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Purge, &preview.works_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), deleted);
        assert!(!store.backup_dir.exists());
        bound.select("local").unwrap();
        assert!(store
            .commit_bead_lifecycle(&id, WorkAction::Restore, &preview.works_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), deleted);
        let (other_root, other, other_id, _) = setup();
        commit(&other, &other_id, WorkAction::Trash);
        let local = crate::profiles::ProfileRuntime::open(
            other_root.path(),
            crate::credentials::CredentialCipher::plain(),
        )
        .unwrap();
        let target = local
            .save_account(&account("https://example.com"))
            .unwrap()
            .key;
        other
            .bind_authorization(
                crate::capabilities::CapabilityRuntime::open(&local).unwrap(),
                local.clone(),
            )
            .unwrap();
        let before = other.app_state_value(WORKS).unwrap();
        let preview = other
            .preview_bead_lifecycle(&other_id, WorkAction::Restore)
            .unwrap();
        local.select(&target).unwrap();
        let error = other
            .commit_bead_lifecycle(&other_id, WorkAction::Restore, &preview.works_hash)
            .unwrap_err();
        assert!(error.contains("资料库"));
        assert_eq!(other.app_state_value(WORKS).unwrap(), before);
    }
}
