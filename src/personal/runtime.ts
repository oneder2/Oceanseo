import { invoke, isTauri } from "@tauri-apps/api/core";
import { platform } from "../platform";
import { currentProfileKey, initializePersonalStorage, profileLocalStorage } from "../profileStorage";
import { emptyWorkspaces, validateDocument, type PersonalWorkspaceDocument } from "./model";
import type { ModuleId } from "../modules/catalog";

let document: PersonalWorkspaceDocument | undefined;
const listeners = new Set<() => void>();
const key = () => `oceanseo.personal.workspaces.v1:${currentProfileKey()}`;
export const personalEnabled = () => !!document;
export const personalSnapshot = () => document;
export const activeWorkspace = () => document?.workspaces.find(w => w.id === document!.activeId && !w.deleted);
export const subscribePersonal = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const personalScope = () => document?.activeId;
export function installed(module: ModuleId) {
  return !document || module === "tasks" || module === "overview"
    || !!activeWorkspace()?.tools.some(t => t.module === module && !t.archived);
}
export function publishPersonal(next: PersonalWorkspaceDocument) {
  if (!validateDocument(next)) throw Error("工作区资料无效，原资料已保留");
  document = next;
  if (globalThis.document) globalThis.document.documentElement.dataset.workspaceStyle = activeWorkspace()!.style;
  listeners.forEach(fn => fn());
}
export async function initializePersonal() {
  if (platform.name !== "linux" && platform.name !== "browser") return;
  if (isTauri()) {
    const keys = ["reminders", "purchase-list", "meal-plan", "shopping-checked", "countdowns", "meal-preferences", "bead-pattern", "bead-works", "life", "assistant", "goals", "infrastructure"];
    const legacy: Record<string,unknown> = {};
    for (const part of keys) { const key = `tideplan.${part}.v1`; const raw = profileLocalStorage.getItem(key); if (raw) legacy[key] = JSON.parse(raw); }
    publishPersonal(await invoke<PersonalWorkspaceDocument>("personal_workspaces", { legacy, rawPayload: profileLocalStorage.getItem("tideplan.tasks.v1") }));
  }
  else {
    const raw = globalThis.localStorage.getItem(key());
    publishPersonal(raw ? JSON.parse(raw) : emptyWorkspaces());
  }
  if (document) {
    profileLocalStorage.migrateSharedTools(document.workspaces.filter(w => !w.deleted).map(w => w.id), isTauri());
    initializePersonalStorage("main");
    globalThis.document.documentElement.dataset.workspaceStyle = activeWorkspace()!.style;
  }
}
export async function savePersonal(next: PersonalWorkspaceDocument) {
  next = { ...next, taskOwners: Object.fromEntries(Object.entries(next.taskOwners).map(([id, owner]) => [id,
    owner === "pending" || next.workspaces.some(w => w.id === owner && !w.deleted) ? owner : "pending",
  ])) };
  if (!document || !validateDocument(next)) throw Error("工作区资料无效");
  if (isTauri()) next = await invoke<PersonalWorkspaceDocument>("save_personal_workspaces", { document: next, expectedRevision: document.revision });
  else {
    next = { ...next, revision: document.revision + 1 };
    globalThis.localStorage.setItem(key(), JSON.stringify(next));
  }
  publishPersonal(next);
  return next;
}
export function mirrorTaskOwner(id: string, owner: string) {
  if (document) publishPersonal({ ...document, taskOwners: { ...document.taskOwners, [id]: owner } });
}

export async function refreshPersonal() {
  if (isTauri() && document) publishPersonal(await invoke<PersonalWorkspaceDocument>("personal_workspaces"));
}
