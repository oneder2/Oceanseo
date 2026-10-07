use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Manager;
#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

mod accounts;
mod ai_settings;
mod assistant;
mod backup_validation;
mod bead_ai;
mod credentials;
mod deep_links;
#[cfg(target_os = "linux")]
mod desktop_launch;
mod goals;
mod infrastructure;
mod maps;
#[cfg(target_os = "android")]
mod mobile;
mod planning;
mod profiles;
mod sync;
mod tasks;
#[cfg(desktop)]
mod work_monitor;

#[tauri::command]
fn get_runtime_platform() -> &'static str {
    std::env::consts::OS
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MealPreferences {
    people: u8,
    dietary_preference: String,
    allergies: String,
    budget: u32,
    health_goal: String,
    #[serde(default)]
    planning_context: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meal {
    name: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MealDay {
    day_index: u8,
    weekday: String,
    breakfast: Meal,
    lunch: Meal,
    dinner: Meal,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShoppingItem {
    name: String,
    amount: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShoppingCategory {
    category: String,
    items: Vec<ShoppingItem>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MealPlan {
    plan_title: String,
    week_summary: String,
    days: Vec<MealDay>,
    shopping_list: Vec<ShoppingCategory>,
}

fn meal_plan_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "planTitle": { "type": "string" },
            "weekSummary": { "type": "string" },
            "days": {
                "type": "array",
                "minItems": 7,
                "maxItems": 7,
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "dayIndex": { "type": "integer", "minimum": 1, "maximum": 7 },
                        "weekday": { "type": "string" },
                        "breakfast": { "$ref": "#/$defs/meal" },
                        "lunch": { "$ref": "#/$defs/meal" },
                        "dinner": { "$ref": "#/$defs/meal" }
                    },
                    "required": ["dayIndex", "weekday", "breakfast", "lunch", "dinner"]
                }
            },
            "shoppingList": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "category": { "type": "string" },
                        "items": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "name": { "type": "string" },
                                    "amount": { "type": "string" }
                                },
                                "required": ["name", "amount"]
                            }
                        }
                    },
                    "required": ["category", "items"]
                }
            }
        },
        "required": ["planTitle", "weekSummary", "days", "shoppingList"],
        "$defs": {
            "meal": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                    "name": { "type": "string" },
                    "note": { "type": "string" }
                },
                "required": ["name", "note"]
            }
        }
    })
}

fn extract_output_text(response: &Value) -> Option<&str> {
    response
        .get("output")?
        .as_array()?
        .iter()
        .filter_map(|item| item.get("content")?.as_array())
        .flatten()
        .find(|content| content.get("type").and_then(Value::as_str) == Some("output_text"))?
        .get("text")?
        .as_str()
}

#[tauri::command]
async fn generate_meal_plan(
    preferences: MealPreferences,
    ai_settings: tauri::State<'_, ai_settings::AiSettingsStore>,
) -> Result<MealPlan, String> {
    let ai = ai_settings.resolve()?;
    if !(1..=12).contains(&preferences.people) {
        return Err("用餐人数需要在 1 到 12 人之间。".into());
    }
    if !(1..=1_000_000).contains(&preferences.budget) {
        return Err("每周预算需要在 1 到 1000000 元之间。".into());
    }

    let planning_context = if preferences.planning_context.trim().is_empty() {
        "未来一周没有额外日程约束。".to_string()
    } else {
        format!(
            "未来一周日程参考：\n{}",
            preferences.planning_context.trim()
        )
    };
    let user_prompt = format!(
        "请制定适合未来一周的三餐计划，并据此汇总一次性采购清单。\n\
        用餐人数：{} 人\n饮食偏好：{}\n过敏或忌口：{}\n每周预算：{} 元\n营养目标：{}\n\
        {}\n\
        要求：使用中国家庭容易采购的食材；数量按人数估算；三餐尽量不重复；采购清单合并相同食材；忙碌日期优先安排简单餐食；只使用简体中文。",
        preferences.people,
        preferences.dietary_preference.trim(),
        preferences.allergies.trim(),
        preferences.budget,
        preferences.health_goal.trim(),
        planning_context,
    );

    let request_body = json!({
        "model": ai.model,
        "store": false,
        "input": [
            {
                "role": "system",
                "content": "你是一位务实的家庭营养与采购规划助手。计划必须可执行、营养均衡，并严格遵守用户的过敏和忌口要求。"
            },
            { "role": "user", "content": user_prompt }
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "weekly_meal_plan",
                "schema": meal_plan_schema(),
                "strict": true
            }
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|_| "无法初始化网络请求，请重启应用后重试。".to_string())?;
    let response = client
        .post(ai.responses_url)
        .bearer_auth(&ai.api_key)
        .json(&request_body)
        .send()
        .await
        .map_err(|_| "无法连接 AI 服务，请检查网络和 BASE_URL 后重试。".to_string())?;

    let status = response.status();
    let response_json: Value = response
        .json()
        .await
        .map_err(|_| "AI 服务返回了无法读取的响应，请稍后重试。".to_string())?;

    if !status.is_success() {
        let message = match status.as_u16() {
            401 => "API 密钥无效或已失效。",
            429 => "请求过于频繁或账户额度不足，请稍后重试。",
            400..=499 => "请求未被 AI 服务接受，请检查账户和模型权限。",
            _ => "AI 服务暂时不可用，请稍后重试。",
        };
        return Err(message.into());
    }

    let output_text = extract_output_text(&response_json)
        .ok_or_else(|| "本次没有生成可用食谱，请重新生成。".to_string())?;
    let plan: MealPlan = serde_json::from_str(output_text)
        .map_err(|_| "生成的食谱格式不完整，请重新生成。".to_string())?;

    if plan.days.len() != 7 {
        return Err("生成结果未覆盖完整七天，请重新生成。".into());
    }

    Ok(plan)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    desktop_launch::sanitize_inherited_appimage();
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(url) = deep_links::deep_link_argument(&args) {
                deep_links::receive_url(app, url);
            } else if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build());
    builder
        .manage(deep_links::DeepLinkQueue::default())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            get_runtime_platform,
            profiles::get_profile_status,
            profiles::list_local_profiles,
            accounts::sign_in_account,
            accounts::select_local_profile,
            accounts::restart_selected_profile,
            accounts::check_account_session,
            accounts::list_account_sessions,
            accounts::revoke_account_session,
            accounts::logout_account,
            accounts::change_account_password,
            accounts::delete_account,
            sync::get_sync_status,
            infrastructure::check_host_endpoint,
            infrastructure::open_host_url,
            infrastructure::save_host_credential,
            infrastructure::host_credential_configured,
            sync::save_sync_config,
            sync::preview_sync,
            sync::commit_sync,
            sync::discard_sync_preview,
            sync::automatic::get_automatic_sync_settings,
            sync::automatic::set_automatic_sync_enabled,
            sync::automatic::preview_automatic_sync,
            sync::automatic::commit_automatic_sync,
            sync::disconnect_sync,
            sync::export_sync_recovery,
            #[cfg(target_os = "android")]
            mobile::configure_mobile_reminders,
            #[cfg(target_os = "android")]
            mobile::get_mobile_reminder_status,
            #[cfg(target_os = "android")]
            mobile::open_mobile_reminder_settings,
            #[cfg(target_os = "android")]
            mobile::share_mobile_shopping_list,
            bead_ai::analyze_bead_image,
            bead_ai::generate_bead_image,
            generate_meal_plan,
            planning::run_planning_agent,
            assistant::run_assistant,
            assistant::cancel_assistant,
            goals::get_goal_state,
            goals::commit_goal_changes,
            maps::get_map_settings,
            maps::save_map_settings,
            maps::search_places,
            maps::plan_map_route,
            ai_settings::get_ai_settings,
            ai_settings::save_ai_settings,
            ai_settings::test_ai_connection,
            tasks::list_tasks,
            tasks::get_task,
            tasks::create_task,
            tasks::update_task,
            tasks::set_task_completed,
            tasks::delete_task,
            tasks::migrate_legacy_tasks,
            tasks::bootstrap_app_state,
            tasks::set_app_state,
            tasks::export_data_backup,
            tasks::restore_data_backup,
            deep_links::take_pending_deep_links,
            #[cfg(desktop)]
            work_monitor::get_work_dashboard,
            #[cfg(desktop)]
            work_monitor::save_work_monitor_config,
            #[cfg(desktop)]
            work_monitor::scan_workspaces,
            #[cfg(desktop)]
            work_monitor::run_scheduled_work_scan,
            #[cfg(desktop)]
            work_monitor::generate_work_report,
            #[cfg(desktop)]
            work_monitor::get_gworkspace_catalog,
            #[cfg(desktop)]
            work_monitor::set_work_project_mapping,
            #[cfg(desktop)]
            work_monitor::reject_work_draft,
            #[cfg(desktop)]
            work_monitor::sync_work_draft,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            let credential_cipher = credentials::CredentialCipher::new(app.handle());
            let profile = profiles::ProfileRuntime::open(&app_data_dir, credential_cipher.clone())
                .map_err(std::io::Error::other)?;
            let profile_data_dir = profile.data_dir.clone();
            let account_key =
                (profile.current_key != profiles::LOCAL).then(|| profile.current_key.clone());
            app.manage(profile);
            app.manage(infrastructure::HostRuntime {
                path: profile_data_dir.join("host-credentials.json"),
                cipher: credential_cipher.clone(),
                gate: tokio::sync::Mutex::new(()),
            });
            app.manage(sync::SyncRuntime {
                path: profile_data_dir.join(if account_key.is_some() {
                    "account-session.json"
                } else {
                    "sync-settings.json"
                }),
                account_key,
                cipher: credential_cipher.clone(),
                gate: tokio::sync::Mutex::new(()),
                preview: std::sync::Mutex::new(None),
                automatic_preview: std::sync::Mutex::new(None),
            });
            let ai_settings_store = ai_settings::AiSettingsStore::open_with_cipher(
                &profile_data_dir.join("ai-settings.json"),
                credential_cipher.clone(),
            )
            .map_err(std::io::Error::other)?;
            app.manage(ai_settings_store);
            app.manage(assistant::AssistantRuntime::default());
            app.manage(
                maps::MapStore::open_with_cipher(
                    &profile_data_dir.join("map-settings.json"),
                    credential_cipher,
                )
                .map_err(std::io::Error::other)?,
            );
            let task_store =
                tasks::TaskStore::open(&profile_data_dir.join("oceanseo-tasks.sqlite3"))
                    .map_err(std::io::Error::other)?;
            app.manage(task_store);
            #[cfg(desktop)]
            {
                let work_monitor_store = work_monitor::WorkMonitorStore::open(
                    &profile_data_dir.join("oceanseo-work-monitor.sqlite3"),
                    profile_data_dir.join("work-monitor-exports"),
                )
                .map_err(std::io::Error::other)?;
                app.manage(work_monitor_store);
            }

            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    deep_links::receive_url(&app_handle, url.as_str());
                }
            });
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    deep_links::receive_url(app.handle(), url.as_str());
                }
            }
            #[cfg(desktop)]
            {
                let _ = app.deep_link().register_all();
            }

            #[cfg(desktop)]
            {
                let open_item =
                    MenuItem::with_id(app, "open", "打开 Oceanseo", true, None::<&str>)?;
                let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().expect("missing app icon").clone())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            if let Some(window) = tray.app_handle().get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                if let Some(window) = app.get_webview_window("main") {
                    let window_to_hide = window.clone();
                    window.on_window_event(move |event| {
                        if let WindowEvent::CloseRequested { api, .. } = event {
                            api.prevent_close();
                            let _ = window_to_hide.hide();
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tideplan");
}
