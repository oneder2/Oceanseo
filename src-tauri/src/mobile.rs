use serde::Deserialize;
use serde_json::json;
use tauri::{plugin::PluginHandle, Manager, Wry};

pub struct MobileBridge(pub PluginHandle<Wry>);

pub fn init() -> tauri::plugin::TauriPlugin<Wry> {
    tauri::plugin::Builder::new("tideplan-mobile")
        .setup(|app, api| {
            app.manage(MobileBridge(
                api.register_android_plugin("com.tideplan.mobile", "MobilePlugin")?,
            ));
            Ok(())
        })
        .build()
}

#[derive(Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderStatus {
    permission: bool,
    scheduled: bool,
    app_notifications: bool,
    channel_enabled: bool,
    battery_optimized: bool,
    power_save_mode: bool,
    next_times: Vec<i64>,
    time_zone: String,
    profile_key: String,
}

#[tauri::command]
pub async fn get_mobile_reminder_status(
    bridge: tauri::State<'_, MobileBridge>,
) -> Result<ReminderStatus, String> {
    bridge
        .0
        .run_mobile_plugin("reminderStatus", json!({}))
        .map_err(|_| "无法读取系统提醒状态，请重试。".into())
}

#[tauri::command]
pub async fn open_mobile_reminder_settings(
    bridge: tauri::State<'_, MobileBridge>,
    destination: String,
) -> Result<(), String> {
    if !matches!(
        destination.as_str(),
        "notifications" | "channel" | "battery"
    ) {
        return Err("不支持的系统设置入口。".into());
    }
    bridge
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "openReminderSettings",
            json!({ "destination": destination }),
        )
        .map(|_| ())
        .map_err(|_| "无法打开系统设置，请从 Android 设置中找到 Oceanseo。".into())
}

#[tauri::command]
pub async fn share_mobile_shopping_list(
    bridge: tauri::State<'_, MobileBridge>,
    format: String,
    content: String,
) -> Result<(), String> {
    if !matches!(format.as_str(), "csv" | "markdown")
        || content.is_empty()
        || content.len() > 2 * 1024 * 1024
    {
        return Err("不支持的分享格式或清单过大，请使用导出。".into());
    }
    bridge
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "shareShoppingList",
            json!({ "format": format, "content": content }),
        )
        .map(|_| ())
        .map_err(|_| "无法打开系统分享，请使用“导出到…”保存文件。".into())
}

#[tauri::command]
pub async fn configure_mobile_reminders(
    bridge: tauri::State<'_, MobileBridge>,
    profile: tauri::State<'_, crate::profiles::ProfileRuntime>,
    enabled: bool,
    times: Vec<String>,
    capabilities: tauri::State<'_, crate::capabilities::CapabilityRuntime>,
) -> Result<ReminderStatus, String> {
    let enabled = enabled && capabilities.require(&profile, "tasks", "write").is_ok();
    bridge
        .0
        .run_mobile_plugin(
            "configureReminders",
            json!({ "enabled": enabled, "times": times, "profileKey": profile.current_key }),
        )
        .map_err(|_| "无法安排系统提醒，请检查通知权限后重试。".into())
}
