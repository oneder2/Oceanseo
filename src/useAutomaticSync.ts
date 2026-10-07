import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { appPersistence, withAppDataGate } from "./appDataStore";
import { currentProfileKey, profileSessionStorage } from "./profileStorage";
import { applyAutomaticSync, AutomaticSyncScheduler, syncFailure, type AutomaticCheck, type AutomaticSyncSettings,
  type AutomaticSyncStatus, type SyncReceipt } from "./automaticSync";
import { rememberSyncView } from "./syncView";
import type { View } from "./types";

interface Options { ready: boolean; blocked: boolean; view: View; saved: unknown; savedGoals: unknown; onBusy: (busy: boolean) => void }
export function useAutomaticSync(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const scheduler = useRef<AutomaticSyncScheduler | null>(null);
  const [settings, setSettings] = useState<AutomaticSyncSettings | null>(null);
  const [status, setStatus] = useState<AutomaticSyncStatus>({ state: "off", message: "", retryAt: null });
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const reloadStarted = useRef(false);
  const requireReload = useCallback(() => {
    reloadStarted.current = true;
    flushSync(() => setReloadRequired(true));
    rememberSyncView(profileSessionStorage, latest.current.view);
  }, []);
  const retryReload = useCallback(() => {
    try { window.location.reload(); }
    catch (e) { setError(syncFailure(e).message); }
  }, []);
  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    const owner = scheduler.current;
    try {
      const value = await invoke<AutomaticSyncSettings>("get_automatic_sync_settings");
      if (owner && scheduler.current === owner) { setError(""); owner.configure(value); }
    } catch (e) {
      if (owner && scheduler.current === owner) {
        setError(syncFailure(e).message);
        owner.suspend(syncFailure(e).message);
      }
    }
  }, []);
  const setEnabled = useCallback(async (enabled: boolean) => {
    const value = await invoke<AutomaticSyncSettings>("set_automatic_sync_enabled", {
      profileKey: currentProfileKey(), enabled,
    });
    setError("");
    scheduler.current?.configure(value);
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let lastActivity = Date.now();
    const canCheck = () => !reloadStarted.current && latest.current.ready && !latest.current.blocked && document.visibilityState === "visible";
    const canCommit = () => canCheck() && appPersistence.status() === "saved"
      && Date.now() - lastActivity >= 8000
      && !document.querySelector('[role="dialog"], [aria-busy="true"], .date-picker-popover')
      && !(document.activeElement instanceof HTMLElement
        && document.activeElement.matches('input, textarea, select, [contenteditable="true"]'))
      // These views have no independent in-flight AI jobs or persistent inline
      // editors. Downloads reload all state consumers; other workspaces wait.
      && ["overview", "today", "all", "completed", "calendar"].includes(latest.current.view);
    const current = new AutomaticSyncScheduler(currentProfileKey(), {
      canCheck, canCommit, status: setStatus, settings: setSettings,
      check: () => navigator.onLine
        ? invoke<AutomaticCheck>("preview_automatic_sync", { profileKey: currentProfileKey() })
        : Promise.reject({ kind: "network", message: "当前离线，本机记录保留，联网后重试" }),
      commit: async plan => {
        if (!canCommit()) return null;
        return applyAutomaticSync({
          gate: withAppDataGate,
          commit: () => invoke<SyncReceipt>("commit_automatic_sync", {
              profileKey: currentProfileKey(), previewId: plan.previewId,
          }),
          freeze: busy => flushSync(() => latest.current.onBusy(busy)),
          beforeReload: requireReload,
          reload: () => window.location.reload(),
        });
      },
    });
    scheduler.current = current;
    void refresh();
    const wake = () => current.request();
    const activity = () => { lastActivity = Date.now(); };
    const unsubscribe = appPersistence.subscribe(() => {
      if (appPersistence.status() === "saved") current.request();
    });
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    document.addEventListener("pointerdown", activity, true);
    document.addEventListener("keydown", activity, true);
    document.addEventListener("input", activity, true);
    return () => {
      current.dispose();
      if (scheduler.current === current) scheduler.current = null;
      unsubscribe();
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
      document.removeEventListener("pointerdown", activity, true);
      document.removeEventListener("keydown", activity, true);
      document.removeEventListener("input", activity, true);
    };
  }, [refresh, requireReload]);
  useEffect(() => { scheduler.current?.request(); }, [options.saved, options.savedGoals]);
  return { settings, status, error, refresh, setEnabled, reloadRequired, retryReload, requireReload };
}
export type AutomaticSyncController = ReturnType<typeof useAutomaticSync>;

export function automaticSyncLabel(status: AutomaticSyncStatus) {
  return { off: "自动同步未启用", waiting: "等待空闲同步", checking: "正在检查云端",
    syncing: "正在同步", synced: "资料已同步", retry: "连接中断，稍后重试", paused: "同步需要处理" }[status.state];
}
