import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import type { MobileReminderStatus } from "./mobileReminders";

export default function MobileReminderPanel({ status, checking, onRefresh }: {
  status: MobileReminderStatus | null;
  checking: boolean;
  onRefresh: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  async function open(destination: "notifications" | "channel" | "battery") {
    setOpening(true);
    setError("");
    try { await invoke("open_mobile_reminder_settings", { destination }); }
    catch (e) { setError(String(e)); }
    finally { setOpening(false); }
  }
  return <section className="mobile-reminder-panel" aria-label="Android 提醒检查" aria-busy={checking}>
    <header><strong>手机提醒检查</strong><button type="button" disabled={checking || !isTauri()} onClick={onRefresh}>
      <RefreshCw size={14} className={checking ? "spin" : ""} />{checking ? "检查中" : "刷新状态"}
    </button></header>
    <dl>
      <div><dt>应用通知</dt><dd>{status ? status.appNotifications ? "已允许" : "未允许" : "待检查"}</dd></div>
      <div><dt>每日提醒频道</dt><dd>{status ? status.channelEnabled ? "已开启" : "已关闭" : "待检查"}</dd></div>
      <div><dt>电池优化</dt><dd>{status ? status.batteryOptimized ? "受系统优化" : "不受电池优化" : "待检查"}</dd></div>
      <div><dt>省电模式</dt><dd>{status ? status.powerSaveMode ? "已开启" : "未开启" : "待检查"}</dd></div>
    </dl>
    {status && <div className="mobile-reminder-schedule">
      <span>已安排的提醒 · {status.timeZone}</span>
      {status.nextTimes.length ? <ul>{status.nextTimes.map(time => <li key={time}>
        <time dateTime={new Date(time).toISOString()}>{new Date(time).toLocaleString("zh-CN", {
          month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: status.timeZone,
        })}</time>
        <small>{time <= Date.now() ? "已到计划时间，等待系统送达" : "计划时间"}</small>
      </li>)}</ul> : <p>暂无已安排的提醒</p>}
    </div>}
    <p className="mobile-reminder-help">这些是计划时间，不保证准点送达。锁屏、省电和厂商后台限制可能导致延迟；返回应用会自动复查状态。</p>
    <div className="mobile-reminder-links">
      <button type="button" disabled={opening || !isTauri()} onClick={() => void open("notifications")}>通知设置<ArrowUpRight size={14} /></button>
      <button type="button" disabled={opening || !isTauri()} onClick={() => void open("channel")}>频道设置<ArrowUpRight size={14} /></button>
      <button type="button" disabled={opening || !isTauri()} onClick={() => void open("battery")}>电池设置<ArrowUpRight size={14} /></button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
