//! Destination-bound handoff. Only the cold-started destination may commit.
use super::*;
use crate::profiles::ProfileRuntime;
use std::{fs, io::Read, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Handoff {
    version: u8,
    source_key: String,
    target_key: String,
    works_hash: String,
    bundle: TransferBundle,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoffReceipt {
    receipt: TransferReceipt,
    cleanup_pending: bool,
}

fn load(profile: &ProfileRuntime, target: &str) -> Result<Option<Handoff>, String> {
    let path = profile.bead_handoff_path(target)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("待复制作品暂时无法读取，原作品仍保留".into()),
    };
    if !metadata.is_file() || metadata.len() > (MAX_APP_STATE_BYTES + 2048) as u64 {
        return Err("待复制作品文件无效，已保留原文件；请联系维护者".into());
    }
    let mut raw = Vec::new();
    fs::File::open(&path)
        .and_then(|file| {
            file.take((MAX_APP_STATE_BYTES + 2049) as u64)
                .read_to_end(&mut raw)
        })
        .map_err(|_| "待复制作品暂时无法读取")?;
    let value: Handoff =
        serde_json::from_slice(&raw).map_err(|_| "待复制作品文件无效，已保留原文件")?;
    if value.version != 1
        || value.target_key != target
        || value.source_key == target
        || profile.bead_handoff_path(&value.source_key).is_err()
        || value.works_hash != hash(&value.bundle.works)?
    {
        return Err("待复制作品与目标资料库不匹配，原资料未修改".into());
    }
    validate_bundle(&value.bundle)?;
    Ok(Some(value))
}

fn sync_parent(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    fs::File::open(path.parent().ok_or("待复制作品路径无效")?)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| "待复制作品目录未能落盘")?;
    Ok(())
}

fn stage(
    profile: &ProfileRuntime,
    target: &str,
    bundle: TransferBundle,
) -> Result<Handoff, String> {
    validate_bundle(&bundle)?;
    let works_hash = hash(&bundle.works)?;
    if let Some(previous) = load(profile, target)? {
        if previous.source_key == profile.current_key && previous.works_hash == works_hash {
            sync_parent(&profile.bead_handoff_path(target)?)?;
            return Ok(previous);
        }
        return Err("目标资料库已有一批待复制作品，请先打开目标确认或取消，再复制新作品".into());
    }
    let value = Handoff {
        version: 1,
        source_key: profile.current_key.clone(),
        target_key: target.into(),
        works_hash,
        bundle,
    };
    let raw = serde_json::to_vec(&value).map_err(|_| "待复制作品无法编码")?;
    let path = profile.bead_handoff_path(target)?;
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    // Publish only fully durable contents. hard_link never replaces an existing
    // destination. Interrupted temporary files are not read as pending copies.
    let result = (|| {
        let mut file = options
            .open(&temporary)
            .map_err(|_| "待复制作品无法保存，尚未切换资料库")?;
        file.write_all(&raw)
            .and_then(|_| file.sync_all())
            .map_err(|_| "待复制作品未能落盘，尚未切换资料库")?;
        fs::hard_link(&temporary, &path)
            .map_err(|_| "待复制作品无法发布，请重新打开目标检查；原作品仍保留")?;
        sync_parent(&path)?;
        Ok(value)
    })();
    let _ = fs::remove_file(temporary);
    result
}

fn remove(profile: &ProfileRuntime, target: &str, operation: &str) -> Result<(), String> {
    let Some(pending) = load(profile, target)? else {
        // Cancellation/cleanup may have succeeded before a lost response or a
        // directory-sync failure. Retrying must be safe without another record.
        return sync_parent(&profile.bead_handoff_path(target)?);
    };
    if pending.bundle.operation_id != operation
        || (profile.current_key != target && profile.current_key != pending.source_key)
    {
        return Err("无权取消这批作品复制，原资料未修改".into());
    }
    let path = profile.bead_handoff_path(target)?;
    fs::remove_file(&path).map_err(|_| "待复制作品暂时无法取消，请重试")?;
    sync_parent(&path)
}

fn stage_or_resume(
    profile: &ProfileRuntime,
    target: &str,
    bundle: TransferBundle,
) -> Result<Handoff, String> {
    let status = profile.status()?;
    if status.restart_required {
        if status.selected_key == target {
            if let Some(pending) = load(profile, target)? {
                if pending.source_key == profile.current_key
                    && pending.works_hash == hash(&bundle.works)?
                {
                    return Ok(pending);
                }
            }
        }
        return Err(
            "资料库已选定，但没有与所选作品对应的待复制记录。请在账号页面返回来源资料库后重试"
                .into(),
        );
    }
    profile.while_current(|| stage(profile, target, bundle))
}

fn commit(
    store: &TaskStore,
    profile: &ProfileRuntime,
    operation_id: &str,
    expected_target_hash: &str,
    expected_bundle_hash: &str,
) -> Result<HandoffReceipt, String> {
    let pending = profile
        .while_current(|| load(profile, &profile.current_key))?
        .ok_or("这批待复制作品已不存在，请重新打开作品页面")?;
    if pending.bundle.operation_id != operation_id {
        return Err("待复制作品已变化，请重新预览".into());
    }
    // Store acquires SQLite then its final profile/capability permit. Never hold
    // while_current across this transaction; commands serialize via profile.gate.
    let receipt =
        store.commit_bead_transfer(&pending.bundle, expected_target_hash, expected_bundle_hash)?;
    let cleanup_pending = profile
        .while_current(|| remove(profile, &profile.current_key, operation_id))
        .is_err();
    Ok(HandoffReceipt {
        receipt,
        cleanup_pending,
    })
}

#[tauri::command]
pub async fn stage_bead_handoff(
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, ProfileRuntime>,
    target_key: String,
    expected_current: String,
    work_ids: Vec<String>,
) -> Result<Handoff, String> {
    let _gate = profile.gate.lock().await;
    if profile.current_key != expected_current || target_key == profile.current_key {
        return Err("来源或目标资料库已变化，请重新选择".into());
    }
    // Decode sessions before the short selection permit (Android Keystore).
    let target = profile
        .list()?
        .into_iter()
        .find(|p| p.key == target_key)
        .ok_or("请先在账号页面打开目标资料库，再回来复制作品")?;
    if target.key != crate::profiles::LOCAL && !target.signed_in {
        return Err("目标账号需要重新登录，请先打开账号页面".into());
    }
    let bundle = store.export_bead_transfer(&work_ids, source_label(&profile.status()?.current))?;
    stage_or_resume(&profile, &target.key, bundle)
}

#[tauri::command]
pub async fn pending_bead_handoff(
    profile: tauri::State<'_, ProfileRuntime>,
) -> Result<Option<Handoff>, String> {
    let _gate = profile.gate.lock().await;
    profile.while_current(|| load(&profile, &profile.current_key))
}

#[tauri::command]
pub async fn cancel_bead_handoff(
    profile: tauri::State<'_, ProfileRuntime>,
    target_key: String,
    operation_id: String,
) -> Result<(), String> {
    let _gate = profile.gate.lock().await;
    profile.while_current(|| remove(&profile, &target_key, &operation_id))
}

#[tauri::command]
pub async fn commit_bead_handoff(
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, ProfileRuntime>,
    operation_id: String,
    expected_target_hash: String,
    expected_bundle_hash: String,
) -> Result<HandoffReceipt, String> {
    let _gate = profile.gate.lock().await;
    // A cleanup failure cannot turn an already committed copy into a SQL failure.
    commit(
        &store,
        &profile,
        &operation_id,
        &expected_target_hash,
        &expected_bundle_hash,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{capabilities::tests::account, credentials::CredentialCipher};
    use tempfile::TempDir;

    fn setup() -> (TempDir, ProfileRuntime, String, TaskStore, TransferBundle) {
        let root = TempDir::new().unwrap();
        let source = ProfileRuntime::open(root.path(), CredentialCipher::plain()).unwrap();
        let target = source
            .save_account(&account("https://example.com"))
            .unwrap()
            .key;
        let store = TaskStore::open(&source.data_dir.join("source.sqlite3")).unwrap();
        let work_id = Uuid::new_v4().to_string();
        let version_id = Uuid::new_v4().to_string();
        let work = json!({"id":work_id,"title":"海边小屋","archived":false,"createdAt":now_timestamp(),"updatedAt":now_timestamp(),
            "currentVersionId":version_id,"progressVersionId":version_id,"completedCells":[0],"versions":[
                {"id":version_id,"label":"初始图纸","createdAt":now_timestamp(),"pattern":{
                    "version":1,"title":"海边小屋","width":2,"height":1,"beadPitchMm":5,
                    "cells":[0,-1],"palette":[{"hex":"#ffffff","name":"白色"}]}}]});
        store
            .set_app_state(
                WORKS,
                json!({"version":1,"activeId":work_id,"works":[work]}),
            )
            .unwrap();
        let bundle = store
            .export_bead_transfer(&[work_id], "本机资料库".into())
            .unwrap();
        (root, source, target, store, bundle)
    }
    fn reopen(root: &TempDir) -> ProfileRuntime {
        ProfileRuntime::open(root.path(), CredentialCipher::plain()).unwrap()
    }
    #[test]
    fn durable_queue_is_private_target_bound_and_keeps_source_snapshot() {
        let (root, source, key, store, bundle) = setup();
        let original = store.app_state_value(WORKS).unwrap();
        let pending = source
            .while_current(|| stage(&source, &key, bundle))
            .unwrap();
        assert!(load(&source, &source.current_key).unwrap().is_none());
        assert_eq!(source.status().unwrap().selected_key, "local");
        let raw = fs::read(source.bead_handoff_path(&key).unwrap()).unwrap();
        let serialized = String::from_utf8(raw.clone()).unwrap();
        assert!(
            !serialized.contains("token")
                && !serialized.contains("endpoint")
                && !serialized.contains("sessionId")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let path = source.bead_handoff_path(&key).unwrap();
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        source.select(&key).unwrap();
        assert!(source
            .while_current(|| stage(&source, &key, pending.bundle.clone()))
            .is_err());
        let target = reopen(&root);
        assert_eq!(
            load(&target, &target.current_key)
                .unwrap()
                .unwrap()
                .bundle
                .operation_id,
            pending.bundle.operation_id
        );
        assert_eq!(
            fs::read(target.bead_handoff_path(&key).unwrap()).unwrap(),
            raw
        );
        assert_eq!(store.app_state_value(WORKS).unwrap(), original);
        let target_store = TaskStore::open(&target.data_dir.join("target.sqlite3")).unwrap();
        assert_eq!(
            target_store.app_state_value(WORKS).unwrap(),
            None,
            "Opening target never commits implicitly"
        );
    }
    #[test]
    fn repeated_staging_reuses_snapshot_and_never_overwrites_different_work() {
        let (_root, source, key, _, bundle) = setup();
        let pending = stage(&source, &key, bundle.clone()).unwrap();
        let raw = fs::read(source.bead_handoff_path(&key).unwrap()).unwrap();
        let mut second = bundle.clone();
        second.operation_id = Uuid::new_v4().to_string();
        assert_eq!(
            stage(&source, &key, second.clone())
                .unwrap()
                .bundle
                .operation_id,
            pending.bundle.operation_id
        );
        second.works[0]["title"] = json!("新内容");
        assert!(stage(&source, &key, second).is_err());
        assert_eq!(
            fs::read(source.bead_handoff_path(&key).unwrap()).unwrap(),
            raw
        );
    }
    #[test]
    fn restart_retry_without_matching_handoff_never_silently_loses_copy_intent() {
        let (_root, source, key, _, bundle) = setup();
        source.select(&key).unwrap();
        assert!(stage_or_resume(&source, &key, bundle.clone()).is_err());
        assert!(load(&source, &key).unwrap().is_none());
        source.select("local").unwrap();
        let pending = stage_or_resume(&source, &key, bundle.clone()).unwrap();
        source.select(&key).unwrap();
        assert_eq!(
            stage_or_resume(&source, &key, bundle.clone())
                .unwrap()
                .bundle
                .operation_id,
            pending.bundle.operation_id
        );
        let mut changed = bundle;
        changed.works[0]["title"] = json!("另一件作品");
        assert!(stage_or_resume(&source, &key, changed).is_err());
        assert_eq!(
            load(&source, &key).unwrap().unwrap().bundle.operation_id,
            pending.bundle.operation_id
        );
    }
    #[test]
    fn cancel_requires_exact_operation_and_source_or_target_without_database_changes() {
        let (root, source, key, store, bundle) = setup();
        let original = store.app_state_value(WORKS).unwrap();
        let pending = stage(&source, &key, bundle.clone()).unwrap();
        assert!(remove(&source, &key, &Uuid::new_v4().to_string()).is_err());
        let mut unrelated = account("https://another.example.com");
        unrelated.username = "other".into();
        let other = source.save_account(&unrelated).unwrap().key;
        source.select(&other).unwrap();
        let runtime = reopen(&root);
        assert!(remove(&runtime, &key, &pending.bundle.operation_id).is_err());
        runtime.select(&key).unwrap();
        let target = reopen(&root);
        remove(&target, &key, &pending.bundle.operation_id).unwrap();
        remove(&target, &key, &pending.bundle.operation_id).unwrap();
        assert!(load(&target, &key).unwrap().is_none());
        target.select("local").unwrap();
        let source = reopen(&root);
        stage(&source, &key, bundle).unwrap();
        remove(&source, &key, &pending.bundle.operation_id).unwrap();
        assert_eq!(store.app_state_value(WORKS).unwrap(), original);
    }
    #[test]
    fn target_commit_and_crash_replay_preserve_source_and_cleanup_once() {
        let (root, source, key, source_store, bundle) = setup();
        let original = source_store.app_state_value(WORKS).unwrap();
        let pending = stage(&source, &key, bundle).unwrap();
        assert!(commit(&source_store, &source, &pending.bundle.operation_id, "", "").is_err());
        source.select(&key).unwrap();
        let target = reopen(&root);
        let store = TaskStore::open(&target.data_dir.join("target.sqlite3")).unwrap();
        let preview = store.preview_bead_transfer(&pending.bundle).unwrap();
        assert!(commit(
            &store,
            &target,
            &Uuid::new_v4().to_string(),
            &preview.target_hash,
            &preview.bundle_hash
        )
        .is_err());
        assert!(commit(
            &store,
            &target,
            &pending.bundle.operation_id,
            &preview.target_hash,
            "changed"
        )
        .is_err());
        assert!(load(&target, &key).unwrap().is_some());
        // Simulate crash after SQL commit, before queue cleanup.
        let first = store
            .commit_bead_transfer(&pending.bundle, &preview.target_hash, &preview.bundle_hash)
            .unwrap();
        let before = store.app_state_value(WORKS).unwrap();
        let restarted = reopen(&root);
        let result = commit(
            &store,
            &restarted,
            &pending.bundle.operation_id,
            &preview.target_hash,
            &preview.bundle_hash,
        )
        .unwrap();
        assert!(result.receipt.already_copied && !result.cleanup_pending);
        assert_eq!(result.receipt.work_ids, first.work_ids);
        assert_eq!(store.app_state_value(WORKS).unwrap(), before);
        assert!(load(&restarted, &key).unwrap().is_none());
        assert_eq!(source_store.app_state_value(WORKS).unwrap(), original);
    }
    #[test]
    fn final_permissions_deny_copy_and_retain_pending_without_partial_target() {
        let (root, source, key, _, bundle) = setup();
        let pending = stage(&source, &key, bundle).unwrap();
        source.select(&key).unwrap();
        let target = reopen(&root);
        let store = TaskStore::open(&target.data_dir.join("target.sqlite3")).unwrap();
        let preview = store.preview_bead_transfer(&pending.bundle).unwrap();
        store
            .bind_authorization(
                crate::capabilities::CapabilityRuntime::open(&target).unwrap(),
                target.clone(),
            )
            .unwrap();
        let result = commit(
            &store,
            &target,
            &pending.bundle.operation_id,
            &preview.target_hash,
            &preview.bundle_hash,
        );
        assert!(matches!(result, Err(error) if error.contains("permission_denied")));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert!(load(&target, &key).unwrap().is_some());
        assert!(!store.backup_dir.exists());
    }
    #[test]
    fn corrupt_misbound_and_symlink_queues_are_preserved_and_never_loaded() {
        let (_root, source, key, _, bundle) = setup();
        let mut pending = stage(&source, &key, bundle).unwrap();
        let path = source.bead_handoff_path(&key).unwrap();
        pending.target_key = "local".into();
        crate::profiles::write_private(&path, &serde_json::to_vec(&pending).unwrap()).unwrap();
        assert!(load(&source, &key).is_err());
        assert!(remove(&source, &key, &pending.bundle.operation_id).is_err());
        assert!(path.exists());
        crate::profiles::write_private(&path, b"interrupted").unwrap();
        assert!(load(&source, &key).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"interrupted");
        assert!(source.bead_handoff_path("../escape").is_err());
        #[cfg(unix)]
        {
            let original = path.with_extension("original");
            fs::rename(&path, &original).unwrap();
            std::os::unix::fs::symlink(&original, &path).unwrap();
            assert!(load(&source, &key).is_err());
            assert_eq!(fs::read(original).unwrap(), b"interrupted");
        }
    }
}
