import { invoke, isTauri } from "@tauri-apps/api/core";

export async function initializeEdition() {
  if (isTauri() && await invoke<string>("get_runtime_edition") !== "personal") {
    throw Error("product_edition_invalid");
  }
}
export function defaultAccountEndpoint() {
  return "https://oceanseo.gellaronline.cc";
}
