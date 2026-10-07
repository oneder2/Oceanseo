import { profileLocalStorage as localStorage, profileSessionStorage as sessionStorage } from "./profileStorage";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { flushAppData, withAppRestore } from "./appDataStore";

export interface DataBackup {
  schemaVersion: string;
  createdAt: string;
  tasks: unknown[];
  appState: Record<string, unknown>;
}

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
  await flushAppData();
  const backup = await invoke<DataBackup>("export_data_backup");
  await writeTextFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`);
  return true;
}

export async function selectDataBackup() {
  if (!isTauri()) return null;
  const selectedPath = await open({
    title: "选择 Oceanseo / 潮汐计划备份",
    multiple: false,
    directory: false,
    filters: [{ name: "JSON 备份", extensions: ["json"] }],
  });
  if (!selectedPath || Array.isArray(selectedPath)) return null;
  const content = await readTextFile(selectedPath);
  const parsed = JSON.parse(content) as unknown;
  if (parsed && typeof parsed === "object" && "syncRecoveryVersion" in parsed && parsed.syncRecoveryVersion === 1 && "backup" in parsed && isDataBackup(parsed.backup)) return parsed.backup;
  if (!isDataBackup(parsed)) throw new Error("backup_invalid");
  return parsed;
}

export async function restoreDataBackup(backup: DataBackup) {
  if (!isTauri()) throw new Error("backup_desktop_only");
  return withAppRestore(async () => {
    const snapshotPath = await invoke<string>("restore_data_backup", {
      backup,
    });
    // The old UI must not enqueue writes between a successful restore and reload.
    try {
      const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
      for (const key of keys) {
        if (!key) continue;
        if (key.startsWith("tideplan.draft.")) localStorage.removeItem(key);
      }
      sessionStorage.setItem("tideplan.restore-snapshot", snapshotPath);
    } catch {
      /* Database restore succeeded; do not report a rolled-back restore. */
    }
    window.location.reload();
    return snapshotPath;
  });
}
