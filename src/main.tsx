import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { initializeProfileStorage } from "./profileStorage";
import "./styles.css";
import { initializePlatform } from "./platform";
import { initializeCapabilities } from "./modules/capabilities";
import { initializeEdition } from "./modules/edition";
import "./mobile.css";
import "./design-system.css";

document.documentElement.dataset.tauri = String(isTauri());

async function start() {
  await initializePlatform();
  await initializeEdition();
  const status = isTauri()
    ? await invoke<{ current: { key: string } }>("get_profile_status")
    : { current: { key: "local" } };
  initializeProfileStorage(status.current.key);
  await initializeCapabilities();
  const { initializePersonal } = await import("./personal/runtime");
  await initializePersonal();
  const { default: App } = await import("./App");
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
}

start().catch(() => {
  const root = document.getElementById("root")!;
  const message = document.createElement("p");
  message.textContent = "应用初始化未完成，原始资料已保留。请关闭应用后重新打开。";
  root.append(message);
});
