import { invoke, isTauri } from "@tauri-apps/api/core";
import type { View } from "./types";
import { viewSupportsPlatform, type ModulePlatform } from "./modules/catalog";
import { canView } from "./modules/capabilities";

export type Platform = ModulePlatform;
export const platform = {
  name: "browser" as Platform,
  mobile: false,
  desktop: false,
  workMonitor: true,
};

// Resolve from the native runtime before React mounts. isTauri() alone cannot
// distinguish desktop plugins from mobile plugins; screen width is not an OS.
export async function initializePlatform() {
  const name = isTauri() ? await invoke<Platform>("get_runtime_platform") : "browser";
  platform.name = name;
  platform.mobile = name === "android" || name === "ios";
  platform.desktop = ["linux", "windows", "macos"].includes(name);
  platform.workMonitor = !platform.mobile;
  document.documentElement.dataset.platform = name;
}

export function viewAvailable(view: View) {
  return viewSupportsPlatform(view, platform.name) && canView(view);
}
