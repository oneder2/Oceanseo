//! Read-only, explicitly configured probes. No shell, SSH or cloud mutations.
use crate::credentials::CredentialCipher;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, time::Duration};

pub struct HostRuntime {
    pub path: PathBuf,
    pub cipher: CredentialCipher,
    pub gate: tokio::sync::Mutex<()>,
}
#[tauri::command]
pub async fn open_host_url(app: tauri::AppHandle, value: String) -> Result<(), String> {
    let parsed = reqwest::Url::parse(&value).map_err(|_| "网址无效")?;
    if value.len() > 2000
        || !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("只允许不含凭据的 HTTP(S) 网址".into());
    }
    #[cfg(target_os = "android")]
    {
        use tauri::Manager;
        app.state::<crate::mobile::MobileBridge>()
            .0
            .run_mobile_plugin::<Value>("openHostUrl", json!({"value":value}))
            .map(|_| ())
            .map_err(|_| "无法打开系统浏览器".into())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("xdg-open");
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut c = std::process::Command::new("rundll32");
            c.arg("url.dll,FileProtocolHandler");
            c
        };
        #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
        {
            let mut child = command
                .arg(value)
                .spawn()
                .map_err(|_| "无法打开系统浏览器")?;
            std::thread::spawn(move || {
                let _ = child.wait();
            });
            Ok(())
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
        {
            Err("当前平台不支持打开外部网址".into())
        }
    }
}
#[derive(Serialize, Deserialize, Clone)]
struct Credential {
    url: String,
    token: String,
}
impl HostRuntime {
    fn read(&self) -> Result<BTreeMap<String, Credential>, String> {
        match std::fs::read_to_string(&self.path) {
            Ok(raw) => serde_json::from_str(&self.cipher.decode(&raw)?)
                .map_err(|_| "采集凭据格式异常，原配置保留".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
            Err(_) => Err("无法读取采集凭据".into()),
        }
    }
    fn write(&self, values: &BTreeMap<String, Credential>) -> Result<(), String> {
        use std::io::Write;
        let raw = self
            .cipher
            .encode(&serde_json::to_string(values).map_err(|_| "凭据编码失败")?)?;
        let temp = self.path.with_extension("tmp");
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp).map_err(|_| "凭据无法保存")?;
        file.write_all(raw.as_bytes())
            .and_then(|_| file.sync_all())
            .map_err(|_| "凭据无法保存")?;
        std::fs::rename(temp, &self.path).map_err(|_| "凭据无法保存".into())
    }
}
fn endpoint(value: &str) -> Result<reqwest::Url, String> {
    let u = reqwest::Url::parse(value).map_err(|_| "请输入完整 HTTPS 地址")?;
    let local = matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if value.len() > 2000
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || !(u.scheme() == "https" || (u.scheme() == "http" && local))
        || u.host_str().is_none()
    {
        return Err(
            "探测地址须为 HTTPS，不得含用户名、密码、查询参数或片段；本机测试可用 HTTP".into(),
        );
    }
    Ok(u)
}
#[tauri::command]
pub async fn save_host_credential(
    host_id: String,
    url: String,
    token: String,
    runtime: tauri::State<'_, HostRuntime>,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&host_id).map_err(|_| "主机编号无效")?;
    let _guard = runtime.gate.lock().await;
    let mut values = runtime.read()?;
    if token.is_empty() {
        values.remove(&host_id);
    } else {
        endpoint(&url)?;
        if token.len() < 32
            || token.len() > 512
            || !token
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("使用 32–512 位随机字母数字令牌，可包含 - 和 _".into());
        }
        values.insert(host_id, Credential { url, token });
    }
    runtime.write(&values)
}
#[tauri::command]
pub async fn host_credential_configured(
    host_id: String,
    url: String,
    runtime: tauri::State<'_, HostRuntime>,
) -> Result<bool, String> {
    let _guard = runtime.gate.lock().await;
    Ok(runtime.read()?.get(&host_id).is_some_and(|c| c.url == url))
}
#[tauri::command]
pub async fn check_host_endpoint(
    host_id: String,
    url: String,
    source: String,
    runtime: tauri::State<'_, HostRuntime>,
) -> Result<Value, String> {
    let credential = if source == "collector" {
        let _guard = runtime.gate.lock().await;
        Some(
            runtime
                .read()?
                .get(&host_id)
                .filter(|c| c.url == url)
                .cloned()
                .ok_or("请先为此采集地址保存独立令牌")?,
        )
    } else if source == "http" {
        None
    } else {
        return Err("检查类型无效".into());
    };
    probe(&url, credential.as_ref().map(|c| c.token.as_str())).await
}
async fn probe(url: &str, token: Option<&str>) -> Result<Value, String> {
    let url = endpoint(url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法初始化检查")?;
    let mut request = client.get(url);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "连接失败：检查网络、地址、证书或超时")?;
    let status = response.status();
    if !status.is_success() {
        return Ok(
            json!({"ok":false,"detail":format!("HTTP {}{}",status.as_u16(),if status.is_redirection(){"（未跟随重定向，请填写最终地址）"}else{""})}),
        );
    }
    if token.is_none() {
        return Ok(
            json!({"ok":true,"detail":format!("HTTP {} · 本机可达，仅代表此端点",status.as_u16())}),
        );
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取采集数据失败")? {
        if bytes.len() + chunk.len() > 16384 {
            return Err("采集响应超过 16 KB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "采集端返回的不是有效 JSON")?;
    if !valid_metrics(&value) {
        return Err("采集端数据无效或超出范围".into());
    }
    // Project only numeric metrics and sample time, not arbitrary response fields.
    let metrics: serde_json::Map<String, Value> = [
        "sampledAt",
        "cpuPercent",
        "memoryPercent",
        "diskPercent",
        "uptimeSeconds",
        "networkRxBytes",
        "networkTxBytes",
    ]
    .into_iter()
    .map(|k| (k.to_owned(), value[k].clone()))
    .collect();
    Ok(
        json!({"ok":true,"detail":"只读采集成功；网络字节为启动后累计，不是账期用量","metrics":metrics}),
    )
}
fn text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| s.encode_utf16().count() <= max)
}
fn number(v: &Value, min: f64, max: f64) -> bool {
    v.as_f64()
        .is_some_and(|n| n.is_finite() && n >= min && n <= max)
}
fn date(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.is_empty()
            || (s.len() == 10
                && ("0100-01-01"..="9999-12-31").contains(&s)
                && chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                    .is_ok_and(|d| d.format("%Y-%m-%d").to_string() == s))
    })
}
fn stamp(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() <= 40 && chrono::DateTime::parse_from_rfc3339(s).is_ok())
}
fn strings(v: &Value, keys: &[&str]) -> bool {
    keys.iter().all(|k| text(&v[*k], 4000))
}
fn rows(v: &Value, max: usize, check: impl Fn(&Value) -> bool) -> bool {
    let mut ids = std::collections::HashSet::new();
    v.as_array().is_some_and(|a| {
        a.len() <= max
            && a.iter().all(|x| {
                x["id"]
                    .as_str()
                    .is_some_and(|s| !s.is_empty() && s.len() <= 80 && ids.insert(s))
                    && check(x)
            })
    })
}
fn url(v: &Value) -> bool {
    v == ""
        || v.as_str().is_some_and(|s| {
            s.len() <= 2000
                && reqwest::Url::parse(s).is_ok_and(|u| {
                    matches!(u.scheme(), "http" | "https")
                        && u.host_str().is_some()
                        && u.username().is_empty()
                        && u.password().is_none()
                })
        })
}
pub fn valid_metrics(v: &Value) -> bool {
    stamp(&v["sampledAt"])
        && ["cpuPercent", "memoryPercent", "diskPercent"]
            .iter()
            .all(|k| number(&v[*k], 0., 100.))
        && ["uptimeSeconds", "networkRxBytes", "networkTxBytes"]
            .iter()
            .all(|k| number(&v[*k], 0., 9_007_199_254_740_991.))
}
pub fn valid_document(v: &Value) -> bool {
    v["version"] == 1
        && rows(&v["hosts"], 100, |h| {
            strings(
                h,
                &[
                    "name",
                    "provider",
                    "plan",
                    "region",
                    "os",
                    "ipv4",
                    "ipv6",
                    "sshUser",
                    "credentialRef",
                    "project",
                    "purpose",
                    "source",
                    "orderId",
                    "constraints",
                    "backupLocation",
                    "backupSchedule",
                ],
            ) && text(&h["name"], 120)
                && h["name"].as_str().is_some_and(|s| !s.trim().is_empty())
                && [
                    "website",
                    "consoleUrl",
                    "supportUrl",
                    "monitorUrl",
                    "collectorUrl",
                ]
                .iter()
                .all(|k| url(&h[*k]))
                && [
                    "verifiedOn",
                    "purchasedOn",
                    "nextDue",
                    "trafficReset",
                    "backupLastSuccess",
                    "restoreTestedOn",
                ]
                .iter()
                .all(|k| date(&h[*k]))
                && [
                    "cpu",
                    "ramGb",
                    "diskGb",
                    "bandwidthMbps",
                    "trafficGb",
                    "snapshots",
                    "amount",
                    "renewalAmount",
                    "tax",
                    "trafficUsedGb",
                ]
                .iter()
                .all(|k| number(&h[*k], 0., 1e12))
                && h["sshPort"]
                    .as_u64()
                    .is_some_and(|n| (1..=65535).contains(&n))
                && h["cycleMonths"]
                    .as_u64()
                    .is_some_and(|n| (1..=120).contains(&n))
                && h["billingAnchor"].as_u64().is_some_and(|n| n <= 31)
                && number(&h["remindDays"], 0., 365.)
                && number(&h["backupDays"], 1., 365.)
                && (h["intervalMinutes"] == 0 || number(&h["intervalMinutes"], 5., 1440.))
                && ["cpuAlert", "memoryAlert", "diskAlert"]
                    .iter()
                    .all(|k| number(&h[*k], 1., 100.))
                && h["archived"].is_boolean()
                && h["autoRenew"].is_boolean()
                && h["environment"]
                    .as_str()
                    .is_some_and(|s| ["production", "test", "development"].contains(&s))
                && currency(&h["currency"])
                && rows(&h["services"], 100, |s| {
                    strings(
                        s,
                        &[
                            "name",
                            "project",
                            "port",
                            "directory",
                            "database",
                            "purpose",
                        ],
                    ) && text(&s["name"], 120)
                        && s["name"].as_str().is_some_and(|s| !s.trim().is_empty())
                        && url(&s["url"])
                })
                && rows(&h["deadlines"], 100, |d| {
                    text(&d["name"], 120)
                        && d["name"].as_str().is_some_and(|s| !s.trim().is_empty())
                        && d["date"] != ""
                        && date(&d["date"])
                        && d["done"].is_boolean()
                        && d["kind"].as_str().is_some_and(|s| {
                            ["domain", "certificate", "refund", "cancel", "other"].contains(&s)
                        })
                })
                && rows(&h["logs"], 300, |l| {
                    l["date"] != ""
                        && date(&l["date"])
                        && text(&l["kind"], 80)
                        && text(&l["text"], 4000)
                        && l["text"].as_str().is_some_and(|s| !s.trim().is_empty())
                })
                && rows(&h["payments"], 300, |p| {
                    p["date"] != ""
                        && p["coveredDue"] != ""
                        && date(&p["date"])
                        && date(&p["coveredDue"])
                        && number(&p["amount"], 0., 1e12)
                        && currency(&p["currency"])
                })
                && rows(&h["samples"], 120, |s| {
                    stamp(&s["checkedAt"])
                        && s["target"] != ""
                        && url(&s["target"])
                        && s["source"]
                            .as_str()
                            .is_some_and(|x| ["http", "collector"].contains(&x))
                        && s["ok"].is_boolean()
                        && text(&s["detail"], 500)
                        && number(&s["latencyMs"], 0., 60000.)
                        && (s.get("metrics").is_none() || valid_metrics(&s["metrics"]))
                })
        })
        && rows(&v["reports"], 30, valid_report)
}
fn currency(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() == 3 && s.bytes().all(|b| b.is_ascii_uppercase()))
}
pub fn valid_report(r: &Value) -> bool {
    stamp(&r["createdAt"])
        && text(&r["summary"], 4000)
        && r["summary"].as_str().is_some_and(|s| !s.trim().is_empty())
        && r["observations"]
            .as_array()
            .is_some_and(|a| a.len() <= 20 && a.iter().all(|s| text(s, 1000)))
        && r["suggestions"].as_array().is_some_and(|a| {
            a.len() <= 20
                && a.iter().all(|s| {
                    text(&s["title"], 200)
                        && s["title"].as_str().is_some_and(|s| !s.trim().is_empty())
                        && text(&s["reason"], 1500)
                        && text(&s["hostId"], 80)
                        && date(&s["dueDate"])
                })
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn collector_payload_projects_only_metrics_and_caps_body() {
        use std::io::{Read, Write};
        for large in [false, true] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let handle = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().unwrap();
                let mut buf = [0; 4096];
                let read = socket.read(&mut buf).unwrap();
                assert!(read > 0);
                let body = if large {
                    "x".repeat(16385)
                } else {
                    json!({"sampledAt":"2026-10-03T12:00:00Z","cpuPercent":25,"memoryPercent":30,"diskPercent":40,"uptimeSeconds":600,"networkRxBytes":100,"networkTxBytes":200,"secret":"do-not-return"}).to_string()
                };
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{}",
                    body.len(),
                    body
                )
                .unwrap();
            });
            let result = probe(&format!("http://{addr}/metrics"), Some("fixture-token")).await;
            if large {
                assert!(result.unwrap_err().contains("16 KB"));
            } else {
                let result = result.unwrap();
                assert_eq!(result["metrics"]["cpuPercent"], 25);
                assert!(!result.to_string().contains("secret"));
                assert_eq!(result["ok"], true);
            }
            handle.join().unwrap();
        }
    }
    #[test]
    fn credential_storage_survives_restart_and_is_private() {
        let temp = tempfile::TempDir::new().unwrap();
        let runtime = HostRuntime {
            path: temp.path().join("host-credentials.json"),
            cipher: CredentialCipher::plain(),
            gate: tokio::sync::Mutex::new(()),
        };
        let mut values = BTreeMap::new();
        values.insert(
            "test".into(),
            Credential {
                url: "https://metrics.example.com/metrics".into(),
                token: "synthetic-test-token-not-production".into(),
            },
        );
        runtime.write(&values).unwrap();
        assert_eq!(runtime.read().unwrap()["test"].url, values["test"].url);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&runtime.path)
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        runtime.write(&BTreeMap::new()).unwrap();
        assert!(runtime.read().unwrap().is_empty());
    }
    #[test]
    fn urls_do_not_leak_tokens_or_follow_insecure_destinations() {
        for u in [
            "http://example.com",
            "https://user:pass@example.com",
            "https://example.com/?key=abc",
            "file:///etc/passwd",
            "https://example.com/#fragment",
        ] {
            assert!(endpoint(u).is_err(), "{u}");
        }
        assert!(endpoint("http://127.0.0.1:4788/metrics").is_ok());
        assert!(endpoint("https://example.com/health").is_ok());
    }
    #[tokio::test]
    async fn real_probe_handles_auth_redirect_and_invalid_metrics() {
        use std::io::{Read, Write};
        for status in [200, 302, 401] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            let thread = std::thread::spawn(move || {
                let (mut s, _) = listener.accept().unwrap();
                s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
                let mut buf = [0; 4096];
                let n = s.read(&mut buf).unwrap();
                assert!(
                    String::from_utf8_lossy(&buf[..n]).contains("Bearer synthetic-collector-token")
                );
                write!(s,"HTTP/1.1 {status} Test\r\nContent-Length: 2\r\nLocation: http://127.0.0.1:1/\r\n\r\n{{}}").unwrap();
            });
            let result = probe(
                &format!("http://{addr}/metrics"),
                Some("synthetic-collector-token"),
            )
            .await;
            if status == 200 {
                assert!(result.is_err());
            } else {
                assert_eq!(result.unwrap()["ok"], false);
            }
            thread.join().unwrap();
        }
    }
}
