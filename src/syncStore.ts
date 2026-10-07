import { profileSessionStorage as sessionStorage } from "./profileStorage";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { flushAppData, withAppRestore } from "./appDataStore";

export interface SyncStatus {
  endpoint: string;
  configured: boolean;
  pending: number;
  lastSuccess: string | null;
  revision: number;
  linked: boolean;
  recoveryAvailable: boolean;
}
export interface SyncConflict {
  key: string;
  local: Record<string, unknown> | null;
  remote: Record<string, unknown> | null;
}
export interface SyncPlan {
  previewId: string;
  uploadCount: number;
  downloadCount: number;
  conflicts: SyncConflict[];
  firstConnection: boolean;
  changes: { key: string; title: string; upload: boolean; download: boolean; deleted: boolean }[];
}
export const syncStatus = () => invoke<SyncStatus>("get_sync_status");
export async function exportSyncRecovery() {
  const path = await save({ title: "导出同步前安全副本", defaultPath: `潮汐同步安全副本-${new Date().toISOString().slice(0,10)}.json`, filters: [{ name: "JSON 安全副本", extensions: ["json"] }] });
  if (!path) return false;
  const value = await invoke("export_sync_recovery");
  await writeTextFile(path, JSON.stringify(value, null, 2));
  return true;
}
export async function checkSync() {
  await flushAppData();
  return invoke<SyncPlan>("preview_sync");
}
export async function applySync(previewId: string, choices: Record<string, "local" | "remote">, onCommitted?: () => void) {
    const receipt = await withAppRestore(() => invoke<{ changed: boolean; revision: number; snapshotPath: string | null }>("commit_sync", { previewId, choices }));
    // Keep all local editor drafts. Only committed records are synchronized.
    // Restart state consumers as one unit, so old React state cannot overwrite
    // newly imported goal/task data. The persistence gate stays closed to reload.
    try { sessionStorage.setItem("tideplan.sync-receipt", JSON.stringify(receipt)); } catch { /* Receipt is also durable in SQLite. */ }
    onCommitted?.();
    window.location.reload();
    return receipt;
}
