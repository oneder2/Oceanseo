use super::*;
use crate::sync::{Receipt, Records, SyncMeta, Vault, GOALS};

fn normalize_goals(mut value: serde_json::Value) -> serde_json::Value {
    if value.is_null() {
        return value;
    }
    // Transaction revision, retry receipts and undo describe this installation.
    // They are never transplanted to a different database or used as sync clocks.
    value["revision"] = serde_json::json!(0);
    value["operations"] = serde_json::json!([]);
    value["undo"] = serde_json::Value::Null;
    value["draft"] = serde_json::json!("");
    if value.get("conversation").is_none() {
        value["conversation"] = serde_json::json!({"messages":[],"understanding":[],"proposalId":"","receipts":[],"needsReply":false});
    }
    value
}

fn read_sync(connection: &Connection) -> Result<(Records, SyncMeta), String> {
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM sync_state WHERE singleton=1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "同步基线读取失败")?;
    let meta: SyncMeta = match raw {
        Some(raw) => {
            serde_json::from_str(&raw).map_err(|_| "同步基线损坏，请保留数据库并联系维护者")?
        }
        None => SyncMeta::default(),
    };
    crate::sync::validate_records(&meta.base)?;
    let mut records: Records = meta
        .base
        .keys()
        .map(|k| (k.clone(), serde_json::Value::Null))
        .collect();
    for task in list_tasks_from_connection(connection)? {
        records.insert(
            format!("task:{}", task.id),
            serde_json::to_value(task).map_err(|_| "任务编码失败")?,
        );
    }
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key=?1",
            [crate::goals::KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "目标读取失败")?;
    if let Some(raw) = raw {
        let goals: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "目标格式无效")?;
        if !crate::goals::valid_state(&goals) {
            return Err("本机目标格式无效，已停止同步".into());
        }
        records.insert(GOALS.into(), normalize_goals(goals));
    }
    crate::sync::validate_records(&records)?;
    Ok((records, meta))
}

impl TaskStore {
    pub fn sync_snapshot(&self) -> Result<(Records, SyncMeta), String> {
        let connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        read_sync(&connection)
    }

    pub fn sync_recovery(&self, local: &Records, remote: &Vault) -> Result<String, String> {
        // Contains the complete local backup plus both normalized sync versions.
        // Conflict decisions remain recoverable even after successful upload.
        let backup = self.export_backup()?;
        fs::create_dir_all(&self.backup_dir).map_err(|_| "无法创建同步安全副本，已停止同步")?;
        let path = self
            .backup_dir
            .join(format!("before-sync-{}.json", Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let data =
            serde_json::to_vec(&serde_json::json!({"syncRecoveryVersion":1,"backup":backup,"local":local,"remote":remote}))
                .map_err(|_| "同步副本编码失败")?;
        use std::io::Write;
        options
            .open(&path)
            .and_then(|mut file| {
                file.write_all(&data)?;
                file.sync_all()
            })
            .map_err(|_| "同步安全副本写入失败，已停止同步")?;
        fs::File::open(&self.backup_dir)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| "同步副本未能安全落盘")?;
        Ok(path.to_string_lossy().into_owned())
    }

    #[cfg(test)]
    pub fn sync_apply(
        &self,
        expected: &Records,
        expected_meta: &SyncMeta,
        remote: &Vault,
        snapshot: String,
    ) -> Result<Receipt, String> {
        self.sync_apply_checked(expected, expected_meta, remote, snapshot)
            .map_err(|error| error.message)
    }

    pub fn sync_apply_checked(
        &self,
        expected: &Records,
        expected_meta: &SyncMeta,
        remote: &Vault,
        snapshot: String,
    ) -> Result<Receipt, crate::sync::SyncFailure> {
        crate::sync::validate_records(&remote.records)?;
        let mut connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let tx = connection.transaction().map_err(|_| "同步事务无法启动")?;
        let (current, meta) = read_sync(&tx)?;
        if current != *expected || crate::sync::hash(&meta) != crate::sync::hash(expected_meta) {
            return Err(crate::sync::SyncFailure {
                kind: crate::sync::FailureKind::Stale,
                message: "上传期间本机又有修改，已保留最新本机数据。请重新检查同步，服务端收到的内容不会重复创建。".into(),
            });
        }
        let changed = crate::sync::count_changes(&current, &remote.records) > 0;
        for (key, value) in &remote.records {
            if current.get(key).unwrap_or(&serde_json::Value::Null) == value {
                continue;
            }
            if let Some(id) = key.strip_prefix("task:") {
                if value.is_null() {
                    tx.execute("DELETE FROM tasks WHERE id=?1", [id])
                        .map_err(|_| "同步删除失败")?;
                } else {
                    let task: TaskRecord =
                        serde_json::from_value(value.clone()).map_err(|_| "同步任务无效")?;
                    if update_task_row(&tx, &task).map_err(|_| "同步任务更新失败")? == 0 {
                        insert_task(&tx, &task).map_err(|_| "同步任务创建失败")?;
                    }
                }
            } else if key == GOALS {
                if value.is_null() {
                    tx.execute("DELETE FROM app_state WHERE key=?1", [crate::goals::KEY])
                        .map_err(|_| "同步目标删除失败")?;
                } else {
                    let old: Option<String> = tx
                        .query_row(
                            "SELECT value_json FROM app_state WHERE key=?1",
                            [crate::goals::KEY],
                            |r| r.get(0),
                        )
                        .optional()
                        .map_err(|_| "目标读取失败")?;
                    let old: serde_json::Value = old
                        .map(|s| serde_json::from_str(&s))
                        .transpose()
                        .map_err(|_| "目标格式异常")?
                        .unwrap_or(serde_json::Value::Null);
                    let mut value = normalize_goals(value.clone());
                    value["revision"] =
                        serde_json::json!(old["revision"].as_u64().unwrap_or(0) + 1);
                    // Preserve local dedup receipts, invalidate cross-device undo.
                    value["operations"] = old
                        .get("operations")
                        .cloned()
                        .unwrap_or(serde_json::json!([]));
                    value["draft"] = old.get("draft").cloned().unwrap_or(serde_json::json!(""));
                    if !crate::goals::valid_state(&value) {
                        return Err("合并后的目标超出限制，未修改本机数据".into());
                    }
                    tx.execute("INSERT INTO app_state(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                        params![crate::goals::KEY, serialize_app_state(&value)?, now_timestamp()]).map_err(|_| "同步目标保存失败")?;
                }
            }
        }
        let next = SyncMeta {
            vault_id: remote.vault_id.clone(),
            revision: remote.revision,
            base: remote.records.clone(),
            last_success: Some(now_timestamp()),
            recovery_path: Some(snapshot.clone()),
        };
        tx.execute("INSERT INTO sync_state(singleton,value_json) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET value_json=excluded.value_json", [serde_json::to_string(&next).map_err(|_| "同步状态编码失败")?]).map_err(|_| "同步状态无法保存")?;
        tx.commit().map_err(|_| "同步事务未完成，请重试")?;
        Ok(Receipt {
            changed,
            revision: remote.revision,
            snapshot_path: Some(snapshot),
        })
    }

    pub fn sync_recovery_document(&self) -> Result<serde_json::Value, String> {
        let (_, meta) = self.sync_snapshot()?;
        let path = PathBuf::from(meta.recovery_path.ok_or("尚无同步安全副本")?);
        if path.parent() != Some(self.backup_dir.as_path()) {
            return Err("安全副本路径无效".into());
        }
        let raw = fs::read_to_string(path).map_err(|_| "无法读取同步安全副本")?;
        serde_json::from_str(&raw).map_err(|_| "同步安全副本格式无效".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::merge;
    use std::collections::BTreeMap;

    fn mutation(title: &str, notes: &str) -> TaskMutation {
        TaskMutation {
            title: title.into(),
            notes: notes.into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: None,
            origin: None,
        }
    }
    fn cycle(store: &TaskStore, remote: &mut Vault) {
        let (local, meta) = store.sync_snapshot().unwrap();
        let (records, conflicts) = merge(&meta.base, &local, &remote.records, &BTreeMap::new());
        assert!(conflicts.is_empty());
        remote.records = records;
        remote.revision += 1;
        store
            .sync_apply(&local, &meta, remote, "test".into())
            .unwrap();
    }
    #[test]
    fn two_databases_offline_fields_deletion_restart_and_retry() {
        let dir = tempfile::tempdir().unwrap();
        let a = TaskStore::open(&dir.path().join("a.sqlite")).unwrap();
        let b = TaskStore::open(&dir.path().join("b.sqlite")).unwrap();
        let task = a.create(mutation("第一步", "笔记")).unwrap();
        let mut remote = Vault {
            protocol: 1,
            vault_id: Uuid::new_v4().to_string(),
            ..Default::default()
        };
        cycle(&a, &mut remote);
        cycle(&b, &mut remote);
        assert_eq!(b.get(&task.id).unwrap().notes, "笔记");
        a.update(&task.id, mutation("电脑改标题", "笔记")).unwrap();
        b.update(&task.id, mutation("第一步", "手机改笔记"))
            .unwrap();
        cycle(&a, &mut remote);
        cycle(&b, &mut remote);
        cycle(&a, &mut remote);
        assert_eq!(a.get(&task.id).unwrap().notes, "手机改笔记");
        assert_eq!(b.get(&task.id).unwrap().title, "电脑改标题");
        a.delete(&task.id).unwrap();
        cycle(&a, &mut remote);
        drop(b);
        let b = TaskStore::open(&dir.path().join("b.sqlite")).unwrap();
        cycle(&b, &mut remote);
        cycle(&b, &mut remote);
        assert!(b.list().unwrap().is_empty());
        assert!(remote.records[&format!("task:{}", task.id)].is_null());
    }
    #[test]
    fn edits_during_upload_are_never_overwritten_and_retry_converges() {
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::open(&dir.path().join("a.sqlite")).unwrap();
        let task = store.create(mutation("初始", "")).unwrap();
        let (local, meta) = store.sync_snapshot().unwrap();
        let mut remote = Vault {
            protocol: 1,
            vault_id: Uuid::new_v4().to_string(),
            revision: 1,
            records: local.clone(),
        };
        store
            .update(&task.id, mutation("上传时又修改", ""))
            .unwrap();
        assert!(store
            .sync_apply(&local, &meta, &remote, "test".into())
            .is_err());
        // Simulates upload succeeded but no local acknowledgement.
        let (current, current_meta) = store.sync_snapshot().unwrap();
        let (_, conflicts) = merge(
            &current_meta.base,
            &current,
            &remote.records,
            &BTreeMap::new(),
        );
        assert_eq!(conflicts.len(), 1); // Needs explicit choice, never silently loses newer content.
        remote.records = current.clone();
        store
            .sync_apply(&current, &current_meta, &remote, "test".into())
            .unwrap();
        assert_eq!(store.get(&task.id).unwrap().title, "上传时又修改");
    }
    #[test]
    fn recovery_contains_both_versions_and_no_service_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let store = TaskStore::open(&dir.path().join("a.sqlite")).unwrap();
        store.create(mutation("保留我", "私有笔记")).unwrap();
        let (local, _) = store.sync_snapshot().unwrap();
        let path = store.sync_recovery(&local, &Vault::default()).unwrap();
        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(value["backup"]["tasks"].as_array().unwrap().len(), 1);
        assert!(value.get("local").is_some() && value.get("remote").is_some());
        assert!(value.get("token").is_none());
    }
}
