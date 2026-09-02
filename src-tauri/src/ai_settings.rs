use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::RwLock,
};
use url::Url;

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsSummary {
    pub base_url: String,
    pub api_key_configured: bool,
    pub api_key_hint: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedAiSettings {
    pub api_key: String,
    pub responses_url: Url,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAiSettings {
    api_key: String,
    base_url: String,
}

impl Default for StoredAiSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }
}

pub struct AiSettingsStore {
    path: PathBuf,
    settings: RwLock<StoredAiSettings>,
}

impl AiSettingsStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        let settings = if path.exists() {
            let raw = fs::read_to_string(path).map_err(|_| "ai_settings_read_failed")?;
            let mut stored: StoredAiSettings =
                serde_json::from_str(&raw).map_err(|_| "ai_settings_invalid")?;
            stored.base_url = normalize_base_url(&stored.base_url)?;
            stored
        } else {
            StoredAiSettings::default()
        };
        Ok(Self {
            path: path.to_path_buf(),
            settings: RwLock::new(settings),
        })
    }

    pub fn summary(&self) -> Result<AiSettingsSummary, String> {
        let settings = self
            .settings
            .read()
            .map_err(|_| "ai_settings_lock_failed")?;
        Ok(summary_for(&settings))
    }

    pub fn save(
        &self,
        api_key: Option<String>,
        base_url: String,
        clear_api_key: bool,
    ) -> Result<AiSettingsSummary, String> {
        let base_url = normalize_base_url(&base_url)?;
        let mut settings = self
            .settings
            .write()
            .map_err(|_| "ai_settings_lock_failed")?;

        if clear_api_key {
            settings.api_key.clear();
        } else if let Some(api_key) = api_key {
            let api_key = api_key.trim();
            if !api_key.is_empty() {
                validate_api_key(api_key)?;
                settings.api_key = api_key.to_string();
            }
        }
        settings.base_url = base_url;
        persist_settings(&self.path, &settings)?;
        Ok(summary_for(&settings))
    }

    pub fn resolve(&self) -> Result<ResolvedAiSettings, String> {
        let settings = self
            .settings
            .read()
            .map_err(|_| "ai_settings_lock_failed")?;
        validate_api_key(&settings.api_key)?;
        Ok(ResolvedAiSettings {
            api_key: settings.api_key.clone(),
            responses_url: responses_url(&settings.base_url)?,
        })
    }
}

fn validate_api_key(api_key: &str) -> Result<(), String> {
    let length = api_key.trim().len();
    if length == 0 {
        return Err("ai_settings_missing".to_string());
    }
    if length > 4096 || api_key.chars().any(char::is_whitespace) {
        return Err("openai_api_key_invalid".to_string());
    }
    Ok(())
}

pub fn normalize_base_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    let parsed = Url::parse(value).map_err(|_| "ai_base_url_invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("ai_base_url_invalid".to_string());
    }

    let normalized = parsed.as_str().trim_end_matches('/').to_string();
    if normalized.is_empty() {
        return Err("ai_base_url_invalid".to_string());
    }
    Ok(normalized)
}

pub fn responses_url(base_url: &str) -> Result<Url, String> {
    let base_url = normalize_base_url(base_url)?;
    let endpoint = if base_url.ends_with("/responses") {
        base_url
    } else {
        format!("{base_url}/responses")
    };
    Url::parse(&endpoint).map_err(|_| "ai_base_url_invalid".to_string())
}

fn summary_for(settings: &StoredAiSettings) -> AiSettingsSummary {
    let api_key = settings.api_key.trim();
    let api_key_hint = if api_key.is_empty() {
        None
    } else {
        let suffix: String = api_key
            .chars()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        Some(format!("····{suffix}"))
    };
    AiSettingsSummary {
        base_url: settings.base_url.clone(),
        api_key_configured: !api_key.is_empty(),
        api_key_hint,
    }
}

fn persist_settings(path: &Path, settings: &StoredAiSettings) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "ai_settings_write_failed")?;
    }
    let temporary_path = path.with_extension("json.tmp");
    let serialized = serde_json::to_vec(settings).map_err(|_| "ai_settings_write_failed")?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options
        .open(&temporary_path)
        .map_err(|_| "ai_settings_write_failed")?;
    file.write_all(&serialized)
        .and_then(|_| file.sync_all())
        .map_err(|_| "ai_settings_write_failed")?;
    #[cfg(unix)]
    fs::set_permissions(&temporary_path, fs::Permissions::from_mode(0o600))
        .map_err(|_| "ai_settings_write_failed")?;
    fs::rename(&temporary_path, path).map_err(|_| "ai_settings_write_failed")?;
    Ok(())
}

#[tauri::command]
pub fn get_ai_settings(
    store: tauri::State<'_, AiSettingsStore>,
) -> Result<AiSettingsSummary, String> {
    store.summary()
}

#[tauri::command]
pub fn save_ai_settings(
    api_key: Option<String>,
    base_url: String,
    clear_api_key: bool,
    store: tauri::State<'_, AiSettingsStore>,
) -> Result<AiSettingsSummary, String> {
    store.save(api_key, base_url, clear_api_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_base_urls_and_builds_responses_endpoint() {
        assert_eq!(
            normalize_base_url(" https://api.openai.com/v1/ ").unwrap(),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            responses_url("https://example.com/openai/v1")
                .unwrap()
                .as_str(),
            "https://example.com/openai/v1/responses"
        );
        assert_eq!(
            responses_url("https://example.com/v1/responses")
                .unwrap()
                .as_str(),
            "https://example.com/v1/responses"
        );
    }

    #[test]
    fn rejects_unsafe_base_urls() {
        for value in [
            "ftp://example.com/v1",
            "https://user:pass@example.com/v1",
            "https://example.com/v1?key=secret",
            "not-a-url",
        ] {
            assert_eq!(normalize_base_url(value), Err("ai_base_url_invalid".into()));
        }
    }

    #[test]
    fn accepts_compatible_provider_keys_without_sk_prefix() {
        assert!(validate_api_key("compatible-provider-key").is_ok());
        assert!(validate_api_key("").is_err());
        assert!(validate_api_key("contains whitespace").is_err());
    }

    #[test]
    fn public_summary_never_serializes_the_api_key() {
        let stored = StoredAiSettings {
            api_key: "very-secret-provider-key".into(),
            base_url: DEFAULT_BASE_URL.into(),
        };
        let serialized = serde_json::to_string(&summary_for(&stored)).unwrap();
        assert!(!serialized.contains("very-secret-provider-key"));
        assert!(serialized.contains("-key"));
    }

    #[test]
    fn persists_and_reloads_shared_settings() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ai-settings.json");
        let store = AiSettingsStore::open(&path).unwrap();
        let summary = store
            .save(
                Some("compatible-provider-key".into()),
                "https://example.com/openai/v1/".into(),
                false,
            )
            .unwrap();
        assert!(summary.api_key_configured);
        assert_eq!(summary.base_url, "https://example.com/openai/v1");

        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        let reloaded = AiSettingsStore::open(&path).unwrap().resolve().unwrap();
        assert_eq!(reloaded.api_key, "compatible-provider-key");
        assert_eq!(
            reloaded.responses_url.as_str(),
            "https://example.com/openai/v1/responses"
        );
    }
}
