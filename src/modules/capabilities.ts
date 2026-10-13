import { invoke, isTauri } from "@tauri-apps/api/core";
import { moduleCatalog, moduleForView, type ModuleId } from "./catalog";
import type { View } from "../types";
import { installed } from "../personal/runtime";

export type ModuleAction = "visible" | "read" | "write" | "ai";
export interface ModuleActions { visible: boolean; read: boolean; write: boolean; ai: boolean }
export interface CapabilityStatus {
  source: "local" | "legacy" | "verified" | "cached" | "limited";
  environment: string | null; edition: string; workspaceId: string | null; role: string;
  modules: Record<ModuleId, ModuleActions>; management: { policies: boolean; cohorts: boolean }; message: string;
}
function defaults(enabled: boolean): Record<ModuleId, ModuleActions> {
  return Object.fromEntries(Object.keys(moduleCatalog).map(id => [id, { visible: enabled, read: enabled, write: enabled, ai: enabled }])) as Record<ModuleId, ModuleActions>;
}
let current: CapabilityStatus = { source: "local", environment: null, edition: "personal", workspaceId: null,
  role: "member", modules: defaults(true), management: { policies: false, cohorts: false }, message: "" };
const listeners = new Set<() => void>();
export const capabilitySnapshot = () => current;
export function subscribeCapabilities(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(status: CapabilityStatus) { current = status; listeners.forEach(listener => listener()); }
export function can(module: ModuleId, action: ModuleAction = "read") { return current.modules[module]?.[action] === true && installed(module); }
export function canView(view: View) { const id = moduleForView(view); return !!id && can(id, "visible") && can(id, "read"); }
export function requireModule(module: ModuleId, action: ModuleAction = "write") {
  if (!can(module, action)) throw Error(`当前空间暂不允许${moduleCatalog[module].title}的${action === "ai" ? "AI 操作" : "修改"}，已有资料仍保留`);
}
export async function initializeCapabilities() {
  if (isTauri()) publish(await invoke<CapabilityStatus>("get_module_capabilities"));

}
let refreshing: Promise<void> | undefined;
export async function refreshCapabilities() {
  if (!isTauri()) return;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    // Update cache age before any network request, so expiry cannot leave UI enabled.
    publish(await invoke<CapabilityStatus>("get_module_capabilities"));
    publish(await invoke<CapabilityStatus>("refresh_module_capabilities"));
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

export function changedStateModules(key: string, before: unknown, after: unknown): ModuleId[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const modules: Record<string, ModuleId> = {
    "tideplan.purchase-list.v1": "shopping-list", "tideplan.meal-plan.v1": "meal-planner",
    "tideplan.shopping-checked.v1": "shopping-list", "tideplan.countdowns.v1": "countdowns",
    "tideplan.meal-preferences.v1": "meal-planner", "tideplan.bead-pattern.v1": "bead-studio",
    "tideplan.assistant.v1": "goals", "tideplan.goals.v1": "goals", "tideplan.infrastructure.v1": "infrastructure",
    "tideplan.bead-works.v1": "bead-studio",
  };
  if (key === "tideplan.reminders.v1") return [];
  if (key === "tideplan.life.v1") {
    const result = new Set<ModuleId>();
    for (const [field, module] of [["people", "people"], ["training", "fitness"], ["workouts", "fitness"], ["trips", "travel"]] as const) {
      const a = before && typeof before === "object" ? (before as Record<string, unknown>)[field] : undefined;
      const b = after && typeof after === "object" ? (after as Record<string, unknown>)[field] : undefined;
      const empty = (v: unknown) => v === undefined || (Array.isArray(v) && !v.length);
      if (JSON.stringify(a) !== JSON.stringify(b) && !(empty(a) && empty(b))) result.add(module);
    }
    for (const v of [before, after]) if (v != null && (typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(field => !["version", "people", "training", "workouts", "trips"].includes(field)))) throw Error("生活数据包含未注册字段");
    return [...result];
  }
  const module = modules[key];
  if (!module) throw Error("未注册的数据模块");
  return [module];
}
export function requireStateWrite(key: string, before: unknown, after: unknown) { changedStateModules(key, before, after).forEach(module => requireModule(module)); }

/** Drop history when permissions narrow: historical prose has no reliable per-module provenance. */
export function canShareHistory() { return (Object.keys(moduleCatalog) as ModuleId[]).filter(installed).every(id => can(id)); }

export function projectLife<T extends { people: unknown[]; training: unknown[]; workouts: unknown[]; trips: unknown[] }>(life: T): T {
  return { ...life, people: can("people") ? life.people : [], training: can("fitness") ? life.training : [],
    workouts: can("fitness") ? life.workouts : [], trips: can("travel") ? life.trips : [] };
}
