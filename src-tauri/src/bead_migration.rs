//! Local single-pattern migration and its immutable, restorable safety copy.
use super::*;
use serde_json::{json, Value};
use std::io::Write;

const LEGACY: &str = "tideplan.bead-pattern.v1";
const WORKS: &str = "tideplan.bead-works.v1";

pub(super) struct BeadMigration {
    pub document: Value,
    source: Value,
    hash: String,
    backup: DataBackup,
}

impl TaskStore {
    pub(super) fn prepare_bead_migration(
        &self,
        tx: &Transaction<'_>,
        state: &HashMap<String, Value>,
    ) -> Result<Option<BeadMigration>, String> {
        if state.get(WORKS).is_some_and(|value| !value.is_null()) {
            return Ok(None);
        }
        let Some(source) = state.get(LEGACY).filter(|value| !value.is_null()) else {
            return Ok(None);
        };
        // Bad old records stay available for export; never generate a blank
        // replacement. Readonly/unknown policy startup also makes no changes.
        if !crate::backup_validation::valid(LEGACY, source)
            || self
                .authorization
                .get()
                .is_some_and(|(capabilities, profile)| {
                    capabilities
                        .require(profile, "bead-studio", "write")
                        .is_err()
                })
        {
            return Ok(None);
        }
        let work_id = Uuid::new_v4().to_string();
        let version_id = Uuid::new_v4().to_string();
        let timestamp = now_timestamp();
        let document = json!({"version":1,"activeId":work_id,"works":[{
            "id":work_id,"title":source["title"],"createdAt":timestamp,"updatedAt":timestamp,
            "archived":false,"currentVersionId":version_id,"progressVersionId":version_id,
            "completedCells":[],"versions":[{"id":version_id,"label":"初始图纸",
                "createdAt":timestamp,"pattern":source}]
        }]});
        validate_app_state(WORKS, &document)?;
        let hash = format!(
            "{:x}",
            Sha256::digest(serialize_app_state(source)?.as_bytes())
        );
        Ok(Some(BeadMigration {
            document,
            source: source.clone(),
            hash,
            backup: DataBackup {
                schema_version: BACKUP_SCHEMA_VERSION.into(),
                created_at: timestamp,
                tasks: list_tasks_from_connection(tx)?,
                app_state: state.clone(),
            },
        }))
    }

    /// Must run under the final write permit and the same SQLite transaction.
    /// Snapshot files are never overwritten; a rollback may leave a harmless
    /// recovery file, but can never leave a committed migration receipt.
    pub(super) fn record_bead_protection(
        &self,
        tx: &Transaction<'_>,
        migration: &BeadMigration,
        imported: bool,
    ) -> Result<(), String> {
        let key = format!("oceanseo.bead-works.v1:{}", migration.hash);
        let previous: Option<String> = tx
            .query_row(
                "SELECT backup_path FROM legacy_migrations WHERE migration_key=?1",
                [&key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "拼豆迁移回执读取失败，原资料未修改")?;
        if let Some(previous) = previous {
            let path = PathBuf::from(previous);
            if path.parent() != Some(self.backup_dir.as_path()) || path.is_symlink() {
                return Err("拼豆迁移安全副本路径无效，原资料未修改".into());
            }
            let snapshot: DataBackup = serde_json::from_slice(
                &fs::read(path).map_err(|_| "拼豆迁移安全副本不可读取，原资料未修改")?,
            )
            .map_err(|_| "拼豆迁移安全副本格式无效，原资料未修改")?;
            if snapshot.app_state.get(LEGACY) != Some(&migration.source) {
                return Err("拼豆迁移安全副本与原图不一致，原资料未修改".into());
            }
            if imported {
                tx.execute(
                    "UPDATE legacy_migrations SET imported_count=1 WHERE migration_key=?1",
                    [&key],
                )
                .map_err(|_| "拼豆迁移回执更新失败，原资料未修改")?;
            }
            return Ok(());
        }
        if self.backup_dir.is_symlink() {
            return Err("拼豆迁移安全副本目录无效，原资料未修改".into());
        }
        fs::create_dir_all(&self.backup_dir)
            .map_err(|_| "拼豆迁移安全副本无法建立，原资料未修改")?;
        let path = self
            .backup_dir
            .join(format!("before-bead-works-{}.json", Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
            options.mode(0o600);
            fs::set_permissions(&self.backup_dir, fs::Permissions::from_mode(0o700))
                .map_err(|_| "拼豆迁移安全副本目录无法保护，原资料未修改")?;
        }
        let mut file = options
            .open(&path)
            .map_err(|_| "拼豆迁移安全副本无法写入，原资料未修改")?;
        file.write_all(
            &serde_json::to_vec_pretty(&migration.backup)
                .map_err(|_| "拼豆迁移安全副本无法编码")?,
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "拼豆迁移安全副本未写入完成，原资料未修改")?;
        fs::File::open(&self.backup_dir)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "拼豆迁移安全副本目录未写入完成，原资料未修改")?;
        tx.execute(
            "INSERT INTO legacy_migrations(migration_key,payload_sha256,imported_count,backup_path,migrated_at) VALUES(?1,?2,?3,?4,?5)",
            params![key, migration.hash, i64::from(imported), path.to_string_lossy(), now_timestamp()],
        ).map_err(|_| "拼豆迁移回执保存失败，原资料未修改")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn pattern() -> Value {
        json!({"version":1,"title":"迁移原图","width":2,"height":1,"beadPitchMm":2.6,
            "palette":[{"hex":"#ffffff","name":"白色"}],"cells":[0,-1]})
    }
    fn store(root: &TempDir) -> TaskStore {
        TaskStore::open(&root.path().join("data.sqlite3")).unwrap()
    }
    fn snapshots(store: &TaskStore) -> Vec<PathBuf> {
        fs::read_dir(&store.backup_dir)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                path.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("before-bead-works-")
            })
            .collect()
    }
    fn receipt_count(store: &TaskStore) -> usize {
        store.connection.lock().unwrap().query_row(
            "SELECT count(*) FROM legacy_migrations WHERE migration_key LIKE 'oceanseo.bead-works.v1:%'", [], |row| row.get(0),
        ).unwrap()
    }
    #[test]
    fn migration_retains_an_immutable_restorable_source_and_is_restart_idempotent() {
        let root = TempDir::new().unwrap();
        let source = pattern();
        let store = store(&root);
        store.set_app_state(LEGACY, source.clone()).unwrap();
        let state = store.bootstrap_app_state(HashMap::new()).unwrap();
        assert_eq!(state[WORKS]["works"][0]["versions"][0]["pattern"], source);
        assert_eq!(state[LEGACY], source);
        assert_eq!(receipt_count(&store), 1);
        let paths = snapshots(&store);
        assert_eq!(paths.len(), 1);
        let bytes = fs::read(&paths[0]).unwrap();
        let safety: DataBackup = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(safety.app_state[LEGACY], source);
        assert!(!safety.app_state.contains_key(WORKS));
        validate_backup(&safety).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                paths[0].metadata().unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let mut edited = source.clone();
        edited["cells"] = json!([0, 0]);
        store.set_app_state(LEGACY, edited).unwrap();
        assert_eq!(fs::read(&paths[0]).unwrap(), bytes);
        let doc = state[WORKS].clone();
        drop(store);
        let reopened = self::store(&root);
        assert_eq!(
            reopened.bootstrap_app_state(HashMap::new()).unwrap()[WORKS],
            doc
        );
        assert_eq!(snapshots(&reopened).len(), 1);
        reopened.restore_backup(safety).unwrap();
        let restored = reopened.bootstrap_app_state(HashMap::new()).unwrap();
        assert_eq!(restored[WORKS]["works"].as_array().unwrap().len(), 1);
        assert_eq!(
            restored[WORKS]["works"][0]["versions"][0]["pattern"],
            source
        );
        assert_eq!(snapshots(&reopened).len(), 1);
        assert_eq!(fs::read(&paths[0]).unwrap(), bytes);
    }
    #[test]
    fn failed_snapshot_blocks_migration_and_retry_preserves_the_same_original() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let source = pattern();
        store.set_app_state(LEGACY, source.clone()).unwrap();
        fs::write(&store.backup_dir, b"Synthetic directory blocker").unwrap();
        assert!(store.bootstrap_app_state(HashMap::new()).is_err());
        assert_eq!(store.app_state_value(LEGACY).unwrap(), Some(source.clone()));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipt_count(&store), 0);
        assert!(!store.import_completed(true).unwrap());
        fs::remove_file(&store.backup_dir).unwrap();
        assert_eq!(
            store.bootstrap_app_state(HashMap::new()).unwrap()[WORKS]["works"][0]["versions"][0]
                ["pattern"],
            source
        );
        assert_eq!(receipt_count(&store), 1);
    }
    #[test]
    fn failed_sql_write_rolls_back_document_and_receipt_but_keeps_recovery_file() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let source = pattern();
        store.set_app_state(LEGACY, source.clone()).unwrap();
        store.connection.lock().unwrap().execute_batch(
            "CREATE TRIGGER reject_bead_migration BEFORE INSERT ON app_state WHEN NEW.key='tideplan.bead-works.v1' BEGIN SELECT RAISE(ABORT,'Synthetic failure'); END;"
        ).unwrap();
        assert!(store.bootstrap_app_state(HashMap::new()).is_err());
        assert_eq!(store.app_state_value(LEGACY).unwrap(), Some(source.clone()));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
        assert_eq!(receipt_count(&store), 0);
        let snapshot: DataBackup =
            serde_json::from_slice(&fs::read(&snapshots(&store)[0]).unwrap()).unwrap();
        assert_eq!(snapshot.app_state[LEGACY], source);
        store
            .connection
            .lock()
            .unwrap()
            .execute_batch("DROP TRIGGER reject_bead_migration")
            .unwrap();
        assert!(store
            .bootstrap_app_state(HashMap::new())
            .unwrap()
            .contains_key(WORKS));
        assert_eq!(receipt_count(&store), 1);
    }
    #[test]
    fn direct_compatibility_write_also_protects_the_original_before_overwriting() {
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let source = pattern();
        store.set_app_state(LEGACY, source.clone()).unwrap();
        let mut edited = source.clone();
        edited["title"] = json!("编辑后");
        store.set_app_state(LEGACY, edited.clone()).unwrap();
        let backup: DataBackup =
            serde_json::from_slice(&fs::read(&snapshots(&store)[0]).unwrap()).unwrap();
        assert_eq!(backup.app_state[LEGACY], source);
        assert_eq!(store.app_state_value(LEGACY).unwrap(), Some(edited));
        assert_eq!(store.app_state_value(WORKS).unwrap(), None);
    }
    #[test]
    fn unknown_policy_and_corrupt_legacy_records_never_generate_blank_works() {
        use crate::capabilities::tests::{account, profile};
        let root = TempDir::new().unwrap();
        let store = store(&root);
        let source = pattern();
        store.set_app_state(LEGACY, source.clone()).unwrap();
        let profile = profile(
            &root.path().join("profile"),
            &account("https://sync.example.com"),
        );
        let capabilities = crate::capabilities::CapabilityRuntime::open(&profile).unwrap();
        store.bind_authorization(capabilities, profile).unwrap();
        let state = store.bootstrap_app_state(HashMap::new()).unwrap();
        assert_eq!(state[LEGACY], source);
        assert!(!state.contains_key(WORKS));
        assert_eq!(receipt_count(&store), 0);
        assert!(!store.backup_dir.exists());
        let other_root = TempDir::new().unwrap();
        let corrupt = self::store(&other_root);
        corrupt
            .set_app_state(LEGACY, json!({"version":1,"cells":"invalid"}))
            .unwrap();
        let state = corrupt.bootstrap_app_state(HashMap::new()).unwrap();
        assert!(!state.contains_key(WORKS));
        assert_eq!(state[LEGACY]["cells"], "invalid");
    }
}
