//! Private application sync protocol. Public ecosystem task contracts unchanged.
use crate::{credentials::CredentialCipher, tasks::TaskStore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::Write, path::PathBuf, sync::Mutex};

pub mod automatic;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureKind {
    Network,
    Auth,
    Stale,
    Integrity,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncFailure {
    pub kind: FailureKind,
    pub message: String,
}

impl SyncFailure {
    fn new(kind: FailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}
impl From<String> for SyncFailure {
    fn from(message: String) -> Self {
        Self::new(FailureKind::Integrity, message)
    }
}
impl From<&str> for SyncFailure {
    fn from(message: &str) -> Self {
        Self::from(message.to_owned())
    }
}

pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const GOALS: &str = "goals";
pub type Records = BTreeMap<String, Value>;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Vault {
    pub protocol: u32,
    pub vault_id: String,
    pub revision: u64,
    pub records: Records,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SyncMeta {
    pub vault_id: String,
    pub revision: u64,
    pub base: Records,
    pub last_success: Option<String>,
    #[serde(default)]
    pub recovery_path: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub endpoint: String,
    pub token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_vault_id: Option<String>,
}

pub struct SyncRuntime {
    pub path: PathBuf,
    pub account_key: Option<String>,
    pub cipher: CredentialCipher,
    pub gate: tokio::sync::Mutex<()>,
    pub preview: Mutex<Option<Preview>>,
    pub automatic_preview: Mutex<Option<Preview>>,
}

#[derive(Clone)]
pub struct Preview {
    pub id: String,
    pub local: Records,
    pub meta: SyncMeta,
    pub remote: Vault,
    pub config_hash: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    endpoint: String,
    configured: bool,
    pending: usize,
    last_success: Option<String>,
    revision: u64,
    linked: bool,
    recovery_available: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    key: String,
    pub local: Value,
    pub remote: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    preview_id: String,
    upload_count: usize,
    download_count: usize,
    conflicts: Vec<Conflict>,
    first_connection: bool,
    changes: Vec<ChangeSummary>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeSummary {
    key: String,
    title: String,
    upload: bool,
    download: bool,
    deleted: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub changed: bool,
    pub revision: u64,
    pub snapshot_path: Option<String>,
}

pub fn hash<T: Serialize>(value: &T) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).expect("serializable sync value"))
    )
}

pub fn count_changes(a: &Records, b: &Records) -> usize {
    a.keys()
        .chain(b.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|key| a.get(*key).unwrap_or(&Value::Null) != b.get(*key).unwrap_or(&Value::Null))
        .count()
}

// Three-way comparison uses the last acknowledged common state, not wall clocks.
// Null entries are permanent deletion tombstones, never interpreted as absence.
pub fn merge(
    base: &Records,
    local: &Records,
    remote: &Records,
    choices: &BTreeMap<String, String>,
) -> (Records, Vec<Conflict>) {
    let mut result = Records::new();
    let mut conflicts = Vec::new();
    for key in base
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect::<std::collections::BTreeSet<_>>()
    {
        let b = base.get(key).unwrap_or(&Value::Null);
        let l = local.get(key).unwrap_or(&Value::Null);
        let r = remote.get(key).unwrap_or(&Value::Null);
        let value = if l == r || r == b {
            Some(l.clone())
        } else if l == b {
            Some(r.clone())
        } else if choices.get(key).is_some_and(|c| c == "local") {
            Some(l.clone())
        } else if choices.get(key).is_some_and(|c| c == "remote") {
            Some(r.clone())
        } else {
            merge_task_fields(key, b, l, r)
        };
        if let Some(value) = value {
            result.insert(key.clone(), value);
        } else {
            conflicts.push(Conflict {
                key: key.clone(),
                local: l.clone(),
                remote: r.clone(),
            });
        }
    }
    (result, conflicts)
}

fn merge_task_fields(key: &str, base: &Value, local: &Value, remote: &Value) -> Option<Value> {
    if !key.starts_with("task:") {
        return None;
    }
    let (b, l, r) = (base.as_object()?, local.as_object()?, remote.as_object()?);
    let mut result = serde_json::Map::new();
    for field in b
        .keys()
        .chain(l.keys())
        .chain(r.keys())
        .collect::<std::collections::BTreeSet<_>>()
    {
        if field == "updated_at" {
            continue;
        }
        let (bv, lv, rv) = (b.get(field), l.get(field), r.get(field));
        let selected = if lv == rv || rv == bv {
            lv
        } else if lv == bv {
            rv
        } else {
            return None;
        };
        if let Some(value) = selected {
            result.insert(field.clone(), value.clone());
        }
    }
    // Deterministic version avoids creating new differences on every preview.
    result.insert(
        "updated_at".into(),
        if local["updated_at"].as_str()? >= remote["updated_at"].as_str()? {
            local["updated_at"].clone()
        } else {
            remote["updated_at"].clone()
        },
    );
    let value = Value::Object(result);
    let task = serde_json::from_value(value.clone()).ok()?;
    crate::tasks::validate_task(&task).ok()?;
    Some(value)
}

pub fn validate_records(records: &Records) -> Result<(), String> {
    if records.len() > 50_000
        || serde_json::to_vec(records)
            .map_err(|_| "同步数据无法编码")?
            .len()
            > MAX_BYTES
    {
        return Err("同步数据超出内测容量，请先备份并整理记录。".into());
    }
    let mut alive = 0;
    for (key, value) in records {
        if let Some(id) = key.strip_prefix("task:") {
            uuid::Uuid::parse_str(id).map_err(|_| "同步任务编号无效")?;
            if value.is_null() {
                continue;
            }
            let record: crate::tasks::TaskRecord =
                serde_json::from_value(value.clone()).map_err(|_| "同步任务格式无效")?;
            if record.id != id {
                return Err("同步任务编号不一致".into());
            }
            crate::tasks::validate_task(&record).map_err(|_| "同步任务校验失败")?;
            alive += 1;
        } else if key == GOALS {
            if !value.is_null()
                && (!crate::goals::valid_state(value)
                    || serde_json::to_vec(value).unwrap().len() > 2 * 1024 * 1024)
            {
                return Err("同步目标与对话格式无效".into());
            }
        } else {
            return Err("服务端包含当前版本不支持的同步内容，请升级应用。".into());
        }
    }
    if alive > 10_000 {
        return Err("同步任务超过 10000 项。".into());
    }
    Ok(())
}

pub fn normalize_endpoint(raw: &str) -> Result<String, String> {
    if raw.len() > 2000 {
        return Err("同步服务地址不能超过 2000 字节".into());
    }
    let mut url = url::Url::parse(raw.trim()).map_err(|_| "请填写完整的同步服务地址")?;
    let host = url.host_str().unwrap_or_default();
    // Cleartext is limited to literal loopback for local tests. LAN/public use TLS.
    let local = matches!(host, "127.0.0.1" | "[::1]" | "localhost");
    if !(url.scheme() == "https" || (url.scheme() == "http" && local))
        || host.is_empty()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "同步地址需要 HTTPS，不能包含账号、查询参数或片段；仅本机测试允许 HTTP。".into(),
        );
    }
    url.set_path(url.path().trim_end_matches('/').to_owned().as_str());
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

impl SyncRuntime {
    fn config(&self) -> Result<Config, String> {
        if !self.path.exists() {
            if self.account_key.is_some() {
                return Err("账号会话文件缺失，已停止同步并保留本机数据".into());
            }
            return Ok(Config::default());
        }
        let raw = fs::read_to_string(&self.path).map_err(|_| "同步配置读取失败，原文件未修改")?;
        if let Some(key) = &self.account_key {
            let profile: crate::profiles::AccountProfile =
                serde_json::from_str(&self.cipher.decode(&raw)?)
                    .map_err(|_| "账号会话无效，原资料已保留")?;
            profile.validate()?;
            if profile.key()? != *key {
                return Err("同步账号与本机资料库不匹配，已停止同步".into());
            }
            return Ok(Config {
                endpoint: profile.endpoint,
                token: if profile.expires_at > chrono::Utc::now().timestamp() {
                    profile.token
                } else {
                    String::new()
                },
                expected_vault_id: Some(profile.vault_id),
            });
        }
        serde_json::from_str(&self.cipher.decode(&raw)?)
            .map_err(|_| "同步配置无效，原文件未修改".into())
    }
    fn write_config(&self, config: &Config) -> Result<(), String> {
        let raw = self
            .cipher
            .encode(&serde_json::to_string(config).map_err(|_| "同步配置无效")?)?;
        let tmp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&tmp).map_err(|_| "同步配置无法写入")?;
        file.write_all(raw.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "同步配置无法写入")?;
        fs::rename(tmp, &self.path).map_err(|_| "同步配置无法替换")?;
        Ok(())
    }
}

#[cfg(test)]
async fn request(config: &Config, body: Option<Value>) -> Result<Vault, String> {
    request_checked(config, body)
        .await
        .map_err(|error| error.message)
}

async fn request_checked(config: &Config, body: Option<Value>) -> Result<Vault, SyncFailure> {
    if config.endpoint.is_empty() || config.token.is_empty() {
        return Err(SyncFailure::new(
            FailureKind::Auth,
            "请先配置同步服务和访问令牌。",
        ));
    }
    let endpoint = normalize_endpoint(&config.endpoint)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化同步连接")?;
    let route = if config.expected_vault_id.is_some() {
        "/v2/vault"
    } else {
        "/v1/vault"
    };
    let url = format!("{endpoint}{route}");
    let req = if let Some(body) = body {
        client.put(url).json(&body)
    } else {
        client.get(url)
    };
    let mut response = req.bearer_auth(&config.token).send().await.map_err(|_| {
        SyncFailure::new(
            FailureKind::Network,
            "无法连接同步服务。本机数据已保留，可联网后重试；若上传已送达，重试会自动核对。",
        )
    })?;
    match response.status().as_u16() {
        200 => (),
        401 | 403 => {
            return Err(SyncFailure::new(
                FailureKind::Auth,
                "登录或同步令牌已失效，请重新登录或检查配置。",
            ))
        }
        409 => {
            return Err(SyncFailure::new(
                FailureKind::Stale,
                "另一台设备刚刚更新了资料，请重新检查更改后同步。",
            ))
        }
        408 | 429 | 500..=599 => {
            return Err(SyncFailure::new(
                FailureKind::Network,
                "同步服务暂不可用或请求过于频繁，本机数据保留，稍后重试。",
            ))
        }
        413 => return Err("同步内容超过服务端容量。".into()),
        _ => return Err("同步服务响应异常，未覆盖本机数据。请检查服务后重试。".into()),
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| SyncFailure::new(FailureKind::Network, "同步连接中断，请重试"))?
    {
        if bytes.len() + chunk.len() > MAX_BYTES + 4096 {
            return Err("同步响应超过容量限制".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let vault: Vault = serde_json::from_slice(&bytes).map_err(|_| "同步服务响应格式不正确")?;
    if vault.protocol != 1
        || uuid::Uuid::parse_str(&vault.vault_id).is_err()
        || vault.revision > 9_007_199_254_740_991
    {
        return Err("同步协议版本或资料库标识不受支持".into());
    }
    validate_records(&vault.records)?;
    if config
        .expected_vault_id
        .as_ref()
        .is_some_and(|id| id != &vault.vault_id)
    {
        return Err("服务端返回了其他资料库，已停止同步并保留本机数据".into());
    }
    Ok(vault)
}

#[tauri::command]
pub async fn get_sync_status(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
) -> Result<Status, String> {
    let _guard = runtime.gate.lock().await;
    let config = runtime.config()?;
    let (local, meta) = store.sync_snapshot()?;
    Ok(Status {
        endpoint: config.endpoint.clone(),
        configured: !config.endpoint.is_empty() && !config.token.is_empty(),
        pending: count_changes(&local, &meta.base),
        last_success: meta.last_success,
        recovery_available: meta.recovery_path.is_some(),
        revision: meta.revision,
        linked: !meta.vault_id.is_empty(),
    })
}

#[tauri::command]
pub async fn save_sync_config(
    runtime: tauri::State<'_, SyncRuntime>,
    endpoint: String,
    token: Option<String>,
) -> Result<(), String> {
    let _guard = runtime.gate.lock().await;
    if runtime.account_key.is_some() {
        return Err("账号资料库使用独立设备会话，请在账号设置中登录，不可替换为共享令牌".into());
    }
    let old = runtime.config()?;
    let endpoint = normalize_endpoint(&endpoint)?;
    let token = token.filter(|s| !s.trim().is_empty()).unwrap_or(old.token);
    if token.len() < 32
        || token.len() > 512
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
    {
        return Err("访问令牌需为 32–512 位字母、数字、下划线或短横线。".into());
    }
    runtime.write_config(&Config {
        endpoint,
        token,
        expected_vault_id: None,
    })?;
    *runtime.preview.lock().map_err(|_| "同步状态不可用")? = None;
    Ok(())
}

#[tauri::command]
pub async fn preview_sync(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
) -> Result<Plan, String> {
    let _guard = runtime.gate.lock().await;
    *runtime.preview.lock().map_err(|_| "同步状态不可用")? = None;
    let (preview, plan) = prepare_preview(&runtime, &store)
        .await
        .map_err(|error| error.message)?;
    *runtime.preview.lock().map_err(|_| "同步状态不可用")? = Some(preview);
    Ok(plan)
}

async fn prepare_preview(
    runtime: &SyncRuntime,
    store: &TaskStore,
) -> Result<(Preview, Plan), SyncFailure> {
    let config = runtime.config()?;
    let (local, meta) = store.sync_snapshot()?;
    let remote = request_checked(&config, None).await?;
    if !meta.vault_id.is_empty()
        && (meta.vault_id != remote.vault_id
            || remote.revision < meta.revision
            || (remote.revision == meta.revision && remote.records != meta.base)
            || meta.base.keys().any(|k| !remote.records.contains_key(k)))
    {
        return Err("服务端资料库已更换、回退或缺少历史记录。为防止旧资料覆盖，已停止同步；请检查服务器备份。".into());
    }
    let (merged, conflicts) = merge(&meta.base, &local, &remote.records, &BTreeMap::new());
    let preview = Preview {
        id: uuid::Uuid::new_v4().to_string(),
        local,
        meta,
        remote,
        config_hash: hash(&config),
    };
    // Count only resolved rows; conflict decisions have not been made yet.
    let unresolved: std::collections::BTreeSet<_> = conflicts.iter().map(|c| &c.key).collect();
    let resolved_local = preview
        .local
        .iter()
        .filter(|(k, _)| !unresolved.contains(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let resolved_remote = preview
        .remote
        .records
        .iter()
        .filter(|(k, _)| !unresolved.contains(k))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let plan = Plan {
        preview_id: preview.id.clone(),
        upload_count: count_changes(&merged, &resolved_remote),
        download_count: count_changes(&merged, &resolved_local),
        conflicts,
        first_connection: preview.meta.vault_id.is_empty(),
        changes: merged
            .iter()
            .filter_map(|(key, value)| {
                let l = preview.local.get(key).unwrap_or(&Value::Null);
                let r = preview.remote.records.get(key).unwrap_or(&Value::Null);
                let upload = value != r;
                let download = value != l;
                if !upload && !download {
                    return None;
                }
                let title = if key == GOALS {
                    "目标与已保存对话".into()
                } else {
                    value["title"]
                        .as_str()
                        .or(l["title"].as_str())
                        .or(r["title"].as_str())
                        .unwrap_or("事项")
                        .to_owned()
                };
                Some(ChangeSummary {
                    key: key.clone(),
                    title,
                    upload,
                    download,
                    deleted: value.is_null(),
                })
            })
            .collect(),
    };
    Ok((preview, plan))
}

#[tauri::command]
pub async fn commit_sync(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
    preview_id: String,
    choices: BTreeMap<String, String>,
) -> Result<Receipt, String> {
    let _guard = runtime.gate.lock().await;
    let preview = runtime
        .preview
        .lock()
        .map_err(|_| "同步状态不可用")?
        .clone()
        .filter(|p| p.id == preview_id)
        .ok_or("检查结果已失效，请重新检查更改")?;
    let receipt = commit_prepared(&runtime, &store, &preview, &choices)
        .await
        .map_err(|error| error.message)?;
    *runtime.preview.lock().map_err(|_| "同步状态不可用")? = None;
    automatic::acknowledge_manual(&runtime);
    Ok(receipt)
}

async fn commit_prepared(
    runtime: &SyncRuntime,
    store: &TaskStore,
    preview: &Preview,
    choices: &BTreeMap<String, String>,
) -> Result<Receipt, SyncFailure> {
    let config = runtime.config()?;
    if hash(&config) != preview.config_hash {
        return Err(SyncFailure::new(
            FailureKind::Stale,
            "同步配置已变化，请重新检查",
        ));
    }
    if choices.values().any(|c| c != "local" && c != "remote") {
        return Err("冲突选择无效".into());
    }
    let (current, meta) = store.sync_snapshot()?;
    if current != preview.local || hash(&meta) != hash(&preview.meta) {
        return Err(SyncFailure::new(
            FailureKind::Stale,
            "本机数据已变化，请重新检查更改。",
        ));
    }
    let (merged, conflicts) = merge(&meta.base, &current, &preview.remote.records, choices);
    if !conflicts.is_empty() {
        return Err("请先为每个冲突选择保留的版本。".into());
    }
    validate_records(&merged)?;
    // Durable recovery copy before either side can change, including both conflict versions.
    let snapshot = store.sync_recovery(&current, &preview.remote)?;
    let remote = request_checked(
        &config,
        Some(
            serde_json::json!({ "protocol":1, "vaultId":preview.remote.vault_id,
        "expectedRevision":preview.remote.revision, "records":merged }),
        ),
    )
    .await?;
    if remote.vault_id != preview.remote.vault_id
        || remote.records != merged
        || remote.revision < preview.remote.revision
    {
        return Err("服务端确认内容不一致，未覆盖本机数据，请重新检查。".into());
    }
    store.sync_apply_checked(&preview.local, &preview.meta, &remote, snapshot)
}

#[tauri::command]
pub async fn discard_sync_preview(
    runtime: tauri::State<'_, SyncRuntime>,
    preview_id: String,
) -> Result<(), String> {
    let _guard = runtime.gate.lock().await;
    let mut preview = runtime.preview.lock().map_err(|_| "同步状态不可用")?;
    if preview.as_ref().is_some_and(|p| p.id == preview_id) {
        *preview = None;
    }
    Ok(())
}

#[tauri::command]
pub async fn disconnect_sync(runtime: tauri::State<'_, SyncRuntime>) -> Result<(), String> {
    let _guard = runtime.gate.lock().await;
    if runtime.account_key.is_some() {
        return Err("请在账号设置中退出设备会话；不会清除本机资料".into());
    }
    runtime.write_config(&Config::default())?;
    *runtime.preview.lock().map_err(|_| "同步状态不可用")? = None;
    // Keep baseline/tombstones so reconnecting cannot resurrect old deletions.
    Ok(())
}

#[cfg(test)]
mod tests;

#[tauri::command]
pub fn export_sync_recovery(store: tauri::State<'_, TaskStore>) -> Result<Value, String> {
    store.sync_recovery_document()
}
