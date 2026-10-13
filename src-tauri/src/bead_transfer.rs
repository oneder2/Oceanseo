//! Portable, explicitly confirmed work copies. Never restores an entire profile.
use super::*;
use serde_json::{json, Value};
use std::io::Write;

const WORKS: &str = "tideplan.bead-works.v1";
const LEGACY: &str = "tideplan.bead-pattern.v1";

#[path = "bead_handoff.rs"]
pub mod handoff;
#[path = "bead_lifecycle.rs"]
pub mod lifecycle;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferBundle {
    pub bead_transfer_version: u8,
    pub operation_id: String,
    pub created_at: String,
    pub source_label: String,
    pub works: Vec<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferPreview {
    pub operation_id: String,
    pub bundle_hash: String,
    pub target_hash: String,
    pub existing_count: usize,
    pub incoming_count: usize,
    pub already_copied: bool,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransferReceipt {
    pub operation_id: String,
    pub work_ids: Vec<String>,
    pub copied_count: usize,
    pub already_copied: bool,
    pub snapshot_path: String,
}

fn hash(value: &impl Serialize) -> Result<String, String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).map_err(|_| "作品文件无法编码")?)
    ))
}

fn identifier(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|id| Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == *id))
}

fn only_keys(value: &Value, keys: &[&str]) -> bool {
    value
        .as_object()
        .is_some_and(|object| object.keys().all(|key| keys.contains(&key.as_str())))
}

fn validate_bundle(bundle: &TransferBundle) -> Result<String, String> {
    if serde_json::to_vec(bundle)
        .map_err(|_| "作品无法编码")?
        .len()
        > MAX_APP_STATE_BYTES
    {
        return Err("作品文件超过 2 MB，请减少一次复制的作品数量".into());
    }
    if bundle.bead_transfer_version != 1
        || Uuid::parse_str(&bundle.operation_id).is_err()
        || validate_timestamp(&bundle.created_at).is_err()
        || bundle.source_label.is_empty()
        || bundle.source_label.chars().count() > 120
        || bundle.works.is_empty()
        || bundle.works.len() > 100
    {
        return Err("作品文件版本或内容无效，原作品未修改".into());
    }
    let mut work_ids = HashSet::new();
    let mut version_ids = HashSet::new();
    for work in &bundle.works {
        let Some(id) = identifier(&work["id"]) else {
            return Err("作品标识无效".into());
        };
        if !work_ids.insert(id)
            || !work["archived"].is_boolean()
            || !["createdAt", "updatedAt"].iter().all(|key| {
                work[key]
                    .as_str()
                    .is_some_and(|stamp| validate_timestamp(stamp).is_ok())
            })
            || !only_keys(
                work,
                &[
                    "id",
                    "title",
                    "createdAt",
                    "updatedAt",
                    "archived",
                    "currentVersionId",
                    "progressVersionId",
                    "completedCells",
                    "versions",
                ],
            )
            || work["title"]
                .as_str()
                .is_none_or(|title| title.encode_utf16().count() > 80)
        {
            return Err("作品字段或重复标识无效".into());
        }
        let document = json!({"version":1,"activeId":id,"works":[work]});
        // Build the validation document without changing the transferred source.
        let mut document = document;
        document["works"][0]["archived"] = json!(false);
        if !crate::backup_validation::valid(WORKS, &document) {
            return Err("作品图纸或版本无效".into());
        }
        let versions = work["versions"].as_array().ok_or("作品缺少版本")?;
        for version in versions {
            let Some(version_id) = identifier(&version["id"]) else {
                return Err("图纸版本标识无效".into());
            };
            let pattern = &version["pattern"];
            if !version_ids.insert(version_id)
                || version["createdAt"]
                    .as_str()
                    .is_none_or(|stamp| validate_timestamp(stamp).is_err())
                || !only_keys(
                    version,
                    &["id", "label", "createdAt", "pattern", "completedCells"],
                )
                || version["label"]
                    .as_str()
                    .is_none_or(|s| s.encode_utf16().count() > 80)
                || !only_keys(
                    pattern,
                    &[
                        "version",
                        "title",
                        "width",
                        "height",
                        "beadPitchMm",
                        "palette",
                        "cells",
                    ],
                )
                || !pattern["palette"].as_array().is_some_and(|colors| {
                    colors
                        .iter()
                        .all(|color| only_keys(color, &["hex", "name", "brand", "code", "catalog"]))
                })
            {
                return Err("图纸字段或重复版本标识无效".into());
            }
        }
        let current = versions
            .iter()
            .find(|v| v["id"] == work["currentVersionId"])
            .ok_or("当前版本不存在")?;
        let cells = current["pattern"]["cells"]
            .as_array()
            .ok_or("当前图纸无效")?;
        let mut completed = HashSet::new();
        for index in work["completedCells"].as_array().ok_or("拼放记录无效")? {
            let i = index.as_u64().ok_or("拼放坐标无效")? as usize;
            if !completed.insert(i)
                || cells
                    .get(i)
                    .is_none_or(|color| color.as_i64().is_none_or(|c| c < 0))
            {
                return Err("拼放记录包含空格、越界或重复坐标".into());
            }
        }
    }
    hash(bundle)
}

fn target_hash(state: &HashMap<String, Value>) -> Result<String, String> {
    hash(&json!({"works":state.get(WORKS),"legacy":state.get(LEGACY)}))
}

fn copy_id(operation: &str, kind: &str, original: &str) -> String {
    let bytes = Sha256::digest(format!(
        "oceanseo-bead-copy-v1\n{operation}\n{kind}\n{original}"
    ));
    let mut uuid: [u8; 16] = bytes[..16].try_into().expect("SHA256 length");
    uuid[6] = (uuid[6] & 0x0f) | 0x80;
    uuid[8] = (uuid[8] & 0x3f) | 0x80;
    Uuid::from_bytes(uuid).to_string()
}

fn copied_works(bundle: &TransferBundle) -> Vec<Value> {
    bundle
        .works
        .iter()
        .map(|source| {
            let mut work = source.clone();
            work["id"] = json!(copy_id(
                &bundle.operation_id,
                "work",
                source["id"].as_str().unwrap()
            ));
            work["archived"] = json!(false);
            work["createdAt"] = json!(now_timestamp());
            work["updatedAt"] = work["createdAt"].clone();
            work["currentVersionId"] = json!(copy_id(
                &bundle.operation_id,
                "version",
                source["currentVersionId"].as_str().unwrap()
            ));
            work["progressVersionId"] = work["currentVersionId"].clone();
            for version in work["versions"].as_array_mut().unwrap() {
                version["id"] = json!(copy_id(
                    &bundle.operation_id,
                    "version",
                    version["id"].as_str().unwrap()
                ));
            }
            work
        })
        .collect()
}

fn existing_count(state: &HashMap<String, Value>) -> Result<usize, String> {
    match state.get(WORKS).filter(|value| !value.is_null()) {
        Some(document) if crate::backup_validation::valid(WORKS, document) => Ok(document["works"]
            .as_array()
            .ok_or("目标作品记录无效")?
            .len()),
        Some(_) => Err("目标作品记录损坏，请先导出备份并恢复；原资料未修改".into()),
        None => match state.get(LEGACY).filter(|v| !v.is_null()) {
            Some(pattern) if crate::backup_validation::valid(LEGACY, pattern) => Ok(1),
            Some(_) => Err("目标旧图记录损坏，请先导出备份并恢复；原资料未修改".into()),
            None => Ok(0),
        },
    }
}

fn previous_receipt(
    tx: &Connection,
    bundle: &TransferBundle,
    bundle_hash: &str,
) -> Result<Option<(usize, String)>, String> {
    let row: Option<(String,usize,String)> = tx.query_row(
        "SELECT payload_sha256,imported_count,backup_path FROM legacy_migrations WHERE migration_key=?1",
        [format!("oceanseo.bead-transfer.v1:{}",bundle.operation_id)], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?)),
    ).optional().map_err(|_| "复制回执无法读取")?;
    if let Some((previous_hash, count, path)) = row {
        if previous_hash != bundle_hash {
            return Err("这个复制操作的内容已变化，请重新导出作品文件；原资料未修改".into());
        }
        return Ok(Some((count, path)));
    }
    Ok(None)
}

impl TaskStore {
    pub fn export_bead_transfer(
        &self,
        work_ids: &[String],
        source_label: String,
    ) -> Result<TransferBundle, String> {
        if work_ids.is_empty()
            || work_ids.len() > 100
            || work_ids.iter().collect::<HashSet<_>>().len() != work_ids.len()
        {
            return Err("请选择需要复制的作品".into());
        }
        let connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let state = read_app_state(&connection)?;
        let works = state
            .get(WORKS)
            .and_then(|v| v["works"].as_array())
            .ok_or("请先保存作品，再导出作品文件")?;
        let selected = work_ids
            .iter()
            .map(|id| {
                works
                    .iter()
                    .find(|w| w["id"].as_str() == Some(id))
                    .filter(|w| w.get("deletedAt").is_none())
                    .cloned()
                    .ok_or("作品已变化，请重新选择".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let bundle = TransferBundle {
            bead_transfer_version: 1,
            operation_id: Uuid::new_v4().to_string(),
            created_at: now_timestamp(),
            source_label,
            works: selected,
        };
        validate_bundle(&bundle)?;
        Ok(bundle)
    }

    pub fn preview_bead_transfer(
        &self,
        bundle: &TransferBundle,
    ) -> Result<TransferPreview, String> {
        let bundle_hash = validate_bundle(bundle)?;
        let connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let state = read_app_state(&connection)?;
        let count = existing_count(&state)?;
        let previous = previous_receipt(&connection, bundle, &bundle_hash)?;
        if previous.is_none() && count + bundle.works.len() > 100 {
            return Err("目标资料库最多保存 100 件作品，请减少本次复制数量或整理目标作品".into());
        }
        Ok(TransferPreview {
            operation_id: bundle.operation_id.clone(),
            bundle_hash,
            target_hash: target_hash(&state)?,
            existing_count: count,
            incoming_count: bundle.works.len(),
            already_copied: previous.is_some(),
        })
    }

    pub fn commit_bead_transfer(
        &self,
        bundle: &TransferBundle,
        expected_target_hash: &str,
        expected_bundle_hash: &str,
    ) -> Result<TransferReceipt, String> {
        let bundle_hash = validate_bundle(bundle)?;
        if bundle_hash != expected_bundle_hash {
            return Err("作品文件内容与预览不一致，请重新选择文件并预览；目标未修改".into());
        }
        let copies = copied_works(bundle);
        let work_ids: Vec<String> = copies
            .iter()
            .map(|w| w["id"].as_str().unwrap().to_string())
            .collect();
        let mut connection = self.connection.lock().map_err(|_| "数据库繁忙")?;
        let tx = connection
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| "复制事务无法启动")?;
        if let Some((count, path)) = previous_receipt(&tx, bundle, &bundle_hash)? {
            return Ok(TransferReceipt {
                operation_id: bundle.operation_id.clone(),
                work_ids,
                copied_count: count,
                already_copied: true,
                snapshot_path: path,
            });
        }
        let state = read_app_state(&tx)?;
        if target_hash(&state)? != expected_target_hash {
            return Err("目标作品刚刚变化，请重新预览再确认复制；原资料未修改".into());
        }
        let count = existing_count(&state)?;
        if count + copies.len() > 100 {
            return Err("目标资料库已达到 100 件作品上限，原资料未修改".into());
        }
        let legacy_migration = self.prepare_bead_migration(&tx, &state)?;
        let mut document = state
            .get(WORKS)
            .filter(|v| !v.is_null())
            .cloned()
            .or_else(|| legacy_migration.as_ref().map(|m| m.document.clone()))
            .unwrap_or_else(|| json!({"version":1,"activeId":work_ids[0],"works":[]}));
        if count == 1 && state.get(WORKS).is_none_or(|v| v.is_null()) && legacy_migration.is_none()
        {
            return Err("目标旧图暂时无法迁移，已停止复制；原资料保留".into());
        }
        let target = document["works"].as_array_mut().ok_or("目标作品无效")?;
        if copies
            .iter()
            .any(|copy| target.iter().any(|work| work["id"] == copy["id"]))
        {
            return Err("目标已存在相同副本标识，请联系支持核对；原资料未修改".into());
        }
        target.extend(copies);
        if document["activeId"] == "" {
            document["activeId"] = json!(work_ids[0]);
        }
        validate_app_state(WORKS, &document)?;
        let backup = DataBackup {
            schema_version: BACKUP_SCHEMA_VERSION.into(),
            created_at: now_timestamp(),
            tasks: list_tasks_from_connection(&tx)?,
            app_state: state,
        };
        validate_backup(&backup)?;
        let snapshot = self
            .backup_dir
            .join(format!("before-bead-copy-{}.json", Uuid::new_v4()));
        tx.execute(&self.state_sql("INSERT INTO app_state(key,value_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at"),
            params![WORKS,serialize_app_state(&document)?,now_timestamp()]).map_err(|_| "作品复制未完成，目标未修改")?;
        self.with_writes(&["bead-studio"], || {
            if let Some(migration) = &legacy_migration { self.record_bead_protection(&tx,migration,true)?; }
            crate::profiles::private_dir(&self.backup_dir)?;
            let mut options = fs::OpenOptions::new(); options.write(true).create_new(true);
            #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
            let mut file = options.open(&snapshot).map_err(|_| "复制安全副本无法建立，目标未修改")?;
            file.write_all(&serde_json::to_vec_pretty(&backup).map_err(|_| "复制安全副本无法编码")?)
                .and_then(|_| file.sync_all()).map_err(|_| "复制安全副本未落盘，目标未修改")?;
            fs::File::open(&self.backup_dir).and_then(|dir| dir.sync_all()).map_err(|_| "复制安全副本目录未落盘，目标未修改")?;
            tx.execute("INSERT INTO legacy_migrations(migration_key,payload_sha256,imported_count,backup_path,migrated_at) VALUES(?1,?2,?3,?4,?5)",
                params![format!("oceanseo.bead-transfer.v1:{}",bundle.operation_id),bundle_hash,work_ids.len(),snapshot.to_string_lossy(),now_timestamp()]).map_err(|_| "复制回执未保存，目标未修改")?;
            tx.commit().map_err(|_| "复制事务未完成，请重试；原作品保留".into())
        })?;
        Ok(TransferReceipt {
            operation_id: bundle.operation_id.clone(),
            copied_count: work_ids.len(),
            work_ids,
            already_copied: false,
            snapshot_path: snapshot.to_string_lossy().into(),
        })
    }
}

#[tauri::command]
pub async fn export_bead_transfer(
    app: tauri::AppHandle,
    personal_scope: Option<String>,
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, crate::profiles::ProfileRuntime>,
    work_ids: Vec<String>,
) -> Result<TransferBundle, String> {
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

    store.export_bead_transfer(&work_ids, source_label(&profile.status()?.current))
}

fn source_label(current: &crate::profiles::ProfileSummary) -> String {
    let label = current
        .workspace
        .as_ref()
        .map(|space| {
            format!(
                "{} · {}",
                if space.environment == "preview" {
                    "测试"
                } else {
                    "正式"
                },
                if space.edition == "personal" {
                    "个人空间"
                } else {
                    "拼豆空间"
                }
            )
        })
        .unwrap_or_else(|| {
            if current.username.is_some() {
                "个人账号资料库".into()
            } else {
                "本机资料库".into()
            }
        });
    current
        .username
        .as_ref()
        .map(|name| format!("{name} · {label}"))
        .unwrap_or(label)
}

#[tauri::command]
pub async fn preview_bead_transfer(
    app: tauri::AppHandle,
    personal_scope: Option<String>,
    store: tauri::State<'_, TaskStore>,
    bundle: TransferBundle,
) -> Result<TransferPreview, String> {
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

    store.preview_bead_transfer(&bundle)
}

#[tauri::command]
pub async fn commit_bead_transfer(
    app: tauri::AppHandle,
    personal_scope: Option<String>,
    store: tauri::State<'_, TaskStore>,
    bundle: TransferBundle,
    expected_target_hash: String,
    expected_bundle_hash: String,
) -> Result<TransferReceipt, String> {
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

    store.commit_bead_transfer(&bundle, &expected_target_hash, &expected_bundle_hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn work(title: &str) -> Value {
        let work_id = Uuid::new_v4().to_string();
        let v1 = Uuid::new_v4().to_string();
        let v2 = Uuid::new_v4().to_string();
        let pattern = json!({"version":1,"title":title,"width":2,"height":1,"beadPitchMm":5,
            "cells":[0,-1],"palette":[{"hex":"#ffffff","name":"白色"}]});
        json!({"id":work_id,"title":title,"archived":false,"createdAt":now_timestamp(),"updatedAt":now_timestamp(),
            "currentVersionId":v2,"progressVersionId":v2,"completedCells":[0],"versions":[
                {"id":v1,"label":"初始图纸","createdAt":now_timestamp(),"pattern":pattern},
                {"id":v2,"label":"已确认图纸","createdAt":now_timestamp(),"pattern":pattern}]})
    }
    fn document(works: Vec<Value>) -> Value {
        json!({"version":1,"activeId":works[0]["id"],"works":works})
    }
    fn store(root: &TempDir) -> TaskStore {
        TaskStore::open(&root.path().join("data.sqlite3")).unwrap()
    }
    fn bundle() -> TransferBundle {
        TransferBundle {
            bead_transfer_version: 1,
            operation_id: Uuid::new_v4().to_string(),
            created_at: now_timestamp(),
            source_label: "个人空间".into(),
            works: vec![work("作品一"), work("作品二")],
        }
    }
    fn receipts(store: &TaskStore) -> usize {
        store.connection.lock().unwrap().query_row("SELECT count(*) FROM legacy_migrations WHERE migration_key LIKE 'oceanseo.bead-transfer.v1:%'",[],|r|r.get(0)).unwrap()
    }
    #[test]
    fn copy_batch_preserves_source_target_history_progress_and_other_data_across_restart() {
        let source_root = TempDir::new().unwrap();
        let target_root = TempDir::new().unwrap();
        let source = store(&source_root);
        let target = store(&target_root);
        let source_doc = document(vec![work("个人作品一"), work("个人作品二")]);
        source.set_app_state(WORKS, source_doc.clone()).unwrap();
        let source_ids: Vec<String> = source_doc["works"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| w["id"].as_str().unwrap().into())
            .collect();
        let file = source
            .export_bead_transfer(&source_ids, "个人空间".into())
            .unwrap();
        let old_target = document(vec![work("测试空间原作品")]);
        target.set_app_state(WORKS, old_target.clone()).unwrap();
        let unrelated = json!([]);
        target
            .set_app_state("tideplan.countdowns.v1", unrelated.clone())
            .unwrap();
        let preview = target.preview_bead_transfer(&file).unwrap();
        assert_eq!(preview.existing_count, 1);
        assert_eq!(preview.incoming_count, 2);
        let receipt = target
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap();
        let next = target.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(next["works"][0], old_target["works"][0]);
        assert_eq!(next["activeId"], old_target["activeId"]);
        for i in 0..2 {
            let copied = &next["works"][i + 1];
            let original = &file.works[i];
            assert_ne!(copied["id"], original["id"]);
            assert_eq!(copied["completedCells"], original["completedCells"]);
            for v in 0..2 {
                assert_ne!(copied["versions"][v]["id"], original["versions"][v]["id"]);
                assert_eq!(
                    copied["versions"][v]["pattern"],
                    original["versions"][v]["pattern"]
                );
            }
            assert_eq!(copied["progressVersionId"], copied["currentVersionId"]);
        }
        assert_eq!(source.app_state_value(WORKS).unwrap(), Some(source_doc));
        assert_eq!(
            target.app_state_value("tideplan.countdowns.v1").unwrap(),
            Some(unrelated)
        );
        let safety: DataBackup =
            serde_json::from_slice(&fs::read(&receipt.snapshot_path).unwrap()).unwrap();
        assert_eq!(safety.app_state[WORKS], old_target);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&receipt.snapshot_path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        drop(target);
        let reopened = store(&target_root);
        assert!(
            reopened
                .preview_bead_transfer(&file)
                .unwrap()
                .already_copied
        );
        let replay = reopened
            .commit_bead_transfer(&file, "stale preview after restart", &preview.bundle_hash)
            .unwrap();
        assert!(replay.already_copied);
        assert_eq!(replay.work_ids, receipt.work_ids);
        assert_eq!(reopened.app_state_value(WORKS).unwrap(), Some(next));
        assert_eq!(receipts(&reopened), 1);
    }
    #[test]
    fn stale_target_and_reused_operation_with_different_payload_never_overwrite() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let preview = store.preview_bead_transfer(&file).unwrap();
        let changed = document(vec![work("预览期间新增")]);
        store.set_app_state(WORKS, changed.clone()).unwrap();
        assert!(store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap_err()
            .contains("重新预览"));
        assert_eq!(store.app_state_value(WORKS).unwrap(), Some(changed));
        assert_eq!(receipts(&store), 0);
        let fresh = store.preview_bead_transfer(&file).unwrap();
        store
            .commit_bead_transfer(&file, &fresh.target_hash, &fresh.bundle_hash)
            .unwrap();
        let committed = store.app_state_value(WORKS).unwrap();
        let mut tampered = file;
        tampered.works[0]["title"] = json!("不同内容");
        assert!(store.preview_bead_transfer(&tampered).is_err());
        assert!(store
            .commit_bead_transfer(&tampered, &fresh.target_hash, &fresh.bundle_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), committed);
    }
    #[test]
    fn snapshot_failure_and_receipt_failure_roll_back_entire_batch_then_retry() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let preview = store.preview_bead_transfer(&file).unwrap();
        fs::write(&store.backup_dir, b"Synthetic blocker").unwrap();
        assert!(store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipts(&store), 0);
        fs::remove_file(&store.backup_dir).unwrap();
        store.connection.lock().unwrap().execute_batch("CREATE TRIGGER reject_copy BEFORE INSERT ON legacy_migrations WHEN NEW.migration_key LIKE 'oceanseo.bead-transfer.v1:%' BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END;").unwrap();
        assert!(store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipts(&store), 0);
        assert_eq!(fs::read_dir(&store.backup_dir).unwrap().count(), 1);
        store
            .connection
            .lock()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_copy")
            .unwrap();
        let receipt = store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap();
        assert_eq!(receipt.copied_count, 2);
        assert_eq!(receipts(&store), 1);
    }
    #[test]
    fn invalid_brand_progress_duplicate_ids_and_embedded_credentials_fail_before_writing() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let mut invalid = file.clone();
        invalid.works[1] = invalid.works[0].clone();
        assert!(store.preview_bead_transfer(&invalid).is_err());
        let mut invalid = file.clone();
        invalid.works[0]["completedCells"] = json!([1]);
        assert!(store.preview_bead_transfer(&invalid).is_err());
        let mut invalid = file.clone();
        invalid.works[0]["token"] = json!("Must not transfer");
        assert!(store.preview_bead_transfer(&invalid).is_err());
        let mut invalid = file.clone();
        invalid.works[0]["versions"][0]["pattern"]["palette"][0]["brand"] = json!("MARD");
        assert!(store.preview_bead_transfer(&invalid).is_err());
        let mut invalid = file;
        invalid.works[0]["versions"][0]["pattern"]["referenceImage"] = json!("Must not transfer");
        assert!(store.preview_bead_transfer(&invalid).is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert!(!store.backup_dir.exists());
    }
    #[test]
    fn unknown_permissions_after_preview_deny_commit_without_snapshot_or_partial_target() {
        use crate::capabilities::tests::{account, profile};
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let preview = store.preview_bead_transfer(&file).unwrap();
        let profile = profile(
            &root.path().join("profile"),
            &account("https://sync.example.com"),
        );
        let policy = crate::capabilities::CapabilityRuntime::open(&profile).unwrap();
        store.bind_authorization(policy, profile).unwrap();
        assert!(store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap_err()
            .contains("permission_denied"));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipts(&store), 0);
        assert!(!store.backup_dir.exists());
    }
    #[test]
    fn capacity_limit_rejects_whole_batch_and_preserves_all_existing_works() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let full = document((0..99).map(|_| work("容量测试")).collect());
        store.set_app_state(WORKS, full.clone()).unwrap();
        assert!(store.preview_bead_transfer(&file).is_err());
        let state = store.export_backup().unwrap().app_state;
        assert!(store
            .commit_bead_transfer(
                &file,
                &target_hash(&state).unwrap(),
                &validate_bundle(&file).unwrap()
            )
            .is_err());
        assert_eq!(store.app_state_value(WORKS).unwrap(), Some(full));
        assert_eq!(receipts(&store), 0);
    }
    #[test]
    fn copying_into_unmigrated_target_keeps_old_drawing_and_its_immutable_backup() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let file = bundle();
        let original = work("目标旧图")["versions"][0]["pattern"].clone();
        store.set_app_state(LEGACY, original.clone()).unwrap();
        let preview = store.preview_bead_transfer(&file).unwrap();
        assert_eq!(preview.existing_count, 1);
        store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap();
        let document = store.app_state_value(WORKS).unwrap().unwrap();
        assert_eq!(document["works"].as_array().unwrap().len(), 3);
        assert_eq!(document["works"][0]["versions"][0]["pattern"], original);
        let files: Vec<_> = fs::read_dir(&store.backup_dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("before-bead-works-")
            })
            .collect();
        assert_eq!(files.len(), 1);
        let safety: DataBackup = serde_json::from_slice(&fs::read(&files[0]).unwrap()).unwrap();
        assert_eq!(safety.app_state[LEGACY], original);
    }

    #[test]
    fn changed_file_after_preview_is_rejected_before_first_commit() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let mut file = bundle();
        let preview = store.preview_bead_transfer(&file).unwrap();
        file.works[0]["title"] = json!("Unreviewed change");
        assert!(store
            .commit_bead_transfer(&file, &preview.target_hash, &preview.bundle_hash)
            .unwrap_err()
            .contains("与预览不一致"));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipts(&store), 0);
        assert!(!store.backup_dir.exists());
    }
}
