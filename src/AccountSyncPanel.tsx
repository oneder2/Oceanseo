import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronLeft, Cloud, CloudOff, RefreshCw } from "lucide-react";
import type { LocalProfile } from "./accountStore";
import { applySync, checkSync, syncStatus, type SyncPlan, type SyncStatus } from "./syncStore";
import { syncFailure } from "./automaticSync";
import type { AutomaticSyncController } from "./useAutomaticSync";
import "./account.css";

function Content({ value }: { value: Record<string, unknown> | null }) {
  if (!value) return <p>这份内容已删除</p>;
  if (typeof value.title === "string") return <>
    <strong>{value.title}</strong>
    <p>{value.completed_at ? "已完成" : "未完成"}{value.due_date ? ` · 截止 ${value.due_date}` : ""}</p>
    <p className="account-content-note">{String(value.notes || "没有笔记")}</p>
  </>;
  const goals = Array.isArray(value.goals) ? value.goals as { title: string }[] : [];
  const messages = (value.conversation as { messages?: { text: string }[] } | undefined)?.messages ?? [];
  return <><strong>{goals.length} 个目标 · {messages.length} 条对话</strong>
    <p>{goals.slice(0, 5).map(goal => goal.title).join("、") || "还没有目标"}</p>
    <p className="account-content-note">{messages.at(-1)?.text || "没有已保存对话"}</p>
  </>;
}

export default function AccountSyncPanel({ profile, automatic, onBusy }: {
  profile: LocalProfile; automatic: AutomaticSyncController; onBusy: (busy: boolean) => void;
}) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const received = useRef(false);
  const pause = automatic.settings?.pause;
  useEffect(() => {
    let active = true;
    void syncStatus().then(value => { if (active) setStatus(value); }).catch(() => {});
    void automatic.refresh();
    return () => { active = false; };
  }, [profile, automatic.status.state]);
  useEffect(() => {
    const previewId = plan?.previewId;
    return () => { if (previewId) void invoke("discard_sync_preview", { previewId }).catch(() => {}); };
  }, [plan?.previewId]);
  async function action(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); onBusy(true); setError("");
    try {
      await fn();
    } catch (e) {
      const kind = syncFailure(e).kind;
      setError(kind === "auth" ? "登录已失效，请重新登录。" : "暂时无法更新，你的记录仍保留在这台设备上。");
    } finally {
      if (!received.current) { setBusy(false); onBusy(false); }
    }
  }
  const offline = !profile.signedIn || pause === "auth";
  const label = offline ? "需要重新登录" : pause === "conflict" ? "有内容需要确认"
    : pause === "integrity" ? "暂时无法更新" : automatic.settings?.enabled === false ? "自动同步已暂停"
    : automatic.status.state === "retry" ? "离线保存中" : ["checking", "syncing"].includes(automatic.status.state) ? "正在更新"
    : status?.lastSuccess ? "已同步" : "正在连接";
  const conflict = plan?.conflicts[index];
  const apply = () => action(async () => {
    if (!plan) return;
    await applySync(plan.previewId, choices, () => { received.current = true; setReloadRequired(true); automatic.requireReload(); onBusy(true); });
  });
  return <section className="account-sync-panel" aria-label="账号同步" aria-busy={busy}>
    <div className="account-sync-heading">{offline || automatic.status.state === "retry" ? <CloudOff size={20} /> : <Cloud size={20} />}
      <div><strong>{label}</strong>{status?.lastSuccess && <p>最近更新 {new Date(status.lastSuccess).toLocaleString("zh-CN")}</p>}</div>
      <span className="account-sync-dot" data-paused={!!pause || !profile.signedIn} />
    </div>
    {offline && <p>离线记录仍会保留。</p>}
    {!offline && automatic.settings?.enabled === false && <button className="secondary-button" disabled={busy} onClick={() => void action(() => automatic.setEnabled(true))}><Cloud size={16} />恢复自动同步</button>}
    {pause === "conflict" && !plan && <button className="primary-button" disabled={busy} onClick={() => void action(async () => {
      setPlan(await checkSync()); setChoices({}); setIndex(0);
    })}><Check size={16} />确认待定内容</button>}
    {conflict && <div className="account-decision">
      <h3>哪份内容是你希望保留的？</h3><p>{index + 1} / {plan!.conflicts.length}</p>
      <div className="account-content-choices">{(["local", "remote"] as const).map(side => <label key={side} className={choices[conflict.key] === side ? "is-selected" : ""}>
        <span><input type="radio" name={conflict.key} aria-label={side === "local" ? "这台设备的内容" : "另一台设备的内容"} disabled={busy} checked={choices[conflict.key] === side}
          onChange={() => setChoices(previous => ({ ...previous, [conflict.key]: side }))} />{side === "local" ? "这台设备的内容" : "另一台设备的内容"}</span>
        <Content value={conflict[side]} />
      </label>)}</div>
      <p>两份内容都会保留安全副本。</p>
      <div className="account-actions">
        {index > 0 && <button className="secondary-button" disabled={busy} onClick={() => setIndex(index - 1)}><ChevronLeft size={16} />上一项</button>}
        {index < plan!.conflicts.length - 1 ? <button className="primary-button" disabled={busy || !choices[conflict.key]} onClick={() => setIndex(index + 1)}>下一项</button>
          : <button className="primary-button" disabled={busy || plan!.conflicts.some(item => !choices[item.key])} onClick={() => void apply()}><Check size={16} />确认保留并继续</button>}
      </div>
    </div>}
    {plan && !plan.conflicts.length && <button className="primary-button" disabled={busy} onClick={() => void apply()}><RefreshCw size={16} />继续更新</button>}
    {pause === "integrity" && <p role="alert">记录已保留。请联系维护者检查云端资料，暂不覆盖任何内容。</p>}
    {error && <p className="account-error" role="alert">{error}</p>}
    {reloadRequired && <button className="secondary-button" onClick={() => window.location.reload()}><RefreshCw size={16} />重新载入</button>}
  </section>;
}
