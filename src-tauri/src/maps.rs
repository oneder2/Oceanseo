use crate::credentials::CredentialCipher;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::RwLock,
    time::Duration,
};

pub struct MapStore {
    path: PathBuf,
    cipher: CredentialCipher,
    key: RwLock<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapSummary {
    configured: bool,
    key_hint: Option<String>,
}
impl MapStore {
    #[cfg(test)]
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::open_with_cipher(path, CredentialCipher::plain())
    }
    pub fn open_with_cipher(path: &Path, cipher: CredentialCipher) -> Result<Self, String> {
        let key = if path.exists() {
            serde_json::from_str::<String>(
                &cipher.decode(&fs::read_to_string(path).map_err(|_| "地图配置读取失败")?)?,
            )
            .map_err(|_| "地图配置格式错误")?
        } else {
            String::new()
        };
        let store = Self {
            path: path.into(),
            cipher,
            key: RwLock::new(key),
        };
        #[cfg(target_os = "android")]
        if path.exists() {
            store.save(None, false)?;
        }
        Ok(store)
    }
    fn summary(&self) -> Result<MapSummary, String> {
        let key = self.key.read().map_err(|_| "地图配置正忙")?;
        Ok(MapSummary {
            configured: !key.is_empty(),
            key_hint: (!key.is_empty()).then(|| {
                format!(
                    "····{}",
                    key.chars()
                        .rev()
                        .take(4)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<String>()
                )
            }),
        })
    }
    fn save(&self, key: Option<String>, clear: bool) -> Result<MapSummary, String> {
        let mut stored = self.key.write().map_err(|_| "地图配置正忙")?;
        let next = if clear {
            String::new()
        } else {
            key.filter(|k| !k.trim().is_empty())
                .map(|k| k.trim().to_string())
                .unwrap_or_else(|| stored.clone())
        };
        if next.len() > 512 || next.chars().any(char::is_whitespace) {
            return Err("地图 Key 格式无效".into());
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| "无法创建地图配置目录")?;
        }
        let temporary = self.path.with_extension("tmp");
        let mut options = fs::OpenOptions::new();
        options.create(true).write(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);
        let mut file = options.open(&temporary).map_err(|_| "地图配置保存失败")?;
        #[cfg(unix)]
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|_| "地图配置权限设置失败")?;
        file.write_all(
            self.cipher
                .encode(&serde_json::to_string(&next).unwrap())?
                .as_bytes(),
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "地图配置保存失败")?;
        fs::rename(temporary, &self.path).map_err(|_| "地图配置保存失败")?;
        *stored = next;
        drop(stored);
        self.summary()
    }
    fn resolved(&self) -> Result<String, String> {
        let k = self.key.read().map_err(|_| "地图配置正忙")?.clone();
        if k.is_empty() {
            Err("请先在偏好设置中填写高德 Web 服务 Key".into())
        } else {
            Ok(k)
        }
    }
}
#[tauri::command]
pub fn get_map_settings(store: tauri::State<'_, MapStore>) -> Result<MapSummary, String> {
    store.summary()
}
#[tauri::command]
pub async fn save_map_settings(
    key: Option<String>,
    clear: bool,
    store: tauri::State<'_, MapStore>,
) -> Result<MapSummary, String> {
    store.save(key, clear)
}
async fn request(
    path: &str,
    params: Vec<(&str, String)>,
    store: &MapStore,
) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "地图服务初始化失败")?;
    let response = client
        .get(format!("https://restapi.amap.com/v3/{path}"))
        .query(&[("key", store.resolved()?)])
        .query(&params)
        .send()
        .await
        .map_err(|_| "地图服务连接失败或超时")?;
    if !response.status().is_success() {
        return Err("地图服务暂不可用".into());
    }
    let body: Value = response.json().await.map_err(|_| "地图返回格式异常")?;
    if body["status"] != "1" {
        return Err(format!(
            "地图查询失败（{}），请检查 Web 服务 Key、服务权限或配额",
            body["infocode"].as_str().unwrap_or("未知状态")
        ));
    }
    Ok(body)
}
#[derive(Serialize, Deserialize)]
pub struct Place {
    name: String,
    address: String,
    lng: f64,
    lat: f64,
}
fn coordinate(raw: &str) -> Option<(f64, f64)> {
    let (a, b) = raw.split_once(',')?;
    let (lng, lat) = (a.parse::<f64>().ok()?, b.parse::<f64>().ok()?);
    (lng.is_finite() && lat.is_finite() && lng.abs() <= 180. && lat.abs() <= 90.)
        .then_some((lng, lat))
}
#[tauri::command]
pub async fn search_places(
    query: String,
    city: String,
    store: tauri::State<'_, MapStore>,
) -> Result<Vec<Place>, String> {
    if query.trim().is_empty() || query.len() > 1000 || city.len() > 300 {
        return Err("请输入具体地点或地址".into());
    }
    let body = request(
        "place/text",
        vec![
            ("keywords", query.clone()),
            ("city", city),
            ("offset", "8".into()),
            ("extensions", "base".into()),
        ],
        &store,
    )
    .await?;
    let mut places = Vec::new();
    if let Some(pois) = body["pois"].as_array() {
        for p in pois {
            if let Some((lng, lat)) = p["location"].as_str().and_then(coordinate) {
                places.push(Place {
                    name: p["name"].as_str().unwrap_or(&query).into(),
                    address: format!(
                        "{}{}{}",
                        p["pname"].as_str().unwrap_or(""),
                        p["cityname"].as_str().unwrap_or(""),
                        p["address"].as_str().unwrap_or("")
                    ),
                    lng,
                    lat,
                });
            }
        }
    }
    if places.is_empty() {
        let geo = request("geocode/geo", vec![("address", query.clone())], &store).await?;
        if let Some(items) = geo["geocodes"].as_array() {
            for p in items {
                if let Some((lng, lat)) = p["location"].as_str().and_then(coordinate) {
                    places.push(Place {
                        name: query.clone(),
                        address: p["formatted_address"].as_str().unwrap_or("").into(),
                        lng,
                        lat,
                    });
                }
            }
        }
    }
    Ok(places)
}
#[tauri::command]
pub async fn plan_map_route(
    origin: [f64; 2],
    destination: [f64; 2],
    mode: String,
    store: tauri::State<'_, MapStore>,
) -> Result<Value, String> {
    for p in [origin, destination] {
        if !p[0].is_finite() || !p[1].is_finite() || p[0].abs() > 180. || p[1].abs() > 90. {
            return Err("地点坐标无效".into());
        }
    }
    let path = match mode.as_str() {
        "步行" => "direction/walking",
        "驾车" => "direction/driving",
        _ => return Err("地图路线目前支持步行或驾车；飞机、火车和公交请另行核实班次".into()),
    };
    let body = request(
        path,
        vec![
            ("origin", format!("{},{}", origin[0], origin[1])),
            (
                "destination",
                format!("{},{}", destination[0], destination[1]),
            ),
        ],
        &store,
    )
    .await?;
    let path = body["route"]["paths"]
        .as_array()
        .and_then(|p| p.first())
        .ok_or("未找到可行路线，请检查地点或交通方式")?;
    let mut points = Vec::new();
    if let Some(steps) = path["steps"].as_array() {
        for step in steps {
            if let Some(polyline) = step["polyline"].as_str() {
                for p in polyline.split(';') {
                    if let Some((lng, lat)) = coordinate(p) {
                        points.push([lng, lat]);
                    }
                }
            }
        }
    }
    if points.len() < 2 || points.len() > 50000 {
        return Err("路线几何数据无效或过大".into());
    }
    Ok(
        json!({"points":points,"distance":path["distance"].as_str().and_then(|s|s.parse::<f64>().ok()).unwrap_or(0.),"duration":path["duration"].as_str().and_then(|s|s.parse::<f64>().ok()).unwrap_or(0.)}),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn keys_are_private_and_clearable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("maps.json");
        let s = MapStore::open(&path).unwrap();
        s.save(Some("secret-map-key".into()), false).unwrap();
        assert!(!serde_json::to_string(&s.summary().unwrap())
            .unwrap()
            .contains("secret-map-key"));
        assert_eq!(
            MapStore::open(&path).unwrap().resolved().unwrap(),
            "secret-map-key"
        );
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        s.save(None, true).unwrap();
        assert!(s.resolved().is_err());
    }
    #[test]
    fn invalid_coordinates_rejected() {
        assert!(coordinate("NaN,12").is_none());
        assert!(coordinate("181,12").is_none());
        assert_eq!(coordinate("116.4,39.9"), Some((116.4, 39.9)));
    }
}
