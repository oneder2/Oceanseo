import { useEffect, useSyncExternalStore } from "react";
import { capabilitySnapshot, refreshCapabilities, subscribeCapabilities } from "./capabilities";
export function useCapabilities() {
  const status = useSyncExternalStore(subscribeCapabilities, capabilitySnapshot);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void refreshCapabilities().catch(() => undefined); };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return status;
}
