//! A process is bound to one local profile. Selection takes effect on restart,
//! so requests already in flight can never write into the next user's database.
use crate::credentials::CredentialCipher;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const LOCAL: &str = "local";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountProfile {
    pub endpoint: String,
    pub user_id: String,
    pub username: String,
    pub vault_id: String,
    pub session_id: String,
    pub expires_at: i64,
    pub device_name: String,
    pub token: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub key: String,
    pub username: Option<String>,
    pub endpoint: Option<String>,
    pub session_id: Option<String>,
    pub expires_at: Option<i64>,
    pub signed_in: bool,
    pub active: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileStatus {
    pub current: ProfileSummary,
    pub selected_key: String,
    pub restart_required: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Selection {
    version: u8,
    key: String,
}

pub struct ProfileRuntime {
    root: PathBuf,
    pub current_key: String,
    pub data_dir: PathBuf,
    pub cipher: CredentialCipher,
    pub gate: tokio::sync::Mutex<()>,
    selection_gate: Mutex<()>,
}

pub fn profile_key(endpoint: &str, user_id: &str) -> Result<String, String> {
    let endpoint = crate::sync::normalize_endpoint(endpoint)?;
    let id = uuid::Uuid::parse_str(user_id).map_err(|_| "账号标识无效")?;
    Ok(format!("{:x}", Sha256::digest(format!("{endpoint}\n{id}"))))
}

fn valid_key(key: &str) -> bool {
    key == LOCAL
        || (key.len() == 64
            && key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
}

pub fn private_dir(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("资料目录不能是符号链接".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .map_err(|_| "无法创建私人资料目录")?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护私人资料目录")?;
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|_| "无法创建私人资料目录")?;
    Ok(())
}

pub fn write_private(path: &Path, raw: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("配置路径无效")?;
    let tmp = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&tmp).map_err(|_| "无法保存私人配置")?;
        file.write_all(raw)
            .and_then(|_| file.sync_all())
            .map_err(|_| "私人配置未能落盘")?;
        fs::rename(&tmp, path).map_err(|_| "无法替换私人配置")?;
        #[cfg(unix)]
        fs::File::open(parent)
            .and_then(|dir| dir.sync_all())
            .map_err(|_| "私人配置目录未能落盘")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(tmp);
    }
    result
}

impl AccountProfile {
    pub fn key(&self) -> Result<String, String> {
        profile_key(&self.endpoint, &self.user_id)
    }

    pub fn validate(&self) -> Result<(), String> {
        if crate::sync::normalize_endpoint(&self.endpoint)? != self.endpoint
            || uuid::Uuid::parse_str(&self.user_id)
                .map(|id| id.to_string())
                .ok()
                .as_deref()
                != Some(&self.user_id)
            || uuid::Uuid::parse_str(&self.vault_id).is_err()
            || uuid::Uuid::parse_str(&self.session_id).is_err()
            || self.expires_at <= 0
            || self.username.len() < 3
            || self.username.len() > 64
            || !self
                .username
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_.-".contains(&b))
            || !self.username.as_bytes()[0].is_ascii_alphanumeric()
            || self.device_name.trim().is_empty()
            || self.device_name.chars().count() > 80
            || self.device_name.chars().any(char::is_control)
            || (!self.token.is_empty()
                && (self.token.len() != 43
                    || !self
                        .token
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))))
        {
            return Err("账号资料或会话格式无效，原数据已保留".into());
        }
        Ok(())
    }

    fn summary(&self, active: bool) -> Result<ProfileSummary, String> {
        Ok(ProfileSummary {
            key: self.key()?,
            username: Some(self.username.clone()),
            endpoint: Some(self.endpoint.clone()),
            session_id: Some(self.session_id.clone()),
            expires_at: Some(self.expires_at),
            signed_in: !self.token.is_empty() && self.expires_at > chrono::Utc::now().timestamp(),
            active,
        })
    }
}

impl ProfileRuntime {
    pub fn open(root: &Path, cipher: CredentialCipher) -> Result<Self, String> {
        fs::create_dir_all(root).map_err(|_| "应用资料目录不可用")?;
        let current_key = Self::selected_at(root)?;
        let mut runtime = Self {
            root: root.to_path_buf(),
            current_key,
            data_dir: root.to_path_buf(),
            cipher,
            gate: tokio::sync::Mutex::new(()),
            selection_gate: Mutex::new(()),
        };
        if runtime.current_key != LOCAL {
            // Missing/corrupt credentials must not silently open another profile.
            runtime.read_account(&runtime.current_key)?;
            runtime.data_dir = runtime.directory(&runtime.current_key)?;
        }
        Ok(runtime)
    }

    fn selected_at(root: &Path) -> Result<String, String> {
        let path = root.join("profile-selection.json");
        match fs::read(path) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LOCAL.into()),
            Err(_) => Err("当前账号配置无法读取，未打开其他资料库".into()),
            Ok(bytes) => {
                let selected: Selection = serde_json::from_slice(&bytes)
                    .map_err(|_| "当前账号配置损坏，未打开其他资料库")?;
                if selected.version != 1 || !valid_key(&selected.key) {
                    return Err("当前账号配置无效".into());
                }
                Ok(selected.key)
            }
        }
    }

    fn directory(&self, key: &str) -> Result<PathBuf, String> {
        if !valid_key(key) || key == LOCAL {
            return Err("账号资料目录标识无效".into());
        }
        let parent = self.root.join("profiles");
        private_dir(&parent)?;
        let dir = parent.join(key);
        private_dir(&dir)?;
        Ok(dir)
    }

    pub fn read_account(&self, key: &str) -> Result<AccountProfile, String> {
        if !valid_key(key) || key == LOCAL {
            return Err("当前为本机离线资料库".into());
        }
        let parent = self.root.join("profiles");
        let directory = parent.join(key);
        for dir in [&parent, &directory] {
            if fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_symlink()) {
                return Err("账号目录不能是符号链接".into());
            }
        }
        let path = self
            .root
            .join("profiles")
            .join(key)
            .join("account-session.json");
        if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("会话配置不能是符号链接".into());
        }
        let raw = fs::read_to_string(path).map_err(|_| "账号会话无法读取，原资料仍保留")?;
        let account: AccountProfile =
            serde_json::from_str(&self.cipher.decode(&raw)?).map_err(|_| "账号会话格式无效")?;
        account.validate()?;
        if account.key()? != key {
            return Err("账号与本机资料库不匹配，已停止操作".into());
        }
        Ok(account)
    }

    pub fn save_account(&self, account: &AccountProfile) -> Result<ProfileSummary, String> {
        account.validate()?;
        let key = account.key()?;
        let dir = self.directory(&key)?;
        if dir.join("account-session.json").exists() {
            let old = self.read_account(&key)?;
            if old.vault_id != account.vault_id {
                return Err("账号云端资料库已更换，已停止连接；请联系维护者恢复原资料库".into());
            }
        }
        let raw = self
            .cipher
            .encode(&serde_json::to_string(account).map_err(|_| "账号配置无法编码")?)?;
        write_private(&dir.join("account-session.json"), raw.as_bytes())?;
        account.summary(self.current_key == key)
    }

    pub fn select(&self, key: &str) -> Result<ProfileStatus, String> {
        let _guard = self
            .selection_gate
            .lock()
            .map_err(|_| "账号选择状态不可用")?;
        if !valid_key(key) {
            return Err("账号标识无效".into());
        }
        if key != LOCAL {
            self.read_account(key)?;
        }
        let raw = serde_json::to_vec(&Selection {
            version: 1,
            key: key.into(),
        })
        .map_err(|_| "账号选择无法编码")?;
        write_private(&self.root.join("profile-selection.json"), &raw)?;
        self.status()
    }

    pub fn current_account(&self) -> Result<Option<AccountProfile>, String> {
        if self.current_key == LOCAL {
            Ok(None)
        } else {
            self.read_account(&self.current_key).map(Some)
        }
    }

    pub fn status(&self) -> Result<ProfileStatus, String> {
        let selected_key = Self::selected_at(&self.root)?;
        let current = if let Some(account) = self.current_account()? {
            account.summary(true)?
        } else {
            ProfileSummary {
                key: LOCAL.into(),
                username: None,
                endpoint: None,
                session_id: None,
                expires_at: None,
                signed_in: false,
                active: true,
            }
        };
        Ok(ProfileStatus {
            restart_required: selected_key != self.current_key,
            current,
            selected_key,
        })
    }

    pub fn list(&self) -> Result<Vec<ProfileSummary>, String> {
        let mut list = vec![ProfileSummary {
            key: LOCAL.into(),
            username: None,
            endpoint: None,
            session_id: None,
            expires_at: None,
            signed_in: false,
            active: self.current_key == LOCAL,
        }];
        let directory = self.root.join("profiles");
        if !directory.exists() {
            return Ok(list);
        }
        for entry in fs::read_dir(directory).map_err(|_| "账号列表不可用")? {
            let entry = entry.map_err(|_| "账号列表读取失败")?;
            let key = entry.file_name().to_string_lossy().into_owned();
            if !valid_key(&key) || key == LOCAL {
                continue;
            }
            if !entry.path().join("account-session.json").exists() {
                // An interrupted first login may leave a private empty directory.
                continue;
            }
            list.push(self.read_account(&key)?.summary(self.current_key == key)?);
        }
        list[1..].sort_by(|a, b| a.username.cmp(&b.username).then(a.key.cmp(&b.key)));
        Ok(list)
    }
}

#[tauri::command]
pub fn get_profile_status(
    runtime: tauri::State<'_, ProfileRuntime>,
) -> Result<ProfileStatus, String> {
    runtime.status()
}

#[tauri::command]
pub fn list_local_profiles(
    runtime: tauri::State<'_, ProfileRuntime>,
) -> Result<Vec<ProfileSummary>, String> {
    runtime.list()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{TaskMutation, TaskStore};

    fn account(id: &str) -> AccountProfile {
        AccountProfile {
            endpoint: "https://sync.example.com".into(),
            user_id: id.into(),
            username: "alice".into(),
            vault_id: "00000000-0000-4000-8000-000000000005".into(),
            session_id: "00000000-0000-4000-8000-000000000006".into(),
            expires_at: 4_000_000_000,
            device_name: "Synthetic device".into(),
            token: "a".repeat(43),
        }
    }
    fn runtime(root: &Path) -> ProfileRuntime {
        ProfileRuntime::open(root, CredentialCipher::plain()).unwrap()
    }
    fn create(store: &TaskStore, title: &str) {
        store
            .create(TaskMutation {
                title: title.into(),
                notes: "private".into(),
                horizon: "short".into(),
                priority: "normal".into(),
                start_date: None,
                due_date: None,
                origin: None,
            })
            .unwrap();
    }

    #[test]
    fn selection_binds_new_process_only_and_preserves_three_databases() {
        let tmp = tempfile::tempdir().unwrap();
        let local = runtime(tmp.path());
        assert_eq!(local.data_dir, tmp.path());
        let original = TaskStore::open(&local.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
        create(&original, "original offline data");
        let alice = account("00000000-0000-4000-8000-000000000001");
        let mut bob = account("00000000-0000-4000-8000-000000000002");
        bob.username = "bob".into();
        let a = local.save_account(&alice).unwrap();
        let b = local.save_account(&bob).unwrap();
        assert_eq!(local.list().unwrap().len(), 3);
        assert!(local.select(&a.key).unwrap().restart_required);
        assert_eq!(local.current_key, LOCAL);
        // A delayed request from the old process still writes only to its own database.
        create(&original, "late offline request");
        let ar = runtime(tmp.path());
        let astore = TaskStore::open(&ar.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
        assert!(astore.list().unwrap().is_empty());
        create(&astore, "alice only");
        assert!(ar.select(&b.key).unwrap().restart_required);
        create(&astore, "late alice request");
        let br = runtime(tmp.path());
        let bstore = TaskStore::open(&br.data_dir.join("oceanseo-tasks.sqlite3")).unwrap();
        assert!(bstore.list().unwrap().is_empty());
        create(&bstore, "bob only");
        br.select(&a.key).unwrap();
        let a_again = runtime(tmp.path());
        assert_eq!(
            TaskStore::open(&a_again.data_dir.join("oceanseo-tasks.sqlite3"))
                .unwrap()
                .list()
                .unwrap()
                .len(),
            2
        );
        a_again.select(LOCAL).unwrap();
        assert_eq!(runtime(tmp.path()).data_dir, tmp.path());
        assert_eq!(original.list().unwrap().len(), 2);
        assert!(original.sync_snapshot().unwrap().1.vault_id.is_empty());
        assert!(astore.sync_snapshot().unwrap().1.vault_id.is_empty());
    }

    #[test]
    fn identity_is_server_and_user_not_username_and_secrets_never_leave_summary() {
        let tmp = tempfile::tempdir().unwrap();
        let rt = runtime(tmp.path());
        let alice = account("00000000-0000-4000-8000-000000000001");
        let mut other = alice.clone();
        other.endpoint = "https://other.example.com".into();
        assert_ne!(alice.key().unwrap(), other.key().unwrap());
        let summary = rt.save_account(&alice).unwrap();
        let raw = serde_json::to_string(&summary).unwrap();
        assert!(!raw.contains(&alice.token));
        assert!(!raw.contains("vaultId"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir = rt.directory(&summary.key).unwrap();
            assert_eq!(
                fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(dir.join("account-session.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn invalid_selection_and_vault_change_fail_closed() {
        let tmp = tempfile::tempdir().unwrap();
        let rt = runtime(tmp.path());
        assert!(rt.select("../local").is_err());
        assert!(rt.select(&"a".repeat(64)).is_err());
        let mut alice = account("00000000-0000-4000-8000-000000000001");
        let summary = rt.save_account(&alice).unwrap();
        alice.vault_id = uuid::Uuid::new_v4().to_string();
        assert!(rt.save_account(&alice).is_err());
        rt.select(&summary.key).unwrap();
        fs::write(tmp.path().join("profile-selection.json"), b"invalid").unwrap();
        assert!(ProfileRuntime::open(tmp.path(), CredentialCipher::plain()).is_err());
        assert_eq!(rt.current_key, LOCAL);
    }

    #[test]
    fn expired_or_signed_out_account_keeps_offline_database_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let rt = runtime(tmp.path());
        let mut alice = account("00000000-0000-4000-8000-000000000001");
        let summary = rt.save_account(&alice).unwrap();
        rt.select(&summary.key).unwrap();
        alice.token.clear();
        alice.expires_at = 1;
        rt.save_account(&alice).unwrap();
        let reopened = runtime(tmp.path());
        assert_eq!(reopened.current_key, summary.key);
        assert!(!reopened.status().unwrap().current.signed_in);
        assert_ne!(reopened.data_dir, tmp.path());
    }
}
