import type { View } from "./types";
import { moduleForView } from "./modules/catalog";

const KEY = "oceanseo.sync-return-view.v1";
export function rememberSyncView(storage: Pick<Storage, "setItem">, view: View) {
  try { storage.setItem(KEY, view); } catch { /* The data merge is already durable. */ }
}
export function takeSyncView(storage: Pick<Storage, "getItem" | "removeItem">): View {
  try {
    const saved = storage.getItem(KEY);
    const view = saved === "bead-home" || saved === "bead-progress" ? "bead-studio" : saved;
    storage.removeItem(KEY);
    return view && moduleForView(view as View) ? view as View : "overview";
  } catch { return "overview"; }
}
