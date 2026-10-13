//! Process-bound module policy. This prevents accidental native bypasses;
//! hosted operations must still authorize independently on the server.
use crate::profiles::{AccountProfile, ProfileRuntime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

pub const MODULES: [&str; 13] = [
    "overview",
    "goals",
    "tasks",
    "calendar",
    "countdowns",
    "people",
    "infrastructure",
    "work-monitor",
    "bead-studio",
    "meal-planner",
    "shopping-list",
    "fitness",
    "travel",
];
const OFFLINE_SECONDS: i64 = 24 * 3600;
const ONLINE_SECONDS: i64 = 300;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Actions {
    pub visible: bool,
    pub read: bool,
    pub write: bool,
    pub ai: bool,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Management {
    pub policies: bool,
    pub cohorts: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyRevision {
    scope: String,
    subject: String,
    revision: u64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Document {
    schema_version: u8,
    pub environment: String,
    pub edition: String,
    pub workspace_id: Option<String>,
    pub role: String,
    pub modules: BTreeMap<String, Actions>,
    pub management: Management,
    policy_revisions: Vec<PolicyRevision>,
    checked_at: i64,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Cache {
    version: u8,
    profile_key: String,
    fetched_at: i64,
    legacy: bool,
    blocked: bool,
    document: Option<Document>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub source: String,
    pub environment: Option<String>,
    pub edition: String,
    pub workspace_id: Option<String>,
    pub role: String,
    pub modules: BTreeMap<String, Actions>,
    pub management: Management,
    pub message: String,
}
#[derive(Clone)]
pub struct CapabilityRuntime {
    path: PathBuf,
    local: bool,
    state: Arc<Mutex<Cache>>,
    connected: Arc<AtomicBool>,
    legacy_fallback: bool,
    refresh_gate: Arc<tokio::sync::Mutex<()>>,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn defaults(enabled: bool) -> BTreeMap<String, Actions> {
    MODULES
        .iter()
        .map(|id| {
            (
                (*id).into(),
                Actions {
                    visible: enabled,
                    read: enabled,
                    write: enabled,
                    ai: enabled,
                },
            )
        })
        .collect()
}

impl Document {
    fn validate(&self, account: &AccountProfile) -> Result<(), String> {
        if self.schema_version != 1
            || !matches!(self.environment.as_str(), "preview" | "live")
            || self.modules.len() != MODULES.len()
            || MODULES.iter().any(|m| !self.modules.contains_key(*m))
            || self.checked_at <= 0
            || self.checked_at > now() + 300
            || self.policy_revisions.len() > 1024
            || !matches!(self.role.as_str(), "member" | "operator" | "owner")
            || self.management.policies != (self.role != "member")
            || self.management.cohorts != (self.role == "owner")
            || self.policy_revisions.iter().any(|r| {
                !matches!(r.scope.as_str(), "edition" | "cohort" | "user")
                    || r.subject.is_empty()
                    || r.subject.len() > 80
                    || r.revision == 0
                    || r.revision > 9_007_199_254_740_991
            })
            || self.modules.values().any(|a| !a.read && (a.write || a.ai))
        {
            return Err("模块权限响应格式无效，已停止受限操作".into());
        }
        if let Some(space) = &account.workspace {
            if self.environment != space.environment
                || self.edition != space.edition
                || self.workspace_id.as_ref() != Some(&space.id)
            {
                return Err("模块策略与当前空间来源不一致".into());
            }
        } else if self.edition != "personal" || self.workspace_id.is_some() {
            return Err("模块策略与原账号资料库不一致".into());
        }
        if self.edition != "personal" {
            return Err("当前仓库仅支持个人版空间".into());
        }
        if !self.modules["tasks"].write
            && ["goals", "calendar", "overview"]
                .iter()
                .any(|m| self.modules[*m].write || self.modules[*m].ai)
        {
            return Err("模块策略缺少必要依赖".into());
        }
        Ok(())
    }
}

enum FetchFailure {
    Network,
    Auth,
    Invalid,
}
async fn fetch(account: &AccountProfile, route: &str) -> Result<(u16, Value), FetchFailure> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("Oceanseo/", env!("CARGO_PKG_VERSION")))
        .timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| FetchFailure::Network)?;
    let mut response = client
        .get(format!("{}{route}", account.endpoint))
        .bearer_auth(&account.token)
        .send()
        .await
        .map_err(|_| FetchFailure::Network)?;
    let status = response.status().as_u16();
    if matches!(status, 401 | 403) {
        return Err(FetchFailure::Auth);
    }
    if matches!(status, 408 | 429 | 500..=599) {
        return Err(FetchFailure::Network);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| FetchFailure::Network)? {
        if bytes.len() + chunk.len() > 32_768 {
            return Err(FetchFailure::Invalid);
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map(|value| (status, value))
        .map_err(|_| FetchFailure::Invalid)
}

impl CapabilityRuntime {
    pub fn open(profile: &ProfileRuntime) -> Result<Self, String> {
        let path = profile.data_dir.join("module-capabilities.json");
        let local = profile.current_key == crate::profiles::LOCAL;
        let mut cache = Cache {
            version: 1,
            profile_key: profile.current_key.clone(),
            fetched_at: 0,
            legacy: false,
            blocked: false,
            document: None,
        };
        let has_cache = path.exists() || path.is_symlink();
        if !local && has_cache {
            let load = || -> Result<Cache, String> {
                if path.is_symlink()
                    || path.metadata().map_err(|_| "模块权限缓存不可用")?.len() > 65_536
                {
                    return Err("模块权限缓存路径或容量无效".into());
                }
                let cache: Cache =
                    serde_json::from_slice(&fs::read(&path).map_err(|_| "模块权限缓存不可用")?)
                        .map_err(|_| "模块权限缓存格式无效，原资料仍保留")?;
                if cache.version != 1
                    || cache.profile_key != profile.current_key
                    || cache.fetched_at < 0
                    || cache.fetched_at > now() + 300
                    || (cache.legacy && cache.document.is_some())
                {
                    return Err("模块权限缓存与当前资料库不一致".into());
                }
                let account = profile.current_account()?.ok_or("当前账号不存在")?;
                if cache.legacy && account.workspace.is_some() {
                    return Err("独立空间不能使用旧服务授权".into());
                }
                if let Some(document) = &cache.document {
                    document.validate(&account)?;
                }
                Ok(cache)
            };
            match load() {
                Ok(loaded) => cache = loaded,
                // A damaged policy file must not prevent exporting the business database.
                Err(_) => cache.blocked = true,
            }
        }
        let legacy_fallback = !has_cache || cache.legacy;
        // A disk cache permits bounded offline editing, never online AI or management.
        Ok(Self {
            path,
            local,
            state: Arc::new(Mutex::new(cache)),
            connected: Arc::new(AtomicBool::new(false)),
            legacy_fallback,
            refresh_gate: Arc::new(tokio::sync::Mutex::new(())),
        })
    }

    fn save(&self, cache: Cache) -> Result<(), String> {
        let raw = serde_json::to_vec(&cache).map_err(|_| "权限缓存无法编码")?;
        let mut state = self.state.lock().map_err(|_| "模块权限状态不可用")?;
        *state = cache;
        if let Err(error) = crate::profiles::write_private(&self.path, &raw) {
            state.blocked = true;
            self.connected.store(false, Ordering::Release);
            return Err(error);
        }
        Ok(())
    }

    pub fn status(&self, profile: &ProfileRuntime) -> Result<Status, String> {
        let cache = self.state.lock().map_err(|_| "模块权限状态不可用")?.clone();
        self.status_from_cache(profile, &cache)
    }

    fn status_from_cache(&self, profile: &ProfileRuntime, cache: &Cache) -> Result<Status, String> {
        self.workspace_status(profile, cache)
    }

    fn workspace_status(&self, profile: &ProfileRuntime, cache: &Cache) -> Result<Status, String> {
        if self.local {
            return Ok(Status {
                source: "local".into(),
                environment: None,
                edition: "personal".into(),
                workspace_id: None,
                role: "member".into(),
                modules: defaults(true),
                management: Management::default(),
                message: String::new(),
            });
        }
        let account = profile.current_account()?.ok_or("当前账号不存在")?;
        if account.key()? != cache.profile_key {
            return Err("权限状态与当前资料库不一致".into());
        }
        let age = now() - cache.fetched_at;
        let valid = !cache.blocked
            && !account.token.is_empty()
            && cache.fetched_at > 0
            && (-300..=OFFLINE_SECONDS).contains(&age);
        let online = valid
            && self.connected.load(Ordering::Acquire)
            && age <= ONLINE_SECONDS
            && account.expires_at > now();
        let mut modules = cache
            .document
            .as_ref()
            .map(|d| d.modules.clone())
            .unwrap_or_else(|| defaults(cache.legacy && valid));
        if !valid {
            for a in modules.values_mut() {
                a.write = false;
                a.ai = false;
            }
        }
        if !online {
            for a in modules.values_mut() {
                a.ai = false;
            }
        }
        let source = if !valid {
            "limited"
        } else if cache.legacy {
            "legacy"
        } else if online {
            "verified"
        } else {
            "cached"
        };
        let management = if online {
            cache
                .document
                .as_ref()
                .map(|d| d.management.clone())
                .unwrap_or_default()
        } else {
            Management::default()
        };
        Ok(Status {
            source: source.into(),
            environment: cache.document.as_ref().map(|d| d.environment.clone()),
            edition: account
                .workspace
                .as_ref()
                .map(|w| w.edition.clone())
                .unwrap_or_else(|| "personal".into()),
            workspace_id: account.workspace.as_ref().map(|w| w.id.clone()),
            role: cache
                .document
                .as_ref()
                .map(|d| d.role.clone())
                .unwrap_or_else(|| "member".into()),
            modules,
            management,
            message: if !valid {
                "尚未取得有效模块权限。已有资料保留，可在数据设置中导出；联网后会自动重试。".into()
            } else if !online && !cache.legacy {
                "正在使用已验证的离线权限，AI 与管理操作等待重新连接。".into()
            } else {
                String::new()
            },
        })
    }

    pub fn require(
        &self,
        profile: &ProfileRuntime,
        module: &str,
        action: &str,
    ) -> Result<(), String> {
        if matches!(action, "write" | "ai") && profile.status()?.restart_required {
            return Err("资料库即将切换，已停止新的业务操作；请重新打开应用".into());
        }
        let status = self.status(profile)?;
        let allowed = status.modules.get(module).is_some_and(|a| match action {
            "visible" => a.visible,
            "read" => a.read,
            "write" => a.write,
            "ai" => a.ai,
            _ => false,
        });
        if allowed {
            Ok(())
        } else {
            Err(format!("module_permission_denied:{module}:{action}；当前空间暂不允许这项操作，已有资料仍保留"))
        }
    }

    /// Acquire the policy/selection permits only after the SQLite writer lock.
    /// Permission refreshes are serialized with the final commit, not the wait.
    pub fn with_writes<T>(
        &self,
        profile: &ProfileRuntime,
        modules: &[&str],
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let permissions: Vec<_> = modules.iter().map(|module| (*module, "write")).collect();
        self.with_permissions(profile, &permissions, operation)
    }

    pub fn with_permissions<T>(
        &self,
        profile: &ProfileRuntime,
        permissions: &[(&str, &str)],
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        profile.while_current(|| {
            let cache = self.state.lock().map_err(|_| "模块权限状态不可用")?;
            let status = self.status_from_cache(profile, &cache)?;
            for (module, action) in permissions {
                if !status.modules.get(*module).is_some_and(|value| match *action {
                    "read" => value.read,
                    "write" => value.write,
                    "ai" => value.ai,
                    "visible" => value.visible,
                    _ => false,
                }) {
                    return Err(format!("module_permission_denied:{module}:{action}；当前空间暂不允许这项操作，已有资料仍保留"));
                }
            }
            operation()
        })
    }

    /// Stop consuming a long-running result when its permission or data source changes.
    /// Dropping an HTTP future cannot undo a request already received by its provider.
    pub async fn while_authorized<T>(
        &self,
        profile: &ProfileRuntime,
        module: &str,
        action: &str,
        operation: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        self.require(profile, module, action)?;
        let initial = self.status(profile)?;
        let check = || -> Result<(), String> {
            self.require(profile, module, action)?;
            if action == "ai" {
                let current = self.status(profile)?;
                if initial.modules.iter().any(|(id, before)| {
                    before.read && !current.modules.get(id).is_some_and(|a| a.read)
                }) {
                    return Err("本轮可读取的资料权限已变化，已停止处理；原输入仍保留".into());
                }
            }
            Ok(())
        };
        tokio::pin!(operation);
        let mut interval = tokio::time::interval(Duration::from_millis(200));
        loop {
            tokio::select! {
                biased;
                _ = interval.tick() => check()?,
                result = &mut operation => {
                    check()?;
                    return result;
                }
            }
        }
    }

    pub async fn refresh(&self, profile: &ProfileRuntime) -> Result<Status, String> {
        let _gate = self.refresh_gate.lock().await;
        if self.local {
            return self.status(profile);
        }
        let _profile_gate = profile.gate.lock().await;
        let account = profile.current_account()?.ok_or("当前账号不存在")?;
        if account.token.is_empty() || account.expires_at <= now() {
            return self.status(profile);
        }
        let old = self.state.lock().map_err(|_| "模块权限状态不可用")?.clone();
        let outcome = async {
            let (code, me) = fetch(&account, "/v2/me").await?;
            if code != 200 || crate::accounts::validate_identity_response(&account, me).is_err() {
                return Err(FetchFailure::Invalid);
            }
            let route = account
                .workspace
                .as_ref()
                .map(|w| format!("/v2/workspaces/{}/capabilities", w.id))
                .unwrap_or_else(|| "/v2/capabilities".into());
            let (code, value) = fetch(&account, &route).await?;
            if code == 404
                && value == serde_json::json!({"error":"not_found"})
                && self.legacy_fallback
                && account.workspace.is_none()
                && old.document.is_none()
            {
                return Ok(Cache {
                    version: 1,
                    profile_key: account.key().map_err(|_| FetchFailure::Invalid)?,
                    fetched_at: now(),
                    legacy: true,
                    blocked: false,
                    document: None,
                });
            }
            if code != 200 {
                return Err(FetchFailure::Invalid);
            }
            let document: Document =
                serde_json::from_value(value).map_err(|_| FetchFailure::Invalid)?;
            document
                .validate(&account)
                .map_err(|_| FetchFailure::Invalid)?;
            if old
                .document
                .as_ref()
                .is_some_and(|previous| previous.environment != document.environment)
            {
                return Err(FetchFailure::Invalid);
            }
            Ok(Cache {
                version: 1,
                profile_key: account.key().map_err(|_| FetchFailure::Invalid)?,
                fetched_at: now(),
                legacy: false,
                blocked: false,
                document: Some(document),
            })
        }
        .await;
        match outcome {
            Ok(cache) => {
                self.save(cache)?;
                self.connected.store(true, Ordering::Release);
            }
            Err(FetchFailure::Network) => {
                self.connected.store(false, Ordering::Release);
            }
            Err(FetchFailure::Auth | FetchFailure::Invalid) => {
                self.connected.store(false, Ordering::Release);
                let mut cache = old;
                cache.blocked = true;
                self.save(cache)?;
            }
        }
        self.status(profile)
    }
}

#[tauri::command]
pub fn get_module_capabilities(
    runtime: tauri::State<'_, CapabilityRuntime>,
    profile: tauri::State<'_, ProfileRuntime>,
) -> Result<Status, String> {
    runtime.status(&profile)
}
#[tauri::command]
pub async fn refresh_module_capabilities(
    runtime: tauri::State<'_, CapabilityRuntime>,
    profile: tauri::State<'_, ProfileRuntime>,
) -> Result<Status, String> {
    runtime.refresh(&profile).await
}

#[tauri::command]
pub async fn open_control_center(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, CapabilityRuntime>,
    profile: tauri::State<'_, ProfileRuntime>,
) -> Result<(), String> {
    let status = runtime.refresh(&profile).await?;
    if status.source != "verified"
        || status.environment.as_deref() != Some("preview")
        || !status.management.policies
    {
        return Err("当前身份没有测试管理权限，请联网后重新登录管理员账号".into());
    }
    let account = profile.current_account()?.ok_or("当前账号不存在")?;
    // No device token is transferred to the browser. Management has its own sign-in session.
    crate::infrastructure::open_host_url(app, format!("{}/manage/", account.endpoint)).await
}

/// Check only the fields that change. Life tools share a document, not a permission.
pub fn changed_modules(
    key: &str,
    before: Option<&Value>,
    after: Option<&Value>,
) -> Result<Vec<&'static str>, String> {
    if before == after {
        return Ok(Vec::new());
    }
    Ok(match key {
        "tideplan.life.v1" => {
            let mut changed = Vec::new();
            for (field, module) in [
                ("people", "people"),
                ("training", "fitness"),
                ("workouts", "fitness"),
                ("trips", "travel"),
            ] {
                let a = before.and_then(|v| v.get(field));
                let b = after.and_then(|v| v.get(field));
                // Empty scaffolding is not a business mutation; deletion of nonempty data is.
                let empty = |v: Option<&Value>| v.is_none() || v == Some(&serde_json::json!([]));
                if a != b && !(empty(a) && empty(b)) && !changed.contains(&module) {
                    changed.push(module);
                }
            }
            let fields = ["version", "people", "training", "workouts", "trips"];
            if [before, after].into_iter().flatten().any(|v| {
                !v.is_null()
                    && v.as_object()
                        .is_none_or(|o| o.keys().any(|k| !fields.contains(&k.as_str())))
            }) {
                return Err("生活数据包含未注册的字段".into());
            }
            changed
        }
        "tideplan.reminders.v1" => vec![],
        "tideplan.purchase-list.v1" => vec!["shopping-list"],
        "tideplan.meal-plan.v1" | "tideplan.meal-preferences.v1" => vec!["meal-planner"],
        "tideplan.shopping-checked.v1" => vec!["shopping-list"],
        "tideplan.countdowns.v1" => vec!["countdowns"],
        "tideplan.bead-pattern.v1" | "tideplan.bead-works.v1" => vec!["bead-studio"],
        "tideplan.assistant.v1" | "tideplan.goals.v1" => vec!["goals"],
        "tideplan.infrastructure.v1" => vec!["infrastructure"],
        _ => return Err("未注册的数据模块".into()),
    })
}

pub fn planning_module(kind: &str) -> Option<&'static str> {
    match kind {
        "goals" | "goal_dialogue" | "goal_review" => Some("goals"),
        "training" | "review" => Some("fitness"),
        "travel" => Some("travel"),
        "host_review" | "host_import" => Some("infrastructure"),
        _ => None,
    }
}

pub fn all_readable(status: &Status) -> bool {
    status.modules.values().all(|a| a.read)
}
pub fn filter_context(context: &mut Value, status: &Status) {
    let read = |module: &str| status.modules.get(module).is_some_and(|a| a.read);
    if let Some(sections) = context.get_mut("sections").and_then(Value::as_object_mut) {
        sections.retain(|key, _| {
            ["tasks", "calendar", "meals", "work", "infrastructure"].contains(&key.as_str())
        });
        for (section, module) in [
            ("tasks", "tasks"),
            ("calendar", "calendar"),
            ("work", "work-monitor"),
            ("infrastructure", "infrastructure"),
        ] {
            if !read(module) {
                sections.remove(section);
            }
        }
        if !read("goals") {
            if let Some(tasks) = sections.get_mut("tasks").and_then(Value::as_object_mut) {
                tasks.remove("goals");
                tasks.remove("actions");
            }
        }
        if let Some(calendar) = sections.get_mut("calendar") {
            if !read("countdowns") {
                calendar["keyDates"] = serde_json::json!([]);
            }
            if let Some(events) = calendar.get_mut("events").and_then(Value::as_array_mut) {
                events.retain(|event| match event["kind"].as_str() {
                    Some("training") => read("fitness"),
                    Some("travel") => read("travel"),
                    _ => false,
                });
            }
        }
        if !read("meal-planner") && !read("shopping-list") {
            sections.remove("meals");
        } else if let Some(meals) = sections.get_mut("meals") {
            if !read("meal-planner") {
                meals["plan"] = Value::Null;
            }
            if !read("shopping-list") {
                meals["shopping"] = serde_json::json!([]);
                meals["pendingCount"] = serde_json::json!(0);
            }
        }
    }
    if let Some(workspace) = context.get_mut("workspace") {
        filter_context(workspace, status);
    }
    if !read("people") {
        if let Some(object) = context.as_object_mut() {
            object.remove("people");
        }
    }
    if !read("tasks") {
        if let Some(object) = context.as_object_mut() {
            object.remove("tasks");
        }
    }
    let module_for_destination = |id: &str| {
        if id == "task" {
            "tasks".to_string()
        } else {
            id.to_string()
        }
    };
    if let Some(destinations) = context
        .get_mut("availableDestinations")
        .and_then(Value::as_array_mut)
    {
        destinations.retain(|d| {
            d.as_str().is_some_and(|id| {
                status
                    .modules
                    .get(&module_for_destination(id))
                    .is_some_and(|a| a.write)
            })
        });
    }
    if let Some(targets) = context.get_mut("targets").and_then(Value::as_array_mut) {
        targets.retain(|t| {
            t["destination"]
                .as_str()
                .is_some_and(|id| read(&module_for_destination(id)))
        });
    }
    if !all_readable(status) {
        if let Some(object) = context.as_object_mut() {
            // Generated summaries and historical plans may contain another module's content.
            for key in [
                "actualProgress",
                "actual",
                "recentDecisions",
                "clarification",
            ] {
                object.remove(key);
            }
        }
        if let Some(dialogue) = context.get_mut("dialogue").and_then(Value::as_object_mut) {
            if let Some(history) = dialogue.get_mut("history").and_then(Value::as_array_mut) {
                let latest = history.iter().rev().find(|m| m["role"] == "user").cloned();
                *history = latest.into_iter().collect();
            }
            for key in ["understanding", "pending", "receipts"] {
                dialogue.remove(key);
            }
            if !read("tasks") {
                dialogue.remove("existingTaskParameters");
            }
        }
        if let Some(object) = context.as_object_mut() {
            object.remove("actions");
        }
    }
}

/// Native business writes cannot be enabled by restoring a hidden route or invoking IPC directly.
/// Own stored data reads and exports remain available for recovery; UI applies read visibility.
pub fn guarded_handler<R: tauri::Runtime>(
    handler: impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    move |invoke| {
        if let Err(error) = guard(&invoke) {
            invoke.resolver.reject(error);
            return true;
        }
        handler(invoke)
    }
}

pub fn guard<R: tauri::Runtime>(invoke: &tauri::ipc::Invoke<R>) -> Result<(), String> {
    use tauri::Manager;
    let app = invoke.message.webview_ref().app_handle();
    let runtime = app.state::<CapabilityRuntime>();
    let profile = app.state::<ProfileRuntime>();
    let require = |module, action| runtime.require(&profile, module, action);
    let require_sync_write = || -> Result<(), String> {
        require("tasks", "write")?;
        require("goals", "write")
    };
    let payload = match invoke.message.payload() {
        tauri::ipc::InvokeBody::Json(v) => v,
        _ => return Err("业务命令需要 JSON 参数".into()),
    };
    match invoke.message.command() {
        // These operations depend on the latest database contents. The bound
        // store checks affected modules under its writer transaction at commit.
        // Never wait for SQLite from the UI-thread admission handler.
        "migrate_legacy_tasks"
        | "bootstrap_app_state"
        | "set_app_state"
        | "commit_bead_transfer"
        | "commit_bead_handoff"
        | "commit_bead_lifecycle"
        | "restore_data_backup" => Ok(()),
        "create_task" | "update_task" | "set_task_completed" | "delete_task" => {
            require("tasks", "write")
        }
        "preview_sync" | "commit_sync" | "preview_automatic_sync" | "commit_automatic_sync" => {
            require_sync_write()
        }
        "set_automatic_sync_enabled" if payload["enabled"] == true => require_sync_write(),
        "stage_bead_handoff" => require("bead-studio", "read"),
        "analyze_bead_image" | "generate_bead_image" => require("bead-studio", "ai"),
        "generate_meal_plan" => require("meal-planner", "ai"),
        "run_assistant" => require("goals", "ai"),
        "run_planning_agent" => require(
            planning_module(payload["kind"].as_str().unwrap_or("")).ok_or("未知规划模块")?,
            "ai",
        ),
        "search_places" | "plan_map_route" => require("travel", "write"),
        "save_map_settings" if payload["clear"] != true => require("travel", "write"),
        "check_host_endpoint" | "save_host_credential" => require("infrastructure", "write"),
        "open_host_url" | "host_credential_configured" => require("infrastructure", "read"),
        "save_work_monitor_config"
        | "scan_workspaces"
        | "run_scheduled_work_scan"
        | "set_work_project_mapping"
        | "reject_work_draft"
        | "sync_work_draft" => require("work-monitor", "write"),
        "generate_work_report" => {
            require("work-monitor", "ai")?;
            require("work-monitor", "write")
        }
        "get_gworkspace_catalog" => require("work-monitor", "read"),
        "commit_goal_changes" => {
            require("goals", "write")?;
            if payload["request"]["undo"] == true
                || ["createTasks", "updateTasks"].iter().any(|k| {
                    payload["request"][*k]
                        .as_array()
                        .is_some_and(|a| !a.is_empty())
                })
            {
                require("tasks", "write")?;
            }
            // Destinations are navigation references. Their business writes are checked separately.
            Ok(())
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{credentials::CredentialCipher, profiles::WorkspaceBinding};
    use serde_json::json;
    use std::io::BufRead;

    struct Server(std::process::Child);
    impl Drop for Server {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    pub(crate) fn account(endpoint: &str) -> AccountProfile {
        AccountProfile {
            endpoint: endpoint.into(),
            user_id: "00000000-0000-4000-8000-000000000001".into(),
            username: "synthetic".into(),
            vault_id: "00000000-0000-4000-8000-000000000002".into(),
            session_id: "00000000-0000-4000-8000-000000000003".into(),
            expires_at: 4_000_000_000,
            device_name: "QA".into(),
            token: "a".repeat(43),
            workspace: None,
        }
    }
    pub(crate) fn profile(root: &std::path::Path, account: &AccountProfile) -> ProfileRuntime {
        let local = ProfileRuntime::open(root, CredentialCipher::plain()).unwrap();
        local.save_account(account).unwrap();
        local.select(&account.key().unwrap()).unwrap();
        ProfileRuntime::open(root, CredentialCipher::plain()).unwrap()
    }
    fn document() -> Document {
        Document {
            schema_version: 1,
            environment: "preview".into(),
            edition: "personal".into(),
            workspace_id: None,
            role: "member".into(),
            modules: defaults(true),
            management: Management::default(),
            policy_revisions: vec![],
            checked_at: now(),
        }
    }
    fn server(temp: &tempfile::TempDir, mode: &str) -> (Server, String) {
        fs::write(temp.path().join("mode"), mode).unwrap();
        fs::write(
            temp.path().join("document"),
            serde_json::to_vec(&document()).unwrap(),
        )
        .unwrap();
        let script = r#"
import os,json
from http.server import BaseHTTPRequestHandler,HTTPServer
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_GET(self):
  mode=open(os.path.join(os.environ['QA_ROOT'],'mode')).read()
  if mode=='revoked': code,value=401,{'error':'unauthorized'}
  elif mode=='offline': code,value=503,{'error':'unavailable'}
  elif self.path=='/v2/me':
   code,value=200,{'user':{'id':'00000000-0000-4000-8000-000000000001','username':'synthetic'},'vaultId':'00000000-0000-4000-8000-000000000002','sessionId':'00000000-0000-4000-8000-000000000003','expiresAt':4000000000}
   if mode=='wrong_identity': value['user']['id']='00000000-0000-4000-8000-000000000099'
  elif mode in ['legacy','bad404']: code,value=404,{'error':'not_found' if mode=='legacy' else 'disabled'}
  else: code,value=200,json.load(open(os.path.join(os.environ['QA_ROOT'],'document')))
  raw=json.dumps(value).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
s=HTTPServer(('127.0.0.1',0),Handler);print(s.server_port,flush=True);s.serve_forever()
"#;
        let mut child = std::process::Command::new("python3")
            .args(["-u", "-c", script])
            .env("QA_ROOT", temp.path())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        let mut port = String::new();
        std::io::BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut port)
            .unwrap();
        (Server(child), format!("http://127.0.0.1:{}", port.trim()))
    }
    #[test]
    fn mixed_life_writes_and_deletions_require_only_changed_modules() {
        let before =
            json!({"version":1,"people":[{"id":"p"}],"training":[],"workouts":[],"trips":[]});
        let mut after = before.clone();
        after["trips"] = json!([{"id":"trip"}]);
        assert_eq!(
            changed_modules("tideplan.life.v1", Some(&before), Some(&after)).unwrap(),
            vec!["travel"]
        );
        assert_eq!(
            changed_modules("tideplan.life.v1", Some(&before), None).unwrap(),
            vec!["people"]
        );
        after["unknown"] = json!(true);
        assert!(changed_modules("tideplan.life.v1", Some(&before), Some(&after)).is_err());
        assert!(changed_modules(
            "tideplan.life.v1",
            None,
            Some(&json!({"version":1,"people":[],"training":[],"workouts":[],"trips":[]}))
        )
        .unwrap()
        .is_empty());
        assert!(changed_modules("arbitrary", None, Some(&json!(1))).is_err());
    }

    fn install_test_policy(runtime: &CapabilityRuntime, profile: &ProfileRuntime, denied: &[&str]) {
        let permissions: Vec<_> = denied.iter().map(|module| (*module, "write")).collect();
        install_test_permissions(runtime, profile, &permissions);
    }

    pub(crate) fn install_test_permissions(
        runtime: &CapabilityRuntime,
        profile: &ProfileRuntime,
        denied: &[(&str, &str)],
    ) {
        let mut policy = document();
        for (module, action) in denied {
            let actions = policy.modules.get_mut(*module).unwrap();
            match *action {
                "write" => actions.write = false,
                "ai" => actions.ai = false,
                "read" => actions.read = false,
                _ => panic!("Unknown test permission"),
            }
        }
        runtime
            .save(Cache {
                version: 1,
                profile_key: profile.current_key.clone(),
                fetched_at: now(),
                legacy: false,
                blocked: false,
                document: Some(policy),
            })
            .unwrap();
        runtime.connected.store(true, Ordering::Release);
    }

    #[test]
    fn queued_store_writes_recheck_revocation_after_sqlite_writer_wait() {
        use crate::tasks::{TaskMutation, TaskStore};
        use std::sync::mpsc;
        let temp = tempfile::tempdir().unwrap();
        let profile = profile(
            &temp.path().join("client"),
            &account("https://sync.example.com"),
        );
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        install_test_policy(&runtime, &profile, &[]);
        let database = profile.data_dir.join("store.sqlite");
        let store = Arc::new(TaskStore::open(&database).unwrap());
        let mutation = || TaskMutation {
            title: "原任务".into(),
            notes: "原笔记".into(),
            horizon: "short".into(),
            priority: "normal".into(),
            start_date: None,
            due_date: None,
            origin: None,
        };
        let task = store.create(mutation()).unwrap();
        let goal_state: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/goals-empty.json")).unwrap();
        store
            .set_app_state(crate::goals::KEY, goal_state.clone())
            .unwrap();
        store
            .bind_authorization(runtime.clone(), profile.clone())
            .unwrap();
        type Operation = Box<dyn FnOnce(&TaskStore) -> Result<(), String> + Send>;
        let id = task.id.clone();
        let update = mutation();
        let completed_id = id.clone();
        let delete_id = id.clone();
        let mut restored = store.export_backup().unwrap();
        restored.tasks.clear();
        let mut next_goal = goal_state;
        next_goal["revision"] = json!(1);
        next_goal["operations"] = json!(["queued-goal"]);
        let request = crate::goals::GoalCommit {
            operation_id: "queued-goal".into(),
            expected_revision: 0,
            next: next_goal,
            create_tasks: vec![],
            update_tasks: vec![],
            checks: vec![],
            undo: false,
        };
        let raw = json!([{"id":uuid::Uuid::new_v4().to_string(),"title":"旧记录","notes":"原文","horizon":"short","priority":"normal","startDate":null,"dueDate":null,"createdAt":"2026-10-01T09:00:00Z","completedAt":null}]).to_string();
        let (expected, meta) = store.sync_snapshot().unwrap();
        let mut remote_records = expected.clone();
        remote_records.insert(format!("task:{id}"), Value::Null);
        let remote = crate::sync::Vault {
            protocol: 1,
            vault_id: uuid::Uuid::new_v4().to_string(),
            revision: 1,
            records: remote_records,
        };
        let operations: Vec<(&str, Operation)> = vec![
            ("tasks", Box::new(move |s| s.create(mutation()).map(|_| ()))),
            (
                "tasks",
                Box::new(move |s| s.update(&id, update).map(|_| ())),
            ),
            (
                "tasks",
                Box::new(move |s| s.set_completed(&completed_id, true).map(|_| ())),
            ),
            ("tasks", Box::new(move |s| s.delete(&delete_id))),
            (
                "tasks",
                Box::new(move |s| s.restore_backup(restored).map(|_| ())),
            ),
            (
                "goals",
                Box::new(move |s| s.commit_goals(request).map(|_| ())),
            ),
            (
                "tasks",
                Box::new(move |s| s.migrate_legacy(Some(&raw)).map(|_| ())),
            ),
            (
                "shopping-list",
                Box::new(move |s| {
                    s.bootstrap_app_state(std::collections::HashMap::from([(
                        "tideplan.purchase-list.v1".into(),
                        json!([]),
                    )]))
                    .map(|_| ())
                }),
            ),
            (
                "tasks",
                Box::new(move |s| {
                    s.sync_apply_checked(&expected, &meta, &remote, "fixture-snapshot".into())
                        .map(|_| ())
                        .map_err(|e| e.message)
                }),
            ),
        ];
        for (module, operation) in operations {
            install_test_policy(&runtime, &profile, &[]);
            runtime.require(&profile, module, "write").unwrap(); // old admission result
            let before = store.export_backup().unwrap();
            let meta_before = store.sync_snapshot().unwrap().1;
            let writer = rusqlite::Connection::open(&database).unwrap();
            writer.execute_batch("BEGIN IMMEDIATE").unwrap();
            let (started_tx, started_rx) = mpsc::channel();
            let (done_tx, done_rx) = mpsc::channel();
            let worker_store = store.clone();
            let worker = std::thread::spawn(move || {
                started_tx.send(()).unwrap();
                done_tx.send(operation(&worker_store)).unwrap()
            });
            started_rx.recv().unwrap();
            assert!(matches!(
                done_rx.recv_timeout(Duration::from_millis(30)),
                Err(mpsc::RecvTimeoutError::Timeout)
            ));
            install_test_policy(&runtime, &profile, &[module]);
            writer.execute_batch("COMMIT").unwrap();
            assert!(done_rx
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .unwrap_err()
                .contains(&format!("module_permission_denied:{module}:write")));
            worker.join().unwrap();
            let after = store.export_backup().unwrap();
            assert_eq!(before.tasks, after.tasks);
            assert_eq!(before.app_state, after.app_state);
            assert_eq!(
                crate::sync::hash(&meta_before),
                crate::sync::hash(&store.sync_snapshot().unwrap().1)
            );
            assert!(!store.import_completed(false).unwrap());
            assert!(!store.import_completed(true).unwrap());
        }
    }

    #[test]
    fn shared_document_authorization_uses_latest_values_and_null_is_protected_deletion() {
        use crate::tasks::TaskStore;
        let temp = tempfile::tempdir().unwrap();
        let profile = profile(
            &temp.path().join("client"),
            &account("https://sync.example.com"),
        );
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        install_test_policy(&runtime, &profile, &[]);
        let database = profile.data_dir.join("store.sqlite");
        let store = Arc::new(TaskStore::open(&database).unwrap());
        let empty = json!({"version":1,"people":[],"training":[],"workouts":[],"trips":[]});
        let mut latest = empty.clone();
        latest["training"] = json!([{"id":"plan","personId":"","title":"原训练","startDate":"2026-10-01","intervalDays":2,"cycles":3,"goal":"","advice":"","archived":false,"exercises":[{"id":"exercise","name":"深蹲","unit":"次","sets":3,"reps":12}]}]);
        store
            .set_app_state("tideplan.life.v1", empty.clone())
            .unwrap();
        store
            .bind_authorization(runtime.clone(), profile.clone())
            .unwrap();
        let writer = rusqlite::Connection::open(&database).unwrap();
        writer.execute_batch("BEGIN IMMEDIATE").unwrap();
        writer
            .execute(
                "UPDATE app_state SET value_json=?1 WHERE key='tideplan.life.v1'",
                [latest.to_string()],
            )
            .unwrap();
        // The queued payload would erase training that did not exist at admission.
        let worker_store = store.clone();
        let worker =
            std::thread::spawn(move || worker_store.set_app_state("tideplan.life.v1", empty));
        install_test_policy(&runtime, &profile, &["fitness"]);
        writer.execute_batch("COMMIT").unwrap();
        assert!(worker
            .join()
            .unwrap()
            .unwrap_err()
            .contains("module_permission_denied:fitness:write"));
        assert_eq!(
            store.app_state_value("tideplan.life.v1").unwrap(),
            Some(latest.clone())
        );
        assert!(store
            .set_app_state("tideplan.life.v1", Value::Null)
            .unwrap_err()
            .contains("module_permission_denied:fitness:write"));
        assert_eq!(
            changed_modules("tideplan.life.v1", Some(&latest), Some(&Value::Null)).unwrap(),
            vec!["fitness"]
        );
        install_test_policy(&runtime, &profile, &[]);
        store
            .set_app_state("tideplan.life.v1", Value::Null)
            .unwrap();
    }

    #[test]
    fn commit_permit_orders_policy_and_selection_changes_without_switching_stores() {
        use std::sync::mpsc;
        let temp = tempfile::tempdir().unwrap();
        let profile = profile(
            &temp.path().join("client"),
            &account("https://sync.example.com"),
        );
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        install_test_policy(&runtime, &profile, &[]);
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let permit_runtime = runtime.clone();
        let permit_profile = profile.clone();
        let commit = std::thread::spawn(move || {
            permit_runtime.with_writes(&permit_profile, &["tasks"], || {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
        });
        entered_rx.recv().unwrap();
        let (changed_tx, changed_rx) = mpsc::channel();
        let updated_runtime = runtime.clone();
        let updated_profile = profile.clone();
        let change = std::thread::spawn(move || {
            install_test_policy(&updated_runtime, &updated_profile, &["tasks"]);
            changed_tx.send(()).unwrap()
        });
        assert!(matches!(
            changed_rx.recv_timeout(Duration::from_millis(30)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));
        release_tx.send(()).unwrap();
        commit.join().unwrap().unwrap();
        change.join().unwrap();
        changed_rx.recv().unwrap();
        assert!(runtime
            .with_writes(&profile, &["tasks"], || Ok(()))
            .unwrap_err()
            .contains("module_permission_denied:tasks:write"));
        install_test_policy(&runtime, &profile, &[]);
        profile.clone().select(crate::profiles::LOCAL).unwrap();
        assert!(runtime
            .with_writes(&profile, &["tasks"], || Ok(()))
            .unwrap_err()
            .contains("资料库即将切换"));
    }
    #[test]
    fn ai_context_drops_denied_modules_nested_calendar_and_unattributed_history() {
        let status = Status {
            source: "verified".into(),
            environment: Some("preview".into()),
            edition: "personal".into(),
            workspace_id: None,
            role: "member".into(),
            modules: defaults(true),
            management: Management::default(),
            message: String::new(),
        };
        let mut status = status;
        for module in [
            "people",
            "travel",
            "meal-planner",
            "work-monitor",
            "countdowns",
        ] {
            status.modules.insert(module.into(), Actions::default());
        }
        let mut context = serde_json::json!({"people":["private"],"actualProgress":"private mixed summary","recentDecisions":["private"],
            "availableDestinations":["task","travel","fitness"],"targets":[{"destination":"travel","title":"private"},{"destination":"fitness","title":"training"}],
            "dialogue":{"history":[{"role":"assistant","text":"private generated summary"},{"role":"user","text":"current explicit input"}],"understanding":["private"],"receipts":["private"]},
            "workspace":{"sections":{"unexpected":{"secret":"private"},"tasks":{"pending":["allowed"]},"work":{"projects":["private"]},
                "meals":{"plan":"private","shopping":["allowed"]},"calendar":{"keyDates":["private"],"events":[{"kind":"training"},{"kind":"travel"}]}}}});
        filter_context(&mut context, &status);
        let text = context.to_string();
        assert!(!text.contains("private"));
        assert!(text.contains("current explicit input"));
        assert!(text.contains("allowed"));
        assert_eq!(
            context["availableDestinations"],
            serde_json::json!(["task", "fitness"])
        );
        assert_eq!(
            context["workspace"]["sections"]["calendar"]["events"],
            serde_json::json!([{"kind":"training"}])
        );
    }
    #[tokio::test]
    async fn http_policy_offline_cache_revocation_and_recovery_are_bounded() {
        let temp = tempfile::tempdir().unwrap();
        let (_server, endpoint) = server(&temp, "ok");
        let profile = profile(&temp.path().join("client"), &account(&endpoint));
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        assert_eq!(runtime.status(&profile).unwrap().source, "limited");
        assert!(runtime.require(&profile, "tasks", "write").is_err());
        assert_eq!(runtime.refresh(&profile).await.unwrap().source, "verified");
        assert!(runtime.require(&profile, "goals", "ai").is_ok());
        let restarted = CapabilityRuntime::open(&profile).unwrap();
        assert_eq!(restarted.status(&profile).unwrap().source, "cached");
        assert!(restarted.require(&profile, "tasks", "write").is_ok());
        assert!(restarted.require(&profile, "goals", "ai").is_err());
        fs::write(temp.path().join("mode"), "offline").unwrap();
        assert_eq!(runtime.refresh(&profile).await.unwrap().source, "cached");
        assert!(runtime.require(&profile, "goals", "ai").is_err());
        let mut cache = runtime.state.lock().unwrap().clone();
        cache.fetched_at = now() - OFFLINE_SECONDS - 1;
        runtime.save(cache).unwrap();
        assert!(runtime.require(&profile, "tasks", "write").is_err());
        fs::write(temp.path().join("mode"), "ok").unwrap();
        runtime.refresh(&profile).await.unwrap();
        let mut policy = document();
        policy.modules.get_mut("travel").unwrap().write = false;
        policy.modules.get_mut("travel").unwrap().ai = false;
        fs::write(
            temp.path().join("document"),
            serde_json::to_vec(&policy).unwrap(),
        )
        .unwrap();
        runtime.refresh(&profile).await.unwrap();
        assert!(runtime.require(&profile, "travel", "write").is_err());
        assert!(runtime.require(&profile, "tasks", "write").is_ok());
        fs::write(temp.path().join("mode"), "revoked").unwrap();
        runtime.refresh(&profile).await.unwrap();
        assert!(runtime.require(&profile, "tasks", "write").is_err());
        assert!(CapabilityRuntime::open(&profile)
            .unwrap()
            .require(&profile, "tasks", "write")
            .is_err());
        assert!(runtime.status(&profile).unwrap().modules["travel"].read);
        fs::write(temp.path().join("mode"), "ok").unwrap();
        runtime.refresh(&profile).await.unwrap();
        assert!(runtime.require(&profile, "tasks", "write").is_ok());
    }
    #[tokio::test]
    async fn in_flight_work_stops_on_revocation_context_loss_or_profile_selection() {
        let temp = tempfile::tempdir().unwrap();
        let (_server, endpoint) = server(&temp, "ok");
        let profile = profile(&temp.path().join("client"), &account(&endpoint));
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        runtime.refresh(&profile).await.unwrap();
        let completed = std::sync::atomic::AtomicBool::new(false);
        let (result, ()) = tokio::join!(
            runtime.while_authorized(&profile, "travel", "ai", async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                completed.store(true, Ordering::Relaxed);
                Ok(())
            }),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                let mut policy = document();
                policy.modules.get_mut("travel").unwrap().ai = false;
                fs::write(
                    temp.path().join("document"),
                    serde_json::to_vec(&policy).unwrap(),
                )
                .unwrap();
                runtime.refresh(&profile).await.unwrap();
            }
        );
        assert!(result
            .unwrap_err()
            .contains("module_permission_denied:travel:ai"));
        assert!(!completed.load(Ordering::Relaxed));
        fs::write(
            temp.path().join("document"),
            serde_json::to_vec(&document()).unwrap(),
        )
        .unwrap();
        runtime.refresh(&profile).await.unwrap();
        let (result, ()) = tokio::join!(
            runtime.while_authorized(&profile, "travel", "ai", async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                completed.store(true, Ordering::Relaxed);
                Ok(())
            }),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                let mut policy = document();
                policy.modules.insert("people".into(), Actions::default());
                fs::write(
                    temp.path().join("document"),
                    serde_json::to_vec(&policy).unwrap(),
                )
                .unwrap();
                runtime.refresh(&profile).await.unwrap();
            }
        );
        assert!(result.unwrap_err().contains("资料权限已变化"));
        assert!(!completed.load(Ordering::Relaxed));
        assert!(runtime.require(&profile, "travel", "ai").is_ok());
        let (result, ()) = tokio::join!(
            runtime.while_authorized(&profile, "tasks", "write", async {
                tokio::time::sleep(Duration::from_secs(1)).await;
                completed.store(true, Ordering::Relaxed);
                Ok(())
            }),
            async {
                tokio::time::sleep(Duration::from_millis(50)).await;
                profile.select("local").unwrap();
            }
        );
        assert!(result.unwrap_err().contains("资料库即将切换"));
        assert!(!completed.load(Ordering::Relaxed));
        assert!(runtime.require(&profile, "tasks", "read").is_ok());
        profile.select(&profile.current_key).unwrap();
        assert_eq!(
            runtime
                .while_authorized(&profile, "tasks", "write", async { Ok("resumed") })
                .await
                .unwrap(),
            "resumed"
        );
    }

    #[tokio::test]
    async fn corrupt_cache_keeps_startup_available_without_enabling_legacy_downgrade() {
        let temp = tempfile::tempdir().unwrap();
        let (_server, endpoint) = server(&temp, "legacy");
        let profile = profile(&temp.path().join("client"), &account(&endpoint));
        let path = profile.data_dir.join("module-capabilities.json");
        fs::write(&path, "corrupt policy, business records unaffected").unwrap();
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        assert_eq!(runtime.status(&profile).unwrap().source, "limited");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "corrupt policy, business records unaffected"
        );
        assert_eq!(runtime.refresh(&profile).await.unwrap().source, "limited");
        assert!(runtime.require(&profile, "tasks", "write").is_err());
        fs::write(temp.path().join("mode"), "ok").unwrap();
        assert_eq!(runtime.refresh(&profile).await.unwrap().source, "verified");
    }

    #[tokio::test]
    async fn failed_policy_persistence_never_leaves_live_mutations_enabled() {
        let temp = tempfile::tempdir().unwrap();
        let (_server, endpoint) = server(&temp, "ok");
        let profile = profile(&temp.path().join("client"), &account(&endpoint));
        let runtime = CapabilityRuntime::open(&profile).unwrap();
        fs::create_dir(&runtime.path).unwrap(); // a real persistence failure, not a mocked serializer
        assert!(runtime.refresh(&profile).await.is_err());
        assert!(runtime.require(&profile, "tasks", "write").is_err());
        assert!(runtime.require(&profile, "goals", "ai").is_err());
    }

    #[tokio::test]
    async fn legacy_fallback_requires_identity_exact404_and_no_workspace_or_previous_policy() {
        let temp = tempfile::tempdir().unwrap();
        let (_server, endpoint) = server(&temp, "legacy");
        let mut account = account(&endpoint);
        let legacy_profile = profile(&temp.path().join("legacy"), &account);
        let runtime = CapabilityRuntime::open(&legacy_profile).unwrap();
        assert_eq!(
            runtime.refresh(&legacy_profile).await.unwrap().source,
            "legacy"
        );
        fs::write(temp.path().join("mode"), "wrong_identity").unwrap();
        runtime.refresh(&legacy_profile).await.unwrap();
        assert!(runtime.require(&legacy_profile, "tasks", "write").is_err());
        fs::write(temp.path().join("mode"), "bad404").unwrap();
        runtime.refresh(&legacy_profile).await.unwrap();
        assert!(runtime.require(&legacy_profile, "tasks", "write").is_err());
        fs::write(temp.path().join("mode"), "ok").unwrap();
        runtime.refresh(&legacy_profile).await.unwrap();
        fs::write(temp.path().join("mode"), "legacy").unwrap();
        runtime.refresh(&legacy_profile).await.unwrap();
        assert!(runtime.require(&legacy_profile, "tasks", "write").is_err());
        account.workspace = Some(WorkspaceBinding {
            version: 1,
            environment: "preview".into(),
            edition: "personal".into(),
            id: "00000000-0000-4000-8000-000000000010".into(),
            vault_id: "00000000-0000-4000-8000-000000000011".into(),
        });
        let bound = profile(&temp.path().join("bound"), &account);
        let bound_runtime = CapabilityRuntime::open(&bound).unwrap();
        assert_eq!(
            bound_runtime.refresh(&bound).await.unwrap().source,
            "limited"
        );
        fs::write(temp.path().join("mode"), "ok").unwrap();
        assert_eq!(
            bound_runtime.refresh(&bound).await.unwrap().source,
            "limited"
        ); // unbound response cannot authorize bound data
    }
}
