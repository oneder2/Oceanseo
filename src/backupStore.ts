import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export interface DataBackup {
  schemaVersion: string;
  createdAt: string;
  tasks: unknown[];
  appState: Record<string, unknown>;
}

function isDataBackup(value: unknown): value is DataBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<DataBackup>;
  return backup.schemaVersion === "1.0.0"
    && typeof backup.createdAt === "string"
    && Array.isArray(backup.tasks)
    && Boolean(backup.appState)
    && typeof backup.appState === "object";
}

export async function exportDataBackup() {
  if (!isTauri()) return false;
  const backup = await invoke<DataBackup>("export_data_backup");
  const outputPath = await save({
    title: "备份潮汐计划数据",
    defaultPath: `潮汐计划备份-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: "JSON 备份", extensions: ["json"] }],
  });
  if (!outputPath) return false;
  await writeTextFile(outputPath, `${JSON.stringify(backup, null, 2)}\n`);
  return true;
}

export async function selectDataBackup() {
  if (!isTauri()) return null;
  const selectedPath = await open({
    title: "选择潮汐计划备份",
    multiple: false,
    directory: false,
    filters: [{ name: "JSON 备份", extensions: ["json"] }],
  });
  if (!selectedPath || Array.isArray(selectedPath)) return null;
  const content = await readTextFile(selectedPath);
  const parsed = JSON.parse(content) as unknown;
  if (!isDataBackup(parsed)) throw new Error("backup_invalid");
  return parsed;
}

export async function restoreDataBackup(backup: DataBackup) {
  if (!isTauri()) throw new Error("backup_desktop_only");
  await invoke("restore_data_backup", { backup });
}
