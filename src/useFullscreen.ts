import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { platform } from "./platform";

export function useFullscreen(onError: (message: string) => void) {
  const [fullscreen, setFullscreen] = useState(false);
  const [busy, setBusy] = useState(false);
  const changing = useRef(false);
  const browserExpanded = useRef(false);

  useEffect(() => {
    if (platform.mobile) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    const sync = async () => {
      try {
        const value = isTauri()
          ? await getCurrentWindow().isMaximized()
          : browserExpanded.current;
        if (active) setFullscreen(value);
      } catch {
        // A failed background query should not interrupt the current workspace.
      }
    };
    void sync();
    if (isTauri()) {
      void getCurrentWindow().onResized(() => void sync()).then((stop) => {
        if (active) unlisten = stop;
        else stop();
      }).catch(() => undefined);
    }
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("focus", sync);
    return () => {
      active = false;
      unlisten?.();
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("focus", sync);
    };
  }, []);

  const change = useCallback(async (exit = false) => {
    if (platform.mobile) return;
    if (changing.current) return;
    changing.current = true;
    setBusy(true);
    try {
      if (isTauri()) {
        const appWindow = getCurrentWindow();
        // Maximization respects the desktop work area reserved for system panels.
        if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
        const current = await appWindow.isMaximized();
        if (exit || current) await appWindow.unmaximize();
        else await appWindow.maximize();
        setFullscreen(await appWindow.isMaximized());
      } else {
        // Browser preview expands the application within the browser window.
        if (document.fullscreenElement) await document.exitFullscreen();
        browserExpanded.current = exit ? false : !browserExpanded.current;
        setFullscreen(browserExpanded.current);
      }
    } catch {
      onError("无法切换全屏，请稍后重试");
    } finally {
      changing.current = false;
      setBusy(false);
    }
  }, [onError]);

  useEffect(() => {
    if (platform.mobile) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "F11" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (!event.repeat) void change();
      } else if (event.key === "Escape" && fullscreen &&
        !document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]')) {
        event.preventDefault();
        if (!event.repeat) void change(true);
      }
    };
    // Inspect dialogs before their own Escape handlers can remove them from the DOM.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [change, fullscreen]);

  return { fullscreen, busy, toggle: () => change() };
}
