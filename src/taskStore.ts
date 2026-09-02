import { invoke, isTauri } from "@tauri-apps/api/core";
import type { Horizon, Priority, Task, TaskDraft, TaskOrigin } from "./types";

const LEGACY_STORAGE_KEY = "tideplan.tasks.v1";

interface TaskRecord {
  schema_version: "1.0.0";
  id: string;
  title: string;
  notes: string;
  horizon: Horizon;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  origin: TaskOrigin | null;
}

interface LegacyTask {
  id: string;
  title: string;
  notes?: string;
  horizon: Horizon;
  priority: Priority;
  startDate?: string | null;
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export type DeepLinkMessage =
  | {
      outcome: "accepted";
      correlation_id: string;
      route: "open";
      task_id: string;
      mutates_task: false;
    }
  | {
      outcome: "accepted";
      correlation_id: string;
      route: "new";
      requires_user_save: true;
      title: string;
      horizon: Horizon;
      priority: Priority;
      start_date: string | null;
      due_date: string | null;
      source_label: string | null;
      source_ref: string | null;
    }
  | {
      outcome: "rejected";
      correlation_id: string;
      error_code: string;
    };

export interface BootstrapResult {
  tasks: Task[];
  migrationError: string | null;
}

function toTask(record: TaskRecord): Task {
  return {
    schemaVersion: record.schema_version,
    id: record.id,
    title: record.title,
    notes: record.notes,
    horizon: record.horizon,
    priority: record.priority,
    startDate: record.start_date ?? "",
    dueDate: record.due_date ?? "",
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    completedAt: record.completed_at,
    origin: record.origin,
  };
}

function mutation(draft: TaskDraft, origin?: TaskOrigin | null) {
  return {
    title: draft.title.trim(),
    notes: draft.notes,
    horizon: draft.horizon,
    priority: draft.priority,
    startDate: draft.startDate || null,
    dueDate: draft.dueDate || null,
    origin: origin ?? null,
  };
}

function browserLegacyTasks(): Task[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return [];
    const records = JSON.parse(raw) as LegacyTask[];
    if (!Array.isArray(records)) return [];
    return records.map((record) => ({
      schemaVersion: "1.0.0",
      id: record.id,
      title: record.title,
      notes: record.notes ?? "",
      horizon: record.horizon,
      priority: record.priority,
      startDate: record.startDate ?? "",
      dueDate: record.dueDate ?? "",
      createdAt: record.createdAt,
      updatedAt: record.completedAt ?? record.createdAt,
      completedAt: record.completedAt ?? null,
      origin: { kind: "migration", label: "Browser preview", reference: null },
    }));
  } catch {
    return [];
  }
}

let previewTasks: Task[] | null = null;

export async function bootstrapTasks(): Promise<BootstrapResult> {
  if (!isTauri()) {
    previewTasks ??= browserLegacyTasks();
    return { tasks: previewTasks, migrationError: null };
  }

  const rawPayload = localStorage.getItem(LEGACY_STORAGE_KEY);
  let migrationError: string | null = null;
  try {
    await invoke("migrate_legacy_tasks", { rawPayload });
  } catch (error) {
    migrationError = String(error);
  }
  const records = await invoke<TaskRecord[]>("list_tasks");
  return { tasks: records.map(toTask), migrationError };
}

export async function createTask(draft: TaskDraft, origin: TaskOrigin | null): Promise<Task> {
  if (!isTauri()) {
    const now = new Date().toISOString();
    const task: Task = {
      schemaVersion: "1.0.0",
      id: crypto.randomUUID(),
      ...draft,
      title: draft.title.trim(),
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      origin: origin ?? { kind: "local", label: null, reference: null },
    };
    previewTasks = [task, ...(previewTasks ?? [])];
    return task;
  }
  return toTask(await invoke<TaskRecord>("create_task", { mutation: mutation(draft, origin) }));
}

export async function updateTask(id: string, draft: TaskDraft): Promise<Task> {
  if (!isTauri()) {
    const existing = (previewTasks ?? []).find((task) => task.id === id);
    if (!existing) throw new Error("task_not_found");
    const updated = { ...existing, ...draft, title: draft.title.trim(), updatedAt: new Date().toISOString() };
    previewTasks = (previewTasks ?? []).map((task) => task.id === id ? updated : task);
    return updated;
  }
  return toTask(await invoke<TaskRecord>("update_task", { id, mutation: mutation(draft) }));
}

export async function setTaskCompleted(id: string, completed: boolean): Promise<Task> {
  if (!isTauri()) {
    const existing = (previewTasks ?? []).find((task) => task.id === id);
    if (!existing) throw new Error("task_not_found");
    const updated = {
      ...existing,
      completedAt: completed ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    };
    previewTasks = (previewTasks ?? []).map((task) => task.id === id ? updated : task);
    return updated;
  }
  return toTask(await invoke<TaskRecord>("set_task_completed", { id, completed }));
}

export async function deleteTask(id: string): Promise<void> {
  if (!isTauri()) {
    previewTasks = (previewTasks ?? []).filter((task) => task.id !== id);
    return;
  }
  await invoke("delete_task", { id });
}

export async function getTask(id: string): Promise<Task> {
  if (!isTauri()) {
    const task = (previewTasks ?? []).find((candidate) => candidate.id === id);
    if (!task) throw new Error("task_not_found");
    return task;
  }
  return toTask(await invoke<TaskRecord>("get_task", { id }));
}

export async function takePendingDeepLinks(): Promise<DeepLinkMessage[]> {
  if (!isTauri()) return [];
  return invoke<DeepLinkMessage[]>("take_pending_deep_links");
}
