use super::*;
use crate::{credentials::CredentialCipher, profiles::AccountProfile, tasks::TaskMutation};
use serde_json::json;
use std::{
    io::BufRead,
    process::{Child, Command, Stdio},
};

struct Fixture {
    dir: tempfile::TempDir,
    child: Child,
    setup: Value,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
struct Client {
    profile: ProfileRuntime,
    runtime: SyncRuntime,
    store: TaskStore,
}
impl Fixture {
    fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("python3")
            .current_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap())
            .args(["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); a=s.store.register('alice','Synthetic-password-123!',s.store.create_invite(),'Linux','linux'); b=s.store.login('alice','Synthetic-password-123!','Android','android'); other=s.store.register('bob','Synthetic-password-123!',s.store.create_invite(),'Other','linux'); print(json.dumps({'port':s.server_port,'a':a,'b':b,'other':other}),flush=True); s.serve_forever()"])
            .env("TEST_ACCOUNTS_DB", dir.path().join("cloud.sqlite"))
            .stdout(Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        Self {
            dir,
            child,
            setup: serde_json::from_str(&line).unwrap(),
        }
    }
    fn account(&self, label: &str) -> AccountProfile {
        let value = &self.setup[label];
        AccountProfile {
            endpoint: format!("http://127.0.0.1:{}", self.setup["port"]),
            user_id: value["user"]["id"].as_str().unwrap().into(),
            username: value["user"]["username"].as_str().unwrap().into(),
            vault_id: value["vaultId"].as_str().unwrap().into(),
            token: value["token"].as_str().unwrap().into(),
            session_id: value["session"]["id"].as_str().unwrap().into(),
            expires_at: value["session"]["expiresAt"].as_i64().unwrap(),
            device_name: value["session"]["deviceName"].as_str().unwrap().into(),
        }
    }
    fn client(&self, label: &str) -> Client {
        let root = self.dir.path().join(label);
        let local = ProfileRuntime::open(&root, CredentialCipher::plain()).unwrap();
        let account = local.save_account(&self.account(label)).unwrap();
        local.select(&account.key).unwrap();
        let profile = ProfileRuntime::open(&root, CredentialCipher::plain()).unwrap();
        let runtime = SyncRuntime {
            path: profile.data_dir.join("account-session.json"),
            account_key: Some(profile.current_key.clone()),
            cipher: CredentialCipher::plain(),
            gate: tokio::sync::Mutex::new(()),
            preview: Mutex::new(None),
            automatic_preview: Mutex::new(None),
        };
        let store = TaskStore::open(&profile.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
        Client {
            profile,
            runtime,
            store,
        }
    }
}
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
async fn manual(client: &Client, choices: BTreeMap<String, String>) {
    let (preview, _) = prepare_preview(&client.runtime, &client.store)
        .await
        .unwrap();
    commit_prepared(&client.runtime, &client.store, &preview, &choices)
        .await
        .unwrap();
    acknowledge_manual(&client.runtime);
}
async fn cycle(client: &Client) -> Receipt {
    let result = check(&client.runtime, &client.store).await.unwrap();
    assert!(matches!(result.state, CheckState::Ready));
    commit(
        &client.runtime,
        &client.store,
        &result.plan.unwrap().preview_id,
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn account_first_connection_is_automatic_isolated_and_respects_explicit_disable() {
    let fixture = Fixture::start();
    let a = fixture.client("a");
    let other = fixture.client("other");
    a.store
        .create(mutation("Saved inside Alice account", "account owned"))
        .unwrap();
    assert!(matches!(
        check(&a.runtime, &a.store).await.unwrap().state,
        CheckState::Ready
    ));
    assert!(read(&a.runtime).unwrap().enabled);
    assert!(request_checked(&a.runtime.config().unwrap(), None)
        .await
        .unwrap()
        .records
        .is_empty());
    cycle(&a).await;
    assert!(
        enabled_settings(&a.runtime, &a.store, true)
            .unwrap()
            .enabled
    );
    assert!(read(&other.runtime).unwrap().enabled);
    cycle(&other).await;
    assert_eq!(
        other.store.sync_snapshot().unwrap().1.vault_id,
        fixture.account("other").vault_id
    );
    assert!(request_checked(&other.runtime.config().unwrap(), None)
        .await
        .unwrap()
        .records
        .is_empty());
    enabled_settings(&a.runtime, &a.store, false).unwrap();
    assert!(!read(&a.runtime).unwrap().enabled);
    assert!(matches!(
        check(&a.runtime, &a.store).await.unwrap().state,
        CheckState::Disabled
    ));
    assert!(
        !identity(&a.runtime, &a.profile, &other.profile.current_key)
            .unwrap_err()
            .message
            .is_empty()
    );
    a.profile.select("local").unwrap();
    assert!(!identity(&a.runtime, &a.profile, &a.profile.current_key).unwrap());
}

#[tokio::test]
async fn real_two_device_auto_merge_conflict_pause_manual_recovery_and_revoke() {
    let fixture = Fixture::start();
    let a = fixture.client("a");
    let b = fixture.client("b");
    let task = a
        .store
        .create(mutation("Original", "Original note"))
        .unwrap();
    manual(&a, BTreeMap::new()).await;
    manual(&b, BTreeMap::new()).await;
    enabled_settings(&a.runtime, &a.store, true).unwrap();
    enabled_settings(&b.runtime, &b.store, true).unwrap();
    a.store
        .update(&task.id, mutation("Linux title", "Original note"))
        .unwrap();
    b.store
        .update(&task.id, mutation("Original", "Android note"))
        .unwrap();
    assert!(!cycle(&a).await.changed);
    assert!(cycle(&b).await.changed);
    assert!(cycle(&a).await.changed);
    assert_eq!(a.store.list().unwrap(), b.store.list().unwrap());
    assert_eq!(a.store.get(&task.id).unwrap().title, "Linux title");
    assert_eq!(a.store.get(&task.id).unwrap().notes, "Android note");
    assert!(matches!(
        check(&a.runtime, &a.store).await.unwrap().state,
        CheckState::Unchanged
    ));
    a.store
        .update(&task.id, mutation("Linux conflict", "Android note"))
        .unwrap();
    b.store
        .update(&task.id, mutation("Android conflict", "Android note"))
        .unwrap();
    cycle(&a).await;
    let result = check(&b.runtime, &b.store).await.unwrap();
    assert_eq!(result.settings.pause, Some(PauseReason::Conflict));
    assert_eq!(b.store.get(&task.id).unwrap().title, "Android conflict");
    assert_eq!(read(&b.runtime).unwrap().pause, Some(PauseReason::Conflict));
    manual(
        &b,
        BTreeMap::from([(format!("task:{}", task.id), "remote".into())]),
    )
    .await;
    assert_eq!(read(&b.runtime).unwrap().pause, None);
    assert_eq!(b.store.get(&task.id).unwrap().title, "Linux conflict");
    let a_session = fixture.account("a");
    let b_session = fixture.account("b");
    assert!(reqwest::Client::new()
        .delete(format!(
            "{}/v2/sessions/{}",
            b_session.endpoint, a_session.session_id
        ))
        .bearer_auth(b_session.token)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let before = a.store.list().unwrap();
    let result = check(&a.runtime, &a.store).await.unwrap();
    assert_eq!(result.settings.pause, Some(PauseReason::Auth));
    assert_eq!(a.store.list().unwrap(), before);
}

#[tokio::test]
async fn stale_preview_offline_and_disable_never_overwrite_newer_local_data() {
    let mut fixture = Fixture::start();
    let a = fixture.client("a");
    let task = a.store.create(mutation("Baseline", "note")).unwrap();
    manual(&a, BTreeMap::new()).await;
    enabled_settings(&a.runtime, &a.store, true).unwrap();
    a.store
        .update(&task.id, mutation("First edit", "note"))
        .unwrap();
    let plan = check(&a.runtime, &a.store).await.unwrap().plan.unwrap();
    a.store
        .update(&task.id, mutation("Newer edit", "note"))
        .unwrap();
    assert!(matches!(
        commit(&a.runtime, &a.store, &plan.preview_id)
            .await
            .unwrap_err()
            .kind,
        FailureKind::Stale
    ));
    assert_eq!(a.store.get(&task.id).unwrap().title, "Newer edit");
    assert_eq!(read(&a.runtime).unwrap().pause, None);
    let plan = check(&a.runtime, &a.store).await.unwrap().plan.unwrap();
    enabled_settings(&a.runtime, &a.store, false).unwrap();
    assert!(commit(&a.runtime, &a.store, &plan.preview_id)
        .await
        .is_err());
    enabled_settings(&a.runtime, &a.store, true).unwrap();
    let plan = check(&a.runtime, &a.store).await.unwrap().plan.unwrap();
    assert!(commit(&a.runtime, &a.store, "foreign-preview")
        .await
        .is_err());
    assert!(
        !commit(&a.runtime, &a.store, &plan.preview_id)
            .await
            .unwrap()
            .changed
    );
    fixture.child.kill().unwrap();
    fixture.child.wait().unwrap();
    assert!(matches!(
        check(&a.runtime, &a.store).await.unwrap_err().kind,
        FailureKind::Network
    ));
    assert!(read(&a.runtime).unwrap().enabled);
    assert_eq!(read(&a.runtime).unwrap().pause, None);
    assert_eq!(a.store.get(&task.id).unwrap().title, "Newer edit");
}

#[test]
fn foreign_future_and_symlink_settings_are_rejected_without_rewriting() {
    let fixture = Fixture::start();
    let a = fixture.client("a");
    let mut value = serde_json::to_value(Settings::defaults(&a.runtime)).unwrap();
    for (field, replacement) in [("version", json!(2)), ("profileKey", json!("b".repeat(64)))] {
        let original = value[field].clone();
        value[field] = replacement;
        let raw = serde_json::to_vec(&value).unwrap();
        fs::write(path(&a.runtime), &raw).unwrap();
        assert!(enabled_settings(&a.runtime, &a.store, false).is_err());
        assert_eq!(fs::read(path(&a.runtime)).unwrap(), raw);
        value[field] = original;
    }
    #[cfg(unix)]
    {
        fs::remove_file(path(&a.runtime)).unwrap();
        let other = fixture.dir.path().join("unrelated.json");
        fs::write(&other, b"keep").unwrap();
        std::os::unix::fs::symlink(&other, path(&a.runtime)).unwrap();
        assert!(read(&a.runtime).is_err());
        assert_eq!(fs::read(other).unwrap(), b"keep");
    }
}

#[test]
fn relogin_clears_auth_pause_without_enabling_disabled_sync_or_hiding_conflicts() {
    let fixture = Fixture::start();
    let a = fixture.client("a");
    let settings = enabled_settings(&a.runtime, &a.store, false).unwrap();
    pause(&a.runtime, settings, PauseReason::Auth, "expired").unwrap();
    acknowledge_login(&a.runtime).unwrap();
    assert!(!read(&a.runtime).unwrap().enabled);
    assert_eq!(read(&a.runtime).unwrap().pause, None);
    for reason in [PauseReason::Conflict, PauseReason::Integrity] {
        pause(
            &a.runtime,
            read(&a.runtime).unwrap(),
            reason,
            "needs review",
        )
        .unwrap();
        acknowledge_login(&a.runtime).unwrap();
        assert_eq!(read(&a.runtime).unwrap().pause, Some(reason));
    }
}
