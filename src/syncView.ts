import type { View } from "./types";

const VIEWS: readonly View[] = ["overview", "goals", "today", "all", "calendar", "countdowns", "meal-planner",
  "shopping-list", "work-monitor", "completed", "bead-studio", "people", "fitness", "travel", "infrastructure"];
const KEY = "oceanseo.sync-return-view.v1";
export function rememberSyncView(storage: Pick<Storage, "setItem">, view: View) {
  try { storage.setItem(KEY, view); } catch { /* The data merge is already durable. */ }
}
export function takeSyncView(storage: Pick<Storage, "getItem" | "removeItem">): View {
  try {
    const view = storage.getItem(KEY);
    storage.removeItem(KEY);
    return VIEWS.includes(view as View) ? view as View : "overview";
  } catch { return "overview"; }
}
