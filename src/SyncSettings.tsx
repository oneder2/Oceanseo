import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowDownToLine, ArrowUpFromLine, Check, Cloud, RefreshCw, X } from "lucide-react";
import { applySync, checkSync, exportSyncRecovery, syncStatus, type SyncConflict, type SyncPlan, type SyncStatus } from "./syncStore";
import "./sync.css";
import { profileStatus, type LocalProfile } from "./accountStore";
import { automaticSyncLabel, type AutomaticSyncController } from "./useAutomaticSync";
import { syncFailure } from "./automaticSync";

function Version({ value, goals }: { value: SyncConflict["local"]; goals: boolean }) {
  if (!value) return <p className="sync-deleted">已删除／此端无记录</p>;
  if (!goals) return <div className="sync-version">
    <strong>{String(value.title ?? "未命名事项")}</strong>
    <p>{value.completed_at ? "已完成" : "未完成"} · {value.priority === "important" ? "重要" : "普通"} · {value.horizon === "long" ? "长期" : value.horizon === "mid" ? "中期" : "短期"}</p>
    <p>开始：{String(value.start_date ?? "未设定")}<br />截止：{String(value.due_date ?? "未设定")}</p>
    <p className="sync-note">{String(value.notes || "没有笔记")}</p>
  </div>;
  const items = (key: string) => Array.isArray(value[key]) ? value[key] as Record<string, unknown>[] : [];
  const chat = value.conversation as { messages?: { role: string; text: string }[] } | undefined;
  return <div className="sync-version">
    <p>{items("goals").length} 个目标 · {items("actions").length} 项行动 · {chat?.messages?.length ?? 0} 条对话</p>
    <ul>{items("goals").slice(0, 6).map((g, i) => <li key={i}>{String(g.title)}</li>)}</ul>
    <p className="sync-note">{chat?.messages?.at(-1)?.text || "没有已保存对话"}</p>
    <details><summary>查看完整版本</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </div>;
}

export default function SyncSettings({ onBusy, automatic }: { onBusy: (busy: boolean) => void; automatic: AutomaticSyncController }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<SyncPlan | null>(null);
  const [choices, setChoices] = useState<Record<string, "local" | "remote">>({});
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const accountMode = !!profile && profile.key !== "local";
  const dirty = !!token || endpoint !== (status?.endpoint ?? "");
  async function refresh() {
    const value = await syncStatus();
    setStatus(value);
    setEndpoint(value.endpoint);
  }
  useEffect(() => {
    let mounted = true;
    if (isTauri()) void profileStatus().then(value => { if (mounted) setProfile(value.current); }).catch(e => { if (mounted) setError(String(e)); });
    if (isTauri()) void syncStatus().then(value => { if (mounted) { setStatus(value); setEndpoint(value.endpoint); } }).catch(e => { if (mounted) setError(String(e)); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => {
    if (isTauri() && profile) void refresh().catch(e => setError(String(e)));
    if (profile) void automatic.refresh();
  }, [profile?.key, profile?.signedIn]);
  useEffect(() => {
    const previewId = plan?.previewId;
    return () => {
      if (isTauri() && previewId) void invoke("discard_sync_preview", { previewId }).catch(() => undefined);
    };
  }, [plan?.previewId]);
  async function action(fn: () => Promise<void>, applying = false) {
    if (busy) return;
    setBusy(true); onBusy(true); setError(""); setMessage("");
    try { await fn(); }
    catch (e) { setError(syncFailure(e).message.replace(/^Error: /, "")); if (applying) setPlan(null); }
    finally { setBusy(false); onBusy(false); }
  }
  return <section className="sync-settings" aria-label="跨设备同步" aria-busy={busy}>
    <header className="sync-heading"><Cloud size={21} /><div><strong>跨设备同步</strong><p>在电脑整理，在手机继续</p></div><span>内测</span></header>
    <div className="sync-status" role="status">
      <strong>{busy ? "正在核对资料…" : status?.configured ? "服务已配置" : "尚未连接同步服务"}</strong>
      <p>{status?.lastSuccess ? `最近完成：${new Date(status.lastSuccess).toLocaleString("zh-CN")} · 服务版本 ${status.revision}` : "本机记录会一直保留，连接后先检查两端更改。"}</p>
      {status && <p>本机有 {status.pending} 项记录较上次同步有变化</p>}
    </div>
    <p className="sync-scope">当前同步：任务（含笔记、日期与完成状态）、目标、已保存对话与交付清单。API 密钥、未提交草稿、通知时间和生活模块暂留各自设备。</p>
    {accountMode && <div className="sync-automatic">
      <label className="sync-auto-toggle"><span>本设备自动同步</span><input type="checkbox" role="switch" aria-label="本设备自动同步"
        checked={automatic.settings?.enabled ?? false} disabled={busy || !automatic.settings || (!profile.signedIn && !automatic.settings.enabled)}
        onChange={e => { const enabled = e.target.checked; void action(() => automatic.setEnabled(enabled)); }} /></label>
      <div className={`sync-auto-status is-${automatic.status.state}`} role="status"><strong>{automaticSyncLabel(automatic.status)}</strong>
        {automatic.status.message && <p>{automatic.status.message}</p>}
        {automatic.status.retryAt && <p>下次尝试：{new Date(automatic.status.retryAt).toLocaleTimeString("zh-CN")}</p>}
      </div>
      {automatic.settings?.pause && automatic.settings.pause === "auth" && profile.signedIn && <button className="secondary-button" type="button" disabled={busy} onClick={() => void action(() => automatic.setEnabled(true))}><RefreshCw size={15} />重新检查会话</button>}
      {automatic.error && <p className="sync-error" role="alert">{automatic.error}</p>}
    </div>}
    {!accountMode && <p className="sync-scope">个人令牌使用手动同步，仅供同一人的设备使用；不同用户请使用独立账号。</p>}
    {accountMode ? <p className="sync-scope">当前同步账号：{profile.username}。{profile.signedIn ? "使用这台设备的独立会话。" : "请在上方重新登录，离线记录仍会保留。"}</p> : (!isTauri() || profile) && <form onSubmit={e => { e.preventDefault(); void action(async () => {
      await invoke("save_sync_config", { endpoint, token: token || null });
      setToken(""); setPlan(null); await refresh(); setMessage("配置已保存。点击检查更改，确认后才会上传。 ");
    }); }}>
      <label>同步服务地址<input aria-label="同步服务地址" type="url" placeholder="https://sync.example.com" autoCapitalize="none" spellCheck={false} value={endpoint} onChange={e => { setEndpoint(e.target.value); setPlan(null); }} disabled={busy} /></label>
      <label>访问令牌<input aria-label="同步访问令牌" type="password" autoComplete="off" placeholder={status?.configured ? "已保存；留空保持原令牌" : "由你的同步服务器提供"} value={token} onChange={e => { setToken(e.target.value); setPlan(null); }} disabled={busy} /></label>
      <button className="secondary-button" disabled={!isTauri() || busy || !endpoint || (!token && !status?.configured)} type="submit">保存同步配置</button>
    </form>}
    {!isTauri() && <p className="sync-hint">浏览器仅预览界面。请在手机或桌面应用中连接同步服务。</p>}
    <div className="sync-actions">
      <button className="primary-button" type="button" disabled={!status?.configured || busy || dirty || (isTauri() && !profile) || (accountMode && !profile.signedIn)} onClick={() => void action(async () => {
        setPlan(null); setChoices({}); const next = await checkSync(); setPlan(next); await refresh();
      })}><RefreshCw size={15} className={busy ? "spin" : ""} />检查更改</button>
      <small>{dirty ? "先保存配置，再检查更改" : "联网后可再次检查；失败不会清空本机数据"}</small>
      {status?.configured && !accountMode && <button className="secondary-button" type="button" disabled={busy} onClick={() => void action(async () => {
        await invoke("disconnect_sync"); setToken(""); setPlan(null); await refresh();
        setMessage("已清除本机同步令牌。两端数据仍保留，重新连接原资料库可继续同步。");
      })}>断开连接</button>}
    </div>
    {plan && <div className="sync-plan">
      <h3>{plan.firstConnection ? "首次连接，确认同步内容" : "本次更改"}</h3>
      <div className="sync-counts"><span><ArrowUpFromLine size={16} />上传 {plan.uploadCount} 项</span><span><ArrowDownToLine size={16} />接收 {plan.downloadCount} 项</span></div>
      {!!plan.changes.length && <details className="sync-change-list" open={plan.changes.some(c => c.deleted)}><summary>查看 {plan.changes.length} 项更改{plan.changes.some(c => c.deleted) ? "（包含删除）" : ""}</summary>
        <ul>{plan.changes.map(change => <li key={change.key}><strong>{change.title}</strong><span className={change.deleted ? "sync-deleted" : ""}>{change.deleted ? "删除" : "新增或更新"} · {change.upload && change.download ? "两端合并" : change.upload ? "上传" : "接收"}</span></li>)}</ul>
      </details>}
      <p>{plan.conflicts.length ? `另有 ${plan.conflicts.length} 项内容在两端都有更改（未计入以上数量）。以下选择会影响两端；未选择前不会提交任何内容。` : "未发现需要你决定的冲突，不同事项及互不重叠的任务字段会合并。"}</p>
      {plan.conflicts.map(conflict => <fieldset className="sync-conflict" key={conflict.key}>
        <legend>{conflict.key === "goals" ? "目标与对话" : String(conflict.local?.title || conflict.remote?.title || "事项冲突")}</legend>
        {conflict.key === "goals" && <p>理解图、清单和执行回执作为一个整体选择，避免自动拼接导致重复执行。两端原始版本均保存为本机安全副本。</p>}
        <div className="sync-versions">{(["local", "remote"] as const).map(side => <div key={side} className={choices[conflict.key] === side ? "is-selected" : ""}>
          <label><input type="radio" name={conflict.key} checked={choices[conflict.key] === side} onChange={() => setChoices(current => ({ ...current, [conflict.key]: side }))} disabled={busy} />{side === "local" ? "保留本机版本" : "保留服务端版本"}</label>
          <Version value={conflict[side]} goals={conflict.key === "goals"} />
        </div>)}</div>
      </fieldset>)}
      <p className="sync-hint">确认会上传上述范围的记录，并接收另一台设备的修改和删除。完成后重新载入页面，本机未提交草稿保留。服务器管理员可读取同步内容。</p>
      <button type="button" className="primary-button" disabled={busy || plan.conflicts.some(c => !choices[c.key])} onClick={() => void action(async () => { await applySync(plan.previewId, choices, automatic.requireReload); }, true)}><Check size={16} />确认同步并重新载入</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setPlan(null)}><X size={16} />取消本次检查</button>
    </div>}
    {message && <p className="sync-hint" role="status">{message}</p>}
    {status?.recoveryAvailable && <div className="sync-recovery"><button className="secondary-button" type="button" disabled={busy} onClick={() => void action(async () => {
      if (await exportSyncRecovery()) setMessage("安全副本已导出，包含同步前的本机备份与两端版本。可用“选择备份”恢复其中的本机备份。");
    })}>导出上次同步前安全副本</button><p className="sync-hint">包含完整本机备份与冲突双方内容，请私人保管。恢复后需重新检查同步。</p></div>}
    {error && <p className="sync-error" role="alert">{error}</p>}
  </section>;
}
