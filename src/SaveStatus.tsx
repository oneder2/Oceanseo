import { useState, useSyncExternalStore } from "react";
import { appPersistence, flushAppData } from "./appDataStore";
export default function SaveStatus({ ready, goals }: { ready: boolean; goals?: { loaded: boolean; busy: boolean; error: string; onInspect: () => void } }) {
  const appStatus = useSyncExternalStore(
    appPersistence.subscribe,
    appPersistence.status,
  );
  const status = goals?.error ? "error" : appStatus === "error" || appStatus === "pending" ? appStatus : goals?.busy ? "saving" : appStatus;
  const [retrying, setRetrying] = useState(false);
  return (
    <div
      className={`save-status save-status-${status}`}
      onMouseDown={(e) => e.stopPropagation()}
      role="status"
    >
      <span>
        {goals?.error
          ? "目标操作需要检查"
          : !ready || (goals && !goals.loaded)
          ? "等待数据载入"
          : status === "saved"
            ? "自动保存已完成"
            : status === "saving"
              ? "正在自动保存…"
              : "自动保存尚未完成"}
      </span>
      {goals?.error && <button onClick={goals.onInspect}>查看详情</button>}
      {(appStatus === "error" || appStatus === "pending") && (
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
