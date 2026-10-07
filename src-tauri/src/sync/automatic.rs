//! Account sync runs by default; private v1 tokens remain manual.
use super::*;
use crate::profiles::ProfileRuntime;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PauseReason {
    Auth,
    Conflict,
    Integrity,
    FirstConnection,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    version: u8,
    pub profile_key: String,
    pub enabled: bool,
    pub pause: Option<PauseReason>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckState {
    Disabled,
    Paused,
    Deferred,
    Unchanged,
    Ready,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub state: CheckState,
    pub settings: Settings,
    pub plan: Option<Plan>,
}

impl Settings {
    fn defaults(runtime: &SyncRuntime) -> Self {
        Self {
            version: 1,
            profile_key: runtime
                .account_key
                .clone()
                .unwrap_or_else(|| "local".into()),
            enabled: runtime.account_key.is_some(),
            pause: None,
            message: None,
        }
    }
}

fn path(runtime: &SyncRuntime) -> PathBuf {
    runtime.path.with_file_name("automatic-sync.json")
}

fn read(runtime: &SyncRuntime) -> Result<Settings, SyncFailure> {
    let path = path(runtime);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Settings::defaults(runtime))
        }
        Err(_) => return Err("自动同步设置读取失败，原配置未修改".into()),
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > 4096 => {
            return Err("自动同步配置无效，原配置未修改".into())
        }
        Ok(_) => (),
    }
    let settings: Settings =
        serde_json::from_slice(&fs::read(path).map_err(|_| "自动同步设置读取失败")?)
            .map_err(|_| "自动同步设置格式无效，原配置未修改")?;
    if settings.version != 1
        || settings.profile_key != Settings::defaults(runtime).profile_key
        || settings.message.as_ref().is_some_and(|m| m.len() > 2048)
        || (runtime.account_key.is_none() && settings.enabled)
    {
        return Err("自动同步配置版本或资料库不匹配，已停止操作".into());
    }
    Ok(settings)
}

fn write(runtime: &SyncRuntime, settings: &Settings) -> Result<(), SyncFailure> {
    crate::profiles::write_private(
        &path(runtime),
        &serde_json::to_vec(settings).map_err(|_| "自动同步配置无法编码")?,
    )?;
    Ok(())
}

fn pause(
    runtime: &SyncRuntime,
    mut settings: Settings,
    reason: PauseReason,
    message: impl Into<String>,
) -> Result<Settings, SyncFailure> {
    settings.pause = Some(reason);
    settings.message = Some(message.into());
    write(runtime, &settings)?;
    Ok(settings)
}

fn identity(
    runtime: &SyncRuntime,
    profile: &ProfileRuntime,
    expected: &str,
) -> Result<bool, SyncFailure> {
    if runtime.account_key.as_deref() != Some(expected) || profile.current_key != expected {
        return Err("自动同步只能用于当前账号资料库，不能使用共享令牌或其他账号".into());
    }
    Ok(!profile.status()?.restart_required)
}

fn enabled_settings(
    runtime: &SyncRuntime,
    _store: &TaskStore,
    enabled: bool,
) -> Result<Settings, SyncFailure> {
    let mut settings = read(runtime)?;
    if enabled {
        if runtime.account_key.is_none() {
            return Err("请先登录账号，个人共享令牌仍使用手动同步".into());
        }
        let config = runtime.config()?;
        if config.token.is_empty() {
            return Err(SyncFailure::new(FailureKind::Auth, "请先重新登录当前账号"));
        }
        if config
            .expected_vault_id
            .as_ref()
            .is_none_or(|id| id.is_empty())
        {
            return Err("账号资料库身份缺失，已保留本机记录".into());
        }
    }
    settings.enabled = enabled;
    settings.pause = None;
    settings.message = None;
    write(runtime, &settings)?;
    *runtime
        .automatic_preview
        .lock()
        .map_err(|_| "自动同步状态不可用")? = None;
    Ok(settings)
}

fn failure(
    runtime: &SyncRuntime,
    settings: Settings,
    error: SyncFailure,
) -> Result<Check, SyncFailure> {
    let reason = match error.kind {
        FailureKind::Auth => PauseReason::Auth,
        FailureKind::Integrity => PauseReason::Integrity,
        FailureKind::Network | FailureKind::Stale => return Err(error),
    };
    Ok(Check {
        state: CheckState::Paused,
        settings: pause(runtime, settings, reason, error.message)?,
        plan: None,
    })
}

async fn check(runtime: &SyncRuntime, store: &TaskStore) -> Result<Check, SyncFailure> {
    let settings = read(runtime)?;
    if !settings.enabled {
        return Ok(Check {
            state: CheckState::Disabled,
            settings,
            plan: None,
        });
    }
    if settings.pause.is_some() {
        return Ok(Check {
            state: CheckState::Paused,
            settings,
            plan: None,
        });
    }
    if runtime
        .preview
        .lock()
        .map_err(|_| "同步状态不可用")?
        .is_some()
    {
        return Ok(Check {
            state: CheckState::Deferred,
            settings,
            plan: None,
        });
    }
    *runtime
        .automatic_preview
        .lock()
        .map_err(|_| "自动同步状态不可用")? = None;
    let (preview, plan) = match prepare_preview(runtime, store).await {
        Ok(value) => value,
        Err(error) => return failure(runtime, settings, error),
    };
    if !plan.conflicts.is_empty() {
        return Ok(Check {
            state: CheckState::Paused,
            settings: pause(
                runtime,
                settings,
                PauseReason::Conflict,
                format!(
                    "有 {} 项内容在两台设备上分别修改，请决定保留哪份内容",
                    plan.conflicts.len()
                ),
            )?,
            plan: None,
        });
    }
    if preview.meta.vault_id == preview.remote.vault_id
        && preview.local == preview.remote.records
        && preview.meta.base == preview.remote.records
        && preview.meta.revision == preview.remote.revision
    {
        return Ok(Check {
            state: CheckState::Unchanged,
            settings,
            plan: None,
        });
    }
    *runtime
        .automatic_preview
        .lock()
        .map_err(|_| "自动同步状态不可用")? = Some(preview);
    Ok(Check {
        state: CheckState::Ready,
        settings,
        plan: Some(plan),
    })
}

async fn commit(
    runtime: &SyncRuntime,
    store: &TaskStore,
    preview_id: &str,
) -> Result<Receipt, SyncFailure> {
    let settings = read(runtime)?;
    if !settings.enabled || settings.pause.is_some() {
        return Err(SyncFailure::new(
            FailureKind::Stale,
            "自动同步已关闭或暂停，未提交更改",
        ));
    }
    if runtime
        .preview
        .lock()
        .map_err(|_| "同步状态不可用")?
        .is_some()
    {
        return Err(SyncFailure::new(
            FailureKind::Stale,
            "正在查看手动同步结果，自动提交已延后",
        ));
    }
    let preview = {
        let mut slot = runtime
            .automatic_preview
            .lock()
            .map_err(|_| "自动同步状态不可用")?;
        if slot.as_ref().is_none_or(|p| p.id != preview_id) {
            return Err(SyncFailure::new(
                FailureKind::Stale,
                "自动检查结果已失效，稍后重新检查",
            ));
        }
        slot.take().expect("matching preview")
    };
    match commit_prepared(runtime, store, &preview, &BTreeMap::new()).await {
        Ok(receipt) => Ok(receipt),
        Err(error) => {
            if matches!(error.kind, FailureKind::Auth | FailureKind::Integrity) {
                let reason = if matches!(error.kind, FailureKind::Auth) {
                    PauseReason::Auth
                } else {
                    PauseReason::Integrity
                };
                pause(runtime, settings, reason, &error.message)?;
            }
            Err(error)
        }
    }
}

// A successful explicit merge resolves a pause, but never opts a device in.
pub(super) fn acknowledge_manual(runtime: &SyncRuntime) {
    if runtime.account_key.is_some() {
        if let Ok(mut settings) = read(runtime) {
            if settings.pause.is_some() {
                settings.pause = None;
                settings.message = None;
                let _ = write(runtime, &settings);
            }
        }
    }
}

pub(crate) fn acknowledge_login(runtime: &SyncRuntime) -> Result<(), String> {
    let mut settings = read(runtime).map_err(|error| error.message)?;
    if matches!(
        settings.pause,
        Some(PauseReason::Auth | PauseReason::FirstConnection)
    ) {
        settings.pause = None;
        settings.message = None;
        write(runtime, &settings).map_err(|error| error.message)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_automatic_sync_settings(
    runtime: tauri::State<'_, SyncRuntime>,
) -> Result<Settings, SyncFailure> {
    let _guard = runtime.gate.lock().await;
    read(&runtime)
}

#[tauri::command]
pub async fn set_automatic_sync_enabled(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, ProfileRuntime>,
    profile_key: String,
    enabled: bool,
) -> Result<Settings, SyncFailure> {
    let _profile_guard = profile.gate.lock().await;
    let _guard = runtime.gate.lock().await;
    if !identity(&runtime, &profile, &profile_key)? {
        return Err("资料库即将切换，自动同步设置未修改".into());
    }
    enabled_settings(&runtime, &store, enabled)
}

#[tauri::command]
pub async fn preview_automatic_sync(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, ProfileRuntime>,
    profile_key: String,
) -> Result<Check, SyncFailure> {
    let _profile_guard = profile.gate.lock().await;
    let _guard = runtime.gate.lock().await;
    if !identity(&runtime, &profile, &profile_key)? {
        return Ok(Check {
            state: CheckState::Deferred,
            settings: read(&runtime)?,
            plan: None,
        });
    }
    check(&runtime, &store).await
}

#[tauri::command]
pub async fn commit_automatic_sync(
    runtime: tauri::State<'_, SyncRuntime>,
    store: tauri::State<'_, TaskStore>,
    profile: tauri::State<'_, ProfileRuntime>,
    profile_key: String,
    preview_id: String,
) -> Result<Receipt, SyncFailure> {
    let _profile_guard = profile.gate.lock().await;
    let _guard = runtime.gate.lock().await;
    if !identity(&runtime, &profile, &profile_key)? {
        return Err(SyncFailure::new(
            FailureKind::Stale,
            "资料库即将切换，自动提交已停止",
        ));
    }
    commit(&runtime, &store, &preview_id).await
}

#[cfg(test)]
mod tests;
