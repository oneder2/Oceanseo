import { profileLocalStorage as localStorage, profileSessionStorage as sessionStorage } from "./profileStorage";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { APP_STATE_KEYS, flushAppData, hasUnimportedAppData, withAppRestore } from "./appDataStore";
import { OUTBOX_PREFIX } from "./reliableState";
import { personalEnabled } from "./personal/runtime";
import { legacyPersonalBackup } from "./personal/backup";
import { unimportedTaskPayload } from "./taskStore";

export interface DataBackup {
  personalWorkspaceVersion?: 1;
  personalBackup?: unknown;
  schemaVersion: string;
  createdAt: string;
  tasks: unknown[];
  appState: Record<string, unknown>;
}

export interface WorkArchive {
  workArchiveVersion: 1;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

// Separate from the ordinary restore format: exporting work history never
// starts a scan or modifies GWorkspace.
export async function exportWorkArchive(archive: WorkArchive) {
  const outputPath = await save({title: "导出工作观察历史", defaultPath: `Oceanseo-work-archive-${new Date().toISOString().slice(0,10)}.json`,
    filters: [{name:"JSON 工作历史", extensions:["json"]}]});
  if (!outputPath) return false;
  await writeTextFile(outputPath, `${JSON.stringify(archive,null,2)}\n`);
  return true;
}
// Remember only within this profile-bound process; make a just-exported file easy to find.
let lastBackupPath: string | undefined;

function isDataBackup(value: unknown): value is DataBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<DataBackup>;
  return (
    backup.schemaVersion === "1.0.0" &&
    typeof backup.createdAt === "string" &&
    Array.isArray(backup.tasks) &&
    Boolean(backup.appState) &&
    typeof backup.appState === "object"
  );
}

export async function exportDataBackup() {
  if (!isTauri()) return false;
  const outputPath = await save({
    title: "备份 Oceanseo 数据",
    defaultPath: `Oceanseo-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 备份", extensions: ["json"] }],
  });
  if (!outputPath) return false;
  let unsettled = false;
  try { await flushAppData(); } catch { unsettled = true; }
  const backup = await invoke<DataBackup>("export_data_backup");
  const pending: Record<string, string> = {};
  const legacy: Record<string, string> = {};
  if (hasUnimportedAppData()) for (const key of Object.values(APP_STATE_KEYS)) {
    const raw = localStorage.getItem(key);
    if (raw !== null) legacy[key] = raw;
  }
  const taskPayload = unimportedTaskPayload();
  if (taskPayload !== null) legacy["tideplan.tasks.v1"] = taskPayload;
  unsettled ||= Object.keys(legacy).length > 0;
  if (unsettled) for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && (key.startsWith(OUTBOX_PREFIX) || key.startsWith("tideplan.draft.") || key === "tideplan.goals.pending.v1")) pending[key] = localStorage.getItem(key)!;
  }
  const personalBackup = personalEnabled() ? await invoke<{ backup: DataBackup }>("export_personal_backup") : undefined;
  const completeBackup = personalBackup ? { ...backup, personalWorkspaceVersion: 1, personalBackup } : backup;
  const data = unsettled ? { localRecoveryVersion: 1, createdAt: new Date().toISOString(), backup: completeBackup, pending, legacy,
    notice: "数据库快照与未完成写入分别保留。不要覆盖原资料；待恢复权限后重试写入，或由支持人员协助核对恢复。" } : completeBackup;
  await writeTextFile(outputPath, `${JSON.stringify(data, null, 2)}\n`);
  lastBackupPath = outputPath;
  return unsettled ? "recovery" as const : "backup" as const;
}

export async function selectDataBackup() {
  if (!isTauri()) return null;
  const selectedPath = await open({
    title: "选择 Oceanseo / 潮汐计划备份",
    defaultPath: lastBackupPath,
    multiple: false,
    directory: false,
    filters: [{ name: "JSON 备份", extensions: ["json"] }],
  });
  if (!selectedPath || Array.isArray(selectedPath)) return null;
  const content = await readTextFile(selectedPath);
  const parsed = JSON.parse(content) as unknown;
  if (parsed && typeof parsed === "object" && "workArchiveVersion" in parsed) throw Error("这是只读工作历史导出，不能作为普通数据备份覆盖。");
  if (parsed && typeof parsed === "object" && "localRecoveryVersion" in parsed) throw Error("recovery_pending：这是包含未完成写入的恢复包，不能直接作为普通备份覆盖。请保留原资料，恢复权限后重试写入或联系支持。");
  if (parsed && typeof parsed === "object" && "syncRecoveryVersion" in parsed && parsed.syncRecoveryVersion === 1 && "backup" in parsed && isDataBackup(parsed.backup)) return parsed.backup;
  if (!isDataBackup(parsed)) throw new Error("backup_invalid");
  return parsed;
}

export async function restoreDataBackup(backup: DataBackup) {
  if (!isTauri()) throw new Error("backup_desktop_only");
  return withAppRestore(async () => {
    if (backup.personalWorkspaceVersion === 1 && !personalEnabled()) throw Error("工作区备份需要 Linux 个人版恢复");
    const clearPersonalRecovery = personalEnabled() ? localStorage.preparePersonalRestore() : undefined;
    const snapshotPath = personalEnabled()
      ? await invoke<string>("restore_personal_backup", { backup: backup.personalWorkspaceVersion === 1 ? backup.personalBackup : legacyPersonalBackup(backup) })
      : await invoke<string>("restore_data_backup", { backup });
    // The old UI must not enqueue writes between a successful restore and reload.
    try {
      clearPersonalRecovery?.();
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) {
        if (!key) continue;
        if (key.startsWith("tideplan.draft.") || (personalEnabled() && key.startsWith(OUTBOX_PREFIX))) localStorage.removeItem(key);
      }
      sessionStorage.setItem("tideplan.restore-snapshot", snapshotPath);
    } catch {
      /* Database restore succeeded; do not report a rolled-back restore. */
    }
    window.location.reload();
    return snapshotPath;
  });
}
