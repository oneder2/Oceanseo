import { invoke, isTauri } from "@tauri-apps/api/core";

export const APP_STATE_KEYS = {
  reminders: "tideplan.reminders.v1",
  purchases: "tideplan.purchase-list.v1",
  mealPlan: "tideplan.meal-plan.v1",
  mealChecked: "tideplan.shopping-checked.v1",
  countdowns: "tideplan.countdowns.v1",
  mealPreferences: "tideplan.meal-preferences.v1",
} as const;

type AppStateKey = typeof APP_STATE_KEYS[keyof typeof APP_STATE_KEYS];

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

function mirrorState(state: Record<string, unknown>) {
  for (const key of Object.values(APP_STATE_KEYS)) {
    if (Object.hasOwn(state, key)) localStorage.setItem(key, JSON.stringify(state[key]));
  }
}

export async function bootstrapAppData() {
  if (!isTauri()) return;
  const state = await invoke<Record<string, unknown>>("bootstrap_app_state", {
    legacy: legacyAppState(),
  });
  mirrorState(state);
}

export async function persistAppState(key: AppStateKey, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  if (isTauri()) await invoke("set_app_state", { key, value });
}
