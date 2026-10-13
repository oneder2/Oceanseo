//! Invitation-only account transport. Passwords are request-local; only device
//! sessions reach encrypted/private profile files, never the web renderer.
use crate::{
    profiles::{AccountProfile, ProfileRuntime, ProfileStatus, ProfileSummary, WorkspaceBinding},
    sync::SyncRuntime,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SignIn {
    pub endpoint: String,
    pub username: String,
    pub password: String,
    pub device_name: String,
    pub invite: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct User {
    id: String,
    username: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthSession {
    id: String,
    device_name: String,
    platform: String,
    created_at: i64,
    last_seen: i64,
    expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthReply {
    user: User,
    session: AuthSession,
    vault_id: String,
    token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Me {
    user: User,
    session_id: String,
    expires_at: i64,
    vault_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceSession {
    pub id: String,
    pub device_name: String,
    pub platform: String,
    pub created_at: i64,
    pub last_seen: i64,
    pub expires_at: i64,
    pub current: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SessionList {
    pub sessions: Vec<DeviceSession>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSummary {
    pub id: String,
    pub edition: String,
    pub name: String,
    pub vault_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceList {
    pub schema_version: u8,
    pub environment: String,
    pub workspaces: Vec<WorkspaceSummary>,
}

fn session_valid(
    id: &str,
    name: &str,
    platform: &str,
    created: i64,
    seen: i64,
    expires: i64,
) -> bool {
    uuid::Uuid::parse_str(id).is_ok()
        && !name.trim().is_empty()
        && name.chars().count() <= 80
        && !name.chars().any(char::is_control)
        && matches!(platform, "linux" | "android" | "test")
        && created > 0
        && seen >= created
        && expires > created
}

fn error_message(status: u16, value: &Value) -> String {
    // Never show raw server bodies (which could echo credentials).
    match (status, value["error"].as_str().unwrap_or("")) {
        (401, "invalid_credentials") => "用户名或密码不正确".into(),
        (401 | 403, _) => "设备会话已过期或被撤销，请重新登录；本机资料仍保留".into(),
        (400, "registration_rejected") => "无法注册，请检查用户名和邀请码是否有效、未使用".into(),
        (400, _) => "提交的信息不符合要求，请检查用户名、密码和设备名称".into(),
        (404, "session_not_found") => "该设备会话不存在或已被撤销，请刷新列表".into(),
        (404, _) => "该地址尚未提供账号服务，请确认服务已部署".into(),
        (409, "device_limit") => "活跃设备已达到 10 台，请在已登录设备中撤销不用的会话".into(),
        (409, _) => "账号状态刚刚变化，请重新登录后重试".into(),
        (429, _) => "尝试过于频繁，请稍后再试".into(),
        _ => "账号服务暂不可用，请稍后重试；本机资料未修改".into(),
    }
}

async fn request(
    endpoint: &str,
    route: &str,
    method: reqwest::Method,
    token: Option<&str>,
    body: Option<Value>,
) -> Result<Value, String> {
    let endpoint = crate::sync::normalize_endpoint(endpoint)?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("Oceanseo/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化账号连接")?;
    let mut request = client.request(method, format!("{endpoint}{route}"));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(&body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "无法连接账号服务，请检查网络；本机资料未修改")?;
    let status = response.status().as_u16();
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "账号连接中断，请重试")? {
        if bytes.len() + chunk.len() > 16_384 {
            return Err("账号响应超过安全限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "账号服务响应格式无效，请确认服务地址")?;
    if !(200..300).contains(&status) {
        return Err(error_message(status, &value));
    }
    Ok(value)
}

async fn authenticate(
    runtime: &ProfileRuntime,
    input: SignIn,
    platform: &str,
) -> Result<ProfileSummary, String> {
    let previous = runtime.current_account()?;
    let endpoint = crate::sync::normalize_endpoint(&input.endpoint)?;
    let username = input.username.trim().to_ascii_lowercase();
    if username.len() < 3
        || username.len() > 64
        || !username
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
        || !username.as_bytes()[0].is_ascii_alphanumeric()
        || !(12..=128).contains(&input.password.chars().count())
        || input.password.len() > 512
        || input.device_name.trim().is_empty()
        || input.device_name.chars().count() > 80
        || input.device_name.chars().any(char::is_control)
    {
        return Err("用户名需为 3–64 位字母、数字、点、短横线或下划线；密码需为 12–128 个字符，设备名称最多 80 个字符".into());
    }
    let mut body = json!({"username":username,"password":input.password,"deviceName":input.device_name.trim(),"platform":platform});
    let register = input.invite.is_some();
    if let Some(invite) = input.invite {
        let invite = invite.trim();
        if invite.len() != 43
            || !invite
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        {
            return Err("请输入有效的邀请码".into());
        }
        body["invite"] = json!(invite);
    }
    let value = request(
        &endpoint,
        if register {
            "/v2/register"
        } else {
            "/v2/login"
        },
        reqwest::Method::POST,
        None,
        Some(body),
    )
    .await?;
    let reply: AuthReply =
        serde_json::from_value(value).map_err(|_| "登录响应格式无效，未连接本机资料库")?;
    if reply.user.username != username
        || reply.token.is_empty()
        || reply.session.platform != platform
        || !session_valid(
            &reply.session.id,
            &reply.session.device_name,
            &reply.session.platform,
            reply.session.created_at,
            reply.session.last_seen,
            reply.session.expires_at,
        )
    {
        return Err("登录响应身份或设备字段不一致，未连接本机资料库".into());
    }
    let mut account = AccountProfile {
        endpoint,
        user_id: reply.user.id,
        username: reply.user.username,
        vault_id: reply.vault_id,
        session_id: reply.session.id,
        expires_at: reply.session.expires_at,
        device_name: reply.session.device_name,
        token: reply.token,
        workspace: None,
    };
    // Reauthentication must remain in the active workspace instead of silently
    // switching back to the legacy account directory.
    let mut same_source = true;
    if let Some(previous) = previous {
        if previous.endpoint == account.endpoint && previous.user_id == account.user_id {
            if previous.vault_id != account.vault_id {
                same_source = false;
            }
            account.workspace = previous.workspace;
        }
    }
    let saved = async {
        if !same_source {
            return Err("账号资料库来源已变化，原资料已保留".into());
        }
        account.validate()?;
        account.validate()?;
        runtime.save_account(&account)
    }
    .await;
    match saved {
        Ok(summary) => Ok(summary),
        Err(error) => {
            // Avoid accumulating a new remote session when local secure storage fails.
            let _ = request(
                &account.endpoint,
                &format!("/v2/sessions/{}", account.session_id),
                reqwest::Method::DELETE,
                Some(&account.token),
                None,
            )
            .await;
            Err(error)
        }
    }
}

fn active_account(runtime: &ProfileRuntime) -> Result<AccountProfile, String> {
    let account = runtime
        .current_account()?
        .ok_or("当前为本机资料库，请先登录并切换到账号资料库")?;
    if account.token.is_empty() || account.expires_at <= chrono::Utc::now().timestamp() {
        return Err("设备会话已过期或已退出，请重新登录；本机资料仍可离线使用".into());
    }
    Ok(account)
}

async fn verify_identity(account: &AccountProfile) -> Result<Me, String> {
    let value = request(
        &account.endpoint,
        "/v2/me",
        reqwest::Method::GET,
        Some(&account.token),
        None,
    )
    .await?;
    validate_identity_response(account, value)
}

pub(crate) fn validate_identity_response(
    account: &AccountProfile,
    value: Value,
) -> Result<Me, String> {
    let me: Me = serde_json::from_value(value).map_err(|_| "账号资料响应无效")?;
    if me.user.id != account.user_id
        || me.user.username != account.username
        || me.vault_id != account.vault_id
        || me.session_id != account.session_id
        || me.expires_at != account.expires_at
    {
        return Err("设备会话与资料库身份不匹配，已停止操作".into());
    }
    Ok(me)
}

async fn workspaces(account: &AccountProfile) -> Result<WorkspaceList, String> {
    verify_identity(account).await?;
    let value = request(
        &account.endpoint,
        "/v2/workspaces",
        reqwest::Method::GET,
        Some(&account.token),
        None,
    )
    .await?;
    let mut list: WorkspaceList =
        serde_json::from_value(value).map_err(|_| "工作空间响应格式无效，原资料已保留")?;
    if list.schema_version != 1
        || !matches!(list.environment.as_str(), "preview" | "live")
        || list.workspaces.len() > 2
    {
        return Err("工作空间版本或环境不受支持".into());
    }
    let mut ids = std::collections::HashSet::new();
    let mut editions = std::collections::HashSet::new();
    for space in &list.workspaces {
        WorkspaceBinding {
            version: 1,
            environment: list.environment.clone(),
            edition: space.edition.clone(),
            id: space.id.clone(),
            vault_id: space.vault_id.clone(),
        }
        .validate()?;
        if !ids.insert(&space.id)
            || !editions.insert(&space.edition)
            || space.vault_id == account.vault_id
            || space.name.trim().is_empty()
            || space.name.chars().count() > 80
            || space.name.chars().any(char::is_control)
        {
            return Err("工作空间身份或名称异常".into());
        }
    }
    if let Some(bound) = &account.workspace {
        if bound.environment != list.environment
            || !list.workspaces.iter().any(|space| {
                space.id == bound.id
                    && space.edition == bound.edition
                    && space.vault_id == bound.vault_id
            })
        {
            return Err("当前工作空间已不可访问或来源变化，本机资料仍保留".into());
        }
    }
    list.workspaces.retain(|space| space.edition == "personal");
    Ok(list)
}

async fn select_workspace(
    runtime: &ProfileRuntime,
    workspace_id: &str,
) -> Result<ProfileStatus, String> {
    let mut account = active_account(runtime)?;
    let list = workspaces(&account).await?;
    let space = list
        .workspaces
        .iter()
        .find(|space| space.id == workspace_id)
        .ok_or("无法访问这个工作空间")?;
    account.workspace = Some(WorkspaceBinding {
        version: 1,
        environment: list.environment,
        edition: space.edition.clone(),
        id: space.id.clone(),
        vault_id: space.vault_id.clone(),
    });
    let saved = runtime.save_account(&account)?;
    runtime.select(&saved.key)
}

#[tauri::command]
pub async fn list_account_workspaces(
    runtime: tauri::State<'_, ProfileRuntime>,
) -> Result<WorkspaceList, String> {
    let _guard = runtime.gate.lock().await;
    workspaces(&active_account(&runtime)?).await
}

#[tauri::command]
pub async fn select_account_workspace(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    workspace_id: String,
    expected_current: String,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    if expected_current != runtime.current_key {
        return Err("当前资料库已变化，请重新打开账号页面".into());
    }
    select_workspace(&runtime, &workspace_id).await
}

#[tauri::command]
pub async fn sign_in_account(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    input: SignIn,
) -> Result<ProfileSummary, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    let summary = authenticate(&runtime, input, std::env::consts::OS).await?;
    if summary.key == runtime.current_key {
        crate::sync::automatic::acknowledge_login(&sync)?;
    }
    Ok(summary)
}

#[tauri::command]
pub async fn select_local_profile(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    key: String,
    expected_current: String,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    if expected_current != runtime.current_key {
        return Err("当前资料库已变化，请重新打开账号设置".into());
    }
    if key != "local"
        && runtime
            .list()?
            .iter()
            .find(|p| p.key == key)
            .is_some_and(|p| {
                p.workspace
                    .as_ref()
                    .is_some_and(|w| w.edition != "personal")
            })
    {
        return Err("此资料库属于独立产品，原始资料已保留".into());
    }
    runtime.select(&key)
}

#[tauri::command]
pub async fn restart_selected_profile(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    selected_key: String,
) -> Result<(), String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    let status = runtime.status()?;
    if status.selected_key != selected_key {
        return Err("待打开的资料库已变化，请重新确认".into());
    }
    if !status.restart_required {
        return Ok(());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<crate::mobile::MobileBridge>()
            .0
            .run_mobile_plugin::<Value>("restartForProfile", json!({}))
            .map(|_| ())
            .map_err(|_| {
                "资料库已选定，但应用未能重新打开。请完全关闭后再打开 Oceanseo；当前资料仍保留"
                    .into()
            })
    }
    #[cfg(desktop)]
    {
        app.request_restart();
        Ok(())
    }
    #[cfg(not(any(desktop, target_os = "android")))]
    {
        let _ = app;
        Err("资料库已选定，请完全关闭后重新打开应用".into())
    }
}

#[tauri::command]
pub async fn check_account_session(
    runtime: tauri::State<'_, ProfileRuntime>,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    verify_identity(&active_account(&runtime)?).await?;
    runtime.status()
}

#[tauri::command]
pub async fn list_account_sessions(
    runtime: tauri::State<'_, ProfileRuntime>,
) -> Result<SessionList, String> {
    let _guard = runtime.gate.lock().await;
    let account = active_account(&runtime)?;
    verify_identity(&account).await?;
    let value = request(
        &account.endpoint,
        "/v2/sessions",
        reqwest::Method::GET,
        Some(&account.token),
        None,
    )
    .await?;
    let list: SessionList = serde_json::from_value(value).map_err(|_| "设备列表响应格式无效")?;
    let mut ids = std::collections::HashSet::new();
    if list.sessions.len() > 10
        || list.sessions.iter().filter(|s| s.current).count() != 1
        || list.sessions.iter().any(|s| {
            !ids.insert(&s.id)
                || !session_valid(
                    &s.id,
                    &s.device_name,
                    &s.platform,
                    s.created_at,
                    s.last_seen,
                    s.expires_at,
                )
                || s.current != (s.id == account.session_id)
        })
    {
        return Err("设备列表身份或字段异常，未执行会话操作".into());
    }
    Ok(list)
}

#[tauri::command]
pub async fn revoke_account_session(
    runtime: tauri::State<'_, ProfileRuntime>,
    session_id: String,
) -> Result<(), String> {
    let _guard = runtime.gate.lock().await;
    let account = active_account(&runtime)?;
    if session_id == account.session_id {
        return Err("退出当前设备请使用退出登录，原资料会保留".into());
    }
    if session_id != "others" && uuid::Uuid::parse_str(&session_id).is_err() {
        return Err("设备会话标识无效".into());
    }
    verify_identity(&account).await?;
    let result = request(
        &account.endpoint,
        &format!("/v2/sessions/{session_id}"),
        reqwest::Method::DELETE,
        Some(&account.token),
        None,
    )
    .await?;
    if result != json!({"revoked":true}) {
        return Err("设备撤销响应无效，请刷新列表核对结果".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn logout_account(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    local_only: bool,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    let mut account = runtime.current_account()?.ok_or("当前没有账号会话")?;
    if !local_only && !account.token.is_empty() {
        verify_identity(&account).await?;
        let result = request(
            &account.endpoint,
            &format!("/v2/sessions/{}", account.session_id),
            reqwest::Method::DELETE,
            Some(&account.token),
            None,
        )
        .await?;
        if result != json!({"revoked":true}) {
            return Err("退出响应无效，请核对设备列表；原本机资料保留".into());
        }
    }
    account.token.clear();
    runtime.save_account(&account)?;
    *sync.preview.lock().map_err(|_| "同步状态不可用")? = None;
    runtime.status()
}

#[tauri::command]
pub async fn change_account_password(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    current_password: String,
    password: String,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    if !(12..=128).contains(&password.chars().count()) || password.len() > 512 {
        return Err("新密码需为 12–128 个字符".into());
    }
    let mut account = active_account(&runtime)?;
    verify_identity(&account).await?;
    let result = request(
        &account.endpoint,
        "/v2/password",
        reqwest::Method::POST,
        Some(&account.token),
        Some(json!({"currentPassword":current_password,"password":password})),
    )
    .await?;
    if result != json!({"signInRequired":true}) {
        return Err("密码修改响应无效，请重新登录核对；本机资料保留".into());
    }
    account.token.clear();
    runtime.save_account(&account)?;
    *sync.preview.lock().map_err(|_| "同步状态不可用")? = None;
    runtime.status()
}

#[tauri::command]
pub async fn delete_account(
    runtime: tauri::State<'_, ProfileRuntime>,
    sync: tauri::State<'_, SyncRuntime>,
    password: String,
    confirmation: String,
) -> Result<ProfileStatus, String> {
    let _guard = runtime.gate.lock().await;
    let _sync_guard = sync.gate.lock().await;
    if confirmation != "DELETE" {
        return Err("请输入 DELETE 以确认删除云端账号".into());
    }
    let mut account = active_account(&runtime)?;
    verify_identity(&account).await?;
    let result = request(
        &account.endpoint,
        "/v2/account",
        reqwest::Method::DELETE,
        Some(&account.token),
        Some(json!({"password":password,"confirmation":confirmation})),
    )
    .await?;
    if result != json!({"deleted":true}) {
        return Err("账号删除响应无效，云端资料状态未确认".into());
    }
    // Keep the local account database available for export, but make it offline
    // immediately so a deleted cloud account cannot receive further writes.
    account.token.clear();
    runtime.save_account(&account)?;
    *sync.preview.lock().map_err(|_| "同步状态不可用")? = None;
    runtime.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials::CredentialCipher;
    use std::io::BufRead;
    struct Server(std::process::Child);
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[tokio::test]
    async fn native_workspace_switch_sync_and_reauthentication_are_owner_scoped() {
        use crate::{
            profiles::WorkspaceBinding,
            sync::{Config, SyncRuntime},
            tasks::{TaskMutation, TaskStore},
        };
        let temp = tempfile::tempdir().unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let mut child = std::process::Command::new("python3").current_dir(root)
            .args(["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB'],control_database=os.environ['TEST_CONTROL_DB'],environment='preview'); a=s.store.register('alice','Synthetic-password-123!',s.store.create_invite(),'Linux','linux'); b=s.store.register('bob','Synthetic-password-123!',s.store.create_invite(),'Other','linux'); s.control.grant_role('alice','owner'); p=s.control.create_workspace(a['token'],'personal','Synthetic personal'); c=p; print(json.dumps({'port':s.server_port,'alice':a,'bob':b,'spaces':c['workspaces']}),flush=True); s.serve_forever()"])
            .env("TEST_ACCOUNTS_DB", temp.path().join("accounts.sqlite3"))
            .env("TEST_CONTROL_DB", temp.path().join("control.sqlite3"))
            .stdout(std::process::Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let _server = Server(child);
        let setup: Value = serde_json::from_str(&line).unwrap();
        let endpoint = format!("http://127.0.0.1:{}", setup["port"]);
        let client_root = temp.path().join("client");
        let local = ProfileRuntime::open(&client_root, CredentialCipher::plain()).unwrap();
        let input = |username: &str| SignIn {
            endpoint: endpoint.clone(),
            username: username.into(),
            password: "Synthetic-password-123!".into(),
            device_name: "Test computer".into(),
            invite: None,
        };
        let alice = authenticate(&local, input("alice"), "linux").await.unwrap();
        let bob = authenticate(&local, input("bob"), "linux").await.unwrap();
        local.select(&alice.key).unwrap();
        let legacy = ProfileRuntime::open(&client_root, CredentialCipher::plain()).unwrap();
        let list = workspaces(&active_account(&legacy).unwrap()).await.unwrap();
        let personal = list
            .workspaces
            .iter()
            .find(|s| s.edition == "personal")
            .unwrap();
        let selected = select_workspace(&legacy, &personal.id).await.unwrap();
        assert!(selected.restart_required);
        assert_eq!(legacy.current_key, alice.key);
        let active = ProfileRuntime::open(&client_root, CredentialCipher::plain()).unwrap();
        let original_key = active.current_key.clone();
        let config_path = active.data_dir.join("account-session.json");
        let sync = SyncRuntime {
            path: config_path,
            account_key: Some(original_key.clone()),
            cipher: CredentialCipher::plain(),
            gate: tokio::sync::Mutex::new(()),
            preview: std::sync::Mutex::new(None),
            automatic_preview: std::sync::Mutex::new(None),
        };
        // The native config must route this profile to the workspace vault.
        let profile = active.current_account().unwrap().unwrap();
        let config = sync.config().unwrap();
        assert_eq!(config.expected_vault_id, Some(personal.vault_id.clone()));
        assert_eq!(config.workspace, profile.workspace);
        let store = TaskStore::open(&active.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
        store
            .create(TaskMutation {
                title: "personal workspace only".into(),
                notes: "".into(),
                horizon: "short".into(),
                priority: "normal".into(),
                start_date: None,
                due_date: None,
                origin: None,
            })
            .unwrap();
        let (records, _) = store.sync_snapshot().unwrap();
        let saved = crate::sync::request(
            &config,
            Some(json!({"protocol":1,"vaultId":personal.vault_id,
            "expectedRevision":0,"records":records})),
        )
        .await
        .unwrap();
        assert_eq!(saved.records.len(), 1);
        assert_eq!(
            request(
                &endpoint,
                "/v2/vault",
                reqwest::Method::GET,
                Some(&profile.token),
                None
            )
            .await
            .unwrap()["records"],
            json!({})
        );
        let reauthenticated = authenticate(&active, input("alice"), "linux")
            .await
            .unwrap();
        assert_eq!(reauthenticated.key, original_key);
        let new_session = active.current_account().unwrap().unwrap();
        assert_eq!(new_session.workspace, profile.workspace);
        assert_ne!(new_session.token, profile.token);
        verify_identity(&new_session).await.unwrap();
        assert_eq!(store.list().unwrap()[0].title, "personal workspace only");
        // A member cannot use the administrator's workspace ID.
        local.select(&bob.key).unwrap();
        let bob_runtime = ProfileRuntime::open(&client_root, CredentialCipher::plain()).unwrap();
        assert!(select_workspace(&bob_runtime, &personal.id).await.is_err());
        assert_eq!(bob_runtime.status().unwrap().selected_key, bob.key);
        let forged = Config {
            token: active_account(&bob_runtime).unwrap().token,
            ..config.clone()
        };
        assert!(crate::sync::request(&forged, None).await.is_err());
        let mismatch = Config {
            workspace: Some(WorkspaceBinding {
                vault_id: uuid::Uuid::new_v4().to_string(),
                ..config.workspace.clone().unwrap()
            }),
            ..config
        };
        assert!(crate::sync::request(&mismatch, None).await.is_err());
        // Also exercise the config decoder used by automatic synchronization.
        assert_eq!(sync.config().unwrap().token, new_session.token);
    }

    #[tokio::test]
    async fn real_account_service_creates_isolated_profiles_and_revocable_device_sessions() {
        let temp = tempfile::tempdir().unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let mut child = std::process::Command::new("python3").current_dir(root)
            .args(["-u", "-c", "import os,json; from services.accounts.server import create_server; s=create_server(('127.0.0.1',0),os.environ['TEST_ACCOUNTS_DB']); print(json.dumps({'port':s.server_port,'alice':s.store.create_invite(),'bob':s.store.create_invite()}),flush=True); s.serve_forever()"])
            .env("TEST_ACCOUNTS_DB", temp.path().join("server.sqlite"))
            .stdout(std::process::Stdio::piped()).spawn().unwrap();
        let mut line = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let _server = Server(child);
        let setup: Value = serde_json::from_str(&line).unwrap();
        let endpoint = format!("http://127.0.0.1:{}", setup["port"]);
        let client =
            ProfileRuntime::open(&temp.path().join("client"), CredentialCipher::plain()).unwrap();
        let input = |name: &str, invite: Option<String>| SignIn {
            endpoint: endpoint.clone(),
            username: name.into(),
            password: "Synthetic-password-123!".into(),
            device_name: "Synthetic computer".into(),
            invite,
        };
        let a = authenticate(
            &client,
            input("Alice", Some(setup["alice"].as_str().unwrap().into())),
            "linux",
        )
        .await
        .unwrap();
        let b = authenticate(
            &client,
            input("bob", Some(setup["bob"].as_str().unwrap().into())),
            "linux",
        )
        .await
        .unwrap();
        assert_ne!(a.key, b.key);
        assert_eq!(client.current_key, "local");
        let alice = client.read_account(&a.key).unwrap();
        let bob = client.read_account(&b.key).unwrap();
        assert_ne!(alice.vault_id, bob.vault_id);
        verify_identity(&alice).await.unwrap();
        verify_identity(&bob).await.unwrap();
        let saved = std::fs::read(
            temp.path()
                .join("client/profiles")
                .join(&a.key)
                .join("account-session.json"),
        )
        .unwrap();
        assert!(!String::from_utf8(saved)
            .unwrap()
            .contains("Synthetic-password-123!"));
        let second = authenticate(&client, input("alice", None), "linux")
            .await
            .unwrap();
        let phone = client.read_account(&second.key).unwrap();
        assert_eq!(phone.vault_id, alice.vault_id);
        assert_ne!(phone.token, alice.token);
        assert_eq!(
            request(
                &endpoint,
                "/v2/sessions",
                reqwest::Method::GET,
                Some(&phone.token),
                None
            )
            .await
            .unwrap()["sessions"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        request(
            &endpoint,
            &format!("/v2/sessions/{}", alice.session_id),
            reqwest::Method::DELETE,
            Some(&phone.token),
            None,
        )
        .await
        .unwrap();
        assert!(verify_identity(&alice)
            .await
            .err()
            .unwrap()
            .contains("撤销"));
        verify_identity(&phone).await.unwrap();
        verify_identity(&bob).await.unwrap();
        client.select(&a.key).unwrap();
        let restarted =
            ProfileRuntime::open(&temp.path().join("client"), CredentialCipher::plain()).unwrap();
        assert_eq!(restarted.current_key, a.key);
        verify_identity(&active_account(&restarted).unwrap())
            .await
            .unwrap();
    }
}
