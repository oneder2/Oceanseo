use super::*;
use crate::sync::{Receipt, Records, SyncMeta, Vault, BEAD_WORKS, GOALS};

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

fn read_sync(
    connection: &Connection,
    include_beads: bool,
    include_tasks: bool,
) -> Result<(Records, SyncMeta), String> {
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
    if !include_beads && meta.base.contains_key(BEAD_WORKS) {
        return Err("作品同步基线属于独立空间，不能写入旧个人同步服务".into());
    }
    let mut records: Records = meta
        .base
        .keys()
        .map(|k| (k.clone(), serde_json::Value::Null))
        .collect();
    if include_tasks {
        for task in list_tasks_from_connection(connection)? {
            records.insert(
                format!("task:{}", task.id),
                serde_json::to_value(task).map_err(|_| "任务编码失败")?,
            );
        }
    }
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key=?1",
            [crate::goals::KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "目标读取失败")?;
    if include_tasks {
        if let Some(raw) = raw {
            let goals: serde_json::Value =
                serde_json::from_str(&raw).map_err(|_| "目标格式无效")?;
            if !crate::goals::valid_state(&goals) {
                return Err("本机目标格式无效，已停止同步".into());
            }
            records.insert(GOALS.into(), normalize_goals(goals));
        }
    }
    let raw: Option<String> = connection
        .query_row(
            "SELECT value_json FROM app_state WHERE key=?1",
            [BEAD_WORKS],
            |r| r.get(0),
        )
        .optional()
        .map_err(|_| "拼豆作品读取失败")?;
    if let Some(raw) = raw.filter(|_| include_beads) {
        let works: serde_json::Value =
            serde_json::from_str(&raw).map_err(|_| "拼豆作品格式无效")?;
        if !crate::backup_validation::valid(BEAD_WORKS, &works) {
            return Err("本机拼豆作品格式无效，已停止同步".into());
        }
        records.insert(BEAD_WORKS.into(), works);
    }
    crate::sync::validate_records(&records)?;
    Ok((records, meta))
}

impl TaskStore {
    fn sync_includes_beads(&self) -> Result<bool, String> {
        match self.authorization.get() {
            // Only negotiated workspace routes can carry the new record type.
            // Unbound stores are used by migrations and synthetic tests.
            // Personal sync keeps the existing task/goal payload boundary.
            Some(_) => Ok(false),
            None => Ok(true),
        }
    }

    fn sync_includes_tasks(&self) -> Result<bool, String> {
        Ok(true)
    }

    pub fn sync_snapshot(&self) -> Result<(Records, SyncMeta), String> {
        let connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let include_beads = self.sync_includes_beads()?;
        // Preserve the existing personal task/goal synchronization payload.
        read_sync(&connection, include_beads, self.sync_includes_tasks()?)
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
        let include_beads = self.sync_includes_beads()?;
        if !include_beads && remote.records.contains_key(BEAD_WORKS) {
            return Err("旧个人同步服务不支持作品记录，请使用独立拼豆空间".into());
        }
        let mut connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| "同步事务无法启动")?;
        let (current, meta) = read_sync(&tx, include_beads, self.sync_includes_tasks()?)?;
        if current != *expected || crate::sync::hash(&meta) != crate::sync::hash(expected_meta) {
            return Err(crate::sync::SyncFailure {
                kind: crate::sync::FailureKind::Stale,
                message: "上传期间本机又有修改，已保留最新本机数据。请重新检查同步，服务端收到的内容不会重复创建。".into(),
            });
        }
        // Incoming works can be the first native works document, before the
        // frontend has bootstrapped the old single drawing. Protect that
        // drawing under the same final permit and transaction as the sync.
        let bead_protection = if remote
            .records
            .get(BEAD_WORKS)
            .is_some_and(|value| !value.is_null() && current.get(BEAD_WORKS) != Some(value))
        {
            self.prepare_bead_migration(&tx, &read_app_state(&tx)?)?
        } else {
            None
        };
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
            } else if key == BEAD_WORKS {
                if value.is_null() {
                    tx.execute("DELETE FROM app_state WHERE key=?1", [BEAD_WORKS])
                        .map_err(|_| "同步拼豆作品删除失败")?;
                } else {
                    if !crate::backup_validation::valid(BEAD_WORKS, value) {
                        return Err("合并后的拼豆作品无效，未修改本机数据".into());
                    }
                    let serialized =
                        serde_json::to_string(value).map_err(|_| "同步拼豆作品编码失败")?;
                    tx.execute("INSERT INTO app_state(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at",
                        params![BEAD_WORKS, serialized, now_timestamp()]).map_err(|_| "同步拼豆作品保存失败")?;
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
        let mut modules = std::collections::BTreeSet::new();
        for key in current
            .keys()
            .chain(remote.records.keys())
            .collect::<std::collections::BTreeSet<_>>()
        {
            if key.starts_with("task:") {
                modules.insert("tasks");
                continue;
            }
            if key == GOALS {
                modules.insert("goals");
                continue;
            }
            let before = current.get(key);
            let after = remote.records.get(key);
            for module in crate::capabilities::changed_modules(key, before, after)? {
                modules.insert(module);
            }
        }
        let modules: Vec<&str> = modules.into_iter().collect();
        self.with_writes(&modules, || {
            if let Some(protection) = &bead_protection {
                self.record_bead_protection(&tx, protection, true)?;
            }
            tx.commit()
                .map_err(|_| "同步事务未完成，请重试".to_string())
        })
        .map_err(|message| crate::sync::SyncFailure {
            kind: crate::sync::FailureKind::Stale,
            message,
        })?;
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

    #[test]
    fn bead_works_and_progress_are_part_of_sync_records() {
        let dir = tempfile::tempdir().unwrap();
        let a = TaskStore::open(&dir.path().join("a.sqlite")).unwrap();
        let b = TaskStore::open(&dir.path().join("b.sqlite")).unwrap();
        let pattern = serde_json::json!({
            "version": 1, "title": "同步作品", "width": 1, "height": 1,
            "cells": [0], "palette": [{"hex":"#faf4c8", "name":"MARD"}]
        });
        let works = serde_json::json!({
            "version": 1, "activeId": "work-1", "works": [{
                "id":"work-1", "title":"同步作品", "createdAt":"2026-01-01",
                "updatedAt":"2026-01-01", "archived":false,
                "currentVersionId":"version-1", "progressVersionId":"version-1",
                "completedCells":[0], "versions":[{"id":"version-1","label":"初始图纸","createdAt":"2026-01-01","pattern": pattern}]
            }]
        });
        a.set_app_state(BEAD_WORKS, works.clone()).unwrap();
        let (local, meta) = a.sync_snapshot().unwrap();
        assert_eq!(local[BEAD_WORKS], works);
        let remote = Vault {
            protocol: 1,
            vault_id: Uuid::new_v4().to_string(),
            revision: 1,
            records: local.clone(),
        };
        b.sync_apply(
            &b.sync_snapshot().unwrap().0,
            &b.sync_snapshot().unwrap().1,
            &remote,
            "test".into(),
        )
        .unwrap();
        assert_eq!(b.app_state_value(BEAD_WORKS).unwrap(), Some(works));
        assert_eq!(meta.revision, 0);
    }

    #[test]
    fn first_incoming_works_protect_legacy_drawing_and_failed_backup_rolls_back_sync() {
        let root = tempfile::tempdir().unwrap();
        let store = TaskStore::open(&root.path().join("data.sqlite3")).unwrap();
        let legacy = serde_json::json!({"version":1,"title":"本机旧图","width":1,
            "height":1,"cells":[0],"palette":[{"hex":"#ffffff","name":"白色"}]});
        store
            .set_app_state("tideplan.bead-pattern.v1", legacy.clone())
            .unwrap();
        let incoming = serde_json::json!({"version":1,"activeId":"cloud-work","works":[{
            "id":"cloud-work","title":"云端作品","createdAt":"2026-10-11","updatedAt":"2026-10-11",
            "archived":false,"currentVersionId":"cloud-version","progressVersionId":"cloud-version",
            "completedCells":[],"versions":[{"id":"cloud-version","label":"初始图纸",
                "createdAt":"2026-10-11","pattern":legacy}]}]});
        let (local, meta) = store.sync_snapshot().unwrap();
        let remote = Vault {
            protocol: 1,
            vault_id: Uuid::new_v4().to_string(),
            revision: 1,
            records: [(BEAD_WORKS.into(), incoming.clone())]
                .into_iter()
                .collect(),
        };
        fs::write(&store.backup_dir, b"Synthetic blocker").unwrap();
        assert!(store
            .sync_apply(&local, &meta, &remote, "test".into())
            .is_err());
        let (unchanged, unchanged_meta) = store.sync_snapshot().unwrap();
        assert_eq!(unchanged, local);
        assert_eq!(crate::sync::hash(&unchanged_meta), crate::sync::hash(&meta));
        assert_eq!(store.app_state_value(BEAD_WORKS).unwrap(), None);
        assert_eq!(
            store.app_state_value("tideplan.bead-pattern.v1").unwrap(),
            Some(legacy.clone())
        );
        fs::remove_file(&store.backup_dir).unwrap();
        store
            .sync_apply(&local, &meta, &remote, "test".into())
            .unwrap();
        assert_eq!(store.app_state_value(BEAD_WORKS).unwrap(), Some(incoming));
        let paths: Vec<_> = fs::read_dir(&store.backup_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(paths.len(), 1);
        let safety: DataBackup = serde_json::from_slice(&fs::read(&paths[0]).unwrap()).unwrap();
        assert_eq!(safety.app_state["tideplan.bead-pattern.v1"], legacy);
        assert!(!safety.app_state.contains_key(BEAD_WORKS));
        assert_eq!(store.connection.lock().unwrap().query_row(
            "SELECT imported_count FROM legacy_migrations WHERE migration_key LIKE 'oceanseo.bead-works.v1:%'",
            [], |row| row.get::<_, usize>(0)).unwrap(), 1);
    }
}
