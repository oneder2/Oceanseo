/// Keep existing desktop credential files compatible. Android credentials are
/// encrypted with a non-exportable Android Keystore key before touching disk.
#[derive(Clone)]
pub struct CredentialCipher {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<tauri::Wry>,
}

impl CredentialCipher {
    pub fn new(_app: &tauri::AppHandle) -> Self {
        #[cfg(target_os = "android")]
        {
            use tauri::Manager;
            Self {
                handle: _app.state::<crate::mobile::MobileBridge>().0.clone(),
            }
        }
        #[cfg(not(target_os = "android"))]
        Self {}
    }

    #[cfg(all(test, not(target_os = "android")))]
    pub fn plain() -> Self {
        Self {}
    }

    pub fn encode(&self, text: &str) -> Result<String, String> {
        #[cfg(target_os = "android")]
        {
            self.call("encryptCredential", text)
        }
        #[cfg(not(target_os = "android"))]
        Ok(text.into())
    }

    pub fn decode(&self, text: &str) -> Result<String, String> {
        #[cfg(target_os = "android")]
        {
            if text.starts_with("tideplan-keystore-v1:") {
                return self.call("decryptCredential", text);
            }
        }
        // Existing plaintext is migrated on open, after successful decoding.
        Ok(text.into())
    }

    #[cfg(target_os = "android")]
    fn call(&self, command: &str, text: &str) -> Result<String, String> {
        #[derive(serde::Deserialize)]
        struct Response {
            value: String,
        }
        self.handle
            .run_mobile_plugin::<Response>(command, serde_json::json!({ "value": text }))
            .map(|v| v.value)
            .map_err(|_| "无法访问设备安全存储；原配置已保留，请解锁设备后重试。".into())
    }
}
