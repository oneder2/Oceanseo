import { invoke, isTauri } from "@tauri-apps/api/core";
import { ReliableState } from "./reliableState";

export const APP_STATE_KEYS = {
  reminders: "tideplan.reminders.v1",
  purchases: "tideplan.purchase-list.v1",
  mealPlan: "tideplan.meal-plan.v1",
  mealChecked: "tideplan.shopping-checked.v1",
  countdowns: "tideplan.countdowns.v1",
  mealPreferences: "tideplan.meal-preferences.v1",
  beads: "tideplan.bead-pattern.v1",
  life: "tideplan.life.v1",
  assistant: "tideplan.assistant.v1",
} as const;

type AppStateKey = (typeof APP_STATE_KEYS)[keyof typeof APP_STATE_KEYS];
export const appPersistence = new ReliableState(
  localStorage,
  Object.values(APP_STATE_KEYS),
  (key, value) =>
    isTauri()
      ? invoke<void>("set_app_state", { key, value })
      : Promise.resolve(),
);
const flushers = new Set<() => void>();
export function registerStateFlusher(flush: () => void) {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}
export async function flushAppData() {
  flushers.forEach((fn) => fn());
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
  const state = await invoke<Record<string, unknown>>("bootstrap_app_state", {
    legacy: legacyAppState(),
  });
  await appPersistence.recover(state);
}

export async function persistAppState(key: AppStateKey, value: unknown) {
  await appPersistence.persist(key, value);
}
