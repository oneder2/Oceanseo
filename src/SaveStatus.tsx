import { useState, useSyncExternalStore } from "react";
import { appPersistence, flushAppData } from "./appDataStore";
export default function SaveStatus({ ready }: { ready: boolean }) {
  const status = useSyncExternalStore(
    appPersistence.subscribe,
    appPersistence.status,
  );
  const [retrying, setRetrying] = useState(false);
  return (
    <div
      className={`save-status save-status-${status}`}
      onMouseDown={(e) => e.stopPropagation()}
      role="status"
    >
      <span>
        {!ready
          ? "等待数据载入"
          : status === "saved"
            ? "自动保存已完成"
            : status === "saving"
              ? "正在自动保存…"
              : "自动保存尚未完成"}
      </span>
      {(status === "error" || status === "pending") && (
        <button
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            try {
              await flushAppData();
            } catch {
              /* Keep durable queue and visible failure. */
            } finally {
              setRetrying(false);
            }
          }}
        >
          {retrying ? "正在重试…" : "重试保存"}
        </button>
      )}
    </div>
  );
}
