import { profileLocalStorage as localStorage } from "./profileStorage";
import { invoke, isTauri } from "./personal/invoke";
import { ReliableState } from "./reliableState";
import { requireStateWrite } from "./modules/capabilities";

export const APP_STATE_KEYS = {
  reminders: "tideplan.reminders.v1",
  purchases: "tideplan.purchase-list.v1",
  mealPlan: "tideplan.meal-plan.v1",
  mealChecked: "tideplan.shopping-checked.v1",
  countdowns: "tideplan.countdowns.v1",
  mealPreferences: "tideplan.meal-preferences.v1",
  beads: "tideplan.bead-pattern.v1",
  beadWorks: "tideplan.bead-works.v1",
  life: "tideplan.life.v1",
  assistant: "tideplan.assistant.v1",
  goals: "tideplan.goals.v1",
  infrastructure: "tideplan.infrastructure.v1",
} as const;

type AppStateKey = (typeof APP_STATE_KEYS)[keyof typeof APP_STATE_KEYS];
let restoring = false;
let legacyImportFailed = false;
// A denied/failed first import must remain exportable, even without an outbox.
export function hasUnimportedAppData() { return legacyImportFailed; }
export function assertAppWritable() {
  if (restoring) throw Error("正在合并或恢复数据，请完成后再保存目标");
}
export async function withAppRestore<T>(restore: () => Promise<T>) {
  return withAppDataGate(restore, () => true);
}
export async function withAppDataGate<T>(action: () => Promise<T>, keepLocked: (result: T) => boolean) {
  if (restoring) throw Error("restore_in_progress");
  restoring = true;
  let retained = false;
  try {
    await flushAppData();
    return await appPersistence.exclusive(action, result => {
      retained = keepLocked(result);
      return retained;
    });
  } finally { if (!retained) restoring = false; }
}
export const appPersistence = new ReliableState(
  localStorage,
  Object.values(APP_STATE_KEYS),
  (key, value) =>
    isTauri()
      ? invoke<void>("set_app_state", { key, value })
      : Promise.resolve(),
  requireStateWrite,
);
const flushers = new Set<() => void | Promise<void>>();
export function registerStateFlusher(flush: () => void | Promise<void>) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushAppData() {
  await Promise.all([...flushers].map((fn) => fn()));
  await appPersistence.flush();
}

function legacyAppState() {
  const legacy: Record<string, unknown> = {};
  for (const key of Object.values(APP_STATE_KEYS)) {
    const rawValue = localStorage.getItem(key);
    if (!rawValue) continue;
    try {
      legacy[key] = JSON.parse(rawValue) as unknown;
    } catch {
      // Existing store validators retain malformed values until the user overwrites them.
    }
  }
  return legacy;
}

export async function bootstrapAppData() {
  if (!isTauri()) return;
  let state: Record<string, unknown>;
  try {
    state = await invoke<Record<string, unknown>>("bootstrap_app_state", { legacy: legacyAppState() });
    legacyImportFailed = false;
  } catch (error) {
    legacyImportFailed = true;
    throw error;
  }
  await appPersistence.recover(state);
}

export async function persistAppState(key: AppStateKey, value: unknown) {
  await appPersistence.persist(key, value);
}
