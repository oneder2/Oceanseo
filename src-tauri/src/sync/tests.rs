use super::*;
use serde_json::json;

struct Server(std::process::Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[tokio::test]
async fn two_clients_sync_over_real_http_conflict_retry_goals_and_auth() {
    use std::io::BufRead;
    let temp = tempfile::tempdir().unwrap();
    let service_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("services/sync");
    let mut child = std::process::Command::new("python3")
        .current_dir(service_dir)
        .args(["-u", "-c", "import os; from server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_SYNC_DB'],os.environ['TEST_SYNC_TOKEN']); print(s.server_port,flush=True); s.serve_forever()"])
        .env("TEST_SYNC_DB", temp.path().join("server.sqlite"))
        .env("TEST_SYNC_TOKEN", "tideplan-local-test-token-not-for-production-123456")
        .stdout(std::process::Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let _server = Server(child);
    let port: u16 = line.trim().parse().unwrap();
    let config = Config {
        endpoint: format!("http://127.0.0.1:{port}"),
        token: "tideplan-local-test-token-not-for-production-123456".into(),
        expected_vault_id: None,
        workspace: None,
    };
    let a = TaskStore::open(&temp.path().join("a.sqlite")).unwrap();
    let b = TaskStore::open(&temp.path().join("b.sqlite")).unwrap();
    let task = a
        .create(crate::tasks::TaskMutation {
            title: "电脑记录".into(),
            notes: "手机继续".into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: Some("2026-10-10".into()),
            origin: None,
        })
        .unwrap();
    let goals = json!({"version":1,"revision":7,"draft":"本机草稿不上传","thoughts":[],"goals":[],"actions":[],"proposals":[],"reviews":[],"preferences":{"minutes":60,"energy":"normal","dailyLimit":3,"checkins":true,"autoReview":false,"reviewTime":"19:00","reviewWeekday":0},"operations":["private-local-operation"],"undo":null,"conversation":{"messages":[{"id":"m1","role":"user","text":"帮我整理下一步","createdAt":"2026-09-29T09:00:00Z"}],"understanding":[],"proposalId":"","receipts":[],"needsReply":true}});
    a.set_app_state(crate::goals::KEY, goals).unwrap();
    let (local, meta) = a.sync_snapshot().unwrap();
    assert_eq!(local[GOALS]["draft"], "");
    assert_eq!(local[GOALS]["operations"], json!([]));
    let initial = request(&config, None).await.unwrap();
    let saved = request(&config,Some(json!({"protocol":1,"vaultId":initial.vault_id,"expectedRevision":initial.revision,"records":local}))).await.unwrap();
    a.sync_apply(&local, &meta, &saved, "fixture".into())
        .unwrap();
    let (blocal, bmeta) = b.sync_snapshot().unwrap();
    b.sync_apply(&blocal, &bmeta, &saved, "fixture".into())
        .unwrap();
    assert_eq!(b.get(&task.id).unwrap().notes, "手机继续");
    assert_eq!(
        b.goal_state().unwrap().unwrap()["conversation"]["messages"][0]["text"],
        "帮我整理下一步"
    );
    assert_eq!(b.sync_snapshot().unwrap().0, saved.records);
    b.set_completed(&task.id, true).unwrap();
    let (updated, updated_meta) = b.sync_snapshot().unwrap();
    let body = json!({"protocol":1,"vaultId":saved.vault_id,"expectedRevision":saved.revision,"records":updated});
    let acknowledged = request(&config, Some(body.clone())).await.unwrap();
    // Lost response: a blind stale PUT is refused, a fresh GET permits convergence.
    assert!(request(&config, Some(body))
        .await
        .unwrap_err()
        .contains("另一台"));
    let retry = request(&config, None).await.unwrap();
    assert!(merge(
        &updated_meta.base,
        &updated,
        &retry.records,
        &BTreeMap::new()
    )
    .1
    .is_empty());
    b.sync_apply(&updated, &updated_meta, &retry, "fixture".into())
        .unwrap();
    let (alocal, ameta) = a.sync_snapshot().unwrap();
    a.sync_apply(&alocal, &ameta, &acknowledged, "fixture".into())
        .unwrap();
    assert!(a.get(&task.id).unwrap().completed_at.is_some());
    let bad = Config {
        token: "wrong".into(),
        ..config
    };
    assert!(request(&bad, None).await.unwrap_err().contains("令牌"));
}

#[test]
fn conflicts_preserve_both_versions_and_require_explicit_selection() {
    let base = BTreeMap::from([("goals".into(), json!({"messages":["before"]}))]);
    let local = BTreeMap::from([("goals".into(), json!({"messages":["computer"]}))]);
    let remote = BTreeMap::from([("goals".into(), json!({"messages":["phone"]}))]);
    let (_, conflicts) = merge(&base, &local, &remote, &BTreeMap::new());
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].local, local["goals"]);
    let (merged, conflicts) = merge(
        &base,
        &local,
        &remote,
        &BTreeMap::from([("goals".into(), "remote".into())]),
    );
    assert!(conflicts.is_empty());
    assert_eq!(merged, remote);
}

#[tokio::test]
async fn account_transport_is_vault_bound_and_keeps_legacy_data_out_of_v2() {
    use crate::{
        credentials::CredentialCipher,
        profiles::{AccountProfile, ProfileRuntime},
    };
    use std::io::BufRead;
    let temp = tempfile::tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let mut child = std::process::Command::new("python3").current_dir(root)
        .args(["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); a=s.store.register('alice','Synthetic-password-123!',s.store.create_invite(),'Synthetic computer','linux'); b=s.store.register('bob','Synthetic-password-123!',s.store.create_invite(),'Synthetic phone','android'); print(json.dumps({'port':s.server_port,'a':a,'b':b}),flush=True); s.serve_forever()"])
        .env("TEST_ACCOUNTS_DB", temp.path().join("server.sqlite"))
        .stdout(std::process::Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let _server = Server(child);
    let setup: Value = serde_json::from_str(&line).unwrap();
    let endpoint = format!("http://127.0.0.1:{}", setup["port"]);
    let profile = |label: &str| {
        let raw = &setup[label];
        AccountProfile {
            endpoint: endpoint.clone(),
            user_id: raw["user"]["id"].as_str().unwrap().into(),
            username: raw["user"]["username"].as_str().unwrap().into(),
            vault_id: raw["vaultId"].as_str().unwrap().into(),
            session_id: raw["session"]["id"].as_str().unwrap().into(),
            expires_at: raw["session"]["expiresAt"].as_i64().unwrap(),
            device_name: raw["session"]["deviceName"].as_str().unwrap().into(),
            token: raw["token"].as_str().unwrap().into(),
            workspace: None,
        }
    };
    let client = temp.path().join("client");
    let offline = ProfileRuntime::open(&client, CredentialCipher::plain()).unwrap();
    let legacy_store = TaskStore::open(&offline.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
    legacy_store
        .create(crate::tasks::TaskMutation {
            title: "offline must not upload".into(),
            notes: "private".into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: None,
            origin: None,
        })
        .unwrap();
    let alice = profile("a");
    let a = offline.save_account(&alice).unwrap();
    let bob = profile("b");
    offline.save_account(&bob).unwrap();
    offline.select(&a.key).unwrap();
    let active = ProfileRuntime::open(&client, CredentialCipher::plain()).unwrap();
    let runtime = SyncRuntime {
        path: active.data_dir.join("account-session.json"),
        account_key: Some(a.key.clone()),
        cipher: CredentialCipher::plain(),
        gate: tokio::sync::Mutex::new(()),
        preview: Mutex::new(None),
        automatic_preview: Mutex::new(None),
    };
    let config = runtime.config().unwrap();
    assert_eq!(config.expected_vault_id, Some(alice.vault_id.clone()));
    let astore = TaskStore::open(&active.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
    assert!(astore.list().unwrap().is_empty());
    let task = astore
        .create(crate::tasks::TaskMutation {
            title: "alice only".into(),
            notes: "not bob".into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: None,
            origin: None,
        })
        .unwrap();
    let (local, meta) = astore.sync_snapshot().unwrap();
    let remote = request(&config, None).await.unwrap();
    assert_eq!(remote.records.len(), 0);
    let saved = request(
        &config,
        Some(json!({"protocol":1,"vaultId":remote.vault_id,"expectedRevision":0,"records":local})),
    )
    .await
    .unwrap();
    astore
        .sync_apply(&local, &meta, &saved, "fixture".into())
        .unwrap();
    assert_eq!(saved.records.len(), 1);
    assert_eq!(
        saved.records[&format!("task:{}", task.id)]["title"],
        "alice only"
    );
    let bob_config = Config {
        endpoint,
        token: bob.token.clone(),
        expected_vault_id: Some(bob.vault_id.clone()),
        workspace: None,
    };
    assert!(request(&bob_config, None).await.unwrap().records.is_empty());
    let cross = Config {
        token: bob.token,
        ..config.clone()
    };
    assert!(request(&cross, None)
        .await
        .unwrap_err()
        .contains("其他资料库"));
    assert!(request(
        &cross,
        Some(json!({"protocol":1,"vaultId":alice.vault_id,"expectedRevision":1,"records":local}))
    )
    .await
    .is_err());
    assert_eq!(
        legacy_store.list().unwrap()[0].title,
        "offline must not upload"
    );
    let mut expired = alice;
    expired.expires_at = 1;
    active.save_account(&expired).unwrap();
    assert!(runtime.config().unwrap().token.is_empty());
    assert!(request(&runtime.config().unwrap(), None).await.is_err());
    std::fs::remove_file(&runtime.path).unwrap();
    assert!(runtime.config().is_err());
}

#[test]
fn deletion_versus_edit_conflicts_and_unchanged_device_accepts_deletion() {
    let base = BTreeMap::from([("task:one".into(), json!({"notes":"before"}))]);
    let edited = BTreeMap::from([("task:one".into(), json!({"notes":"after"}))]);
    let deleted = BTreeMap::from([("task:one".into(), Value::Null)]);
    assert_eq!(merge(&base, &edited, &deleted, &BTreeMap::new()).1.len(), 1);
    assert_eq!(merge(&base, &base, &deleted, &BTreeMap::new()).0, deleted);
}

#[test]
fn fresh_device_does_not_delete_existing_remote_and_new_ids_union() {
    let local = BTreeMap::from([("task:A".into(), json!({"title":"A"}))]);
    let remote = BTreeMap::from([
        ("task:B".into(), json!({"title":"B"})),
        ("task:C".into(), Value::Null),
    ]);
    let (result, conflicts) = merge(&Records::new(), &local, &remote, &BTreeMap::new());
    assert_eq!(result.len(), 3);
    assert!(conflicts.is_empty());
}

#[test]
fn secure_endpoint_policy_blocks_tokens_in_urls_and_cleartext_lan() {
    for url in [
        "http://192.168.1.10",
        "https://user:secret@example.com",
        "https://example.com/?token=secret",
        "file:///tmp/sync",
        "https://example.com/#secret",
    ] {
        assert!(normalize_endpoint(url).is_err(), "{url}");
    }
    assert_eq!(
        normalize_endpoint("https://example.com/sync/").unwrap(),
        "https://example.com/sync"
    );
    assert!(normalize_endpoint("http://127.0.0.1:4789").is_ok());
}

#[test]
fn unsupported_documents_and_malformed_goals_are_rejected() {
    assert!(validate_records(&BTreeMap::from([("api_key".into(), Value::Null)])).is_err());
    assert!(validate_records(&BTreeMap::from([("goals".into(), json!({}))])).is_err());
}

#[tokio::test]
async fn bead_workspace_two_stores_http_progress_restart_and_conflict() {
    use std::io::BufRead;
    let temp = tempfile::tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let mut child = std::process::Command::new("python3").current_dir(root)
        .args(["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB'],control_database=os.environ['TEST_CONTROL_DB'],environment='preview'); a=s.store.register('bead-user','Synthetic-password-123!',s.store.create_invite(),'Synthetic','test'); s.control.grant_role('bead-user','owner'); w=s.control.create_workspace(a['token'],'personal','Synthetic')['workspaces'][0]; print(json.dumps({'port':s.server_port,'a':a,'w':w}),flush=True); s.serve_forever()"])
        .env("TEST_ACCOUNTS_DB", temp.path().join("accounts.sqlite"))
        .env("TEST_CONTROL_DB", temp.path().join("control.sqlite"))
        .stdout(std::process::Stdio::piped()).spawn().unwrap();
    let mut line = String::new();
    std::io::BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let _server = Server(child);
    let setup: Value = serde_json::from_str(&line).unwrap();
    let config = Config {
        endpoint: format!("http://127.0.0.1:{}", setup["port"]),
        token: setup["a"]["token"].as_str().unwrap().into(),
        expected_vault_id: Some(setup["w"]["vaultId"].as_str().unwrap().into()),
        workspace: Some(crate::profiles::WorkspaceBinding {
            version: 1,
            environment: "preview".into(),
            edition: "personal".into(),
            id: setup["w"]["id"].as_str().unwrap().into(),
            vault_id: setup["w"]["vaultId"].as_str().unwrap().into(),
        }),
    };
    let a = TaskStore::open(&temp.path().join("desktop.sqlite")).unwrap();
    let b_path = temp.path().join("phone.sqlite");
    let b = TaskStore::open(&b_path).unwrap();
    let work = uuid::Uuid::new_v4().to_string();
    let version = uuid::Uuid::new_v4().to_string();
    let doc = json!({"version":1,"activeId":work,"works":[{
        "id":work,"title":"Synthetic work","createdAt":"2026-10-11","updatedAt":"2026-10-11",
        "archived":false,"currentVersionId":version,"progressVersionId":version,"completedCells":[],
        "versions":[{"id":version,"label":"Initial","createdAt":"2026-10-11","pattern":{
            "version":1,"title":"Synthetic work","width":2,"height":1,"cells":[0,0],
            "palette":[{"hex":"#faf4c8","name":"Legacy"}]
        }}]
    }]});
    a.set_app_state(BEAD_WORKS, doc).unwrap();
    let initial = request(&config, None).await.unwrap();
    let (local, meta) = a.sync_snapshot().unwrap();
    let saved = request(&config, Some(json!({"protocol":1,"vaultId":initial.vault_id,"expectedRevision":initial.revision,"records":local}))).await.unwrap();
    a.sync_apply(&local, &meta, &saved, "synthetic".into())
        .unwrap();
    let (blocal, bmeta) = b.sync_snapshot().unwrap();
    b.sync_apply(&blocal, &bmeta, &saved, "synthetic".into())
        .unwrap();
    let mut phone = b.app_state_value(BEAD_WORKS).unwrap().unwrap();
    phone["works"][0]["completedCells"] = json!([0]);
    b.set_app_state(BEAD_WORKS, phone).unwrap();
    let (blocal, bmeta) = b.sync_snapshot().unwrap();
    let body = json!({"protocol":1,"vaultId":saved.vault_id,"expectedRevision":saved.revision,"records":blocal});
    let progress = request(&config, Some(body.clone())).await.unwrap();
    assert!(request(&config, Some(body)).await.is_err()); // stale retry cannot overwrite
    b.sync_apply(&blocal, &bmeta, &progress, "synthetic".into())
        .unwrap();
    let (alocal, ameta) = a.sync_snapshot().unwrap();
    let (merged, conflicts) = merge(&ameta.base, &alocal, &progress.records, &BTreeMap::new());
    assert!(conflicts.is_empty());
    assert_eq!(merged[BEAD_WORKS]["works"][0]["completedCells"], json!([0]));
    a.sync_apply(&alocal, &ameta, &progress, "synthetic".into())
        .unwrap();
    drop(b);
    let b = TaskStore::open(&b_path).unwrap();
    assert_eq!(
        b.app_state_value(BEAD_WORKS).unwrap().unwrap()["works"][0]["completedCells"],
        json!([0])
    );
    let (base, _) = a.sync_snapshot().unwrap();
    let mut desktop = base.clone();
    desktop.get_mut(BEAD_WORKS).unwrap()["works"][0]["title"] = json!("Edited offline");
    let mut phone = base.clone();
    phone.get_mut(BEAD_WORKS).unwrap()["works"][0]["completedCells"] = json!([]);
    assert_eq!(merge(&base, &desktop, &phone, &BTreeMap::new()).1.len(), 1);
    assert_eq!(base[BEAD_WORKS]["works"][0]["completedCells"], json!([0]));
    let legacy = Config {
        workspace: None,
        expected_vault_id: Some(setup["a"]["vaultId"].as_str().unwrap().into()),
        ..config
    };
    assert!(request(&legacy, None).await.unwrap().records.is_empty());
}
