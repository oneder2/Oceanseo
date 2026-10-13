//! One tool dataset per personal profile. Scene membership remains independent.
use super::{PersonalBackup, PersonalRuntime};
use crate::tasks::TaskStore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::PathBuf};

fn record_key(value: &Value) -> Option<String> {
    if let Some(id) = value.get("id") {
        return Some(id.to_string());
    }
    value
        .get("scan_id")
        .map(|scan| format!("{scan}:{}", value.get("project_id").unwrap_or(&Value::Null)))
}
fn timestamp(value: &Value) -> &str {
    [
        "updatedAt",
        "updated_at",
        "last_scanned_at",
        "finished_at",
        "createdAt",
        "created_at",
    ]
    .iter()
    .find_map(|key| value.get(key).and_then(Value::as_str))
    .unwrap_or("")
}
fn legacy_id(scene: &str, label: &str, pattern: &Value) -> String {
    let hash = Sha256::digest(format!("{scene}:{label}:{pattern}"));
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash[..16]);
    uuid::Builder::from_random_bytes(bytes)
        .into_uuid()
        .to_string()
}
fn merge(first: &mut Value, next: &Value) {
    if first.is_null() || first.as_str() == Some("") {
        *first = next.clone();
        return;
    }
    match (first, next) {
        (Value::Array(a), Value::Array(b)) => {
            for value in b {
                let id = record_key(value);
                let existing = a.iter().position(|old| match &id {
                    Some(id) => record_key(old).as_ref() == Some(id),
                    None => old == value,
                });
                if let Some(index) = existing {
                    if id.is_some() && timestamp(value) > timestamp(&a[index]) {
                        a[index] = value.clone();
                    }
                } else {
                    a.push(value.clone());
                }
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            // A pattern must retain its dimensions, palette and complete cells.
            if a.contains_key("cells") && a.contains_key("palette") {
                return;
            }
            for (key, value) in b {
                merge(a.entry(key).or_insert(Value::Null), value);
            }
        }
        _ => {}
    }
}

#[cfg(desktop)]
fn merge_work_archive(first: &mut Value, next: &Value) {
    let mut next = next.clone();
    let mut aliases = HashMap::new();
    if let (Some(a), Some(b)) = (
        first["tables"]["projects"].as_array(),
        next["tables"]["projects"].as_array_mut(),
    ) {
        for project in b {
            if let Some(existing) = a.iter().find(|p| p["path"] == project["path"]) {
                aliases.insert(project["id"].clone().to_string(), existing["id"].clone());
                project["id"] = existing["id"].clone();
            }
        }
    }
    for table in ["scanProjects", "drafts"] {
        if let Some(rows) = next["tables"][table].as_array_mut() {
            for row in rows {
                if let Some(id) = aliases.get(&row["project_id"].to_string()) {
                    row["project_id"] = id.clone();
                }
            }
        }
    }
    let prefer_config = first["tables"]["config"][0]["workspace_root"]
        .as_str()
        .unwrap_or("")
        .is_empty()
        && !next["tables"]["config"][0]["workspace_root"]
            .as_str()
            .unwrap_or("")
            .is_empty();
    let config = if prefer_config {
        next["tables"]["config"].clone()
    } else {
        first["tables"]["config"].clone()
    };
    // Reports also have a unique scan identity.
    if let (Some(a), Some(b)) = (
        first["tables"]["reports"].as_array(),
        next["tables"]["reports"].as_array_mut(),
    ) {
        b.retain(|row| !a.iter().any(|old| old["scan_id"] == row["scan_id"]));
    }
    merge(first, &next);
    first["tables"]["config"] = config;
}

impl PersonalRuntime {
    pub(super) fn shared_directory(&self) -> PathBuf {
        self.root.join("personal-workspaces/main")
    }
    pub(super) fn shared_marker(&self) -> PathBuf {
        self.root.join("personal-workspaces/shared-tools-v1.json")
    }

    pub(super) fn ensure_shared_data(&self, base: &TaskStore) -> Result<(), String> {
        if self.shared_marker().exists() {
            return Ok(());
        }
        let before = self.backup(base)?;
        let directory = self.shared_directory();
        crate::profiles::private_dir(&directory)?;
        let mut state = HashMap::<String, Value>::new();
        #[cfg(desktop)]
        let mut work: Option<Value> = None;
        let mut credentials = json!({});
        let mut map = Value::Null;
        let mut credential_backup = json!({});
        for scene in before.document.workspaces.iter().filter(|w| !w.deleted) {
            if let Some(values) = before.states.get(&scene.id) {
                let mut values = values.clone();
                // Preserve unopened legacy drawings as separate saved works.
                if values
                    .get("tideplan.bead-works.v1")
                    .is_none_or(Value::is_null)
                {
                    if let Some(pattern) = values
                        .get("tideplan.bead-pattern.v1")
                        .filter(|p| crate::backup_validation::valid("tideplan.bead-pattern.v1", p))
                    {
                        let id = legacy_id(&scene.id, "work", pattern);
                        let version = legacy_id(&scene.id, "version", pattern);
                        let now = chrono::Utc::now().to_rfc3339();
                        let document = json!({"version":1,"activeId":id,"works":[{"id":id,"title":pattern["title"],"createdAt":now,"updatedAt":now,"archived":false,"currentVersionId":version,"progressVersionId":version,"completedCells":[],"versions":[{"id":version,"label":"原工作区图纸","createdAt":now,"pattern":pattern}]}]});
                        values.insert("tideplan.bead-works.v1".into(), document);
                    }
                }
                for (key, value) in values {
                    merge(state.entry(key).or_insert(Value::Null), &value);
                }
            }
            #[cfg(desktop)]
            if let Some(archive) = before.work_archives.get(&scene.id) {
                if let Some(current) = &mut work {
                    merge_work_archive(current, archive);
                } else {
                    work = Some(archive.clone());
                }
            }
            let scene_dir = self.root.join("personal-workspaces").join(&scene.id);
            // Personal scenes exist only on Linux; desktop credential files use
            // the existing plain JSON encoding, with private filesystem access.
            for file in ["host-credentials.json", "map-settings.json"] {
                let path = scene_dir.join(file);
                if path.exists() {
                    let value: Value =
                        serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                            .map_err(|_| "旧工作区配置损坏，原资料已保留")?;
                    credential_backup[&scene.id][file] = value.clone();
                    if file == "host-credentials.json" {
                        for (host, credential) in
                            value.as_object().ok_or("旧主机凭据无效，原配置保留")?
                        {
                            credentials
                                .as_object_mut()
                                .unwrap()
                                .entry(host.clone())
                                .or_insert_with(|| credential.clone());
                        }
                    } else {
                        if !value.is_string() {
                            return Err("旧地图配置无效，原配置保留".into());
                        }
                        merge(&mut map, &value);
                    }
                }
            }
        }
        // Validate all merged data in throwaway databases before any replacement.
        let stage = self
            .root
            .join("personal-workspaces")
            .join(format!("sharing-validation-{}", uuid::Uuid::new_v4()));
        crate::profiles::private_dir(&stage)?;
        let validation = (|| {
            TaskStore::open_personal(
                &stage.join("tasks.sqlite3"),
                &stage,
                &self.root.join("personal-workspaces/registry.sqlite3"),
            )?
            .replace_personal_state(state.clone())?;
            #[cfg(desktop)]
            if let Some(archive) = &work {
                crate::work_monitor::WorkMonitorStore::open(
                    &stage.join("work.sqlite3"),
                    stage.join("exports"),
                )?
                .restore_personal_archive(archive)?;
            }
            Ok::<(), String>(())
        })();
        std::fs::remove_dir_all(stage).map_err(|e| e.to_string())?;
        validation?;
        let recovery = self
            .root
            .join("personal-workspaces/shared-tools-before-v1.json");
        if !recovery.exists() {
            crate::profiles::write_private(
                &recovery,
                &serde_json::to_vec_pretty(&before).map_err(|e| e.to_string())?,
            )?;
        }
        let credential_recovery = self
            .root
            .join("personal-workspaces/shared-tools-credentials-before-v1.json");
        if !credential_recovery.exists() {
            crate::profiles::write_private(
                &credential_recovery,
                &serde_json::to_vec(&credential_backup).map_err(|e| e.to_string())?,
            )?;
        }
        TaskStore::open_personal(
            &self.root.join("oceanseo-tasks.sqlite3"),
            &directory,
            &self.root.join("personal-workspaces/registry.sqlite3"),
        )?
        .replace_personal_state(state)?;
        #[cfg(desktop)]
        if let Some(archive) = work {
            crate::work_monitor::WorkMonitorStore::open(
                &directory.join("work-monitor.sqlite3"),
                directory.join("work-monitor-exports"),
            )?
            .restore_personal_archive(&archive)?;
        }
        for (file, value) in [
            ("host-credentials.json", credentials),
            ("map-settings.json", map),
        ] {
            if !value.is_null() {
                crate::profiles::write_private(
                    &directory.join(file),
                    &serde_json::to_vec(&value).map_err(|e| e.to_string())?,
                )?;
            }
        }
        crate::profiles::write_private(&self.shared_marker(), b"{\"version\":1}")?;
        Ok(())
    }

    pub(super) fn restore_sharing_marker(&self, backup: &PersonalBackup) -> Result<(), String> {
        if backup.shared_tools {
            crate::profiles::write_private(&self.shared_marker(), b"{\"version\":1}")
        } else {
            if self.shared_marker().exists() {
                std::fs::remove_file(self.shared_marker()).map_err(|e| e.to_string())?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::personal_workspaces::{Tool, Workspace};

    #[test]
    fn shared_migration_unifies_records_keeps_recovery_and_does_not_resurrect_removed_data() {
        let root = tempfile::tempdir().unwrap();
        let base = TaskStore::open(&root.path().join("oceanseo-tasks.sqlite3")).unwrap();
        let runtime = PersonalRuntime::open(root.path().into()).unwrap();
        let mut doc = runtime.initialize(&base.export_backup().unwrap()).unwrap();
        let mut scenes = vec![];
        for name in ["CTO", "CEO"] {
            let id = uuid::Uuid::new_v4().to_string();
            doc.workspaces.push(Workspace {
                id: id.clone(),
                name: name.into(),
                main: false,
                style: "neutral".into(),
                deleted: false,
                tools: vec![Tool {
                    id: uuid::Uuid::new_v4().to_string(),
                    module: "shopping-list".into(),
                    archived: false,
                }],
            });
            let directory = root.path().join("personal-workspaces").join(&id);
            crate::profiles::private_dir(&directory).unwrap();
            let store = TaskStore::open_personal(
                &root.path().join("oceanseo-tasks.sqlite3"),
                &directory,
                &root.path().join("personal-workspaces/registry.sqlite3"),
            )
            .unwrap();
            store
                .set_app_state(
                    "tideplan.purchase-list.v1",
                    json!([{"id":name,"name":name}]),
                )
                .unwrap();
            #[cfg(desktop)]
            {
                let work = crate::work_monitor::WorkMonitorStore::open(
                    &directory.join("work-monitor.sqlite3"),
                    directory.join("exports"),
                )
                .unwrap();
                let mut archive = work.archive().unwrap();
                archive["tables"]["config"][0]["workspace_root"] =
                    json!(root.path().to_string_lossy());
                archive["tables"]["projects"] = json!([{"id":uuid::Uuid::new_v4().to_string(),"path":"/same/project","name":name,"version":null,"snapshot_hash":"hash","target_public_id":null,"target_title":null,"last_scanned_at":"2026-01-01T00:00:00Z"}]);
                work.restore_personal_archive(&archive).unwrap();
            }
            store.set_app_state("tideplan.bead-pattern.v1", json!({"version":1,"title":name,"width":2,"height":1,"beadPitchMm":2.6,"palette":[{"hex":"#ffffff","name":"白色"}],"cells":[0,-1]})).unwrap();
            crate::profiles::write_private(
                &directory.join("host-credentials.json"),
                json!({name:{"url":"https://example.com","token":"test"}})
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
            scenes.push((id, store));
        }
        runtime.save(doc, 0).unwrap();
        let legacy = runtime.backup(&base).unwrap();
        runtime.ensure_shared_data(&base).unwrap();
        let shared = TaskStore::open_personal(
            &root.path().join("oceanseo-tasks.sqlite3"),
            &runtime.shared_directory(),
            &root.path().join("personal-workspaces/registry.sqlite3"),
        )
        .unwrap();
        assert_eq!(
            shared.export_backup().unwrap().app_state["tideplan.purchase-list.v1"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(runtime.backup(&base).unwrap().shared_tools);
        assert!(root
            .path()
            .join("personal-workspaces/shared-tools-before-v1.json")
            .exists());
        assert_eq!(
            scenes[0].1.export_backup().unwrap().app_state["tideplan.purchase-list.v1"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let credentials: Value = serde_json::from_slice(
            &std::fs::read(runtime.shared_directory().join("host-credentials.json")).unwrap(),
        )
        .unwrap();
        assert!(credentials.get("CTO").is_some() && credentials.get("CEO").is_some());
        #[cfg(desktop)]
        {
            let work = crate::work_monitor::WorkMonitorStore::open(
                &runtime.shared_directory().join("work-monitor.sqlite3"),
                runtime.shared_directory().join("exports"),
            )
            .unwrap();
            assert_eq!(
                work.archive().unwrap()["tables"]["projects"]
                    .as_array()
                    .unwrap()
                    .len(),
                1
            );
        }
        assert_eq!(
            shared.export_backup().unwrap().app_state["tideplan.bead-works.v1"]["works"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        std::fs::remove_file(runtime.shared_marker()).unwrap();
        runtime.ensure_shared_data(&base).unwrap();
        assert_eq!(
            shared.export_backup().unwrap().app_state["tideplan.bead-works.v1"]["works"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        shared
            .set_app_state("tideplan.purchase-list.v1", json!([]))
            .unwrap();
        let backup = runtime.backup(&base).unwrap();
        runtime.restore(&base, backup).unwrap();
        runtime.ensure_shared_data(&base).unwrap();
        assert_eq!(
            shared.export_backup().unwrap().app_state["tideplan.purchase-list.v1"],
            json!([])
        );
        runtime.restore(&base, legacy).unwrap();
        runtime.ensure_shared_data(&base).unwrap();
        assert_eq!(
            shared.export_backup().unwrap().app_state["tideplan.purchase-list.v1"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn merge_keeps_newest_record_revision_and_preserves_drawing_dimensions() {
        let mut state =
            json!({"version":1,"people":[{"id":"same","updatedAt":"2026-01-01","name":"old"}]});
        merge(
            &mut state,
            &json!({"version":1,"people":[{"id":"same","updatedAt":"2026-02-01","name":"new"},{"id":"other","name":"second"}]}),
        );
        assert_eq!(state["people"].as_array().unwrap().len(), 2);
        assert_eq!(state["people"][0]["name"], "new");
        let mut pattern = json!({"width":1,"height":1,"cells":[0],"palette":[]});
        merge(
            &mut pattern,
            &json!({"width":2,"height":1,"cells":[0,0],"palette":[]}),
        );
        assert_eq!(pattern["cells"], json!([0]));
        assert_eq!(pattern["width"], 1);
    }
}
