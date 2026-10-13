//! This repository builds the open-source personal application only.

#[tauri::command]
pub fn get_runtime_edition() -> &'static str {
    "personal"
}

#[tauri::command]
pub fn get_runtime_release_channel() -> &'static str {
    "live"
}
