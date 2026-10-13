import { invoke as nativeInvoke } from "@tauri-apps/api/core";
import { personalScope } from "./runtime";
export { isTauri } from "@tauri-apps/api/core";

// Capture before dispatch: a response must never be routed using the workspace
// selected after a request started. Unscoped products keep their existing IPC.
const scoped = new Set([
  "get_map_settings", "save_map_settings", "search_places", "plan_map_route",
  "create_task", "update_task",
  "export_data_backup",
  "bootstrap_app_state", "set_app_state", "get_goal_state", "commit_goal_changes",
  "get_work_dashboard", "export_work_archive", "save_work_monitor_config", "scan_workspaces",
  "run_scheduled_work_scan", "generate_work_report", "get_gworkspace_catalog",
  "set_work_project_mapping", "reject_work_draft", "sync_work_draft",
  "preview_bead_lifecycle", "commit_bead_lifecycle", "export_bead_transfer",
  "preview_bead_transfer", "commit_bead_transfer",
  "save_host_credential", "host_credential_configured", "check_host_endpoint",
]);
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const scope = personalScope();
  return nativeInvoke<T>(command, scope && scoped.has(command) && !(command === "set_app_state" && args?.key === "tideplan.reminders.v1") ? { ...args, personalScope: scope } : args);
}
