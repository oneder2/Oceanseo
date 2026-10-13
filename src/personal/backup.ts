import type { ModuleId } from "../modules/catalog";
import { emptyWorkspaces, PENDING } from "./model";

// Old backups have a single global tool document. Restore it into an explicit
// legacy scene rather than leave it invisible behind an existing registry.
export function legacyPersonalBackup(backup: { tasks: unknown[]; appState: Record<string, unknown> }) {
  const document = emptyWorkspaces();
  const modules = new Set<ModuleId>();
  const keyModules: Record<string, ModuleId> = {
    "purchase-list": "shopping-list", "shopping-checked": "shopping-list",
    "meal-plan": "meal-planner", "meal-preferences": "meal-planner",
    countdowns: "countdowns", "bead-pattern": "bead-studio", "bead-works": "bead-studio",
    assistant: "goals", goals: "goals", infrastructure: "infrastructure",
  };
  for (const [key, value] of Object.entries(backup.appState)) {
    if (value === null || (Array.isArray(value) && !value.length)) continue;
    const part = key.match(/^tideplan\.(.+)\.v1$/)?.[1];
    if (part && Object.hasOwn(keyModules, part)) modules.add(keyModules[part]);
    if (part === "life" && value && typeof value === "object") {
      for (const [field, module] of [["people", "people"], ["training", "fitness"], ["workouts", "fitness"], ["trips", "travel"]] as const) {
        const records = (value as Record<string, unknown>)[field];
        if (Array.isArray(records) && records.length) modules.add(module);
      }
    }
  }
  for (const task of backup.tasks) if (task && typeof task === "object" && "id" in task && typeof task.id === "string") document.taskOwners[task.id] = PENDING;
  const states: Record<string, Record<string, unknown>> = {};
  if (modules.size) {
    const id = crypto.randomUUID();
    document.workspaces.push({ id, name: "旧版资料", main: false, style: "neutral", deleted: false,
      tools: [...modules].map(module => ({ id: crypto.randomUUID(), module, archived: false })) });
    states[id] = backup.appState;
  }
  return { personalWorkspaceVersion: 1, createdAt: new Date().toISOString(), document, backup, states, workArchives: {} };
}
